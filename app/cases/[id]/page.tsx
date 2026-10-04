import type { Metadata } from "next";
import { CaseScreen } from "../../../components/CaseScreen";

export const metadata: Metadata = { title: "Case" };

type CasePageProps = { params: Promise<{ id: string }> };

export default async function CasePage({ params }: CasePageProps) {
  const { id } = await params;

  return (
    <main className="app-main">
      <CaseScreen id={id} />
    </main>
  );
}
