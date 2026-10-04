// The evaluator. One function decides whether a candidate OEM is kept, so no two lanes can
// invent two scores. Grok proposes a file. This function keeps it or does not.
//
// It reduces the OEM it is given (lib/oem-reduce.ts), asks the physics service for the
// predicted lifetime of that orbit, and compares it with the case's holdout outcomes.
// It never calls Grok, never draws, never writes the case log, and never changes the case it
// reads: the route writes the log from the result. It reads `records`, `chipIds` and
// `holdoutError` and nothing else, so `workingOem` and `optimizedOem` stay as they were.
//
// Nothing is filled in. A missing LTAN, shield thickness or chip refuses the score. The
// package's defaults (800 km, sun-synchronous, 6 h, 5 mm, commercial) are never applied.

import type { CaseDocument, CaseRecord, ValueStatus } from "./case";
import { chipIdFor } from "./case-ops";
import { CHIP_PRESETS, KNOWN_CHIP_IDS, type ChipPreset } from "./chip-ids";
import { reduceOem, type ReducedOrbit } from "./oem-reduce";

// ---------------------------------------------------------------------------
// The physics service, as this function sees it. Phase 5 supplies the real call. Tests
// supply a stub. A failure to reach it is thrown, not scored, so the route can say
// "Physics unavailable" and not record an error.

export type ScoreOrbitInput = {
  altitude_km: number;
  inclination: "sso" | number;
  ltan_hours: number;
  shield_mm_Al: number;
} & ({ chip_id: string } | { chip_preset: ChipPreset });

export type ScoreOrbitResult =
  | { refused: true; reason?: string }
  | { refused: false; lifetime_years: number | null; assumptions_note?: string | null };

export type ScoreOrbit = (input: ScoreOrbitInput) => Promise<ScoreOrbitResult>;

// ---------------------------------------------------------------------------
// Result

export type OutcomeRowScore = {
  record_id: string;
  kind: "failure" | "censored";
  observed_years: number;
  predicted_years: number;
  /** Failure: |predicted - observed|. Censored: 0 when predicted >= observed, else observed - predicted. */
  error_years: number;
};

export type SkippedRecord = { record_id: string; reason: string };

/** Where each number sent to the service came from, with that record's `value_status`. */
export type ScoreInputs = {
  chip: { record_id: string; part_number: string; sent_as: "chip_id" | "chip_preset"; value: string };
  ltan_hours: { record_id: string; value: number; value_status: ValueStatus };
  shield_mm_Al: { record_id: string; value: number; value_status: ValueStatus };
};

type Detail = {
  orbit: ReducedOrbit | null;
  inputs: ScoreInputs | null;
  predicted_lifetime_years: number | null;
  assumptions_note: string | null;
  /** The outcome rows the error was computed from. Empty unless a lifetime was compared. */
  rows: OutcomeRowScore[];
  skipped: SkippedRecord[];
  refusals: string[];
  /** One sentence for the log. */
  reason: string;
};

export type HoldoutResult =
  /** Nothing to score against. The draft stays unscored and `optimizedOem` is not set. */
  | (Detail & { verdict: "unscored"; error: null; previous_error: number | null })
  /** Lower than the stored error, or the first finite one. The route may replace `optimizedOem`. */
  | (Detail & { verdict: "kept"; error: number; previous_error: number | null })
  /** Not lower, or refused (error is Infinity). The candidate is not the optimized file. */
  | (Detail & { verdict: "rejected"; error: number; previous_error: number | null });

// ---------------------------------------------------------------------------
// Reading the case

type Fields = Record<string, unknown>;

/** The body as an object with lower-cased keys, or null when it is not a JSON object. */
function bodyOf(record: CaseRecord): Fields | null {
  try {
    const parsed: unknown = JSON.parse(record.body);
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) return null;
    return Object.fromEntries(Object.entries(parsed).map(([key, value]) => [key.trim().toLowerCase().replace(/[\s-]+/g, "_"), value]));
  } catch {
    return null;
  }
}

