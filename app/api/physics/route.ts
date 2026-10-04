import { json, requireAccount } from "../../../lib/account.server";
import { CaseStoreError, SupabaseCaseStore } from "../../../lib/case-store.server";
import { UUID } from "../../../lib/case-validate";
import { flightEnv, scoreOrbitVia, wakeFlightServer } from "../../../lib/flight-client";
import { physicsFor } from "../../../lib/physics-estimate";

// A flight server that sleeps takes up to a minute to answer, then the score takes a few seconds.
export const maxDuration = 90;
const WAKE_DEADLINE_MS = 55_000;
const SCORE_DEADLINE_MS = 30_000;

// GET /api/physics?case=<id>: the physics estimate for the file that case exports to testing, as the
// signed-in account. It reads the case and calls the flight server. It never calls Grok, never scores a
// holdout outcome, and never saves the case or writes its log.
export async function GET(request: Request) {
  const account = await requireAccount();
  if (!account.ok) return account.response;

  const id = new URL(request.url).searchParams.get("case") ?? "";
  if (!UUID.test(id)) return json({ error: "A case id is a UUID." }, 400);

  let doc;
  try {
    doc = await new SupabaseCaseStore(account.supabase).get(account.userId, id);
  } catch (error) {
    if (error instanceof CaseStoreError) {
      return json({ error: error.message }, error.kind === "forbidden" ? 403 : 500);
    }
    throw error;
  }
  if (!doc) return json({ error: "No such case." }, 404);

  const flight = flightEnv();
  if (flight) await wakeFlightServer(flight, { timeoutMs: WAKE_DEADLINE_MS });
  const report = await physicsFor({
    doc,
    scoreOrbit: flight ? scoreOrbitVia(flight, { signal: AbortSignal.timeout(SCORE_DEADLINE_MS) }) : null,
  });
  return json({ report });
}
