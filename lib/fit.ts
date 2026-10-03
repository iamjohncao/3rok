// The vehicle-class estimate on the testing page. Every figure here is an
// estimate. The only vehicle numbers used are the published class figures in
// docs/product-spec.md. There is no price, no engine-out case, and no throttle
// history, and nothing is ranked on a mass the case does not state.
//
// Fit order, from the spec: destination (from the terminal state), then mass,
// then fairing, with the terminal specific energy as a check on the destination.

import { EARTH_EQUATORIAL_RADIUS_KM, EARTH_MU_KM3_S2, cross, dot, norm } from "./frame";
import type { Vec3 } from "./oem";

export type VehicleClass = "Falcon 9" | "Falcon Heavy" | "Starship";

export type PublishedSource = { label: string; url: string | null };

export type PublishedClass = {
  name: VehicleClass;
  /** kg to LEO as published. Starship's figure is a lower bound ("over 100 t"). */
  leoKg: number;
  leoIsLowerBound: boolean;
  /** The published figure, in the words the product spec uses. */
  published: string;
  fairing: {
    /** The published width the case's envelope is compared with, m. */
    diameterM: number;
    heightM: number;
    /** What that width is. Falcon's is an outer diameter, so a payload needs less. */
    text: string;
  };
  sources: PublishedSource[];
};

/** Published class figures, as cited in the product spec. */
export const PUBLISHED_CLASSES: readonly PublishedClass[] = [
  {
    name: "Falcon 9",
    leoKg: 22800,
    leoIsLowerBound: false,
    published: "22,800 kg to LEO. Standard fairing 5.2 m outer diameter, 13.2 m overall height.",
    fairing: { diameterM: 5.2, heightM: 13.2, text: "5.2 m outer diameter, 13.2 m overall height" },
    sources: [
      { label: "Falcon 9", url: "https://www.spacex.com/vehicles/falcon-9/" },
      {
        label: "Falcon User's Guide, 9 May 2025",
        url: "https://www.spacex.com/assets/media/falcon-users-guide-2025-05-09.pdf",
      },
    ],
  },
  {
    name: "Falcon Heavy",
    leoKg: 63800,
    leoIsLowerBound: false,
    published: "63,800 kg to LEO. Same 5.2 m fairing.",
    fairing: { diameterM: 5.2, heightM: 13.2, text: "5.2 m outer diameter, 13.2 m overall height" },
    sources: [{ label: "Falcon Heavy", url: "https://www.spacex.com/vehicles/falcon-heavy/" }],
  },
  {
    name: "Starship",
    leoKg: 100000,
    leoIsLowerBound: true,
    published:
      "Over 100 t to LEO on a single launch with full reuse (reference up to 500 km circular, up to 98.9° inclination). 9 m outer-diameter fairing, 8 m payload dynamic envelope, extended volume up to 22 m height.",
    fairing: { diameterM: 8, heightM: 22, text: "8 m payload dynamic envelope inside a 9 m fairing, extended volume up to 22 m height" },
    sources: [{ label: "Starship Users Guide, initial release", url: null }],
  },
];

/** The page's own boundary for "low Earth orbit": an apogee at or below this altitude. Not a published figure. */
export const LEO_CEILING_KM = 2000;

export type Destination = "suborbital" | "leo" | "transfer" | "escape";

export type TerminalOrbit = {
  destination: Destination;
  /** Specific mechanical energy v^2/2 - mu/r of the terminal state, km^2/s^2. */
  specificEnergyKm2S2: number;
  /** Null for an unbound orbit. */
  apogeeAltitudeKm: number | null;
  perigeeAltitudeKm: number;
};

