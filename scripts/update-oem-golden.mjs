// Writes fixtures/oem-profile-expected.json: the exact validate_oem result of lib/oem.ts for
// every case in fixtures/oem-profile-cases.json. lib/oem.test.ts and
// flight-mcp/tests/test_oem_profile.py both compare against it, so the two validators cannot
// drift. Run it after a deliberate change to a rule or an error sentence, in both validators,
// then read the diff:
//
//   node --experimental-strip-types scripts/update-oem-golden.mjs
//
// It does not run in the build. Node 22.6 or later reads lib/oem.ts directly.

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { validateOem } from "../lib/oem.ts";

const root = fileURLToPath(new URL("..", import.meta.url));
const read = (path) => readFileSync(`${root}${path}`, "utf8");
const cases = JSON.parse(read("fixtures/oem-profile-cases.json"));

// The same edit rules as lib/oem.test.ts and the pytest.
function applyEdits(base, edits) {
  let lines = base.replace(/\n$/, "").split("\n");
  for (const edit of edits) {
    if ("append" in edit) {
      lines = [...lines, ...edit.append.split("\n")];
      continue;
    }
    const hits = lines.filter((line) => line === edit.replace).length;
    if (hits !== 1) throw new Error(`Edit matched ${hits} lines, expected 1: ${edit.replace}`);
    lines = lines.flatMap((line) => (line === edit.replace ? (edit.with === null ? [] : edit.with.split("\n")) : [line]));
  }
  return `${lines.join("\n")}\n`;
}

const base = read(cases.base);
const expected = {};
for (const testCase of cases.cases) {
  expected[testCase.name] = validateOem(applyEdits(base, testCase.edits), { thisAppWrote: testCase.this_app_wrote ?? false });
}
for (const testCase of cases.text_cases) {
  expected[testCase.name] = validateOem(testCase.text, { thisAppWrote: testCase.this_app_wrote ?? false });
}

const out = {
  _about:
    "The exact validate_oem result of lib/oem.ts for every case in oem-profile-cases.json, keyed by case name. Written by scripts/update-oem-golden.mjs. Do not edit by hand.",
  expected,
};
writeFileSync(`${root}fixtures/oem-profile-expected.json`, `${JSON.stringify(out, null, 2)}\n`);
console.log(`Wrote ${Object.keys(expected).length} expected results.`);
