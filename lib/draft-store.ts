// The unsaved working copy, kept in this browser so a reload does not lose typing and
// a keystroke never travels to the server. Only an explicit "Save edit" does. Best
// effort: if IndexedDB is unavailable or fails, editing carries on without a draft.

import { idbFinished, idbResult, resolveIndexedDb } from "./idb";

export interface DraftStore {
  get(accountId: string, caseId: string): Promise<string | null>;
  set(accountId: string, caseId: string, text: string): Promise<void>;
  clear(accountId: string, caseId: string): Promise<void>;
}

const DB_NAME = "3rok-drafts";
const DB_VERSION = 1;
const STORE_NAME = "drafts";

type Row = { key: string; text: string; savedAt: string };

const keyFor = (accountId: string, caseId: string) => `${accountId}/${caseId}`;

export class IndexedDbDraftStore implements DraftStore {
  private readonly factory: IDBFactory;
  private opened: Promise<IDBDatabase> | null = null;

  constructor(factory?: IDBFactory) {
    this.factory = resolveIndexedDb(factory);
  }

  private database(): Promise<IDBDatabase> {
    this.opened ??= new Promise((resolve, reject) => {
      const request = this.factory.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = () => {
        request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.opened;
  }

  async get(accountId: string, caseId: string): Promise<string | null> {
    const db = await this.database();
    const row = await idbResult<Row | undefined>(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(keyFor(accountId, caseId)),
    );
    return row?.text ?? null;
  }

  async set(accountId: string, caseId: string, text: string): Promise<void> {
    const db = await this.database();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const row: Row = { key: keyFor(accountId, caseId), text, savedAt: new Date().toISOString() };
    transaction.objectStore(STORE_NAME).put(row);
    await idbFinished(transaction);
  }

  async clear(accountId: string, caseId: string): Promise<void> {
    const db = await this.database();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(keyFor(accountId, caseId));
    await idbFinished(transaction);
  }

  async close(): Promise<void> {
    if (!this.opened) return;
    (await this.opened).close();
    this.opened = null;
  }
}

let draftStore: DraftStore | null | undefined;

/** The browser's draft store, or null when this browser cannot keep one. */
export function getDraftStore(): DraftStore | null {
  if (draftStore === undefined) {
    try {
      draftStore = new IndexedDbDraftStore();
    } catch {
      draftStore = null;
    }
  }
  return draftStore;
}
