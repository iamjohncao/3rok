import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  OemError,
  epochToSeconds,
  formatIssue,
  parseOem,
  serializeOem,
  validateOem,
  type Oem,
} from "./oem";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path: string) => readFileSync(`${root}${path}`, "utf8");

const minimal = read("fixtures/minimal.oem");

type Edit = { replace: string; with: string | null } | { append: string };
type ProfileCase = {
  name: string;
  edits: Edit[];
  valid: boolean;
  this_app_wrote?: boolean;
  errors_mention?: string[];
};
const profile = JSON.parse(read("fixtures/oem-profile-cases.json")) as {
  base: string;
  cases: ProfileCase[];
};

// Applies a case's edits to the base file. Each `replace` must hit exactly one
// line, so a typo in the fixture fails loudly instead of testing nothing.
function applyEdits(base: string, edits: Edit[]): string {
  let lines = base.replace(/\n$/, "").split("\n");
  for (const edit of edits) {
    if ("append" in edit) {
      lines = [...lines, ...edit.append.split("\n")];
      continue;
    }
    const hits = lines.filter((line) => line === edit.replace).length;
    if (hits !== 1) throw new Error(`Edit matched ${hits} lines, expected 1: ${edit.replace}`);
    lines = lines.flatMap((line) =>
      line === edit.replace ? (edit.with === null ? [] : edit.with.split("\n")) : [line],
    );
  }
  return `${lines.join("\n")}\n`;
}

function mustParse(text: string): Oem {
  const result = parseOem(text);
  if (!result.ok) throw new Error(result.errors.map(formatIssue).join("\n"));
  return result.oem;
}

describe("shared profile cases (fixtures/oem-profile-cases.json)", () => {
  it("starts from the minimal fixture", () => {
    expect(profile.base).toBe("fixtures/minimal.oem");
  });

  for (const testCase of profile.cases) {
    it(testCase.name, () => {
      const text = applyEdits(read(profile.base), testCase.edits);
      const result = validateOem(text, { thisAppWrote: testCase.this_app_wrote ?? false });

      expect(result.valid, result.errors.join("\n")).toBe(testCase.valid);
      expect(result.errors.length > 0).toBe(!testCase.valid);
      for (const phrase of testCase.errors_mention ?? []) {
        expect(
          result.errors.some((error) => error.includes(phrase)),
          `expected an error mentioning "${phrase}" in:\n${result.errors.join("\n")}`,
        ).toBe(true);
      }
    });
  }

  it("states every failure as a sentence, never a bare code", () => {
    for (const testCase of profile.cases.filter((c) => !c.valid)) {
      const text = applyEdits(read(profile.base), testCase.edits);
      const { errors } = validateOem(text, { thisAppWrote: testCase.this_app_wrote ?? false });
      for (const error of errors) {
        expect(error, error).toMatch(/^(Line \d+: )?[A-Z"].+\.$/);
        expect(error.split(/\s+/).length, error).toBeGreaterThan(4);
      }
    }
  });
});

describe("parsing the minimal fixture", () => {
  const oem = mustParse(minimal);

  it("returns epochs and GCRF position and velocity, so a line can be drawn", () => {
    expect(oem.segments).toHaveLength(1);
    const [first, second] = oem.segments[0].states;
    expect(first.epoch).toBe("2026-10-03T18:05:00.000");
    expect(first.position).toEqual([-1045.0, -5512.0, 3298.0]);
    expect(first.velocity).toEqual([-1.2, 3.4, 6.1]);
    expect(first.acceleration).toBeNull();
    expect(second.position).toEqual([-2120.0, -2440.0, 6205.0]);
    expect(second.time - first.time).toBe(15 * 60);
  });

  it("reads the header and metadata", () => {
    expect(oem.originator).toBe("3ROK");
    expect(oem.creationDate).toBe("2026-10-03T18:00:00");
    expect(oem.segments[0]).toMatchObject({
      objectName: "CASE-CHIPSET",
      objectId: "UNKNOWN",
      centerName: "EARTH",
      refFrame: "GCRF",
      timeSystem: "UTC",
      startTime: "2026-10-03T18:05:00.000",
      stopTime: "2026-10-03T18:20:00.000",
    });
  });

  it("matches the validate_oem result shape in docs/grok-flight-mcp.md", () => {
    expect(validateOem(minimal)).toEqual({
      valid: true,
      errors: [],
      segment_count: 1,
      state_count: 2,
      start_time: "2026-10-03T18:05:00.000",
      stop_time: "2026-10-03T18:20:00.000",
      has_acceleration: false,
    });
  });

  it("accepts the fixture as a file this app writes", () => {
    expect(parseOem(minimal, { thisAppWrote: true }).ok).toBe(true);
  });
});

describe("epochs", () => {
  it("reads calendar and day-of-year forms to the same instant", () => {
    const calendar = epochToSeconds("2026-10-03T18:05:00.000");
    expect(calendar).not.toBeNull();
    expect(epochToSeconds("2026-276T18:05:00.000")).toBe(calendar);
    expect(epochToSeconds("2026-10-03T18:05:00.000Z")).toBe(calendar);
  });

  it("keeps fractions of a second", () => {
    const whole = epochToSeconds("2026-10-03T18:05:00") as number;
    expect(epochToSeconds("2026-10-03T18:05:00.250")).toBeCloseTo(whole + 0.25, 6);
  });

  it("refuses times that are not real", () => {
    for (const bad of [
      "2026-02-30T00:00:00",
      "2026-13-01T00:00:00",
      "2026-10-03T24:00:00",
      "2026-10-03T18:60:00",
      "2026-366T00:00:00",
      "2026-10-03 18:05:00",
      "2026-10-03T18:05:00+01:00",
      "yesterday",
    ]) {
      expect(epochToSeconds(bad), bad).toBeNull();
    }
    expect(epochToSeconds("2024-366T00:00:00")).not.toBeNull(); // 2024 is a leap year
  });
});

describe("empty and broken files", () => {
  it("says so when the file is empty", () => {
    const result = parseOem("   \n\n");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].message).toContain("empty");
  });

  it("reports every problem, not just the first", () => {
    const text = applyEdits(minimal, [
      { replace: "REF_FRAME = GCRF", with: "REF_FRAME = EME2000" },
      { replace: "CENTER_NAME = EARTH", with: "CENTER_NAME = MOON" },
      { replace: "TIME_SYSTEM = UTC", with: "TIME_SYSTEM = TAI" },
    ]);
    const { errors } = validateOem(text);
    expect(errors).toHaveLength(3);
  });

  it("points at the line that is wrong", () => {
    const text = applyEdits(minimal, [{ replace: "REF_FRAME = GCRF", with: "REF_FRAME = EME2000" }]);
    const result = parseOem(text);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors[0].line).toBe(9);
  });

  it("tolerates CRLF line endings, a BOM, blank lines and extra spacing", () => {
    const text = `﻿${minimal.split("\n").join("\r\n")}\r\n\r\n`.replace(
      "REF_FRAME = GCRF",
      "REF_FRAME   =   GCRF",
    );
    expect(parseOem(text).ok).toBe(true);
  });

  it("accepts exponent notation and signed numbers", () => {
    const text = applyEdits(minimal, [
      {
        replace: "2026-10-03T18:05:00.000  -1045.0  -5512.0  3298.0  -1.20  3.40  6.10",
        with: "2026-10-03T18:05:00.000  +1.045E3  -5.512e+3  .3298e4  -1.2E0  3.4e0  6.1",
      },
    ]);
    const oem = mustParse(text);
    expect(oem.segments[0].states[0].position).toEqual([1045, -5512, 3298]);
  });
});

