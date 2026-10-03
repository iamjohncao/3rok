import type { Metadata } from "next";
import { Button } from "../../components/ui/Button";

export const metadata: Metadata = { title: "Cases" };

export default function CasesPage() {
  return (
    <main className="app-main">
      <header className="page-head">
        <div>
          <p className="page-head__eyebrow eyebrow">Saved work</p>
          <h1 className="page-head__title heading-lg">Cases</h1>
        </div>
        <Button variant="solid" disabled>
          Create case
        </Button>
      </header>

      <section aria-label="Case list" className="frame frame--empty">
        <p className="body rok-muted">No cases yet.</p>
      </section>
    </main>
  );
}
