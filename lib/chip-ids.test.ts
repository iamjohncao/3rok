import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { CHIP_PRESETS, KNOWN_CHIP_IDS } from "./chip-ids";

const root = fileURLToPath(new URL("..", import.meta.url));
const yaml = readFileSync(`${root}starmind-physics/starmind_physics/data/ai_chips.yaml`, "utf8");

describe("KNOWN_CHIP_IDS", () => {
  it("is the id list under chips: in ai_chips.yaml, no more and no fewer", () => {
    const section = yaml.split(/^chips:\s*$/m)[1]?.split(/^preset_aliases:/m)[0] ?? "";
    const ids = [...section.matchAll(/^ {2}- id: (\S+)/gm)].map((match) => match[1]);
    expect(ids.length).toBeGreaterThan(0);
    expect([...KNOWN_CHIP_IDS].sort()).toEqual([...ids].sort());
  });

  it("names the two presets the YAML aliases", () => {
    const aliases = yaml.split(/^preset_aliases:\s*$/m)[1] ?? "";
    for (const preset of CHIP_PRESETS) expect(aliases).toMatch(new RegExp(`^ {2}${preset}:`, "m"));
  });
});