describe("round trip", () => {
  it("keeps the states, epochs, and comments of the fixture", () => {
    const before = mustParse(minimal);
    const written = serializeOem(before);
    const after = mustParse(written);
    expect(after).toEqual(before);
    expect(after.headerComments).toEqual([
      "3ROK fixture. The numbers show the file shape only. This is not a flyable trajectory.",
    ]);
  });

  it("keeps acceleration, several segments, interpolation, and every kind of comment", () => {
    const oem: Oem = {
      headerComments: ["Case CASE-1, revision 4.", "A second header comment."],
      classification: "unclassified",
      creationDate: "2026-10-03T18:00:00",
      originator: "3ROK",
      messageId: "MSG-0001",
      segments: [
        {
          comments: ["Segment one."],
          objectName: "CASE-1",
          objectId: "UNKNOWN",
          centerName: "EARTH",
          refFrame: "GCRF",
          timeSystem: "UTC",
          startTime: "2026-10-03T18:05:00.000",
          stopTime: "2026-10-03T18:20:00.000",
          useableStartTime: "2026-10-03T18:05:00.000",
          useableStopTime: "2026-10-03T18:20:00.000",
          interpolation: "HERMITE",
          interpolationDegree: 3,
          dataComments: ["Data comment."],
          states: [
            {
              epoch: "2026-10-03T18:05:00.000",
              time: epochToSeconds("2026-10-03T18:05:00.000") as number,
              position: [-1045, -5512.25, 3298.125],
              velocity: [-1.2, 3.4, 6.1],
              acceleration: [0.001, -0.0000001, 1e-9],
            },
            {
              epoch: "2026-10-03T18:20:00.000",
              time: epochToSeconds("2026-10-03T18:20:00.000") as number,
              position: [-2120, -2440, 6205],
              velocity: [-3.1, 6.55, 2.4],
              acceleration: [0, 0, 0],
            },
          ],
        },
        {
          comments: [],
          objectName: "CASE-1",
          objectId: "UNKNOWN",
          centerName: "EARTH",
          refFrame: "GCRF",
          timeSystem: "UTC",
          startTime: "2026-10-03T18:25:00.000",
          stopTime: "2026-10-03T18:30:00.000",
          useableStartTime: null,
          useableStopTime: null,
          interpolation: null,
          interpolationDegree: null,
          dataComments: [],
          states: [
            {
              epoch: "2026-10-03T18:25:00.000",
              time: epochToSeconds("2026-10-03T18:25:00.000") as number,
              position: [-3000, -1500, 6300],
              velocity: [-3.5, 6.8, 1.9],
              acceleration: null,
            },
            {
              epoch: "2026-10-03T18:30:00.000",
              time: epochToSeconds("2026-10-03T18:30:00.000") as number,
              position: [-3500, -500, 6350],
              velocity: [-3.6, 6.9, 1.2],
              acceleration: null,
            },
          ],
        },
      ],
    };

    const text = serializeOem(oem);
    expect(mustParse(text)).toEqual(oem);
    expect(serializeOem(mustParse(text))).toBe(text);
  });

  it("writes numbers the parser reads back exactly", () => {
    const states = [0.1 + 0.2, 1e21, 5e-324, -123456.789012345, 7, -0.5];
    const base = mustParse(minimal);
    base.segments[0].states[0] = {
      ...base.segments[0].states[0],
      position: [states[0], states[1], states[2]],
      velocity: [states[3], states[4], states[5]],
    };
    const again = mustParse(serializeOem(base));
    expect(again.segments[0].states[0].position).toEqual([states[0], states[1], states[2]]);
    expect(again.segments[0].states[0].velocity).toEqual([states[3], states[4], states[5]]);
  });
});

