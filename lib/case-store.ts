// Where cases are saved. Callers use `CaseStore` and never talk to IndexedDB
// or Supabase directly. Phase 2 ships the IndexedDB implementation, one case
// document per row. Phase 3 adds a server implementation behind the same
// interface.

import type { CaseDocument } from "./case";
import { chipIdFor } from "./case-ops";
import { flightArtifact, type FlightSource } from "./export";
import { idbFinished, idbResult, resolveIndexedDb } from "./idb";

export type CaseSummary = {
  id: string;
  name: string;
  /** From the chip-identity records. Null until the case has some. */
  chipFamily: string | null;
  hasOptimizedOem: boolean;
  /** Which OEM string the testing page would fly: the working copy, else the optimized OEM, else none. */
  flightSource: FlightSource | null;
  /** True when `holdoutError` is set. */
  isScored: boolean;
  /** UTC time of the last log entry, or null when the log is empty. */
  lastLogAt: string | null;
  updatedAt: string;
};

export interface CaseStore {
  list(accountId: string): Promise<CaseSummary[]>;
  get(accountId: string, id: string): Promise<CaseDocument | null>;
  save(accountId: string, doc: CaseDocument): Promise<void>;
}

/** Cases saved in this browser before there is an account. */
export const LOCAL_ACCOUNT_ID = "local";

function chipFamily(doc: CaseDocument): string | null {
  const identity = doc.records.filter((record) => record.record_type === "chip-identity");
  // The chip selector writes chipIds. With none selected, every chip-identity row counts.
  const selected =
    doc.chipIds.length > 0 ? identity.filter((record) => doc.chipIds.includes(chipIdFor(record))) : identity;
  const families = [...new Set(selected.map((record) => record.chip_family).filter(Boolean))];
  return families.length > 0 ? families.join(", ") : null;
}

export function summarizeCase(doc: CaseDocument): CaseSummary {
  return {
    id: doc.id,
    name: doc.name,
    chipFamily: chipFamily(doc),
    hasOptimizedOem: doc.optimizedOem !== null,
    flightSource: flightArtifact(doc)?.source ?? null,
    isScored: doc.holdoutError !== null,
    lastLogAt: doc.log.length > 0 ? doc.log[doc.log.length - 1].at : null,
    updatedAt: doc.updatedAt,
  };
}

const DB_NAME = "3rok";
const DB_VERSION = 1;
const STORE_NAME = "cases";
const BY_ACCOUNT = "by_account";

type Row = { key: string; accountId: string; doc: CaseDocument };

function rowKey(accountId: string, id: string): string {
  return `${accountId}/${id}`;
}

export class IndexedDbCaseStore implements CaseStore {
  private readonly factory: IDBFactory;
  private opened: Promise<IDBDatabase> | null = null;

  constructor(factory?: IDBFactory) {
    this.factory = resolveIndexedDb(factory);
  }

  private database(): Promise<IDBDatabase> {
    this.opened ??= new Promise((resolve, reject) => {
      const request = this.factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
        store.createIndex(BY_ACCOUNT, "accountId");
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.opened;
  }

  async list(accountId: string): Promise<CaseSummary[]> {
    const db = await this.database();
    const rows = await idbResult<Row[]>(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).index(BY_ACCOUNT).getAll(accountId),
    );
    return rows
      .map((row) => summarizeCase(row.doc))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  async get(accountId: string, id: string): Promise<CaseDocument | null> {
    const db = await this.database();
    const row = await idbResult<Row | undefined>(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(rowKey(accountId, id)),
    );
    return row?.doc ?? null;
  }

  async save(accountId: string, doc: CaseDocument): Promise<void> {
    const db = await this.database();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const row: Row = { key: rowKey(accountId, doc.id), accountId, doc };
    transaction.objectStore(STORE_NAME).put(row);
    await idbFinished(transaction);
  }

  /** Releases the connection. Tests use this; the app keeps one open. */
  async close(): Promise<void> {
    if (!this.opened) return;
    (await this.opened).close();
    this.opened = null;
  }
}

/** An error from the case API, with the status it came back with. */
export class CaseApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "CaseApiError";
  }
}

async function callApi<T>(path: string, init?: RequestInit): Promise<{ status: number; body: T | null }> {
  const response = await fetch(path, { cache: "no-store", credentials: "same-origin", ...init });
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    // An empty or non-JSON body. The status still tells the story.
  }
  if (response.status === 404) return { status: 404, body: null };
  if (!response.ok) {
    const message =
      typeof body === "object" && body !== null && "error" in body && typeof body.error === "string"
        ? body.error
        : `The request failed (${response.status}).`;
    throw new CaseApiError(response.status, message);
  }
  return { status: response.status, body: body as T };
}

/**
 * The saved cases, through the server. The server decides whose cases these are
 * from the signed-in session, so the account id argument is not sent and cannot
 * be used to ask for someone else's.
 */
export class ApiCaseStore implements CaseStore {
  async list(_accountId: string): Promise<CaseSummary[]> {
    const { body } = await callApi<{ cases: CaseSummary[] }>("/api/cases");
    return body?.cases ?? [];
  }

  async get(_accountId: string, id: string): Promise<CaseDocument | null> {
    const { body } = await callApi<{ case: CaseDocument }>(`/api/cases/${encodeURIComponent(id)}`);
    return body?.case ?? null;
  }

  async save(_accountId: string, doc: CaseDocument): Promise<void> {
    await callApi(`/api/cases/${encodeURIComponent(doc.id)}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(doc),
    });
  }
}

let browserStore: CaseStore | null = null;

/** The store the screens use: the signed-in account's saved cases, on the server. */
export function getCaseStore(): CaseStore {
  browserStore ??= new ApiCaseStore();
  return browserStore;
}
