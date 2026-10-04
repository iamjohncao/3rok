import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi, type Mock } from "vitest";
import type { CaseDocument, CaseRecord } from "./case";
import { newCase } from "./case-ops";
import { handleAsk, GROK_NOT_SET_UP, type AskDeps } from "./grok-handler";
import { ingestText } from "./ingest";
import { sunSynchronousInclinationDeg } from "./oem-reduce";
import { circularOemText } from "./test-support/circular-oem";
import { TEST_ENV, assistantMessage, fakeXai, mcpSubmit, type FakeXai } from "./test-support/fake-xai";

const root = fileURLToPath(new URL("..", import.meta.url));
const ingested = ingestText("records.json", readFileSync(`${root}fixtures/orin-case/records.json`, "utf8"));
if (!ingested.ok) throw new Error("the Orin fixture must ingest");
const RECORDS: CaseRecord[] = ingested.records;

const CASE_ID = "5a4c1f0e-3b7d-4b36-9c1a-2f6d7a8e9b10";
const ALICE = { userId: "11111111-1111-4111-8111-111111111111", email: "alice@example.com" };
const BOB = { userId: "22222222-2222-4222-8222-222222222222", email: "bob@example.com" };
const OEM = circularOemText({ altitudeKm: 650, inclinationDeg: sunSynchronousInclinationDeg(650) });
const FLIGHT = { mcpUrl: "https://flight.example/mcp", scoreUrl: "https://flight.example/score", healthUrl: "https://flight.example/health", token: "tok-123456" };
const NO_MGMT = { ...TEST_ENV, managementKey: null };

function aliceCase(over: Partial<CaseDocument> = {}): CaseDocument {
  return { ...newCase(CASE_ID, "2026-10-04T00:00:00.000Z", ALICE.userId), records: RECORDS.map((r) => ({ ...r })), chipIds: ["nvidia_jetson_agx_orin"], workingOem: "MY WORKING COPY", ...over };
}

/** Cases by account, so another account's id is simply not found. */
function memoryStore(initial: CaseDocument[]) {
  const rows = new Map(initial.map((doc) => [`${doc.accountId}/${doc.id}`, doc]));
  return {
    rows,
    get: vi.fn(async (accountId: string, id: string) => rows.get(`${accountId}/${id}`) ?? null),
    save: vi.fn(async (accountId: string, doc: CaseDocument) => void rows.set(`${accountId}/${doc.id}`, doc)),
  };
}

type Harness = { deps: AskDeps; store: ReturnType<typeof memoryStore>; xai: FakeXai; scoreCalls: unknown[]; healthCalls: string[]; claim: Mock<AskDeps["claim"]> };

/** Routes the flight server's /score to a stub, and everything else to the fake xAI. */
function harness({
  script,
  doc = aliceCase(),
  lifetime = 3,
  flight = FLIGHT as AskDeps["flight"],
  xaiEnv = NO_MGMT as AskDeps["xai"],
  allowed = [] as string[],
  claim = vi.fn<AskDeps["claim"]>(async () => ({ ok: true })),
  scoreStatus = 200,
}: {
  script?: Parameters<typeof fakeXai>[0];
  doc?: CaseDocument;
  lifetime?: number;
  flight?: AskDeps["flight"];
  xaiEnv?: AskDeps["xai"];
  allowed?: string[];
  claim?: Mock<AskDeps["claim"]>;
  scoreStatus?: number;
} = {}): Harness {
  const xai = fakeXai(script ?? (() => ({ output: [mcpSubmit(OEM), assistantMessage("Submitted.")] })));
  const scoreCalls: unknown[] = [];
  const healthCalls: string[] = [];
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    if (String(url) === "https://flight.example/health") {
      healthCalls.push(String(url));
      return new Response("{}");
    }
    if (String(url) === "https://flight.example/score") {
      scoreCalls.push(JSON.parse(init!.body as string));
      return new Response(JSON.stringify({ refused: false, lifetime_years: lifetime, assumptions_note: "A ranking." }), { status: scoreStatus });
    }
    return xai.fetch(url, init);
  }) as typeof fetch;
  const store = memoryStore([doc]);
  return { deps: { xai: xaiEnv, flight, fetch: fetchImpl, store, claim, allowedEmails: allowed, now: () => new Date("2026-10-04T12:00:00.000Z"), scoreRetryMs: 1 }, store, xai, scoreCalls, healthCalls, claim };
}

const ask = (h: Harness, body: unknown = { caseId: CASE_ID, instruction: "Choose a dawn-dusk orbit." }, who = ALICE) => handleAsk(who, body, h.deps);
const saved = (h: Harness) => h.store.rows.get(`${ALICE.userId}/${CASE_ID}`)!;

