import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Metadata } from "next";
import { TestScreen } from "../../components/TestScreen";

export const metadata: Metadata = { title: "Testing" };

// The path is the picture: the globe is most of the viewport and the specs sit beside it.
// With no `case` in the address the page loads the fixture and says so. With one, it flies the
// file that case exports to testing.
export default async function TestPage({
  searchParams,
}: {
  searchParams: Promise<{ case?: string | string[] }>;
}) {
  const { case: requested } = await searchParams;
  const caseId = Array.isArray(requested) ? (requested[0] ?? null) : (requested ?? null);
  const fixtureOem = await readFile(join(process.cwd(), "fixtures", "minimal.oem"), "utf8");

  return (
    <main className="test-layout">
      <h1 className="visually-hidden">Testing</h1>
      <TestScreen fixtureOem={fixtureOem} caseId={caseId} />
    </main>
  );
}
