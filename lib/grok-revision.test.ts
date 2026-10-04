import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import type { CaseDocument, CaseRecord } from "./case";
import { LOG_KINDS } from "./case";
import { parseCaseDocument } from "./case-validate";
import { newCase } from "./case-ops";
import { PhysicsUnavailableError } from "./flight-client";
import { grokInstructions } from "./grok-instructions";
import { failedRevision, givenText, reviseCase } from "./grok-revision";
import type { GrokTrace } from "./grok-run";
import type { ScoreOrbit } from "./holdout";
import { ingestText } from "./ingest";
import { parseOem } from "./oem";
import { reduceOem, sunSynchronousInclinationDeg } from "./oem-reduce";
import { circularOemText } from "./test-support/circular-oem";

const root = fileURLToPath(new URL("..", import.meta.url));
const ingested = ingestText("records.json", readFileSync(`${root}fixtures/orin-case/records.json`, "utf8"));
if (!ingested.ok) throw new Error("the Orin fixture must ingest");
const RECORDS: CaseRecord[] = ingested.records;

const CASE_ID = "5a4c1f0e-3b7d-4b36-9c1a-2f6d7a8e9b10";
const T0 = "2026-10-04T00:00:00.000Z";
const T1 = "2026-10-04T01:00:00.000Z";
const OEM = circularOemText({ altitudeKm: 650, inclinationDeg: sunSynchronousInclinationDeg(650) });
const INSTRUCTION = "Choose a dawn-dusk orbit that spares the Orin.";

const orin = (over: Partial<CaseDocument> = {}): CaseDocument => ({
  ...newCase(CASE_ID, T0, "user-1"),
  records: RECORDS.map((r) => ({ ...r })),
  chipIds: ["nvidia_jetson_agx_orin"],
  workingOem: "WORKING COPY TEXT",
  ...over,
});

function trace(over: Partial<GrokTrace> = {}): GrokTrace {
  return {
    model: "grok-4.7",
    mode: "mcp",
    retrieval: { kind: "inline", records: 12, collectionFailed: null },
    systemInstructions: grokInstructions(CASE_ID),
    usedWorkingOem: true,
    candidate: OEM,
    submissions: 1,
    assistantText: "I chose a dawn-dusk sun-synchronous orbit.",
    toolCalls: ["submit_oem"],
    fileSearchQueries: [],
    requests: 1,
    incomplete: null,
    ...over,
  };
}

const lifetime = (years: number): ScoreOrbit => async () => ({ refused: false, lifetime_years: years, assumptions_note: "A ranking under assumed coefficients." });
const kinds = (doc: CaseDocument) => doc.log.map((e) => e.kind);

// The fixture's holdout outcomes: a failure at 4.5 years and a survivor censored at 2. A lifetime of 3 gives error 0.75.
describe("a kept revision", () => {
  it("logs the instruction, the file, the score and the keep, and replaces the optimized file", async () => {
    const result = await reviseCase({ doc: orin(), instruction: INSTRUCTION, trace: trace(), now: T1, scoreOrbit: lifetime(3) });
    expect(result.verdict).toBe("kept");
    expect(kinds(result.doc)).toEqual(["instruction", "proposal", "score", "kept"]);
    expect(result.doc.optimizedOem).toBe(OEM);
    expect(result.doc.holdoutError).toBeCloseTo(0.75, 12);
    expect(result.doc.updatedAt).toBe(T1);

    const [asked, proposal, score, kept] = result.doc.log;
    expect(asked.text).toBe(INSTRUCTION);
    expect(proposal.oem).toBe(OEM);
    expect(score.holdout_error).toBeCloseTo(0.75, 12);
    expect(kept).toMatchObject({ kind: "kept", oem: OEM });
    expect(kept.holdout_error).toBeCloseTo(0.75, 12);
  });

  it("leaves the working copy exactly as the person left it", async () => {
    const result = await reviseCase({ doc: orin(), instruction: INSTRUCTION, trace: trace(), now: T1, scoreOrbit: lifetime(3) });
    expect(result.doc.workingOem).toBe("WORKING COPY TEXT");
  });

  it("keeps the records, the chip selection, and every earlier log entry", async () => {
    const before = orin({ log: [{ at: T0, kind: "hand_edit", text: "earlier", oem: null, holdout_error: null }] });
    const result = await reviseCase({ doc: before, instruction: INSTRUCTION, trace: trace(), now: T1, scoreOrbit: lifetime(3) });
    expect(result.doc.records).toEqual(before.records);
    expect(result.doc.chipIds).toEqual(before.chipIds);
    expect(result.doc.log[0]).toEqual(before.log[0]);
  });

  it("scores against the rows and says where every number came from, including what is assumed", async () => {
    const result = await reviseCase({ doc: orin(), instruction: INSTRUCTION, trace: trace(), now: T1, scoreOrbit: lifetime(3) });
    const text = result.doc.log[2].text;
    expect(text).toContain("outcome-synthetic-failure: failed at 4.500 years, predicted 3.000 years, error 1.500 years.");
    expect(text).toContain("outcome-synthetic-survivor: still alive at 2.000 years");
    expect(text).toContain("ltan_hours 6 from traj-dawn-dusk-assumed (assumed)");
    expect(text).toContain("shield_mm_Al 5 from place-a1-assumed (assumed)");
    expect(text).toContain("Predicted lifetime 3.000 years (derived by the physics service)");
    expect(text).toContain("A ranking under assumed coefficients.");
  });

  it("keeps a second revision only when the error drops further", async () => {
    const first = await reviseCase({ doc: orin(), instruction: "one", trace: trace(), now: T1, scoreOrbit: lifetime(3) });
    const worse = await reviseCase({ doc: first.doc, instruction: "two", trace: trace(), now: T1, scoreOrbit: lifetime(1) });
    expect(worse.verdict).toBe("rejected");
    expect(worse.doc.optimizedOem).toBe(OEM);
    expect(worse.doc.holdoutError).toBeCloseTo(0.75, 12);
    const better = await reviseCase({ doc: first.doc, instruction: "three", trace: trace(), now: T1, scoreOrbit: lifetime(4.5) });
    expect(better.verdict).toBe("kept");
    // |4.5 - 4.5| = 0 for the failure, and the survivor is predicted to outlive its censor time.
    expect(better.doc.holdoutError).toBe(0);
  });
});

