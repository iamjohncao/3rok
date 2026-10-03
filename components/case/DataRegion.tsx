import type { CaseDocument } from "../../lib/case";
import { groupRecords } from "../../lib/case-ops";
import { Panel } from "../ui/Panel";

// The nine record types, in order, with every row's value_status and split.
// Holdout rows are shown like any other row. They are withheld from Grok, not from the person.
export function DataRegion({ doc }: { doc: CaseDocument }) {
  const groups = groupRecords(doc.records);

  return (
    <Panel id="data" title="Data" eyebrow="Records by type">
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
                  <li key={record.record_id} className="record-row">
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
                    </details>
                  </li>
                ))}
              </ul>
            ) : null}
          </section>
        ))}
      </div>
    </Panel>
  );
}
