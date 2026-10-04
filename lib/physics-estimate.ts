// The physics panel's numbers for one case's flight file. The same reading the evaluator uses:
// reduce the OEM (lib/oem-reduce.ts), take the chip, LTAN and shield from the case
// (gatherScoreInputs in lib/holdout.ts), and ask the physics service for one orbit.
//
// It compares nothing with a holdout outcome, scores nothing, writes no log, and never changes the
// case. It invents nothing: a missing input, an orbit outside the envelope, or a service that
// refuses is a refusal with the sentence and no lifetime. A service that cannot be reached is
// "unavailable", and no number stands in for it.

import type { CaseDocument } from "./case";
import { KNOWN_CHIP_IDS } from "./chip-ids";
import { flightArtifact, type FlightSource } from "./export";
import {
  describeScoreInputs,
  gatherScoreInputs,
  type PhysicsEstimate,
  type ScoreInputs,
  type ScoreOrbit,
} from "./holdout";
import { reduceOem, type ReducedOrbit } from "./oem-reduce";

export type PhysicsReport =
  | { kind: "no_flight" }
  /** The case has nothing the orbit could be scored with, or the service refused it. No lifetime. */
  | { kind: "refused"; flight: FlightSource; reasons: string[]; orbit: ReducedOrbit | null; inputs: ScoreInputs | null }
  /** The service was not reached. Nothing is estimated in its place. */
  | { kind: "unavailable"; flight: FlightSource; message: string }
  | {
      kind: "estimate";
      flight: FlightSource;
      lifetime_years: number;
      estimate: PhysicsEstimate | null;
      assumptions_note: string | null;
      orbit: ReducedOrbit;
      inputs: ScoreInputs;
    };

export async function physicsFor({
  doc,
  scoreOrbit,
  knownChipIds = KNOWN_CHIP_IDS,
}: {
  doc: Pick<CaseDocument, "records" | "chipIds" | "workingOem" | "optimizedOem">;
  /** Null when no flight server is configured. */
  scoreOrbit: ScoreOrbit | null;
  knownChipIds?: ReadonlySet<string>;
}): Promise<PhysicsReport> {
  const artifact = flightArtifact(doc as CaseDocument);
  if (artifact === null) return { kind: "no_flight" };
  const flight = artifact.source;

  const reasons: string[] = [];
  const reduced = reduceOem(artifact.text);
  if (!reduced.ok) reasons.push(...reduced.refusals);

  const { chip, ltan, shield } = gatherScoreInputs(doc, knownChipIds);
  if (typeof chip === "string") reasons.push(chip);
  if (typeof ltan === "string") reasons.push(ltan);
  if (typeof shield === "string") reasons.push(shield);

  if (!reduced.ok || typeof chip === "string" || typeof ltan === "string" || typeof shield === "string") {
    return {
      kind: "refused",
      flight,
      reasons,
      orbit: reduced.ok ? reduced.orbit : null,
      inputs: null,
    };
  }

  const inputs = describeScoreInputs(chip, ltan, shield);
  if (scoreOrbit === null) {
    return { kind: "unavailable", flight, message: "No physics server is connected to this deployment." };
  }

  let scored;
  try {
    scored = await scoreOrbit({
      altitude_km: reduced.orbit.altitude_km,
      inclination: reduced.orbit.score_inclination,
      ltan_hours: ltan.value,
      shield_mm_Al: shield.value,
      ...chip.request,
    });
  } catch (error) {
    return { kind: "unavailable", flight, message: error instanceof Error ? error.message : "The physics server could not be reached." };
  }

  if (scored.refused) {
    return {
      kind: "refused",
      flight,
      reasons: [scored.reason ?? "The physics service refused the orbit."],
      orbit: reduced.orbit,
      inputs,
    };
  }
  if (scored.lifetime_years === null || !Number.isFinite(scored.lifetime_years)) {
    return {
      kind: "refused",
      flight,
      reasons: ["The physics service returned no lifetime for this orbit."],
      orbit: reduced.orbit,
      inputs,
    };
  }
  return {
    kind: "estimate",
    flight,
    lifetime_years: scored.lifetime_years,
    estimate: scored.estimate ?? null,
    assumptions_note: scored.assumptions_note ?? null,
    orbit: reduced.orbit,
    inputs,
  };
}
