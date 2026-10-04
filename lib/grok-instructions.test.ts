import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { INSTRUCTION_LINES, grokInstructions } from "./grok-instructions";

const root = fileURLToPath(new URL("..", import.meta.url));
const doc = readFileSync(`${root}docs/grok-flight-mcp.md`, "utf8");

describe("the Grok instructions", () => {
  it("are the numbered instructions in docs/grok-flight-mcp.md, word for word", () => {
    const section = doc.split(/^## Instructions\s*$/m)[1]?.split(/^## /m)[0] ?? "";
    const documented = [...section.matchAll(/^(\d+)\. (.+)$/gm)].map((match) => match[2].trim());
    expect(documented).toHaveLength(7);
    expect([...INSTRUCTION_LINES]).toEqual(documented);
  });

  it("number the seven in order and name the case", () => {
    const text = grokInstructions("5a4c1f0e-3b7d-4b36-9c1a-2f6d7a8e9b10");
    const lines = text.split("\n");
    expect(lines[0]).toBe("You are working on case 5a4c1f0e-3b7d-4b36-9c1a-2f6d7a8e9b10.");
    expect(lines.slice(1).map((line) => line.slice(0, 3))).toEqual(["1. ", "2. ", "3. ", "4. ", "5. ", "6. ", "7. "]);
  });

  it("do not say the model is trained, fine-tuned, or changed", () => {
    expect(grokInstructions("c")).not.toMatch(/fine.?tun|\btrained\b|training run|checkpoint|loss curve|weights/i);
  });

  it("do not name the holdout, and still say the evaluator uses records the model does not have", () => {
    const text = grokInstructions("c");
    expect(text).not.toMatch(/holdout/i);
    expect(text).toContain("on records you do not have");
  });
});
