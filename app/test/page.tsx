import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Metadata } from "next";
import { TestScreen } from "../../components/TestScreen";

export const metadata: Metadata = { title: "Testing" };

// The path is the picture: the globe is most of the viewport and the specs sit beside it.
// Until a case exports a file (Phase 9), the page loads the fixture and says so.
export default async function TestPage() {
  const fixtureOem = await readFile(join(process.cwd(), "fixtures", "minimal.oem"), "utf8");

  return (
    <main className="test-layout">
      <h1 className="visually-hidden">Testing</h1>
      <TestScreen fixtureOem={fixtureOem} />
    </main>
  );
}