describe("a rejected revision", () => {
  it("is logged, and neither the optimized file nor the stored error changes", async () => {
    const result = await reviseCase({ doc: orin({ holdoutError: 0.5, optimizedOem: "EARLIER OPTIMIZED" }), instruction: INSTRUCTION, trace: trace(), now: T1, scoreOrbit: lifetime(1) });
    expect(result.verdict).toBe("rejected");
    expect(kinds(result.doc)).toEqual(["instruction", "proposal", "score", "rejected"]);
    expect(result.doc.optimizedOem).toBe("EARLIER OPTIMIZED");
    expect(result.doc.holdoutError).toBe(0.5);
    expect(result.doc.log[3].oem).toBeNull();
    expect(result.doc.log[1].oem).toBe(OEM);
  });

  it("when the orbit is outside the envelope, with no error stored as infinity", async () => {
    const service = vi.fn(lifetime(3));
    const result = await reviseCase({ doc: orin(), instruction: INSTRUCTION, trace: trace({ candidate: circularOemText({ altitudeKm: 400, inclinationDeg: 30 }) }), now: T1, scoreOrbit: service });
    expect(result.verdict).toBe("rejected");
    expect(service).not.toHaveBeenCalled();
    expect(result.doc.optimizedOem).toBeNull();
    expect(result.doc.log[2].holdout_error).toBeNull();
    expect(JSON.stringify(result.doc)).not.toMatch(/Infinity|NaN/);
    expect(result.doc.log[2].text).toContain("400.0 km");
  });

  it("when the physics service refuses the orbit", async () => {
    const result = await reviseCase({ doc: orin(), instruction: INSTRUCTION, trace: trace(), now: T1, scoreOrbit: async () => ({ refused: true, reason: "Outside the filed envelope." }) });
    expect(result.verdict).toBe("rejected");
    expect(result.doc.log.at(-1)!.text).toContain("Outside the filed envelope.");
  });

  it("when the file fails the OEM profile on the app's own second check, even though the tool said it passed", async () => {
    const bad = OEM.replace("REF_FRAME = GCRF", "REF_FRAME = EME2000");
    const service = vi.fn(lifetime(3));
    const result = await reviseCase({ doc: orin(), instruction: INSTRUCTION, trace: trace({ candidate: bad }), now: T1, scoreOrbit: service });
    expect(result.verdict).toBe("rejected");
    expect(kinds(result.doc)).toEqual(["instruction", "proposal", "rejected"]);
    expect(result.doc.log[2].text).toContain("does not pass the OEM profile when the app checks it again");
    expect(result.doc.log[1].oem).toBe(bad);
    expect(result.doc.optimizedOem).toBeNull();
    expect(service).not.toHaveBeenCalled();
  });
});

