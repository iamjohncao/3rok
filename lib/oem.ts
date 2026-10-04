// CCSDS Orbit Ephemeris Message (OEM) 3.0, keyword-value notation: the 3rok
// profile in docs/flight-algorithm-oem.md. Parse, validate, and write.
//
// Pure functions. No network, no model, no imports. Nothing here decides
// whether a file is any good, only whether it is a valid 3rok OEM. The caller
// decides what to do with that.

export const OEM_VERSION = "3.0";
export const OEM_ORIGINATOR = "3ROK";
export const OEM_CENTER_NAME = "EARTH";
export const OEM_REF_FRAME = "GCRF";
export const OEM_TIME_SYSTEM = "UTC";

export type Vec3 = [number, number, number];

export type OemState = {
  /** The epoch exactly as written in the file. */
  epoch: string;
  /** Seconds since 1970-01-01T00:00:00Z (UTC), derived from `epoch`. */
  time: number;
  /** GCRF position, km. */
  position: Vec3;
  /** GCRF velocity, km/s. */
  velocity: Vec3;
  /** GCRF acceleration, km/s^2. Null when the line does not carry it. */
  acceleration: Vec3 | null;
};

export type OemSegment = {
  /** COMMENT lines directly after META_START. */
  comments: string[];
  objectName: string;
  objectId: string;
  centerName: string;
  refFrame: string;
  timeSystem: string;
  startTime: string;
  stopTime: string;
  useableStartTime: string | null;
  useableStopTime: string | null;
  interpolation: string | null;
  interpolationDegree: number | null;
  /** COMMENT lines directly after META_STOP, before the first state. */
  dataComments: string[];
  states: OemState[];
};

export type Oem = {
  /** COMMENT lines directly after CCSDS_OEM_VERS. */
  headerComments: string[];
  classification: string | null;
  creationDate: string;
  originator: string;
  messageId: string | null;
  segments: OemSegment[];
};

/** One problem, in a plain sentence. `line` is 1-based, or null for the whole file. */
export type OemIssue = { message: string; line: number | null };

export type OemParseOptions = {
  /** True for a file this app writes: ORIGINATOR must then be 3ROK. */
  thisAppWrote?: boolean;
};

export type OemParseResult =
  | { ok: true; oem: Oem }
  | { ok: false; errors: OemIssue[] };

/** Same shape as the `validate_oem` MCP tool result in docs/grok-flight-mcp.md. */
export type OemValidation = {
  valid: boolean;
  errors: string[];
  segment_count: number;
  state_count: number;
  start_time: string | null;
  stop_time: string | null;
  has_acceleration: boolean;
};

export class OemError extends Error {
  readonly issues: OemIssue[];

  constructor(issues: OemIssue[]) {
    super(issues.map(formatIssue).join(" "));
    this.name = "OemError";
    this.issues = issues;
  }
}

export function formatIssue(issue: OemIssue): string {
  return issue.line === null ? issue.message : `Line ${issue.line}: ${issue.message}`;
}

// ---------------------------------------------------------------------------
// Epochs

const CALENDAR_EPOCH = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z?$/;
const DAY_OF_YEAR_EPOCH = /^(\d{4})-(\d{3})T(\d{2}):(\d{2}):(\d{2})(\.\d+)?Z?$/;

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

/**
 * Seconds since 1970-01-01T00:00:00Z for a UTC epoch written as
 * `YYYY-MM-DDThh:mm:ss[.fff][Z]` or `YYYY-DDDThh:mm:ss[.fff][Z]`.
 * Null when the text is not a real instant. Leap seconds (second 60) are not supported.
 */
export function epochToSeconds(epoch: string): number | null {
  let year: number;
  let month = 1;
  let day: number;
  let rest: string[];
  let fraction: string | undefined;

  const calendar = CALENDAR_EPOCH.exec(epoch);
  if (calendar) {
    year = Number(calendar[1]);
    month = Number(calendar[2]);
    day = Number(calendar[3]);
    rest = [calendar[4], calendar[5], calendar[6]];
    fraction = calendar[7];
    if (month < 1 || month > 12) return null;
  } else {
    const ordinal = DAY_OF_YEAR_EPOCH.exec(epoch);
    if (!ordinal) return null;
    year = Number(ordinal[1]);
    day = Number(ordinal[2]);
    rest = [ordinal[3], ordinal[4], ordinal[5]];
    fraction = ordinal[6];
    if (day < 1 || day > (isLeapYear(year) ? 366 : 365)) return null;
  }

  const [hour, minute, second] = rest.map(Number);
  if (hour > 23 || minute > 59 || second > 59) return null;

  const date = new Date(0);
  if (calendar) {
    date.setUTCFullYear(year, month - 1, day);
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  } else {
    date.setUTCFullYear(year, 0, day);
  }
  date.setUTCHours(hour, minute, second, 0);

  return date.getTime() / 1000 + (fraction ? Number(`0${fraction}`) : 0);
}

