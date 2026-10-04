// Small promise wrappers over IndexedDB, shared by the local stores.

export function idbResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function idbFinished(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

/** The browser's IndexedDB, or an error that says what is missing. */
export function resolveIndexedDb(factory?: IDBFactory): IDBFactory {
  const resolved = factory ?? (typeof indexedDB === "undefined" ? undefined : indexedDB);
  if (!resolved) throw new Error("This browser cannot save data because IndexedDB is unavailable.");
  return resolved;
}