describe("the writer", () => {
  const oem = mustParse(minimal);

  it("writes CCSDS OEM 3.0 keyword-value text and nothing else", () => {
    const text = serializeOem(oem);
    expect(text.startsWith("CCSDS_OEM_VERS = 3.0\n")).toBe(true);
    expect(text).toContain("ORIGINATOR = 3ROK");
    expect(text).toContain("REF_FRAME = GCRF");
    expect(text).not.toContain("REF_FRAME_EPOCH");
    expect(() => JSON.parse(text)).toThrow();
    expect(text).not.toMatch(/[{}[\]]/);
  });

  it("refuses to write an ORIGINATOR other than 3ROK", () => {
    expect(() => serializeOem({ ...oem, originator: "NASA/JPL" })).toThrow(OemError);
    try {
      serializeOem({ ...oem, originator: "NASA/JPL" });
    } catch (error) {
      expect((error as OemError).issues[0].message).toContain("3ROK");
    }
  });

  it("refuses to write a frame, center or time system the profile does not allow", () => {
    const wrong = structuredClone(oem);
    wrong.segments[0].refFrame = "EME2000";
    wrong.segments[0].centerName = "MOON";
    wrong.segments[0].timeSystem = "TAI";
    // Errors follow the file's keyword order: CENTER_NAME, REF_FRAME, TIME_SYSTEM.
    expect(() => serializeOem(wrong)).toThrow(/CENTER_NAME.*REF_FRAME.*TIME_SYSTEM/);
  });

  it("refuses to write a file with fewer than two states", () => {
    const one = structuredClone(oem);
    one.segments[0].states.pop();
    one.segments[0].stopTime = one.segments[0].startTime;
    expect(() => serializeOem(one)).toThrow(/at least two/);
  });

  it("does not change the model it is given", () => {
    const copy = structuredClone(oem);
    serializeOem(copy);
    expect(copy).toEqual(oem);
  });
});

describe("comments are not flight data", () => {
  const withComments = applyEdits(minimal, [
    {
      replace: "COMMENT 3ROK fixture. The numbers show the file shape only. This is not a flyable trajectory.",
      with: "COMMENT thrust = 5000 N, mass = 120000 kg\nCOMMENT pitch program: 0 s 90 deg, 60 s 45 deg",
    },
    { replace: "META_STOP", with: "META_STOP\nCOMMENT propellant 40 t, throttle 0.8" },
  ]);

  it("keeps comment text as text and gains no thrust, mass, or pitch field", () => {
    const oem = mustParse(withComments);
    expect(oem.headerComments).toEqual([
      "thrust = 5000 N, mass = 120000 kg",
      "pitch program: 0 s 90 deg, 60 s 45 deg",
    ]);
    expect(oem.segments[0].dataComments).toEqual(["propellant 40 t, throttle 0.8"]);

    const keys = JSON.stringify(oem, (_key, value) => value).match(/"[A-Za-z]+":/g) ?? [];
    for (const key of keys) {
      expect(key.toLowerCase()).not.toMatch(/thrust|mass|pitch|propellant|throttle|lifetime/);
    }
  });

  it("leaves the states exactly as they are", () => {
    expect(mustParse(withComments).segments[0].states).toEqual(mustParse(minimal).segments[0].states);
  });
});

describe("source gates (Phase 1)", () => {
  const source = read("lib/oem.ts");

  it("makes no network call and imports nothing, including the AI SDK", () => {
    expect(source).not.toMatch(/^\s*import\s/m);
    expect(source).not.toMatch(/\brequire\(|\bfetch\(|XMLHttpRequest|WebSocket|process\.env/);
    expect(source).not.toMatch(/@ai-sdk|api\.x\.ai|XAI_API_KEY|openai|anthropic/i);
  });

  it("does not set an optimized, kept, or rejected status", () => {
    expect(source).not.toMatch(/\b(optimi[sz]ed|kept|rejected)\b/i);
  });
});
