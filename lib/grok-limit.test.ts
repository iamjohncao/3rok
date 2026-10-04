import type { SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { DEFAULT_RUNS_PER_HOUR, allowedEmails, claimGrokRun, mayAsk, runsPerHour } from "./grok-limit";

describe("runsPerHour", () => {
  it("is the default unless GROK_RUNS_PER_HOUR is a whole number above 0", () => {
    expect(runsPerHour({})).toBe(DEFAULT_RUNS_PER_HOUR);
    expect(runsPerHour({ GROK_RUNS_PER_HOUR: "10" })).toBe(10);
    for (const bad of ["0", "-3", "2.5", "many", ""]) expect(runsPerHour({ GROK_RUNS_PER_HOUR: bad })).toBe(DEFAULT_RUNS_PER_HOUR);
  });
});

describe("who may ask", () => {
  it("is everyone signed in when GROK_ALLOWED_EMAILS is empty", () => {
    expect(allowedEmails({})).toEqual([]);
    expect(mayAsk("a@example.com", [])).toBe(true);
    expect(mayAsk(null, [])).toBe(true);
  });

  it("is only the listed emails, in any letter case, when it is set", () => {
    const list = allowedEmails({ GROK_ALLOWED_EMAILS: " Me@Example.com , you@example.com ,, " });
    expect(list).toEqual(["me@example.com", "you@example.com"]);
    expect(mayAsk("ME@example.com", list)).toBe(true);
    expect(mayAsk("other@example.com", list)).toBe(false);
    expect(mayAsk(null, list)).toBe(false);
  });
});

// A stand-in for the two queries claimGrokRun makes.
function ledger(rows: string[], failure: "select" | "insert" | null = null) {
  const inserted: unknown[] = [];
  const seen: Record<string, unknown> = {};
  const client = {
    from: (table: string) => {
      seen.table = table;
      return {
        select: () => {
          const query = {
            eq: (column: string, value: unknown) => ((seen[column] = value), query),
            gt: (column: string, value: unknown) => ((seen[`${column}>`] = value), query),
            order: async () => (failure === "select" ? { data: null, error: { message: "x" } } : { data: rows.map((started_at) => ({ started_at })), error: null }),
          };
          return query;
        },
        insert: async (row: unknown) => {
          inserted.push(row);
          return { error: failure === "insert" ? { message: "x" } : null };
        },
      };
    },
  } as unknown as SupabaseClient;
  return { client, inserted, seen };
}

const NOW = new Date("2026-10-04T12:00:00.000Z");

describe("claimGrokRun", () => {
  it("records the run when the account is under its limit, for that account and case only", async () => {
    const { client, inserted, seen } = ledger(["2026-10-04T11:30:00.000Z"]);
    await expect(claimGrokRun(client, "user-1", "case-1", { limit: 2, now: NOW })).resolves.toEqual({ ok: true });
    expect(inserted).toEqual([{ account_id: "user-1", case_id: "case-1" }]);
    expect(seen).toMatchObject({ table: "grok_run", account_id: "user-1", "started_at>": "2026-10-04T11:00:00.000Z" });
  });

  it("refuses at the limit, says when the oldest run leaves the hour, and records nothing", async () => {
    const { client, inserted } = ledger(["2026-10-04T11:10:00.000Z", "2026-10-04T11:40:00.000Z"]);
    const claim = await claimGrokRun(client, "user-1", "case-1", { limit: 2, now: NOW });
    expect(claim).toEqual({ ok: false, retryAfterSeconds: 10 * 60 });
    expect(inserted).toEqual([]);
  });

  it("starts at the first run", async () => {
    expect(await claimGrokRun(ledger([]).client, "u", "c", { limit: 1, now: NOW })).toEqual({ ok: true });
  });

  it("does not call xAI's side when it cannot count or cannot record: it throws", async () => {
    await expect(claimGrokRun(ledger([], "select").client, "u", "c", { limit: 1, now: NOW })).rejects.toThrow("could not be counted");
    await expect(claimGrokRun(ledger([], "insert").client, "u", "c", { limit: 1, now: NOW })).rejects.toThrow("could not be recorded");
  });
});
