import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { EARTH_EQUATORIAL_RADIUS_KM as R, EARTH_MU_KM3_S2 as MU } from "./frame";
import {
  LEO_CEILING_KM,
  PUBLISHED_CLASSES,
  classifyTerminalState,
  fitVehicleClass,
} from "./fit";
import { parseOem, type Vec3 } from "./oem";

type State = { position: Vec3; velocity: Vec3 };

function circular(altitudeKm: number): State {
  const r = R + altitudeKm;
  return { position: [r, 0, 0], velocity: [0, Math.sqrt(MU / r), 0] };
}

// A state at perigee of an orbit with the given perigee and apogee altitudes.
function elliptical(perigeeKm: number, apogeeKm: number): State {
  const rp = R + perigeeKm;
  const a = (rp + R + apogeeKm) / 2;
  return { position: [rp, 0, 0], velocity: [0, Math.sqrt(MU * (2 / rp - 1 / a)), 0] };
}

describe("destination from the terminal state", () => {
  it("reads a circular 550 km orbit as LEO", () => {
    const orbit = classifyTerminalState(circular(550).position, circular(550).velocity);
    expect(orbit.destination).toBe("leo");
    expect(orbit.perigeeAltitudeKm).toBeCloseTo(550, 6);
    expect(orbit.apogeeAltitudeKm).toBeCloseTo(550, 6);
    expect(orbit.specificEnergyKm2S2).toBeCloseTo(-MU / (2 * (R + 550)), 9);
  });

  it("reads an elliptical orbit by its perigee and apogee", () => {
    const { position, velocity } = elliptical(300, 1500);
    const orbit = classifyTerminalState(position, velocity);
    expect(orbit.destination).toBe("leo");
    expect(orbit.perigeeAltitudeKm).toBeCloseTo(300, 4);
    expect(orbit.apogeeAltitudeKm).toBeCloseTo(1500, 4);
  });

  it("puts the LEO boundary at an apogee of 2000 km", () => {
    const below = elliptical(300, LEO_CEILING_KM - 1);
    const above = elliptical(300, LEO_CEILING_KM + 50);
    expect(classifyTerminalState(below.position, below.velocity).destination).toBe("leo");
    expect(classifyTerminalState(above.position, above.velocity).destination).toBe("transfer");
  });

  it("reads a geostationary transfer orbit as a transfer", () => {
    const { position, velocity } = elliptical(200, 35786);
    const orbit = classifyTerminalState(position, velocity);
    expect(orbit.destination).toBe("transfer");
    expect(orbit.apogeeAltitudeKm).toBeCloseTo(35786, 2);
  });

  it("reads faster than escape speed as an escape", () => {
    const r = R + 200;
    const orbit = classifyTerminalState([r, 0, 0], [0, 1.05 * Math.sqrt((2 * MU) / r), 0]);
    expect(orbit.destination).toBe("escape");
    expect(orbit.apogeeAltitudeKm).toBeNull();
    expect(orbit.specificEnergyKm2S2).toBeGreaterThan(0);
  });

  it("reads a state that will fall back to the surface as suborbital", () => {
    const orbit = classifyTerminalState([R + 120, 0, 0], [0, 3, 0]);
    expect(orbit.destination).toBe("suborbital");
    expect(orbit.perigeeAltitudeKm).toBeLessThan(0);
  });
});

describe("the published figures", () => {
  it("are the three in the product spec, with their sources", () => {
    expect(PUBLISHED_CLASSES.map((c) => c.name)).toEqual(["Falcon 9", "Falcon Heavy", "Starship"]);
    expect(PUBLISHED_CLASSES.map((c) => c.leoKg)).toEqual([22800, 63800, 100000]);
    expect(PUBLISHED_CLASSES[0].fairing.diameterM).toBe(5.2);
    expect(PUBLISHED_CLASSES[0].fairing.heightM).toBe(13.2);
    expect(PUBLISHED_CLASSES[2].fairing.diameterM).toBe(8);
    expect(PUBLISHED_CLASSES[2].leoIsLowerBound).toBe(true);
    expect(PUBLISHED_CLASSES[0].sources.map((s) => s.url)).toEqual([
      "https://www.spacex.com/vehicles/falcon-9/",
      "https://www.spacex.com/assets/media/falcon-users-guide-2025-05-09.pdf",
    ]);
    expect(PUBLISHED_CLASSES[1].sources[0].url).toBe("https://www.spacex.com/vehicles/falcon-heavy/");
  });
});

