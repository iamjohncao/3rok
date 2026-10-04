import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// Machine-checkable parts of the Phase 0 gates and the UI rules in
// docs/mvp-phase-plan.md. These scan app source, not tests.

const root = fileURLToPath(new URL("..", import.meta.url));
const SOURCE_DIRS = ["app", "components", "lib"];
const SOURCE_EXT = /\.(ts|tsx|css)$/;

function sourceFiles(): string[] {
  const out: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      // Test support is not app code. It stands in for services and is never imported by the app.
      if (name === "test-support") continue;
      if (statSync(full).isDirectory()) walk(full);
      else if (SOURCE_EXT.test(name) && !/\.test\.tsx?$/.test(name)) out.push(full);
    }
  };
  for (const dir of SOURCE_DIRS) walk(join(root, dir));
  return out;
}

function offenders(pattern: RegExp, files = sourceFiles()): string[] {
  return files
    .filter((file) => pattern.test(readFileSync(file, "utf8")))
    .map((file) => relative(root, file));
}

describe("design-system rules", () => {
  it("uses no hex or functional colors, only design tokens", () => {
    expect(offenders(/#[0-9a-f]{3,8}\b|\b(rgb|rgba|hsl|hsla)\(/i)).toEqual([]);
  });

  it("imports the tokens and component CSS once, in the root layout", () => {
    const layout = readFileSync(join(root, "app/layout.tsx"), "utf8");
    expect(layout).toContain('import "../3rok-design-system/tokens.css";');
    expect(layout).toContain('import "../3rok-design-system/components/bundle.css";');
    expect(offenders(/3rok-design-system\/(tokens|components\/bundle)\.css/).sort()).toEqual([
      "app/layout.tsx",
    ]);
  });

  it("does not load bundle.js or use Hero or ProgressBar", () => {
    expect(offenders(/bundle\.js|window\.Rok|\bHero\b|\bProgressBar\b/)).toEqual([]);
  });

  it("builds frames on --surface-100", () => {
    const css = readFileSync(join(root, "app/app.css"), "utf8");
    expect(css).toContain("var(--surface-100)");
  });
});

describe("testing page (Phase 8)", () => {
  // The pages that draw. They hold no case store at all.
  const drawingFiles = [
    "app/test/page.tsx",
    "components/TestScreen.tsx",
    "components/FlightFile.tsx",
    "components/Globe.tsx",
    "components/GlobeLoader.tsx",
    "components/OemReadout.tsx",
    "components/LaunchSpecs.tsx",
    "components/PhysicsPanel.tsx",
    "components/FitPanel.tsx",
  ].map((file) => join(root, file));
  // The two files that read a case to import it. They read and never write.
  const importFiles = ["components/CaseFlight.tsx", "components/ImportCase.tsx"].map((file) => join(root, file));
  const testingFiles = [...drawingFiles, ...importFiles];

  it("never bundles Cesium: it loads from public/cesium with a script tag", () => {
    // Type-only uses (`typeof import("cesium")`, `import("cesium").Viewer`) are fine.
    expect(
      offenders(/await\s+import\(\s*["']cesium|^\s*import\s+(?!type\b)[^\n]*["']cesium|import\s+["']cesium\//m),
    ).toEqual([]);
  });

  it("does not call Grok, so the globe cannot propose a new file", () => {
    expect(offenders(/api\/grok|api\.x\.ai|XAI_API_KEY/i, testingFiles)).toEqual([]);
  });

  it("does not touch the case store where it draws, so scrubbing and playing write no log", () => {
    expect(offenders(/case-store|case-ops|getCaseStore|applyHandEdit|applyExport/, drawingFiles)).toEqual([]);
  });

  it("reads a case to import it and never saves one or writes its log", () => {
    expect(offenders(/\.save\(|case-ops|applyHandEdit|applyExport|applyIngest|method:\s*["']PUT/, importFiles)).toEqual([]);
    expect(offenders(/getCaseStore/, importFiles).length).toBe(importFiles.length);
  });

  it("does not show a thrust, Mach, throttle, propellant, or dynamic-pressure reading", () => {
    expect(offenders(/\bthrust\b|\bmach\b|throttle|propellant|dynamic pressure/i, testingFiles)).toEqual([]);
  });
});

describe("product language", () => {
  it('never calls the container a "project"', () => {
    expect(offenders(/\bprojects?\b/i)).toEqual([]);
  });

  it("shows no training run, loss curve, checkpoint or fine-tune job", () => {
    expect(offenders(/loss curve|checkpoint|fine-?tun|training run/i)).toEqual([]);
  });
});

describe("secrets and the server line (Phase 7)", () => {
  const clientFiles = () => sourceFiles().filter((file) => /^(components|app)\//.test(relative(root, file)) && !relative(root, file).startsWith("app/api/"));

  it("keeps the xAI keys and the flight token out of every page and component", () => {
    expect(offenders(/XAI_API_KEY|XAI_MANAGEMENT_API_KEY|FLIGHT_MCP_TOKEN|FLIGHT_MCP_URL/, clientFiles())).toEqual([]);
  });

  it("never exposes a key to the browser through a NEXT_PUBLIC_ variable", () => {
    expect(offenders(/NEXT_PUBLIC_(XAI|FLIGHT|GROK)/)).toEqual([]);
  });

  it("lets a component import server-only code for its types, and for nothing else", () => {
    const serverOnly = /from ["'][^"']*\/(xai|xai-collections|flight-client|grok-run|grok-handler|grok-request|grok-tools|grok-limit|account\.server|case-store\.server)["']/;
    const bad = clientFiles().filter((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .some((line) => /^\s*import\b/.test(line) && !/^\s*import type\b/.test(line) && serverOnly.test(line)),
    );
    expect(bad.map((file) => relative(root, file))).toEqual([]);
  });

  it("calls xAI only from the library files that own it, and the route reaches them through the handler", () => {
    expect(offenders(/api\.x\.ai|management-api\.x\.ai/).sort()).toEqual(["lib/xai.ts"]);
  });

  it("has no fine-tune, training, or model-update call anywhere", () => {
    expect(offenders(/\/fine[-_]?tun|\/training|\/model[-_]?update/i)).toEqual([]);
  });
});
