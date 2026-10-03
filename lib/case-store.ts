// Where cases are saved. Callers use `CaseStore` and never talk to IndexedDB
// or Supabase directly. Phase 2 ships the IndexedDB implementation, one case
// document per row. Phase 3 adds a server implementation behind the same
// interface.

import type { CaseDocument } from "./case";

export type CaseSummary = {
  id: string;
  name: string;
  /** From the chip-identity records. Null until the case has some. */
  chipFamily: string | null;
  hasOptimizedOem: boolean;
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
  // The chip selector (Phase 4) writes chipIds. Until it does, every chip-identity row counts.
  const selected =
    doc.chipIds.length > 0
      ? identity.filter(
          (record) => doc.chipIds.includes(record.part_number) || doc.chipIds.includes(record.record_id),
        )
      : identity;
  const families = [...new Set(selected.map((record) => record.chip_family).filter(Boolean))];
  return families.length > 0 ? families.join(", ") : null;
}

export function summarizeCase(doc: CaseDocument): CaseSummary {
  return {
    id: doc.id,
    name: doc.name,
    chipFamily: chipFamily(doc),
    hasOptimizedOem: doc.optimizedOem !== null,
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

function result<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function finished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

export class IndexedDbCaseStore implements CaseStore {
  private readonly factory: IDBFactory;
  private opened: Promise<IDBDatabase> | null = null;

  constructor(factory?: IDBFactory) {
    const resolved = factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
    if (!resolved) throw new Error("This browser cannot save cases because IndexedDB is unavailable.");
    this.factory = resolved;
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
    const rows = await result<Row[]>(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).index(BY_ACCOUNT).getAll(accountId),
    );
    return rows
      .map((row) => summarizeCase(row.doc))
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : 0));
  }

  async get(accountId: string, id: string): Promise<CaseDocument | null> {
    const db = await this.database();
    const row = await result<Row | undefined>(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(rowKey(accountId, id)),
    );
    return row?.doc ?? null;
  }

  async save(accountId: string, doc: CaseDocument): Promise<void> {
    const db = await this.database();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const row: Row = { key: rowKey(accountId, doc.id), accountId, doc };
    transaction.objectStore(STORE_NAME).put(row);
    await finished(transaction);
  }

  /** Releases the connection. Tests use this; the app keeps one open. */
  async close(): Promise<void> {
    if (!this.opened) return;
    (await this.opened).close();
    this.opened = null;
  }
}

let browserStore: CaseStore | null = null;

/** The store the screens use. Phase 3 swaps in the server store here. */
export function getCaseStore(): CaseStore {
  browserStore ??= new IndexedDbCaseStore();
  return browserStore;
}
