import { CaseFlight } from "./CaseFlight";
import { FlightFile } from "./FlightFile";

// The fixture until a case is imported, then the file that case exports. With no case in the
// address the page flies the fixture and says so.
export function TestScreen({ fixtureOem, caseId }: { fixtureOem: string; caseId: string | null }) {
  if (caseId !== null) return <CaseFlight caseId={caseId} />;
  return <FlightFile text={fixtureOem} origin={{ kind: "fixture" }} />;
}
