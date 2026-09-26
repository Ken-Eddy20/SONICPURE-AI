/**
 * Keeps an in-progress recording in IndexedDB as it is captured, so a crash, closed tab
 * or dead battery in the middle of a service does not lose it. Everything is best-effort:
 * if storage is blocked (private mode), recording still works, just without recovery.
 */

const DB_NAME = 'sonicpure-recorder';
const VERSION = 1;

export interface SessionInfo {
  id: string;
  mimeType: string;
  startedAt: number;
  updatedAt: number;
  seconds: number;
  chunks: number;
}

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('sessions')) db.createObjectStore('sessions', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('chunks')) db.createObjectStore('chunks');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function run<T>(stores: string[], mode: IDBTransactionMode, fn: (tx: IDBTransaction) => T | Promise<T>): Promise<T | null> {
  try {
    const db = await open();
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(stores, mode);
      let result: T;
      Promise.resolve(fn(tx)).then((r) => (result = r), reject);
      tx.oncomplete = () => {
        db.close();
        resolve(result);
      };
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    return null;
  }
}

const reqValue = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

export function startSession(id: string, mimeType: string) {
  const now = Date.now();
  return run(['sessions'], 'readwrite', (tx) => {
    tx.objectStore('sessions').put({ id, mimeType, startedAt: now, updatedAt: now, seconds: 0, chunks: 0 } satisfies SessionInfo);
  });
}

export function saveChunk(id: string, index: number, blob: Blob, seconds: number) {
  return run(['sessions', 'chunks'], 'readwrite', async (tx) => {
    tx.objectStore('chunks').put(blob, `${id}:${String(index).padStart(6, '0')}`);
    const store = tx.objectStore('sessions');
    const info = (await reqValue(store.get(id))) as SessionInfo | undefined;
    if (info) store.put({ ...info, updatedAt: Date.now(), seconds, chunks: index + 1 });
  });
}

export async function listSessions(): Promise<SessionInfo[]> {
  const res = await run(['sessions'], 'readonly', (tx) => reqValue(tx.objectStore('sessions').getAll()));
  return ((res as SessionInfo[] | null) || []).filter((s) => s.chunks > 0).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function loadSession(id: string): Promise<Blob | null> {
  const res = await run(['sessions', 'chunks'], 'readonly', async (tx) => {
    const info = (await reqValue(tx.objectStore('sessions').get(id))) as SessionInfo | undefined;
    if (!info) return null;
    const range = IDBKeyRange.bound(`${id}:`, `${id}:￿`);
    const blobs = (await reqValue(tx.objectStore('chunks').getAll(range))) as Blob[];
    return new Blob(blobs, { type: info.mimeType });
  });
  return (res as Blob | null) || null;
}

export function deleteSession(id: string) {
  return run(['sessions', 'chunks'], 'readwrite', (tx) => {
    tx.objectStore('sessions').delete(id);
    tx.objectStore('chunks').delete(IDBKeyRange.bound(`${id}:`, `${id}:￿`));
  });
}
