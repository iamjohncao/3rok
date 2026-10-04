// The only case shape. Every lane reads this file.
// After this is on main, change a field only in a commit that also updates
// docs/mvp-phase-plan.md and every lane that reads the field.
//
// Out by design: a tenth record type, any field that implies the model was
// trained, a dose field outside record 6 and record 8, a dollar field, a team
// id, and any flight field other than the two OEM strings.

export const RECORD_TYPES = [
  "chip-identity",
  "tid",
  "see",
  "thermal-wear",
  "trajectory",
  "environment",
  "placement",
  "outcome",
  "provenance",
] as const;
export type RecordType = (typeof RECORD_TYPES)[number];

export const SPLITS = ["train", "holdout"] as const;
export type Split = (typeof SPLITS)[number];

export const VALUE_STATUSES = [
  "measured",
  "derived",
  "assumed",
  "not_observable",
] as const;
export type ValueStatus = (typeof VALUE_STATUSES)[number];

export type CaseRecord = {
  record_id: string;
  record_type: RecordType;
  chip_family: string;
  part_number: string;
  test_or_model: string;
  particle_or_stress: string | null;
  split: Split;
  source_url: string;
  value_status: ValueStatus;
  body: string; // CSV or JSON. Numbers live here, not in a PDF.
  source_filename: string | null;
};

export const LOG_KINDS = [
  "instruction",
  "proposal",
  "score",
  "kept",
  "rejected",
  "hand_edit",
  "record_added",
  "record_replaced",
  "export",
] as const;
export type LogKind = (typeof LOG_KINDS)[number];

export type LogEntry = {
  at: string; // UTC
  kind: LogKind;
  text: string;
  oem: string | null;
  holdout_error: number | null;
};

export type CaseDocument = {
  id: string;
  accountId: string | null;
  name: string;
  chipIds: string[]; // chip_id values selected from record 1, matched to ai_chips.yaml when possible
  records: CaseRecord[];
  log: LogEntry[];
  optimizedOem: string | null;
  workingOem: string | null;
  holdoutError: number | null; // null means unscored
  updatedAt: string;
};
