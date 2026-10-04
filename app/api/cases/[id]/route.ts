import { json, requireAccount } from "../../../../lib/account.server";
import { CaseStoreError, SupabaseCaseStore } from "../../../../lib/case-store.server";
import { MAX_CASE_BYTES, UUID, parseCaseDocument } from "../../../../lib/case-validate";

type Context = { params: Promise<{ id: string }> };

const MAX_BODY_BYTES = MAX_CASE_BYTES;

function failure(error: unknown) {
  if (error instanceof CaseStoreError) {
    const status = error.kind === "forbidden" ? 403 : error.kind === "invalid" ? 400 : 500;
    return json({ error: error.message }, status);
  }
  throw error;
}

// GET /api/cases/[id]: one case, only if it belongs to the signed-in account.
export async function GET(_request: Request, { params }: Context) {
  const account = await requireAccount();
  if (!account.ok) return account.response;

  const { id } = await params;
  if (!UUID.test(id)) return json({ error: "A case id is a UUID." }, 400);

  try {
    const doc = await new SupabaseCaseStore(account.supabase).get(account.userId, id);
    return doc ? json({ case: doc }) : json({ error: "No such case." }, 404);
  } catch (error) {
    return failure(error);
  }
}

// PUT /api/cases/[id]: saves the case document. The document must carry this id and
// belong to the signed-in account. A document with no accountId is refused.
export async function PUT(request: Request, { params }: Context) {
  const account = await requireAccount();
  if (!account.ok) return account.response;

  const { id } = await params;
  if (!UUID.test(id)) return json({ error: "A case id is a UUID." }, 400);

  const declared = Number(request.headers.get("content-length") ?? 0);
  if (declared > MAX_BODY_BYTES) return json({ error: "That case is too large to save." }, 413);
  const text = await request.text();
  if (text.length > MAX_BODY_BYTES) return json({ error: "That case is too large to save." }, 413);

  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return json({ error: "The request body is not JSON." }, 400);
  }

  const parsed = parseCaseDocument(body);
  if (!parsed.ok) return json({ error: parsed.error }, 400);
  if (parsed.doc.id !== id) return json({ error: "The case id in the document does not match the address." }, 400);
  if (parsed.doc.accountId !== account.userId) {
    return json({ error: "A saved case must belong to the signed-in account." }, 403);
  }

  try {
    await new SupabaseCaseStore(account.supabase).save(account.userId, parsed.doc);
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
