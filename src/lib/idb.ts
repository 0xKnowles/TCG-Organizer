/**
 * Tiny IndexedDB blob store. Uploaded photos would blow through the
 * localStorage quota as data URLs, so images live here and the binder JSON
 * only keeps their keys.
 */
const DB_NAME = 'binder-studio';
const STORE = 'images';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

function tx<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const req = run(t.objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      }),
  );
}

export const putBlob = (key: string, blob: Blob) => tx('readwrite', (s) => s.put(blob, key) as IDBRequest<IDBValidKey>);
export const getBlob = (key: string) => tx<Blob | undefined>('readonly', (s) => s.get(key));
export const deleteBlob = (key: string) => tx('readwrite', (s) => s.delete(key) as IDBRequest<undefined>);
export const allKeys = () => tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys());

const urlCache = new Map<string, string>();
const pending = new Map<string, Promise<string | undefined>>();

/** Resolve a stored blob to an object URL, memoised for the page session. */
export function blobUrl(key: string): Promise<string | undefined> {
  const cached = urlCache.get(key);
  if (cached) return Promise.resolve(cached);
  let p = pending.get(key);
  if (!p) {
    p = getBlob(key).then((blob) => {
      if (!blob) return undefined;
      const url = URL.createObjectURL(blob);
      urlCache.set(key, url);
      return url;
    });
    pending.set(key, p);
  }
  return p;
}

export function cachedUrl(key: string): string | undefined {
  return urlCache.get(key);
}

export function forgetUrl(key: string) {
  const url = urlCache.get(key);
  if (url) URL.revokeObjectURL(url);
  urlCache.delete(key);
  pending.delete(key);
}