/** What kind of destination the last state of the file is on. Derived from that one state. */
export function classifyTerminalState(position: Vec3, velocity: Vec3): TerminalOrbit {
  const r = norm(position);
  const v = norm(velocity);
  const energy = (v * v) / 2 - EARTH_MU_KM3_S2 / r;

  const radialSpeed = dot(position, velocity);
  const eccentricityVector: Vec3 = [
    ((v * v - EARTH_MU_KM3_S2 / r) * position[0] - radialSpeed * velocity[0]) / EARTH_MU_KM3_S2,
    ((v * v - EARTH_MU_KM3_S2 / r) * position[1] - radialSpeed * velocity[1]) / EARTH_MU_KM3_S2,
    ((v * v - EARTH_MU_KM3_S2 / r) * position[2] - radialSpeed * velocity[2]) / EARTH_MU_KM3_S2,
  ];
  const e = norm(eccentricityVector);

  if (energy >= 0) {
    const h = norm(cross(position, velocity));
    const perigeeRadius = h * h / EARTH_MU_KM3_S2 / (1 + e);
    return {
      destination: "escape",
      specificEnergyKm2S2: energy,
      apogeeAltitudeKm: null,
      perigeeAltitudeKm: perigeeRadius - EARTH_EQUATORIAL_RADIUS_KM,
    };
  }

  const a = -EARTH_MU_KM3_S2 / (2 * energy);
  const perigeeAltitudeKm = a * (1 - e) - EARTH_EQUATORIAL_RADIUS_KM;
  const apogeeAltitudeKm = a * (1 + e) - EARTH_EQUATORIAL_RADIUS_KM;
  const destination: Destination =
    perigeeAltitudeKm < 0 ? "suborbital" : apogeeAltitudeKm <= LEO_CEILING_KM ? "leo" : "transfer";
  return { destination, specificEnergyKm2S2: energy, apogeeAltitudeKm, perigeeAltitudeKm };
}

export type Envelope = { diameterM: number; heightM?: number | null };

export type FitInput = {
  terminal: { position: Vec3; velocity: Vec3 };
  /** Chip mass plus support mass, kg. Only when the case states both. */
  massKg?: number | null;
  /** The payload envelope, when the case states one. */
  envelope?: Envelope | null;
};

export type FitRow = {
  name: VehicleClass;
  published: string;
  fairing: string;
  sources: PublishedSource[];
  /** Null when the case states no mass, or the published figure is only a lower bound and the mass is above it. */
  coversMass: boolean | null;
  /** Null when the case states no envelope. */
  coversEnvelope: boolean | null;
};

export type FitResult = {
  isEstimate: true;
  orbit: TerminalOrbit;
  recommended: VehicleClass | null;
  /** Plain sentences saying how the class was chosen, or why none was. */
  reason: string;
  /** The case's own values, or null where the case states none. */
  caseValues: { massKg: number | null; envelope: Envelope | null };
  rows: FitRow[];
  energyCheck: { agrees: boolean; text: string };
};

const LEO_CEILING_ENERGY = -EARTH_MU_KM3_S2 / (2 * (EARTH_EQUATORIAL_RADIUS_KM + LEO_CEILING_KM));

function usableMass(massKg: number | null | undefined): number | null {
  return typeof massKg === "number" && Number.isFinite(massKg) && massKg > 0 ? massKg : null;
}

function usableEnvelope(envelope: Envelope | null | undefined): Envelope | null {
  return envelope && Number.isFinite(envelope.diameterM) && envelope.diameterM > 0 ? envelope : null;
}

function km(value: number): string {
  return `${Math.round(value).toLocaleString("en-US")} km`;
}

function energyCheck(orbit: TerminalOrbit): FitResult["energyCheck"] {
  const e = orbit.specificEnergyKm2S2;
  const bin: Destination | "above-leo" = e >= 0 ? "escape" : e > LEO_CEILING_ENERGY ? "above-leo" : "leo";
  const agrees =
    (orbit.destination === "escape" && bin === "escape") ||
    (orbit.destination === "leo" && bin === "leo") ||
    (orbit.destination === "transfer" && (bin === "above-leo" || bin === "leo")) ||
    orbit.destination === "suborbital";
  const energy = `${e.toFixed(1)} km²/s²`;
  const ceiling = `${LEO_CEILING_ENERGY.toFixed(1)} km²/s² for a circular ${LEO_CEILING_KM.toLocaleString("en-US")} km orbit`;
  if (orbit.destination === "transfer" && bin === "leo") {
    return {
      agrees,
      text: `The terminal energy is ${energy}, below the ${ceiling}, but the apogee is above ${LEO_CEILING_KM.toLocaleString("en-US")} km. This is a low-energy, strongly elliptical orbit.`,
    };
  }
  return { agrees, text: `Terminal specific energy ${energy}. The LEO boundary is ${ceiling}.` };
}