/** A finite number, from a number or from text that is only a number. CSV and XLSX bodies carry text. */
function numberOf(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

const present = (value: unknown) => value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");

const samePart = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

type Outcome = { record: CaseRecord; kind: "failure" | "censored"; observed: number };

function readOutcome(record: CaseRecord): Outcome | { skip: string } {
  const body = bodyOf(record);
  if (!body) return { skip: "The body is not a JSON object, so no failure time or censor time could be read." };
  const hasFailure = present(body.failure_time_years);
  const hasCensor = present(body.censor_time_years);
  if (hasFailure && hasCensor) return { skip: "It gives both a failure time and a censor time. It must give one." };
  if (!hasFailure && !hasCensor) return { skip: "It has no failure_time_years or censor_time_years." };
  const key = hasFailure ? "failure_time_years" : "censor_time_years";
  const observed = numberOf(body[key]);
  if (observed === null || observed < 0) return { skip: `${key} is not a number of years, 0 or more.` };
  return { record, kind: hasFailure ? "failure" : "censored", observed };
}

type ChosenChip = { record: CaseRecord; id: string; request: { chip_id: string } | { chip_preset: ChipPreset } };

function chooseChip(doc: Pick<CaseDocument, "records" | "chipIds">, known: ReadonlySet<string>): ChosenChip | string {
  const identities = doc.records.filter((record) => record.record_type === "chip-identity");
  if (identities.length === 0) return "The case has no chip-identity record, so there is no chip to score.";

  let record: CaseRecord | undefined;
  if (doc.chipIds.length > 1) return "More than one chip is selected. A score is for one chip. Check one in the Data region.";
  if (doc.chipIds.length === 1) {
    record = identities.find((candidate) => chipIdFor(candidate) === doc.chipIds[0]);
    if (!record) return `The selected chip ${doc.chipIds[0]} has no chip-identity record.`;
  } else if (identities.length === 1) {
    record = identities[0];
  } else {
    return "The case has more than one chip-identity record and none is selected. Check one in the Data region.";
  }

  const id = chipIdFor(record);
  if (known.has(id)) return { record, id, request: { chip_id: id } };
  const preset = bodyOf(record)?.chip_preset;
  if (typeof preset === "string" && (CHIP_PRESETS as readonly string[]).includes(preset.trim().toLowerCase())) {
    return { record, id, request: { chip_preset: preset.trim().toLowerCase() as ChipPreset } };
  }
  return `The chip ${id} is not in ai_chips.yaml, and its chip-identity record does not say commercial or rad_hard in chip_preset. It is not scored as a guess.`;
}

type Found = { record: CaseRecord; value: number };

/** The one number a key holds across these records, or the sentence that says why there is not one. */
function onlyValue(records: CaseRecord[], key: string, label: string, where: string, hint: string): Found | string {
  const found: Found[] = [];
  for (const record of records) {
    const value = numberOf(bodyOf(record)?.[key]);
    if (value !== null) found.push({ record, value });
  }
  if (found.length === 0) return `No ${where} record gives ${label} as a number. ${hint} It is not filled in.`;
  const distinct = new Set(found.map((entry) => entry.value));
  if (distinct.size > 1) {
    const list = found.map((entry) => `${entry.record.record_id} says ${entry.value}`).join(", ");
    return `The ${where} records disagree on ${label}: ${list}. Keep one.`;
  }
  return found[0];
}

// ---------------------------------------------------------------------------
// The score

const years = (value: number) => value.toFixed(3);

/**
 * Scores one candidate OEM against the case's holdout outcomes.
 *
 * - No holdout outcome with a failure time or a censor time: `unscored`.
 * - A refusal anywhere (the OEM profile, the 500 to 2000 km envelope, a missing LTAN, shield or
 *   chip, or the service refusing the orbit): `rejected`, with an infinite error.
 * - Otherwise the case error is the mean over the holdout outcome rows for the selected chip,
 *   each scored against the one predicted lifetime. It is kept only when it is finite and
 *   strictly lower than `doc.holdoutError`. The first finite error is kept, because there is no
 *   earlier one.
 */
export async function evaluateCandidate({
  candidateOem,
  doc,
  scoreOrbit,
  knownChipIds = KNOWN_CHIP_IDS,
}: {
  candidateOem: string;
  doc: Pick<CaseDocument, "records" | "chipIds" | "holdoutError">;
  scoreOrbit: ScoreOrbit;
  knownChipIds?: ReadonlySet<string>;
}): Promise<HoldoutResult> {
  const previous = doc.holdoutError;
  const skipped: SkippedRecord[] = [];
  const base: Detail = {
    orbit: null,
    inputs: null,
    predicted_lifetime_years: null,
    assumptions_note: null,
    rows: [],
    skipped,
    refusals: [],
    reason: "",
  };
  /** Not kept. A refusal has no error to report, so its error is infinite. A score that did not improve keeps its own. */
  const rejected = (detail: Partial<Detail>, reason: string, error = Number.POSITIVE_INFINITY): HoldoutResult => ({
    ...base,
    ...detail,
    reason,
    verdict: "rejected",
    error,
    previous_error: previous,
  });

  // 1. Which holdout outcomes could be scored at all.
  const outcomes: Outcome[] = [];
  for (const record of doc.records) {
    if (record.record_type !== "outcome" || record.split !== "holdout") continue;
    const read = readOutcome(record);
    if ("skip" in read) skipped.push({ record_id: record.record_id, reason: read.skip });
    else outcomes.push(read);
  }

  // 2. The orbit and the inputs the case has to supply.
  const refusals: string[] = [];
  const reduced = reduceOem(candidateOem);
  if (!reduced.ok) refusals.push(...reduced.refusals);

  const chip = chooseChip(doc, knownChipIds);
  if (typeof chip === "string") refusals.push(chip);

  const trajectories = doc.records.filter((record) => record.record_type === "trajectory");
  const ltan = onlyValue(trajectories, "ltan_hours", "ltan_hours", "trajectory", "Add ltan_hours to a trajectory record's body.");
  if (typeof ltan === "string") refusals.push(ltan);

  const placements = doc.records.filter(
    (record) => record.record_type === "placement" && (typeof chip === "string" || samePart(record.part_number, chip.record.part_number)),
  );
  const shield = onlyValue(placements, "shield_mm_al", "shield_mm_Al", "placement", "Add shield_mm_Al, in millimetres of aluminium, to the chip's placement record.");
  if (typeof shield === "string") refusals.push(shield);

  if (outcomes.length === 0) {
    return {
      ...base,
      orbit: reduced.ok ? reduced.orbit : null,
      refusals,
      reason: "No holdout outcome has a failure time or a censor time, so the candidate is unscored.",
      verdict: "unscored",
      error: null,
      previous_error: previous,
    };
  }

  if (refusals.length > 0 || !reduced.ok || typeof chip === "string" || typeof ltan === "string" || typeof shield === "string") {
    return rejected(
      { orbit: reduced.ok ? reduced.orbit : null, refusals },
      `The candidate was refused, so it is not kept: ${refusals.join(" ")}`,
    );
  }

  const inputs: ScoreInputs = {
    chip: {
      record_id: chip.record.record_id,
      part_number: chip.record.part_number,
      sent_as: "chip_id" in chip.request ? "chip_id" : "chip_preset",
      value: "chip_id" in chip.request ? chip.request.chip_id : chip.request.chip_preset,
    },
    ltan_hours: { record_id: ltan.record.record_id, value: ltan.value, value_status: ltan.record.value_status },
    shield_mm_Al: { record_id: shield.record.record_id, value: shield.value, value_status: shield.record.value_status },
  };

  // 3. Only the outcomes for this chip are compared with this chip's lifetime.
  const forChip = outcomes.filter((outcome) => samePart(outcome.record.part_number, chip.record.part_number));
  for (const outcome of outcomes) {
    if (!forChip.includes(outcome)) {
      skipped.push({
        record_id: outcome.record.record_id,
        reason: `It is for ${outcome.record.part_number}, not for the selected chip ${chip.record.part_number}.`,
      });
    }
  }
  if (forChip.length === 0) {
    return {
      ...base,
      orbit: reduced.orbit,
      inputs,
      reason: `No holdout outcome is for the selected chip ${chip.record.part_number}, so the candidate is unscored.`,
      verdict: "unscored",
      error: null,
      previous_error: previous,
    };
  }

  // 4. The one call to the physics service.
  const scored = await scoreOrbit({
    altitude_km: reduced.orbit.altitude_km,
    inclination: reduced.orbit.score_inclination,
    ltan_hours: ltan.value,
    shield_mm_Al: shield.value,
    ...chip.request,
  });
  if (scored.refused || scored.lifetime_years === null || !Number.isFinite(scored.lifetime_years)) {
    const why = scored.refused
      ? (scored.reason ?? "The physics service refused the orbit.")
      : "The physics service returned no lifetime.";
    return rejected({ orbit: reduced.orbit, inputs, refusals: [why] }, `The physics service did not score the orbit, so the candidate is not kept: ${why}`);
  }
  const predicted = scored.lifetime_years;

  const rows: OutcomeRowScore[] = forChip.map(({ record, kind, observed }) => ({
    record_id: record.record_id,
    kind,
    observed_years: observed,
    predicted_years: predicted,
    error_years: kind === "failure" ? Math.abs(predicted - observed) : predicted >= observed ? 0 : observed - predicted,
  }));
  const error = rows.reduce((sum, row) => sum + row.error_years, 0) / rows.length;

  const detail: Partial<Detail> = {
    orbit: reduced.orbit,
    inputs,
    predicted_lifetime_years: predicted,
    assumptions_note: scored.assumptions_note ?? null,
    rows,
  };

  if (Number.isFinite(error) && (previous === null || error < previous)) {
    return {
      ...base,
      ...detail,
      reason:
        previous === null
          ? `The holdout error is ${years(error)} years. It is the first score, so the candidate is kept.`
          : `The holdout error fell from ${years(previous)} to ${years(error)} years, so the candidate is kept.`,
      verdict: "kept",
      error,
      previous_error: previous,
    };
  }
  return rejected(
    detail,
    `The holdout error is ${years(error)} years, not lower than the stored ${years(previous ?? error)} years, so the candidate is not kept.`,
    error,
  );
}
