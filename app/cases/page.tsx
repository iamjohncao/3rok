import type { Metadata } from "next";
import { CaseList } from "../../components/CaseList";

export const metadata: Metadata = { title: "Cases" };

export default function CasesPage() {
  return (
    <main className="app-main">
      <CaseList />
    </main>
  );
}
