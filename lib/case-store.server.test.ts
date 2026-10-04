import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it, vi } from "vitest";
import { applyHandEdit, newCase } from "./case-ops";
import { CaseStoreError, SupabaseCaseStore } from "./case-store.server";

const ALICE = "0c8d2a33-7f4e-4a10-8b55-6e9f1a2b3c4d";
const BOB = "9b1e7c52-2d4a-4f0e-a3c8-5d6e7f8a9b0c";
const CASE_ID = "5a4c1f0e-3b7d-4b36-9c1a-2f6d7a8e9b10";
const T0 = "2026-10-03T18:00:00.000Z";
const T1 = "2026-10-03T18:10:00.000Z";

type Call = { table: string; op: string; args: unknown[] };

// A stand-in for the Supabase client that records what the store asks of it and
// answers with what the test says the database would. The real database is covered
// by supabase/tests/case_doc_rls.sql and the end-to-end run against Supabase.
function fake(answer: { data?: unknown; error?: { code?: string; message: string } | null }) {
  const calls: Call[] = [];
  const builder: Record<string, unknown> = {};
  const record = (op: string) => (...args: unknown[]) => {
    calls.push({ table: "case_doc", op, args });
    return builder;
  };
  for (const op of ["select", "eq", "order", "upsert", "maybeSingle"]) builder[op] = record(op);
  builder.then = (resolve: (value: unknown) => void) => resolve({ data: answer.data ?? null, error: answer.error ?? null });
  const client = { from: vi.fn(() => builder) } as unknown as SupabaseClient;
  return { client, calls };
}

const doc = () => ({ ...newCase(CASE_ID, T0, ALICE), name: "Orin run" });

describe("SupabaseCaseStore.save", () => {
  it("upserts the document under the signed-in account, by id", async () => {
    const { client, calls } = fake({});
    await new SupabaseCaseStore(client).save(ALICE, doc());

    const upsert = calls.find((call) => call.op === "upsert");
    expect(upsert).toBeDefined();
    const [row, options] = upsert!.args as [Record<string, unknown>, Record<string, unknown>];
    expect(row).toMatchObject({ id: CASE_ID, account_id: ALICE, document: doc() });
    expect(typeof row.updated_at).toBe("string");
    expect(options).toEqual({ onConflict: "id" });
  });

  it("refuses a document with no accountId before asking the database anything", async () => {
    const { client } = fake({});
    const orphan = { ...doc(), accountId: null };
    await expect(new SupabaseCaseStore(client).save(ALICE, orphan)).rejects.toMatchObject({ kind: "forbidden" });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("refuses a document that belongs to another account before asking the database anything", async () => {
    const { client } = fake({});
    const theirs = { ...doc(), accountId: BOB };
    await expect(new SupabaseCaseStore(client).save(ALICE, theirs)).rejects.toMatchObject({ kind: "forbidden" });
    expect(client.from).not.toHaveBeenCalled();
  });

  it("turns a row-level security refusal into a forbidden error", async () => {
    const { client } = fake({ error: { code: "42501", message: "new row violates row-level security policy" } });
    await expect(new SupabaseCaseStore(client).save(ALICE, doc())).rejects.toMatchObject({
      kind: "forbidden",
      message: "That case belongs to a different account.",
    });
  });

  it("turns a check-constraint refusal into an invalid error", async () => {
    const { client } = fake({ error: { code: "23514", message: "violates check constraint" } });
    await expect(new SupabaseCaseStore(client).save(ALICE, doc())).rejects.toMatchObject({ kind: "invalid" });
  });

  it("does not pass database details to the caller for other failures", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = fake({ error: { code: "XX000", message: "relation internal_secret_table is broken" } });
    const error = await new SupabaseCaseStore(client).save(ALICE, doc()).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(CaseStoreError);
    expect((error as CaseStoreError).kind).toBe("failed");
    expect((error as CaseStoreError).message).not.toContain("internal_secret_table");
    quiet.mockRestore();
  });
});

describe("SupabaseCaseStore.get", () => {
  it("asks for the case by id and account, and returns the document", async () => {
    const { client, calls } = fake({ data: { document: doc() } });
    const found = await new SupabaseCaseStore(client).get(ALICE, CASE_ID);

    expect(found).toEqual(doc());
    expect(calls.filter((call) => call.op === "eq").map((call) => call.args)).toEqual([
      ["id", CASE_ID],
      ["account_id", ALICE],
    ]);
  });

  it("returns null when there is no such case for this account", async () => {
    const { client } = fake({ data: null });
    expect(await new SupabaseCaseStore(client).get(ALICE, CASE_ID)).toBeNull();
  });

  it("refuses to hand back a row that is not a valid case", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = fake({ data: { document: { id: CASE_ID, thrust: 5 } } });
    await expect(new SupabaseCaseStore(client).get(ALICE, CASE_ID)).rejects.toMatchObject({ kind: "failed" });
    quiet.mockRestore();
  });
});

describe("SupabaseCaseStore.list", () => {
  it("lists only this account's cases, newest first, as summaries", async () => {
    const older = { ...newCase("5a4c1f0e-3b7d-4b36-9c1a-2f6d7a8e9b11", T0, ALICE), name: "Older" };
    const newer = applyHandEdit({ ...newCase(CASE_ID, T1, ALICE), name: "Newer" }, "x", T1);
    const { client, calls } = fake({ data: [{ document: newer }, { document: older }] });
    const rows = await new SupabaseCaseStore(client).list(ALICE);

    expect(rows.map((row) => row.name)).toEqual(["Newer", "Older"]);
    expect(rows[0].lastLogAt).toBe(T1);
    expect(calls.find((call) => call.op === "eq")?.args).toEqual(["account_id", ALICE]);
    expect(calls.find((call) => call.op === "order")?.args).toEqual(["updated_at", { ascending: false }]);
  });

  it("skips a row that is not a valid case instead of failing the whole list", async () => {
    const quiet = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { client } = fake({ data: [{ document: { nonsense: true } }, { document: doc() }] });
    const rows = await new SupabaseCaseStore(client).list(ALICE);
    expect(rows.map((row) => row.id)).toEqual([CASE_ID]);
    quiet.mockRestore();
  });

  it("returns an empty list for an account with no cases", async () => {
    const { client } = fake({ data: [] });
    expect(await new SupabaseCaseStore(client).list(ALICE)).toEqual([]);
  });
});
