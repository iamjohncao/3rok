// The system text sent with every Grok request. It is the seven instructions in
// docs/grok-flight-mcp.md, word for word (lib/grok-instructions.test.ts reads that document and
// fails if the two differ), with the case id filled in. Grok reads the case and proposes a file.
// It does not decide that the file is kept, and nothing in this text says its weights change.

export const GROK_INSTRUCTIONS_VERSION = 1;

export const INSTRUCTION_LINES: readonly string[] = [
  "Read this case's train records before writing a trajectory. Use them to choose a path that prolongs the life of the selected chips.",
  "The only flight artifact is a CCSDS OEM 3.0 keyword-value file: `REF_FRAME = GCRF`, `CENTER_NAME = EARTH`, `TIME_SYSTEM = UTC`, `ORIGINATOR = 3ROK`, position in km, velocity in km/s. At least two state lines. Acceleration in km/s² is optional and must be on every line of a segment or on none.",
  "Call `validate_oem` on a draft. Call `submit_oem` only with a file that validates. The file you submit is the candidate. Prose is not the flight.",
  "Do not put thrust, mass, a pitch program, or a chip lifetime in the file, including in `COMMENT` lines.",
  "You may call `score_candidate` to compare reduced orbits. Those figures are estimates from the lifespan model. Do not copy them into the OEM as if they were states, and do not invent a figure the tool did not return.",
  "If `score_candidate` refuses the orbit, leave that orbit. Do not fill in a lifetime yourself.",
  "Do not claim the candidate is the optimized algorithm. The evaluator decides that after this request, on records you do not have.",
];

/** The system input for one case. */
export function grokInstructions(caseId: string): string {
  return [`You are working on case ${caseId}.`, ...INSTRUCTION_LINES.map((line, index) => `${index + 1}. ${line}`)].join("\n");
}
