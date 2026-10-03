import type { Metadata } from "next";
import { Button } from "../../components/ui/Button";
import { Panel } from "../../components/ui/Panel";

export const metadata: Metadata = { title: "Testing" };

// The path is the picture: the globe region is most of the viewport and the
// specs column sits beside it.
export default function TestPage() {
  return (
    <main className="test-layout">
      <h1 className="visually-hidden">Testing</h1>

      <section aria-label="Globe" className="frame frame--empty globe-frame">
        <p className="body rok-muted">No path loaded.</p>
      </section>

      <aside aria-label="Specs" className="specs">
        <Button variant="solid" disabled>
          Import case
        </Button>
        <Panel id="readings" title="Readings" eyebrow="At the scrubbed epoch">
          <p className="body-sm rok-muted">Import a case to read its path.</p>
        </Panel>
      </aside>
    </main>
  );
}
