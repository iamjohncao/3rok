import type { Metadata } from "next";
import { Button } from "../../../components/ui/Button";
import { Panel } from "../../../components/ui/Panel";

export const metadata: Metadata = { title: "Case" };

type CasePageProps = { params: Promise<{ id: string }> };

// One case, four regions: Data, Activity, Algorithm, Score.
export default async function CasePage({ params }: CasePageProps) {
  const { id } = await params;

  return (
    <main className="app-main">
      <header className="page-head">
        <div>
          <p className="page-head__eyebrow eyebrow">Case</p>
          <h1 className="page-head__title heading-lg">Case</h1>
          <p className="page-head__meta data-sm">{id}</p>
        </div>
        <Button variant="solid" disabled>
          Ask Grok
        </Button>
      </header>

      <div className="case-grid">
        <Panel id="data" title="Data" eyebrow="Records by type">
          <p className="body rok-muted">No records yet.</p>
        </Panel>

        <Panel id="algorithm" title="Algorithm" eyebrow="CCSDS OEM">
          <div className="oem-stack">
            <div>
              <p className="oem-block__label eyebrow">Optimized</p>
              <pre className="oem-box data-sm" aria-label="Optimized OEM, read-only">
                None yet.
              </pre>
            </div>
            <div>
              <p className="oem-block__label eyebrow">Working copy</p>
              <textarea
                className="oem-box data-sm"
                aria-label="Working copy"
                disabled
                placeholder="Working copy, editable as text."
              />
            </div>
          </div>
        </Panel>

        <Panel id="activity" title="Activity" eyebrow="Instructions and revisions">
          <p className="body rok-muted">No activity yet.</p>
        </Panel>

        <Panel id="score" title="Score" eyebrow="Last holdout error">
          <p className="data-md">unscored</p>
        </Panel>
      </div>
    </main>
  );
}