describe("who may ask, before anything is spent", () => {
  it("answers 503 when Grok is not set up, and touches nothing", async () => {
    const h = harness({ xaiEnv: null });
    const result = await ask(h);
    expect(result).toMatchObject({ status: 503, body: { error: GROK_NOT_SET_UP } });
    expect(h.store.get).not.toHaveBeenCalled();
    expect(h.claim).not.toHaveBeenCalled();
  });

  it("answers 403 for an account that is not on the allow-list", async () => {
    const h = harness({ allowed: ["someone@example.com"] });
    expect((await ask(h)).status).toBe(403);
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.xai.requests).toHaveLength(0);
  });

  it("lets an account on the list ask", async () => {
    expect((await ask(harness({ allowed: ["ALICE@example.com"] }))).status).toBe(200);
  });

  it.each([
    ["no body", null],
    ["a string", "hi"],
    ["no case id", { instruction: "x" }],
    ["a case id that is not a UUID", { caseId: "../etc", instruction: "x" }],
    ["no instruction", { caseId: CASE_ID }],
    ["a blank instruction", { caseId: CASE_ID, instruction: "   " }],
    ["an instruction that is not text", { caseId: CASE_ID, instruction: 5 }],
    ["an instruction over the limit", { caseId: CASE_ID, instruction: "x".repeat(4001) }],
  ])("answers 400 for %s", async (_name, body) => {
    const h = harness();
    expect((await ask(h, body)).status).toBe(400);
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.xai.requests).toHaveLength(0);
  });

  it("answers 404 for a case that is not there", async () => {
    const h = harness();
    expect((await ask(h, { caseId: "33333333-3333-4333-8333-333333333333", instruction: "x" })).status).toBe(404);
    expect(h.claim).not.toHaveBeenCalled();
  });

  it("cannot be pointed at another account's case: Bob gets 404, is not counted, and nothing is sent", async () => {
    const h = harness();
    const result = await ask(h, { caseId: CASE_ID, instruction: "go" }, BOB);
    expect(result.status).toBe(404);
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.xai.requests).toHaveLength(0);
    expect(h.scoreCalls).toHaveLength(0);
    expect(h.store.save).not.toHaveBeenCalled();
    expect(h.store.get).toHaveBeenCalledWith(BOB.userId, CASE_ID);
  });

  it("answers 429 over the hourly limit, says when to come back, and calls no one", async () => {
    const h = harness({ claim: vi.fn<AskDeps["claim"]>(async () => ({ ok: false, retryAfterSeconds: 600 })) });
    const result = await ask(h);
    expect(result.status).toBe(429);
    expect(result.headers).toEqual({ "Retry-After": "600" });
    expect(result.body.error).toContain("Try again in 10 minutes.");
    expect(h.xai.requests).toHaveLength(0);
    expect(h.store.save).not.toHaveBeenCalled();
  });

  it("answers 422 for a case with no train rows, and does not spend a run on it", async () => {
    const h = harness({ doc: aliceCase({ records: RECORDS.filter((r) => r.split === "holdout") }) });
    const result = await ask(h);
    expect(result.status).toBe(422);
    expect(result.body.error).toContain("no train records");
    expect(h.claim).not.toHaveBeenCalled();
    expect(h.xai.requests).toHaveLength(0);
  });
});

describe("a flight server that sleeps when idle", () => {
  it("is woken when a run starts, once, and only after the run is allowed", async () => {
    const h = harness();
    await ask(h);
    expect(h.healthCalls).toEqual(["https://flight.example/health"]);
  });

  it("is not woken for a request that is refused, or when there is no flight server", async () => {
    const refused = harness({ claim: vi.fn<AskDeps["claim"]>(async () => ({ ok: false, retryAfterSeconds: 60 })) });
    await ask(refused);
    expect(refused.healthCalls).toEqual([]);
    const none = harness({ flight: null, script: () => ({ output: [assistantMessage("hi")] }) });
    await ask(none);
    expect(none.healthCalls).toEqual([]);
  });
});

describe("a revision that is kept", () => {
  it("is saved to the account: the optimized file, the stored error, the log, and the reply", async () => {
    const h = harness({ lifetime: 3 });
    const result = await ask(h);
    expect(result.status).toBe(200);
    expect(result.body.verdict).toBe("kept");
    const doc = saved(h);
    expect(doc.optimizedOem).toBe(OEM);
    expect(doc.holdoutError).toBeCloseTo(0.75, 12);
    expect(doc.log.map((e) => e.kind)).toEqual(["instruction", "proposal", "score", "kept"]);
    expect(doc.workingOem).toBe("MY WORKING COPY");
    expect((result.body.case as CaseDocument).log).toEqual(doc.log);
    expect(doc.updatedAt).toBe("2026-10-04T12:00:00.000Z");
  });

  it("counts the run once, for this case", async () => {
    const h = harness();
    await ask(h);
    expect(h.claim).toHaveBeenCalledTimes(1);
    expect(h.claim).toHaveBeenCalledWith(CASE_ID);
  });

  it("scores the reduced orbit with the case's own numbers, through the flight server", async () => {
    const h = harness();
    await ask(h);
    expect(h.scoreCalls).toHaveLength(1);
    expect(h.scoreCalls[0]).toMatchObject({ inclination: "sso", ltan_hours: 6, shield_mm_Al: 5, chip_id: "nvidia_jetson_agx_orin" });
  });

  it("sends Grok only train rows: no holdout record reaches xAI", async () => {
    const h = harness();
    await ask(h);
    const sent = JSON.stringify(h.xai.requests.map((r) => r.body));
    expect(sent).toContain("tid-agx-co60");
    expect(sent).not.toContain("outcome-synthetic");
  });

  it("keeps an edit made while Grok worked", async () => {
    const h = harness({
      script: () => {
        const current = h.store.rows.get(`${ALICE.userId}/${CASE_ID}`)!;
        h.store.rows.set(`${ALICE.userId}/${CASE_ID}`, { ...current, name: "Renamed meanwhile", workingOem: "EDITED MEANWHILE" });
        return { output: [mcpSubmit(OEM)] };
      },
    });
    await ask(h);
    expect(saved(h).name).toBe("Renamed meanwhile");
    expect(saved(h).workingOem).toBe("EDITED MEANWHILE");
    expect(saved(h).optimizedOem).toBe(OEM);
  });
});

