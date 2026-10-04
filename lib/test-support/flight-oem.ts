// Test support: build a parsed OEM from states, and fly a state the way the engine does. Not imported by the app.

import type { Oem, OemSegment, OemState, Vec3 } from "../oem";
import { J2, MU_KM3_S2, RADIUS_KM } from "../engine/gravity";
import { propagateThrough, type State } from "../engine/integrate";
import { meanPoleGcrf } from "../frame";

export const T0 = Date.UTC(2026, 9, 3, 18, 0, 0) / 1000;

export type TimedState = { time: number; r: Vec3; v: Vec3 };

export function oemOf(segments: TimedState[][]): Oem {
  const toState = (s: TimedState): OemState => ({
    epoch: new Date(s.time * 1000).toISOString().replace("Z", ""),
    time: s.time,
    position: s.r,
    velocity: s.v,
    acceleration: null,
  });
  const make = (states: OemState[]): OemSegment => ({
    comments: [],
    objectName: "TEST",
    objectId: "UNKNOWN",
    centerName: "EARTH",
    refFrame: "GCRF",
    timeSystem: "UTC",
    startTime: states[0].epoch,
    stopTime: states[states.length - 1].epoch,
    useableStartTime: null,
    useableStopTime: null,
    interpolation: null,
    interpolationDegree: null,
    dataComments: [],
    states,
  });
  return {
    headerComments: [],
    classification: null,
    creationDate: "2026-10-03T18:00:00",
    originator: "3ROK",
    messageId: null,
    segments: segments.map((states) => make(states.map(toState))),
  };
}

export function circularState(altKm: number, incDeg: number): State {
  const a = RADIUS_KM + altKm;
  const v = Math.sqrt(MU_KM3_S2 / a);
  const i = (incDeg * Math.PI) / 180;
  return { r: [a, 0, 0], v: [0, v * Math.cos(i), v * Math.sin(i)] };
}

/** States a gravity-only satellite really flies, from `start` at T0, at the given offsets. */
export function flownStates(start: State, offsets: number[]): TimedState[] {
  const states = propagateThrough(start, offsets, { model: { j2: true, pole: meanPoleGcrf(T0) } });
  return offsets.map((offset, i) => ({ time: T0 + offset, r: states[i].r, v: states[i].v }));
}

export { J2 };
