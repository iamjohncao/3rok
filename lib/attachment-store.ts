// PDFs that ride along under a record. The case document stores only the file's name
// (`source_filename`). The bytes stay in this browser. They are not saved to the
// account, and the Data region says so. Best effort: if IndexedDB is unavailable the
// name is still recorded and the file is simply not kept.

import { idbFinished, idbResult, resolveIndexedDb } from "./idb";

export type Attachment = { filename: string; bytes: ArrayBuffer; savedAt: string };

export interface AttachmentStore {
  get(accountId: string, caseId: string, recordId: string): Promise<Attachment | null>;
  set(accountId: string, caseId: string, recordId: string, filename: string, bytes: ArrayBuffer): Promise<void>;
}

const DB_NAME = "3rok-attachments";
const DB_VERSION = 1;
const STORE_NAME = "attachments";

type Row = Attachment & { key: string };

const keyFor = (accountId: string, caseId: string, recordId: string) =>
  JSON.stringify([accountId, caseId, recordId]);

export class IndexedDbAttachmentStore implements AttachmentStore {
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

  async get(accountId: string, caseId: string, recordId: string): Promise<Attachment | null> {
    const db = await this.database();
    const row = await idbResult<Row | undefined>(
      db.transaction(STORE_NAME, "readonly").objectStore(STORE_NAME).get(keyFor(accountId, caseId, recordId)),
    );
    return row ? { filename: row.filename, bytes: row.bytes, savedAt: row.savedAt } : null;
  }

  async set(
    accountId: string,
    caseId: string,
    recordId: string,
    filename: string,
    bytes: ArrayBuffer,
  ): Promise<void> {
    const db = await this.database();
    const transaction = db.transaction(STORE_NAME, "readwrite");
    const row: Row = {
      key: keyFor(accountId, caseId, recordId),
      filename,
      bytes,
      savedAt: new Date().toISOString(),
    };
    transaction.objectStore(STORE_NAME).put(row);
    await idbFinished(transaction);
  }

  async close(): Promise<void> {
    if (!this.opened) return;
    (await this.opened).close();
    this.opened = null;
  }
}

let attachmentStore: AttachmentStore | null | undefined;

/** The browser's attachment store, or null when this browser cannot keep one. */
export function getAttachmentStore(): AttachmentStore | null {
  if (attachmentStore === undefined) {
    try {
      attachmentStore = new IndexedDbAttachmentStore();
    } catch {
      attachmentStore = null;
    }
  }
  return attachmentStore;
}