describe("a revision that is not kept", () => {
  it("is rejected when the error does not drop, and the optimized file stays", async () => {
    const h = harness({ lifetime: 1, doc: aliceCase({ holdoutError: 0.1, optimizedOem: "EARLIER" }) });
    const result = await ask(h);
    expect(result.body.verdict).toBe("rejected");
    expect(saved(h).optimizedOem).toBe("EARLIER");
    expect(saved(h).holdoutError).toBe(0.1);
    expect(saved(h).log.map((e) => e.kind)).toEqual(["instruction", "proposal", "score", "rejected"]);
  });

  it("is a failed revision, logged, when Grok submits nothing", async () => {
    const h = harness({ script: () => ({ output: [assistantMessage(`Here you go:\n${OEM}`)] }) });
    const result = await ask(h);
    expect(result).toMatchObject({ status: 200, body: { verdict: "failed" } });
    expect(saved(h).optimizedOem).toBeNull();
    expect(saved(h).log.map((e) => e.kind)).toEqual(["instruction", "rejected"]);
    expect(h.scoreCalls).toHaveLength(0);
  });

  it("is a failed revision, logged, when xAI answers with an error, and no secret is in it", async () => {
    const h = harness();
    h.xai.failNext.responses = 1;
    const result = await ask(h);
    expect(result.body.verdict).toBe("failed");
    const text = saved(h).log.at(-1)!.text;
    expect(text).toContain("The request to Grok failed, so there is no candidate.");
    expect(text).toContain("xAI answered 500");
    for (const secret of [TEST_ENV.apiKey, TEST_ENV.managementKey!, FLIGHT.token]) expect(JSON.stringify(result.body)).not.toContain(secret);
  });

  it("is a failed revision when Grok does not finish before the deadline", async () => {
    const h = harness();
    const slow = (async (_url: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError"))))) as typeof fetch;
    h.deps.fetch = slow;
    const result = await handleAsk(ALICE, { caseId: CASE_ID, instruction: "go" }, { ...h.deps, deadlineMs: 20 });
    expect(result.body.verdict).toBe("failed");
    expect(saved(h).log.at(-1)!.text).toContain("did not finish before the time limit");
  });

  it("is unscored, with the draft in the log, when there is no flight server to score it", async () => {
    const h = harness({ flight: null, script: (_body, round) => (round === 1 ? { output: [{ type: "function_call", call_id: "c", name: "submit_oem", arguments: JSON.stringify({ oem: OEM }) }] } : { output: [assistantMessage("done")] }) });
    const result = await ask(h);
    expect(result.body.verdict).toBe("unscored");
    expect(saved(h).optimizedOem).toBeNull();
    expect(saved(h).log.map((e) => e.kind)).toEqual(["instruction", "proposal", "score"]);
    expect(saved(h).log[2].text).toContain("Physics unavailable");
    expect(saved(h).log[1].oem).toBe(OEM);
  });

  it("is unscored, not kept, when the physics server is down", async () => {
    const h = harness({ scoreStatus: 503 });
    const result = await ask(h);
    expect(result.body.verdict).toBe("unscored");
    expect(saved(h).optimizedOem).toBeNull();
  });

  it("lets a store failure surface to the route, and saves nothing", async () => {
    const h = harness();
    h.store.get.mockImplementationOnce(async () => aliceCase()).mockImplementationOnce(async () => {
      throw new Error(`database exploded near ${TEST_ENV.apiKey}`);
    });
    await expect(ask(h)).rejects.toThrow();
    expect(h.store.save).not.toHaveBeenCalled();
  });
});

describe("secrets", () => {
  it("never appear in the reply or in the saved case", async () => {
    const h = harness();
    const result = await ask(h);
    const text = JSON.stringify(result) + JSON.stringify(saved(h));
    for (const secret of [TEST_ENV.apiKey, TEST_ENV.managementKey!, FLIGHT.token]) expect(text).not.toContain(secret);
  });
});
