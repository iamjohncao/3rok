// The saved case document, in Supabase. Server only. It runs as the signed-in
// person (the client carries their session), so row-level security applies to
// every query below. The checks in this file are the first lock; the database
// policy in supabase/migrations is the second.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { CaseDocument } from "./case";
import { parseCaseDocument } from "./case-validate";
import { summarizeCase, type CaseStore, type CaseSummary } from "./case-store";

export type CaseStoreErrorKind = "forbidden" | "invalid" | "failed";

export class CaseStoreError extends Error {
  constructor(
    readonly kind: CaseStoreErrorKind,
    message: string,
  ) {
    super(message);
    this.name = "CaseStoreError";
  }
}

type DatabaseError = { code?: string; message: string };

// Postgres codes: 42501 row-level security or privilege, 23514 check constraint, 22P02 bad id text.
function mapError(error: DatabaseError, action: string): CaseStoreError {
  if (error.code === "42501") {
    return new CaseStoreError("forbidden", "That case belongs to a different account.");
  }
  if (error.code === "23514" || error.code === "22P02") {
    return new CaseStoreError("invalid", "The case document does not match the case contract.");
  }
  console.error(`case_doc ${action} failed:`, error.code, error.message);
  return new CaseStoreError("failed", `The case could not be ${action}.`);
}

export class SupabaseCaseStore implements CaseStore {
  constructor(private readonly client: SupabaseClient) {}

  async list(accountId: string): Promise<CaseSummary[]> {
    const { data, error } = await this.client
      .from("case_doc")
      .select("document")
      .eq("account_id", accountId)
      .order("updated_at", { ascending: false });
    if (error) throw mapError(error, "listed");

    const summaries: CaseSummary[] = [];
    for (const row of data ?? []) {
      const parsed = parseCaseDocument(row.document);
      if (parsed.ok) summaries.push(summarizeCase(parsed.doc));
      else console.error("case_doc row skipped, not a valid case:", parsed.error);
    }
    return summaries;
  }

  async get(accountId: string, id: string): Promise<CaseDocument | null> {
    const { data, error } = await this.client
      .from("case_doc")
      .select("document")
      .eq("id", id)
      .eq("account_id", accountId)
      .maybeSingle();
    if (error) throw mapError(error, "read");
    if (!data) return null;

    const parsed = parseCaseDocument(data.document);
    if (!parsed.ok) {
      console.error("case_doc row is not a valid case:", parsed.error);
      throw new CaseStoreError("failed", "The saved case could not be read.");
    }
    return parsed.doc;
  }

  async save(accountId: string, doc: CaseDocument): Promise<void> {
    if (doc.accountId === null || doc.accountId !== accountId) {
      throw new CaseStoreError("forbidden", "A saved case must belong to the signed-in account.");
    }
    const { error } = await this.client.from("case_doc").upsert(
      { id: doc.id, account_id: accountId, document: doc, updated_at: new Date().toISOString() },
      { onConflict: "id" },
    );
    if (error) throw mapError(error, "saved");
  }
}