// ---------------------------------------------------------------------------
// Reading

const HEADER_KEYWORDS = [
  "CCSDS_OEM_VERS",
  "CLASSIFICATION",
  "CREATION_DATE",
  "ORIGINATOR",
  "MESSAGE_ID",
] as const;

// The standard's order. Optional keywords may be missing, but never out of place.
const METADATA_KEYWORDS = [
  "OBJECT_NAME",
  "OBJECT_ID",
  "CENTER_NAME",
  "REF_FRAME",
  "REF_FRAME_EPOCH",
  "TIME_SYSTEM",
  "START_TIME",
  "USEABLE_START_TIME",
  "USEABLE_STOP_TIME",
  "STOP_TIME",
  "INTERPOLATION",
  "INTERPOLATION_DEGREE",
] as const;

const REQUIRED_METADATA = [
  "OBJECT_NAME",
  "OBJECT_ID",
  "CENTER_NAME",
  "REF_FRAME",
  "TIME_SYSTEM",
  "START_TIME",
  "STOP_TIME",
] as const;

const COMMENT_LINE = /^COMMENT(?:\s+(.*))?$/;
const KEYWORD_LINE = /^([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/;
const NUMBER = /^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/;
const EPOCH_LIKE = /^\d{4}-/;

const EPOCH_EXAMPLE = "2026-10-03T18:05:00.000";

type SourceLine = { n: number; text: string };

function sourceLines(text: string): SourceLine[] {
  return text
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .map((raw, index) => ({ n: index + 1, text: raw.trim() }))
    .filter((line) => line.text !== "");
}

function clip(text: string): string {
  return text.length > 60 ? `${text.slice(0, 57)}...` : text;
}

function emptySegment(): OemSegment {
  return {
    comments: [],
    objectName: "",
    objectId: "",
    centerName: "",
    refFrame: "",
    timeSystem: "",
    startTime: "",
    stopTime: "",
    useableStartTime: null,
    useableStopTime: null,
    interpolation: null,
    interpolationDegree: null,
    dataComments: [],
    states: [],
  };
}

/**
 * Reads as much of the file as it can and collects every problem it finds.
 * Only `parseOem` is the gate: a file with any issue must not be drawn or flown.
 */
function readOem(
  text: string,
  options: OemParseOptions,
): { oem: Oem; issues: OemIssue[] } {
  const issues: OemIssue[] = [];
  const fail = (message: string, line: number | null = null) => {
    issues.push({ message, line });
  };
  const oem: Oem = {
    headerComments: [],
    classification: null,
    creationDate: "",
    originator: "",
    messageId: null,
    segments: [],
  };
  const lines = sourceLines(text);
  let i = 0;

  if (lines.length === 0) {
    fail("The file is empty. An OEM starts with CCSDS_OEM_VERS = 3.0.");
    return { oem, issues };
  }

  // --- Header -------------------------------------------------------------
  const headerSeen = new Set<string>();
  let headerRank = -1;
  while (i < lines.length && lines[i].text !== "META_START") {
    const line = lines[i++];

    const comment = COMMENT_LINE.exec(line.text);
    if (comment) {
      const allowed =
        headerSeen.has("CCSDS_OEM_VERS") &&
        !headerSeen.has("CLASSIFICATION") &&
        !headerSeen.has("CREATION_DATE");
      if (allowed) oem.headerComments.push((comment[1] ?? "").trim());
      else fail("COMMENT lines in the header must come directly after CCSDS_OEM_VERS.", line.n);
      continue;
    }

    const pair = KEYWORD_LINE.exec(line.text);
    if (!pair) {
      fail(`This is not a KEYWORD = value line: "${clip(line.text)}".`, line.n);
      continue;
    }
    const key = pair[1];
    const value = pair[2].trim();
    const rank = (HEADER_KEYWORDS as readonly string[]).indexOf(key);

    if (rank === -1) {
      fail(
        (METADATA_KEYWORDS as readonly string[]).includes(key)
          ? `${key} belongs between META_START and META_STOP, not in the header.`
          : `${key} is not an OEM header keyword. The header keywords are ${HEADER_KEYWORDS.join(", ")}.`,
        line.n,
      );
      continue;
    }
    if (headerSeen.has(key)) {
      fail(`${key} appears more than once in the header.`, line.n);
      continue;
    }
    if (rank < headerRank) {
      fail(
        `${key} is out of order. Header keywords go in this order: ${HEADER_KEYWORDS.join(", ")}.`,
        line.n,
      );
    }
    headerRank = Math.max(headerRank, rank);
    headerSeen.add(key);

    switch (key) {
      case "CCSDS_OEM_VERS":
        if (value !== OEM_VERSION) {
          fail(`CCSDS_OEM_VERS must be ${OEM_VERSION}, but this file says ${value || "nothing"}.`, line.n);
        }
        break;
      case "CLASSIFICATION":
        oem.classification = value;
        break;
      case "CREATION_DATE":
        oem.creationDate = value;
        if (epochToSeconds(value) === null) {
          fail(
            `CREATION_DATE must be a UTC timestamp such as 2026-10-03T18:00:00, but this file says "${clip(value)}".`,
            line.n,
          );
        }
        break;
      case "ORIGINATOR":
        oem.originator = value;
        if (value === "") {
          fail("ORIGINATOR must not be empty.", line.n);
        } else if (options.thisAppWrote && value !== OEM_ORIGINATOR) {
          fail(
            `ORIGINATOR must be ${OEM_ORIGINATOR} on a file this app writes, but this file says ${clip(value)}. Do not use another agency's name.`,
            line.n,
          );
        }
        break;
      case "MESSAGE_ID":
        oem.messageId = value;
        break;
    }
  }

  if (!headerSeen.has("CCSDS_OEM_VERS")) {
    fail(`CCSDS_OEM_VERS = ${OEM_VERSION} is required at the top of the file.`);
  }
  if (!headerSeen.has("CREATION_DATE")) fail("CREATION_DATE is required in the header.");
  if (!headerSeen.has("ORIGINATOR")) fail("ORIGINATOR is required in the header.");
  if (i >= lines.length) {
    fail("The file has no META_START block, so it has no trajectory.");
    return { oem, issues };
  }

  // --- Segments -----------------------------------------------------------
  while (i < lines.length) {
    const opening = lines[i++]; // META_START
    const segment = emptySegment();
    const number = oem.segments.length + 1;
    const where = `(segment ${number})`;
    oem.segments.push(segment);

    // Metadata block
    const metaSeen = new Set<string>();
    let metaRank = -1;
    let closed = false;
    while (i < lines.length) {
      const line = lines[i];
      if (line.text === "META_STOP") {
        closed = true;
        i++;
        break;
      }
      if (line.text === "META_START") break;
      if (EPOCH_LIKE.test(line.text) && !KEYWORD_LINE.test(line.text)) {
        fail(`META_STOP is missing: state lines begin here ${where}.`, line.n);
        closed = true;
        break; // leave the line for the data section
      }
      i++;

      const comment = COMMENT_LINE.exec(line.text);
      if (comment) {
        if (metaSeen.size === 0) segment.comments.push((comment[1] ?? "").trim());
        else fail(`COMMENT lines in a metadata block must come directly after META_START ${where}.`, line.n);
        continue;
      }

      const pair = KEYWORD_LINE.exec(line.text);
      if (!pair) {
        fail(`This is not a KEYWORD = value line: "${clip(line.text)}" ${where}.`, line.n);
        continue;
      }
      const key = pair[1];
      const value = pair[2].trim();
      const rank = (METADATA_KEYWORDS as readonly string[]).indexOf(key);

      if (rank === -1) {
        fail(`${key} is not an OEM metadata keyword ${where}.`, line.n);
        continue;
      }
      if (metaSeen.has(key)) {
        fail(`${key} appears more than once in the metadata block ${where}.`, line.n);
        continue;
      }
      if (rank < metaRank) {
        fail(
          `${key} is out of order. Metadata keywords go in this order: ${METADATA_KEYWORDS.join(", ")} ${where}.`,
          line.n,
        );
      }
      metaRank = Math.max(metaRank, rank);
      metaSeen.add(key);

      switch (key) {
        case "OBJECT_NAME":
          segment.objectName = value;
          if (value === "") fail(`OBJECT_NAME must not be empty ${where}.`, line.n);
          break;
        case "OBJECT_ID":
          segment.objectId = value;
          if (value === "") fail(`OBJECT_ID must not be empty; use UNKNOWN ${where}.`, line.n);
          break;
        case "CENTER_NAME":
          segment.centerName = value;
          if (value !== OEM_CENTER_NAME) {
            fail(`CENTER_NAME must be ${OEM_CENTER_NAME}, but this file says ${clip(value) || "nothing"} ${where}.`, line.n);
          }
          break;
        case "REF_FRAME":
          segment.refFrame = value;
          if (value !== OEM_REF_FRAME) {
            fail(`REF_FRAME must be ${OEM_REF_FRAME}, but this file says ${clip(value) || "nothing"} ${where}.`, line.n);
          }
          break;
        case "REF_FRAME_EPOCH":
          fail(
            `REF_FRAME_EPOCH must be omitted. REF_FRAME is ${OEM_REF_FRAME}, which has a fixed definition and takes no epoch ${where}.`,
            line.n,
          );
          break;
        case "TIME_SYSTEM":
          segment.timeSystem = value;
          if (value !== OEM_TIME_SYSTEM) {
            fail(`TIME_SYSTEM must be ${OEM_TIME_SYSTEM}, but this file says ${clip(value) || "nothing"} ${where}.`, line.n);
          }
          break;
        case "START_TIME":
        case "STOP_TIME":
        case "USEABLE_START_TIME":
        case "USEABLE_STOP_TIME":
          if (key === "START_TIME") segment.startTime = value;
          else if (key === "STOP_TIME") segment.stopTime = value;
          else if (key === "USEABLE_START_TIME") segment.useableStartTime = value;
          else segment.useableStopTime = value;
          if (epochToSeconds(value) === null) {
            fail(
              `${key} must be a UTC timestamp such as ${EPOCH_EXAMPLE}, but this file says "${clip(value)}" ${where}.`,
              line.n,
            );
          }
          break;
        case "INTERPOLATION":
          segment.interpolation = value;
          if (value === "") fail(`INTERPOLATION must not be empty ${where}.`, line.n);
          break;
        case "INTERPOLATION_DEGREE":
          if (/^\d+$/.test(value) && Number(value) >= 1) {
            segment.interpolationDegree = Number(value);
          } else {
            fail(
              `INTERPOLATION_DEGREE must be a whole number of 1 or more, but this file says "${clip(value)}" ${where}.`,
              line.n,
            );
          }
          break;
      }
    }

    if (!closed) {
      fail(`The metadata block that starts at META_START never reaches META_STOP ${where}.`, opening.n);
      continue;
    }

    for (const key of REQUIRED_METADATA) {
      if (!metaSeen.has(key)) {
        fail(`${key} is required in every metadata block ${where}.`, opening.n);
      }
    }
    if (metaSeen.has("INTERPOLATION") && !metaSeen.has("INTERPOLATION_DEGREE")) {
      fail(`INTERPOLATION_DEGREE is required when INTERPOLATION is present ${where}.`, opening.n);
    }

    // Data section
    const stateLines: number[] = [];
    let skippingCovariance = false;
    while (i < lines.length && lines[i].text !== "META_START") {
      const line = lines[i++];

      if (skippingCovariance) {
        if (line.text === "COVARIANCE_STOP") skippingCovariance = false;
        continue;
      }
      if (line.text === "COVARIANCE_START") {
        fail(`COVARIANCE blocks are not part of the 3rok profile. Remove the covariance data ${where}.`, line.n);
        skippingCovariance = true;
        continue;
      }

      const comment = COMMENT_LINE.exec(line.text);
      if (comment) {
        if (segment.states.length === 0) segment.dataComments.push((comment[1] ?? "").trim());
        else fail(`COMMENT lines in the data section must come before the first state line ${where}.`, line.n);
        continue;
      }

      const tokens = line.text.split(/\s+/);
      const values = tokens.slice(1);
      if (values.length !== 6 && values.length !== 9) {
        fail(
          `A state line holds an epoch and then 6 numbers (position and velocity) or 9 numbers (with acceleration), but this line has ${values.length} ${where}.`,
          line.n,
        );
        continue;
      }
      const time = epochToSeconds(tokens[0]);
      let good = true;
      if (time === null) {
        fail(`"${clip(tokens[0])}" is not a valid UTC epoch. Use a form like ${EPOCH_EXAMPLE} ${where}.`, line.n);
        good = false;
      }
      const numbers: number[] = [];
      for (const token of values) {
        const parsed = NUMBER.test(token) ? Number(token) : Number.NaN;
        if (!Number.isFinite(parsed)) {
          fail(`"${clip(token)}" is not a number. State lines hold km, km/s, and km/s^2 values ${where}.`, line.n);
          good = false;
        }
        numbers.push(parsed);
      }
      if (!good || time === null) continue;

      segment.states.push({
        epoch: tokens[0],
        time,
        position: [numbers[0], numbers[1], numbers[2]],
        velocity: [numbers[3], numbers[4], numbers[5]],
        acceleration: numbers.length === 9 ? [numbers[6], numbers[7], numbers[8]] : null,
      });
      stateLines.push(line.n);
    }

    // Checks that need the whole segment.
    const { states } = segment;
    if (states.length === 0) {
      fail(`There are no state lines after META_STOP ${where}.`, opening.n);
      continue;
    }

    const withAcceleration = states[0].acceleration !== null;
    const mixed = states.findIndex((state) => (state.acceleration !== null) !== withAcceleration);
    if (mixed !== -1) {
      fail(
        withAcceleration
          ? `Acceleration must be on every state line of a segment or on none, but line ${stateLines[0]} has it and line ${stateLines[mixed]} does not ${where}.`
          : `Acceleration must be on every state line of a segment or on none, but line ${stateLines[mixed]} has it and line ${stateLines[0]} does not ${where}.`,
        stateLines[mixed],
      );
    }

    for (let k = 1; k < states.length; k++) {
      if (states[k].time <= states[k - 1].time) {
        fail(
          `Epochs in a segment must increase, but ${states[k].epoch} on line ${stateLines[k]} is not later than ${states[k - 1].epoch} on line ${stateLines[k - 1]} ${where}.`,
          stateLines[k],
        );
        break;
      }
    }

    const first = states[0];
    const last = states[states.length - 1];
    const start = epochToSeconds(segment.startTime);
    const stop = epochToSeconds(segment.stopTime);
    if (start !== null && start !== first.time) {
      fail(
        `START_TIME must match the first state's epoch, but START_TIME is ${segment.startTime} and the first state is at ${first.epoch} ${where}.`,
        opening.n,
      );
    }
    if (stop !== null && stop !== last.time) {
      fail(
        `STOP_TIME must match the last state's epoch, but STOP_TIME is ${segment.stopTime} and the last state is at ${last.epoch} ${where}.`,
        opening.n,
      );
    }
    const usableStart = segment.useableStartTime ? epochToSeconds(segment.useableStartTime) : null;
    const usableStop = segment.useableStopTime ? epochToSeconds(segment.useableStopTime) : null;
    if (start !== null && stop !== null) {
      for (const [key, value] of [
        ["USEABLE_START_TIME", usableStart],
        ["USEABLE_STOP_TIME", usableStop],
      ] as const) {
        if (value !== null && (value < start || value > stop)) {
          fail(`${key} must fall between START_TIME and STOP_TIME ${where}.`, opening.n);
        }
      }
    }
    if (usableStart !== null && usableStop !== null && usableStart > usableStop) {
      fail(`USEABLE_START_TIME must not be later than USEABLE_STOP_TIME ${where}.`, opening.n);
    }
  }

  const total = oem.segments.reduce((sum, segment) => sum + segment.states.length, 0);
  if (total < 2) {
    fail(
      `An OEM needs at least two state lines so the path has a start and an end, but this file has ${total}.`,
    );
  }

  issues.sort((a, b) => (a.line ?? Number.MAX_SAFE_INTEGER) - (b.line ?? Number.MAX_SAFE_INTEGER));
  return { oem, issues };
}

/**
 * Parses and validates OEM text against the 3rok profile. On success the
 * result carries the epochs and GCRF states, so a line can be drawn. On
 * failure it carries every problem found, each in a sentence. A file that
 * fails here must not be drawn or flown.
 */
export function parseOem(text: string, options: OemParseOptions = {}): OemParseResult {
  const { oem, issues } = readOem(text, options);
  return issues.length === 0 ? { ok: true, oem } : { ok: false, errors: issues };
}

/** The `validate_oem` result: validity, plain-language errors, and a summary. */
export function validateOem(text: string, options: OemParseOptions = {}): OemValidation {
  const { oem, issues } = readOem(text, options);
  const segments = oem.segments;
  return {
    valid: issues.length === 0,
    errors: issues.map(formatIssue),
    segment_count: segments.length,
    state_count: segments.reduce((sum, segment) => sum + segment.states.length, 0),
    start_time: segments[0]?.startTime || null,
    stop_time: segments[segments.length - 1]?.stopTime || null,
    has_acceleration: segments.some((segment) =>
      segment.states.some((state) => state.acceleration !== null),
    ),
  };
}

// ---------------------------------------------------------------------------
// Writing

function formatNumber(value: number): string {
  const text = String(value);
  const exponent = /e/i.exec(text);
  if (exponent) {
    const mantissa = text.slice(0, exponent.index);
    const power = text.slice(exponent.index + 1);
    return `${mantissa.includes(".") ? mantissa : `${mantissa}.0`}e${power}`;
  }
  return text.includes(".") ? text : `${text}.0`;
}

function commentLines(comments: string[]): string[] {
  return comments.flatMap((comment) =>
    comment
      .split(/\r?\n/)
      .map((part) => (part.trim() === "" ? "COMMENT" : `COMMENT ${part.trim()}`)),
  );
}

/**
 * Writes CCSDS OEM 3.0 keyword-value text and nothing else. The result is
 * read back with the same rules `parseOem` enforces, with ORIGINATOR required
 * to be 3ROK, so this never writes a file the parser would refuse. Throws an
 * `OemError` listing the problems if the model cannot be written as a valid
 * 3rok OEM.
 */
export function serializeOem(oem: Oem): string {
  const out: string[] = [`CCSDS_OEM_VERS = ${OEM_VERSION}`, ...commentLines(oem.headerComments)];
  if (oem.classification !== null) out.push(`CLASSIFICATION = ${oem.classification}`);
  out.push(`CREATION_DATE = ${oem.creationDate}`, `ORIGINATOR = ${oem.originator}`);
  if (oem.messageId !== null) out.push(`MESSAGE_ID = ${oem.messageId}`);

  for (const segment of oem.segments) {
    out.push("META_START", ...commentLines(segment.comments));
    out.push(
      `OBJECT_NAME = ${segment.objectName}`,
      `OBJECT_ID = ${segment.objectId}`,
      `CENTER_NAME = ${segment.centerName}`,
      `REF_FRAME = ${segment.refFrame}`,
      `TIME_SYSTEM = ${segment.timeSystem}`,
      `START_TIME = ${segment.startTime}`,
    );
    if (segment.useableStartTime !== null) out.push(`USEABLE_START_TIME = ${segment.useableStartTime}`);
    if (segment.useableStopTime !== null) out.push(`USEABLE_STOP_TIME = ${segment.useableStopTime}`);
    out.push(`STOP_TIME = ${segment.stopTime}`);
    if (segment.interpolation !== null) out.push(`INTERPOLATION = ${segment.interpolation}`);
    if (segment.interpolationDegree !== null) {
      out.push(`INTERPOLATION_DEGREE = ${segment.interpolationDegree}`);
    }
    out.push("META_STOP", ...commentLines(segment.dataComments));
    for (const state of segment.states) {
      const numbers = [...state.position, ...state.velocity, ...(state.acceleration ?? [])];
      out.push(`${state.epoch}  ${numbers.map(formatNumber).join("  ")}`);
    }
  }

  const text = `${out.join("\n")}\n`;
  const { issues } = readOem(text, { thisAppWrote: true });
  if (issues.length > 0) throw new OemError(issues);
  return text;
}
