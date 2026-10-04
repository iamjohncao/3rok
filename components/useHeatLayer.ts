"use client";

import { useEffect, useState } from "react";
import type { ValueStatus } from "../lib/case";
import { loadFluxGrid, placementScores, type FluxMeta, type Placement } from "../lib/globe/flux-grid";

/** What the case says about the shield, or why it says nothing. Read from the case on the server of record, not guessed. */
export type HeatSource =
  | { status: "ready"; shieldMm: number; recordId: string; valueStatus: ValueStatus }
  | { status: "refused"; reason: string };

export type HeatState =
  | { status: "none" }
  | { status: "loading" }
  | { status: "refused"; reason: string }
  | { status: "error"; message: string }
  | { status: "ready"; placement: Placement; meta: FluxMeta; shield: { recordId: string; valueStatus: ValueStatus } };

/**
 * The placement-score layer for the file on the globe. It needs the file's mean altitude and the
 * case's shield. With either missing it says so and draws nothing. It reads two static files and
 * does the arithmetic in the browser: no server, no model, no case write.
 */
export function useHeatLayer(altitudeKm: number, source: HeatSource | null): HeatState {
  const [state, setState] = useState<HeatState>({ status: source === null ? "none" : "loading" });

  // The effect depends on the source's fields, not on the object, so a parent that rebuilds the object
  // on every render does not make the layer reload.
  const kind = source?.status ?? "none";
  const shieldMm = source?.status === "ready" ? source.shieldMm : NaN;
  const recordId = source?.status === "ready" ? source.recordId : "";
  const valueStatus = source?.status === "ready" ? source.valueStatus : null;
  const reason = source?.status === "refused" ? source.reason : "";

  useEffect(() => {
    if (kind === "none") {
      setState({ status: "none" });
      return;
    }
    if (kind === "refused") {
      setState({ status: "refused", reason });
      return;
    }
    let live = true;
    setState((current) => (current.status === "ready" ? current : { status: "loading" }));
    loadFluxGrid()
      .then((grid) => {
        if (!live) return;
        const placement = placementScores(grid, altitudeKm, shieldMm);
        setState(
          placement.ok && valueStatus !== null
            ? { status: "ready", placement, meta: grid.meta, shield: { recordId, valueStatus } }
            : { status: "refused", reason: placement.ok ? "The shield has no value status." : placement.reason },
        );
      })
      .catch((error: unknown) => {
        if (live) setState({ status: "error", message: error instanceof Error ? error.message : "The radiation grid could not be loaded." });
      });
    return () => {
      live = false;
    };
  }, [altitudeKm, kind, shieldMm, recordId, valueStatus, reason]);

  return state;
}