describe("an unscored draft", () => {
  it("stays a draft in the log when the case has no holdout outcomes, and never becomes the optimized file", async () => {
    const noOutcomes = orin({ records: RECORDS.filter((r) => r.record_type !== "outcome") });
    const result = await reviseCase({ doc: noOutcomes, instruction: INSTRUCTION, trace: trace(), now: T1, scoreOrbit: lifetime(3) });
    expect(result.verdict).toBe("unscored");
    expect(kinds(result.doc)).toEqual(["instruction", "proposal", "score"]);
    expect(result.doc.optimizedOem).toBeNull();
    expect(result.doc.holdoutError).toBeNull();
    expect(result.doc.log[1].oem).toBe(OEM);
    expect(result.doc.log[2].holdout_error).toBeNull();
    expect(result.doc.log[2].text).toContain("unscored");
  });

  it("when the physics service cannot be reached: says so, and invents no lifetime", async () => {
    const result = await reviseCase({
      doc: orin(),
      instruction: INSTRUCTION,
      trace: trace(),
      now: T1,
      scoreOrbit: async () => {
        throw new PhysicsUnavailableError("The physics server could not be reached.");
      },
    });
    expect(result.verdict).toBe("unscored");
    expect(kinds(result.doc)).toEqual(["instruction", "proposal", "score"]);
    expect(result.doc.log[2].text).toContain("Physics unavailable");
    expect(result.doc.log[2].holdout_error).toBeNull();
    expect(result.doc.optimizedOem).toBeNull();
  });

  it("lets any other failure surface, so a bug is not logged as a verdict", async () => {
    await expect(
      reviseCase({
        doc: orin(),
        instruction: INSTRUCTION,
        trace: trace(),
        now: T1,
        scoreOrbit: async () => {
          throw new Error("a bug");
        },
      }),
    ).rejects.toThrow("a bug");
  });
});

describe("a request with no candidate", () => {
  it("fails, and the log says why: Grok did not submit through submit_oem, and chat text is ignored", async () => {
    const result = await reviseCase({ doc: orin(), instruction: INSTRUCTION, trace: trace({ candidate: null, submissions: 0 }), now: T1, scoreOrbit: lifetime(3) });
    expect(result.verdict).toBe("failed");
    expect(kinds(result.doc)).toEqual(["instruction", "rejected"]);
    expect(result.doc.log[1].text).toContain("did not submit an OEM through submit_oem");
    expect(result.doc.log[1].text).toContain("appears only in the chat is ignored");
    expect(result.doc.log[1].oem).toBeNull();
    expect(result.doc.optimizedOem).toBeNull();
  });

  it("says when Grok called submit_oem and the tool accepted nothing", async () => {
    const result = await reviseCase({ doc: orin(), instruction: INSTRUCTION, trace: trace({ candidate: null, submissions: 2 }), now: T1, scoreOrbit: lifetime(3) });
    expect(result.doc.log[1].text).toContain("called submit_oem 2 times, but the tool did not accept any file");
  });

  it("says why xAI stopped early", async () => {
    const result = await reviseCase({ doc: orin(), instruction: INSTRUCTION, trace: trace({ candidate: null, submissions: 0, incomplete: "max_turns" }), now: T1, scoreOrbit: lifetime(3) });
    expect(result.doc.log[1].text).toContain("Grok stopped early: max_turns.");
  });

  it("failedRevision logs a request that never reached an answer, with nothing else changed", () => {
    const before = orin({ holdoutError: 0.9, optimizedOem: "KEEP ME" });
    const result = failedRevision({ doc: before, instruction: INSTRUCTION, reason: "Grok could not be reached.", now: T1 });
    expect(result.verdict).toBe("failed");
    expect(kinds(result.doc)).toEqual(["instruction", "rejected"]);
    expect(result.doc.log[1].text).toBe("Grok could not be reached.");
    expect(result.doc.optimizedOem).toBe("KEEP ME");
    expect(result.doc.holdoutError).toBe(0.9);
    expect(result.doc.workingOem).toBe("WORKING COPY TEXT");
  });
});

