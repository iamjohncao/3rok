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
  const testingFiles = [
    "app/test/page.tsx",
    "components/TestScreen.tsx",
    "components/Globe.tsx",
    "components/GlobeLoader.tsx",
    "components/OemReadout.tsx",
    "components/LaunchSpecs.tsx",
    "components/PhysicsPanel.tsx",
    "components/FitPanel.tsx",
  ].map((file) => join(root, file));

  it("never bundles Cesium: it loads from public/cesium with a script tag", () => {
    // Type-only uses (`typeof import("cesium")`, `import("cesium").Viewer`) are fine.
    expect(
      offenders(/await\s+import\(\s*["']cesium|^\s*import\s+(?!type\b)[^\n]*["']cesium|import\s+["']cesium\//m),
    ).toEqual([]);
  });

  it("does not call Grok, so the globe cannot propose a new file", () => {
    expect(offenders(/api\/grok|api\.x\.ai|XAI_API_KEY/i, testingFiles)).toEqual([]);
  });

  it("does not touch the case store, so scrubbing and playing write no log", () => {
    expect(offenders(/case-store|case-ops|getCaseStore|applyHandEdit/, testingFiles)).toEqual([]);
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
