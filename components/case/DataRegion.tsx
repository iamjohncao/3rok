import type { CaseDocument, CaseRecord } from "../../lib/case";
import { chipIdFor, groupRecords } from "../../lib/case-ops";
import { Panel } from "../ui/Panel";
import { DataUpload } from "./DataUpload";

// Checking a chip-identity row writes its id to `chipIds`. With none checked, every
// chip-identity row counts toward the family on the case list.
function ChipSelector({
  doc,
  onToggleChip,
}: {
  doc: CaseDocument;
  onToggleChip: (chipId: string) => void;
}) {
  const chips = doc.records.filter((record) => record.record_type === "chip-identity");
  if (chips.length === 0) return null;
  return (
    <fieldset className="chip-selector">
      <legend className="eyebrow">Chips in this case</legend>
      <p className="body-sm rok-subtle">
        The checked chips set the family on the case list. With none checked, every chip-identity record counts.
      </p>
      {chips.map((record) => {
        const chipId = chipIdFor(record);
        return (
          <label key={record.record_id} className="chip-option body-sm">
            <input
              type="checkbox"
              checked={doc.chipIds.includes(chipId)}
              onChange={() => onToggleChip(chipId)}
            />
            <span className="data-sm">{chipId}</span>
            <span className="rok-muted">{record.chip_family}</span>
          </label>
        );
      })}
    </fieldset>
  );
}

function RecordRow({ record }: { record: CaseRecord }) {
  return (
    <li className="record-row">
      <details>
        <summary>
          <span className="data-sm">{record.record_id}</span>
          <span className="body-sm rok-muted">{record.test_or_model}</span>
          <span className="tag data-sm">{record.value_status}</span>
          <span className="tag data-sm">{record.split}</span>
        </summary>
        <p className="body-sm rok-subtle">
          {record.chip_family} · {record.part_number}
          {record.particle_or_stress ? ` · ${record.particle_or_stress}` : ""}
        </p>
        <pre className="oem-box data-sm">{record.body}</pre>
        <p className="body-sm rok-subtle">Source: {record.source_url}</p>
        {record.source_filename ? <p className="body-sm rok-subtle">File: {record.source_filename}</p> : null}
      </details>
    </li>
  );
}

// The nine record types, in order, with every row's value_status and split.
// Holdout rows are shown like any other row. They are withheld from Grok, not from the person.
export function DataRegion({
  doc,
  onIngest,
  onAttachPdf,
  onToggleChip,
}: {
  doc: CaseDocument;
  onIngest: (records: CaseRecord[], filename: string) => Promise<boolean>;
  onAttachPdf: (recordId: string, filename: string, bytes: ArrayBuffer) => Promise<boolean>;
  onToggleChip: (chipId: string) => void;
}) {
  const groups = groupRecords(doc.records);

  return (
    <Panel id="data" title="Data" eyebrow="Records by type">
      <DataUpload doc={doc} onIngest={onIngest} onAttachPdf={onAttachPdf} />
      <ChipSelector doc={doc} onToggleChip={onToggleChip} />
      {doc.records.length === 0 ? <p className="body rok-muted">No records yet.</p> : null}
      <div className="record-groups">
        {groups.map((group) => (
          <section key={group.type} aria-label={group.label} className="record-group">
            <h3 className="record-group__title eyebrow">
              <span>{group.label}</span>
              <span className="data-sm">{group.records.length}</span>
            </h3>
            {group.records.length > 0 ? (
              <ul className="record-list">
                {group.records.map((record) => (
                  <RecordRow key={record.record_id} record={record} />
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </Panel>
  );
}
