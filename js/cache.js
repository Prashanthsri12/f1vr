// Persistent response cache. IndexedDB database `f1vr` v1 with stores
// `responses` (API JSON keyed by full URL) and `tracks` (built track data).
// Falls back silently to in-memory Maps when IndexedDB is unavailable
// (Node, private mode, quota or open errors). Never throws.

const DB_NAME = 'f1vr';
const DB_VERSION = 1;
const STORES = ['responses', 'tracks'];

/** @type {Map<string, Map<any, any>>} in-memory fallback, one Map per store */
const memory = new Map(STORES.map((s) => [s, new Map()]));

/** @type {Promise<IDBDatabase|null>|null} */
let dbPromise = null;

function memStore(store) {
  let m = memory.get(store);
  if (!m) { m = new Map(); memory.set(store, m); }
  return m;
}

/** Open (once) the database; resolves null if IndexedDB can't be used. */
function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let idb;
    try { idb = globalThis.indexedDB; } catch { idb = undefined; }
    if (!idb || typeof idb.open !== 'function') { resolve(null); return; }
    try {
      const req = idb.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of STORES) {
          if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

/** Run one request against a store; rejects on any IndexedDB error. */
function idbRequest(db, store, mode, makeRequest) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = makeRequest(tx.objectStore(store));
    tx.oncomplete = () => resolve(req.result);
    tx.onerror = () => reject(tx.error || req.error);
    tx.onabort = () => reject(tx.error || new Error('transaction aborted'));
  });
}

/**
 * Read a cached value.
 * @param {string} key
 * @param {'responses'|'tracks'} [store]
 * @returns {Promise<any|undefined>} the value, or undefined on a miss
 */
export async function cacheGet(key, store = 'responses') {
  const mem = memStore(store);
  if (mem.has(key)) return mem.get(key);
  const db = await openDb();
  if (!db) return undefined;
  try {
    return await idbRequest(db, store, 'readonly', (os) => os.get(key));
  } catch {
    return undefined;
  }
}

/**
 * Store a value. Falls back to memory if IndexedDB fails (e.g. quota).
 * @param {string} key
 * @param {any} value structured-cloneable value
 * @param {'responses'|'tracks'} [store]
 * @returns {Promise<void>}
 */
export async function cachePut(key, value, store = 'responses') {
  const db = await openDb();
  if (db) {
    try {
      await idbRequest(db, store, 'readwrite', (os) => os.put(value, key));
      return;
    } catch {
      // fall through to memory
    }
  }
  memStore(store).set(key, value);
}

/**
 * Remove everything from every store (IndexedDB and memory).
 * @returns {Promise<void>}
 */
export async function cacheClear() {
  for (const m of memory.values()) m.clear();
  const db = await openDb();
  if (!db) return;
  for (const s of STORES) {
    try {
      await idbRequest(db, s, 'readwrite', (os) => os.clear());
    } catch {
      // ignore: nothing more we can do
    }
  }
}