describe("the fit", () => {
  const leo = { terminal: circular(550) };

  it("says it is an estimate, and invents no price, engine-out case, or throttle history", () => {
    const result = fitVehicleClass(leo);
    expect(result.isEstimate).toBe(true);
    expect(JSON.stringify(result)).not.toMatch(/price|cost|\$|engine-?out|throttle/i);
  });

  it("does not rank on mass when the case states none, and says so", () => {
    const result = fitVehicleClass(leo);
    expect(result.recommended).toBe("Falcon 9");
    expect(result.caseValues).toEqual({ massKg: null, envelope: null });
    expect(result.reason).toContain("not ranked on mass");
    expect(result.reason).toContain("smallest class that serves LEO");
    expect(result.rows.every((row) => row.coversMass === null)).toBe(true);
  });

  it("picks the smallest class whose published LEO figure covers a stated mass", () => {
    expect(fitVehicleClass({ ...leo, massKg: 5000 }).recommended).toBe("Falcon 9");
    expect(fitVehicleClass({ ...leo, massKg: 22800 }).recommended).toBe("Falcon 9");
    expect(fitVehicleClass({ ...leo, massKg: 22801 }).recommended).toBe("Falcon Heavy");
    expect(fitVehicleClass({ ...leo, massKg: 63800 }).recommended).toBe("Falcon Heavy");
    expect(fitVehicleClass({ ...leo, massKg: 63801 }).recommended).toBe("Starship");
  });

  it("shows the case value it compared with", () => {
    const result = fitVehicleClass({ ...leo, massKg: 30000 });
    expect(result.caseValues.massKg).toBe(30000);
    expect(result.reason).toContain("30,000 kg");
    expect(result.rows.map((row) => row.coversMass)).toEqual([false, true, true]);
  });

  it("calls Starship's figure a lower bound above 100 t, and does not claim a confirmed fit", () => {
    const result = fitVehicleClass({ ...leo, massKg: 150000 });
    expect(result.recommended).toBe("Starship");
    expect(result.reason).toContain("lower bound");
    expect(result.rows[2].coversMass).toBeNull();
  });

  it("uses the fairing when the case states an envelope", () => {
    expect(fitVehicleClass({ ...leo, envelope: { diameterM: 4 } }).recommended).toBe("Falcon 9");
    expect(fitVehicleClass({ ...leo, envelope: { diameterM: 6 } }).recommended).toBe("Starship");
    expect(fitVehicleClass({ ...leo, envelope: { diameterM: 4, heightM: 15 } }).recommended).toBe("Starship");
    expect(fitVehicleClass({ ...leo, envelope: { diameterM: 6 } }).reason).toContain("6 m wide");
  });

  it("needs a class that covers both mass and envelope", () => {
    expect(fitVehicleClass({ ...leo, massKg: 10000, envelope: { diameterM: 7 } }).recommended).toBe("Starship");
    const none = fitVehicleClass({ ...leo, massKg: 10000, envelope: { diameterM: 9 } });
    expect(none.recommended).toBeNull();
    expect(none.reason).toContain("No class's published figures cover");
  });

  it("treats a missing, zero, negative, or non-numeric mass as not stated", () => {
    for (const massKg of [null, undefined, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      const result = fitVehicleClass({ ...leo, massKg });
      expect(result.caseValues.massKg).toBeNull();
      expect(result.reason).toContain("not ranked on mass");
    }
  });

  it("recommends no class for a destination the published figures do not cover", () => {
    const gto = fitVehicleClass({ terminal: elliptical(200, 35786), massKg: 1000 });
    expect(gto.recommended).toBeNull();
    expect(gto.reason).toContain("transfer orbit");
    expect(gto.reason).toContain("LEO figures");

    const r = R + 200;
    const escape = fitVehicleClass({ terminal: { position: [r, 0, 0], velocity: [0, 12, 0] } });
    expect(escape.recommended).toBeNull();
    expect(escape.reason).toContain("escape");

    const suborbital = fitVehicleClass({ terminal: { position: [R + 120, 0, 0], velocity: [0, 3, 0] } });
    expect(suborbital.recommended).toBeNull();
    expect(suborbital.reason).toContain("not on an orbit");
  });

  it("still lists all three classes with their published figure and source", () => {
    const rows = fitVehicleClass({ terminal: elliptical(200, 35786) }).rows;
    expect(rows.map((row) => row.name)).toEqual(["Falcon 9", "Falcon Heavy", "Starship"]);
    expect(rows[0].published).toContain("22,800 kg to LEO");
    expect(rows[2].sources[0].label).toBe("Starship Users Guide, initial release");
  });

  it("checks the destination against the terminal energy", () => {
    const circularCheck = fitVehicleClass(leo).energyCheck;
    expect(circularCheck.agrees).toBe(true);
    expect(circularCheck.text).toContain("km²/s²");

    const gtoCheck = fitVehicleClass({ terminal: elliptical(200, 35786) }).energyCheck;
    expect(gtoCheck.agrees).toBe(true);
  });

  it("reads the minimal fixture's terminal state", () => {
    const text = readFileSync(fileURLToPath(new URL("../fixtures/minimal.oem", import.meta.url)), "utf8");
    const parsed = parseOem(text);
    if (!parsed.ok) throw new Error("fixture does not parse");
    const states = parsed.oem.segments[0].states;
    const last = states[states.length - 1];
    const result = fitVehicleClass({ terminal: last });
    // The fixture is a shape example, not a flight. Whatever it reads as, the result is an estimate with a reason.
    expect(result.isEstimate).toBe(true);
    expect(result.reason.length).toBeGreaterThan(20);
    expect(["leo", "suborbital", "transfer", "escape"]).toContain(result.orbit.destination);
  });
});