describe("what the person can see Grok was given", () => {
  it("is in the proposal: the instructions sent, the records, the tools, and that holdout was not sent", async () => {
    const result = await reviseCase({ doc: orin(), instruction: INSTRUCTION, trace: trace(), now: T1, scoreOrbit: lifetime(3) });
    const text = result.doc.log[1].text;
    expect(text).toContain("Holdout records were not sent.");
    expect(text).toContain("12 train records, read inline in the request");
    expect(text).toContain("the flight server's tools (validate_oem, submit_oem, score_candidate)");
    expect(text).toContain("Instructions sent (version 1):");
    expect(text).toContain(grokInstructions(CASE_ID));
    expect(text).toContain("The working copy was sent.");
    expect(text).toContain("Grok said:\nI chose a dawn-dusk sun-synchronous orbit.");
    expect(text).toMatch(/: 12 states from 2026-10-03T18:00:00\.000 to 2026-10-03T18:11:00\.000\./);
  });

  it("names the collection that was searched", () => {
    const text = givenText(trace({ retrieval: { kind: "collection", records: 12, collectionId: "collection_abc" } }));
    expect(text).toContain("searched in the collection collection_abc");
    expect(text).toContain("deleted after it");
  });

  it("says when the collection failed and the records went inline", () => {
    expect(givenText(trace({ retrieval: { kind: "inline", records: 12, collectionFailed: "xAI answered 500" } }))).toContain("The collection could not be built (xAI answered 500), so the records went inline.");
  });

  it("says the app ran the tools when there is no flight server", () => {
    expect(givenText(trace({ mode: "function" }))).toContain("validate_oem and submit_oem, run by the app, because no flight server is set up");
  });

  it("says there was no working copy when there was none", () => {
    expect(givenText(trace({ usedWorkingOem: false }))).toContain("not sent, because there is none");
  });

  it("never says the model was trained or its weights changed", async () => {
    const result = await reviseCase({ doc: orin(), instruction: INSTRUCTION, trace: trace(), now: T1, scoreOrbit: lifetime(3) });
    expect(result.doc.log.map((e) => e.text).join("\n")).not.toMatch(/fine.?tun|\btrained\b|training run|checkpoint|loss curve|weights/i);
  });
});

describe("the result is still a case", () => {
  it("passes the case contract, whatever the verdict", async () => {
    const docs = [
      (await reviseCase({ doc: orin(), instruction: INSTRUCTION, trace: trace(), now: T1, scoreOrbit: lifetime(3) })).doc,
      (await reviseCase({ doc: orin({ holdoutError: 0.1 }), instruction: INSTRUCTION, trace: trace(), now: T1, scoreOrbit: lifetime(1) })).doc,
      (await reviseCase({ doc: orin(), instruction: INSTRUCTION, trace: trace({ candidate: null, submissions: 0 }), now: T1, scoreOrbit: lifetime(3) })).doc,
    ];
    for (const doc of docs) {
      const parsed = parseCaseDocument(JSON.parse(JSON.stringify(doc)));
      expect(parsed.ok, parsed.ok ? "" : parsed.error).toBe(true);
      for (const entry of doc.log) expect(LOG_KINDS).toContain(entry.kind);
    }
  });

  it("has no field the contract does not name: a comment that mentions thrust gains no thrust field", async () => {
    const withComment = OEM.replace("CCSDS_OEM_VERS = 3.0", "CCSDS_OEM_VERS = 3.0\nCOMMENT THRUST = 5000 N, MASS = 12000 kg, PITCH PROGRAM = 80 deg at 40 s");
    expect(parseOem(withComment, { thisAppWrote: true }).ok).toBe(true);

    const result = await reviseCase({ doc: orin(), instruction: INSTRUCTION, trace: trace({ candidate: withComment }), now: T1, scoreOrbit: lifetime(3) });
    expect(Object.keys(result.doc).sort()).toEqual(["accountId", "chipIds", "holdoutError", "id", "log", "name", "optimizedOem", "records", "updatedAt", "workingOem"]);
    for (const entry of result.doc.log) expect(Object.keys(entry).sort()).toEqual(["at", "holdout_error", "kind", "oem", "text"]);

    // The comment is text in the file and nothing more: the reduction reads the states, and comments do not move them.
    const plain = reduceOem(OEM);
    const commented = reduceOem(withComment);
    expect(plain.ok && commented.ok && plain.orbit).toEqual(commented.ok && commented.orbit);
  });

  it("applies to the freshest copy of the case, so an edit made while Grok worked is kept", async () => {
    const fresh = orin({ name: "Renamed while Grok worked", workingOem: "EDITED WHILE GROK WORKED", log: [{ at: T0, kind: "hand_edit", text: "during", oem: null, holdout_error: null }] });
    const result = await reviseCase({ doc: fresh, instruction: INSTRUCTION, trace: trace(), now: T1, scoreOrbit: lifetime(3) });
    expect(result.doc.name).toBe("Renamed while Grok worked");
    expect(result.doc.workingOem).toBe("EDITED WHILE GROK WORKED");
    expect(result.doc.log[0].text).toBe("during");
    expect(kinds(result.doc)).toEqual(["hand_edit", "instruction", "proposal", "score", "kept"]);
  });
});
