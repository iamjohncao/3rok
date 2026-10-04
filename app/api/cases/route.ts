import { json, requireAccount } from "../../../lib/account.server";
import { CaseStoreError, SupabaseCaseStore } from "../../../lib/case-store.server";

// GET /api/cases: the signed-in account's cases, newest first. Only that account's.
export async function GET() {
  const account = await requireAccount();
  if (!account.ok) return account.response;

  try {
    const cases = await new SupabaseCaseStore(account.supabase).list(account.userId);
    return json({ cases });
  } catch (error) {
    if (error instanceof CaseStoreError) return json({ error: error.message }, error.kind === "forbidden" ? 403 : 500);
    throw error;
  }
}