/** Recommends a SpaceX vehicle class, in the spec's order. Every figure it returns is an estimate. */
export function fitVehicleClass(input: FitInput): FitResult {
  const orbit = classifyTerminalState(input.terminal.position, input.terminal.velocity);
  const massKg = usableMass(input.massKg);
  const envelope = usableEnvelope(input.envelope);

  const rows: FitRow[] = PUBLISHED_CLASSES.map((cls) => ({
    name: cls.name,
    published: cls.published,
    fairing: cls.fairing.text,
    sources: cls.sources,
    coversMass:
      massKg === null ? null : massKg <= cls.leoKg ? true : cls.leoIsLowerBound ? null : false,
    coversEnvelope:
      envelope === null
        ? null
        : envelope.diameterM <= cls.fairing.diameterM &&
          (envelope.heightM == null || envelope.heightM <= cls.fairing.heightM),
  }));

  const result = (recommended: VehicleClass | null, reason: string): FitResult => ({
    isEstimate: true,
    orbit,
    recommended,
    reason,
    caseValues: { massKg, envelope },
    rows,
    energyCheck: energyCheck(orbit),
  });

  // 1. Destination.
  if (orbit.destination === "suborbital") {
    return result(
      null,
      `The terminal state is not on an orbit: its perigee is ${km(Math.abs(orbit.perigeeAltitudeKm))} below the surface. No destination class applies.`,
    );
  }
  if (orbit.destination === "transfer") {
    return result(
      null,
      `The terminal state is on a transfer orbit with an apogee near ${km(orbit.apogeeAltitudeKm as number)}. The published figures here are LEO figures, so this panel cannot pick a class for that destination.`,
    );
  }
  if (orbit.destination === "escape") {
    return result(
      null,
      "The terminal state is on an escape trajectory. The published figures here are LEO figures, so this panel cannot pick a class for that destination.",
    );
  }

  // 2 and 3. Mass and fairing, when the case states them. The smallest class that covers what is stated.
  const used: string[] = [];
  const skipped: string[] = [];
  if (massKg !== null) used.push(`a stated mass of ${Math.round(massKg).toLocaleString("en-US")} kg`);
  else skipped.push("The case states no chip mass plus support mass, so the class is not ranked on mass.");
  if (envelope !== null) {
    used.push(
      `a stated envelope ${envelope.diameterM} m wide${envelope.heightM != null ? ` and ${envelope.heightM} m tall` : ""}`,
    );
  } else skipped.push("The case states no payload envelope, so the fairing is not compared.");

  const covered = rows.filter((row) => row.coversMass !== false && row.coversEnvelope !== false);
  const destination = `The destination is low Earth orbit (apogee near ${km(orbit.apogeeAltitudeKm as number)}).`;

  if (covered.length === 0) {
    return result(
      null,
      `${destination} No class's published figures cover ${used.join(" and ")}.`,
    );
  }

  const pick = covered[0];
  const lowerBound =
    massKg !== null && pick.coversMass === null
      ? " Starship's published figure is a lower bound (over 100 t), so the fit above 100 t is not confirmed."
      : "";
  const basis = used.length > 0 ? `It covers ${used.join(" and ")}.` : "It is the smallest class that serves LEO.";
  return result(
    pick.name,
    [destination, `${pick.name} is the smallest class whose published figures fit. ${basis}${lowerBound}`, ...skipped].join(" "),
  );
}
