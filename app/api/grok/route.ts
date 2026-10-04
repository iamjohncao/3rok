import { json, requireAccount } from "../../../lib/account.server";
import { SupabaseCaseStore } from "../../../lib/case-store.server";
import { flightEnv } from "../../../lib/flight-client";
import { handleAsk } from "../../../lib/grok-handler";
import { allowedEmails, claimGrokRun, runsPerHour } from "../../../lib/grok-limit";
import { scrub, xaiEnv } from "../../../lib/xai";

// Ask Grok can run for minutes: Grok reads the case, calls the flight tools, and the evaluator scores
// the file. The handler stops at 270 seconds, under this limit.
export const maxDuration = 300;
export const dynamic = "force-dynamic";

// POST /api/grok: { caseId, instruction }. Grok reads this case's train records and proposes an OEM
// through submit_oem. The evaluator, not the model, decides whether it is kept. The reply is the
// updated case and the verdict. The case is saved here, as the signed-in account.
export async function POST(request: Request) {
  const account = await requireAccount();
  if (!account.ok) return account.response;

  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    return json({ error: "The request body must be JSON with a caseId and an instruction." }, 400);
  }

  const env = xaiEnv();
  try {
    const result = await handleAsk({ userId: account.userId, email: account.email }, body, {
      xai: env,
      flight: flightEnv(),
      store: new SupabaseCaseStore(account.supabase),
      claim: (caseId) => claimGrokRun(account.supabase, account.userId, caseId, { limit: runsPerHour() }),
      allowedEmails: allowedEmails(),
    });
    const response = json(result.body, result.status);
    for (const [name, value] of Object.entries(result.headers ?? {})) response.headers.set(name, value);
    return response;
  } catch (error) {
    // A database or network failure outside Grok. The message never leaves the server, and no key is in it.
    console.error("ask grok failed:", scrub(error instanceof Error ? error.message : String(error), [env?.apiKey, env?.managementKey]));
    return json({ error: "Ask Grok failed. If a revision had been saved it is in the activity log." }, 500);
  }
}
