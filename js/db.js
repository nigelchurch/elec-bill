// Tiny IndexedDB wrapper.
//
// IndexedDB is the browser's built-in database. It lives on the phone, survives
// app restarts, and works offline. Its native API is event-based and clunky, so
// these helpers wrap it in Promises (usable with async/await).
//
// Object stores (like tables):
//   readings  key = date 'YYYY-MM-DD'  { date, thip, nova, thip_est, nova_est }
//             thip/nova are full cumulative meter values (or null if absent);
//             *_est are booleans (true = estimated by gap-filling).
//   bills     key = month 'YYYY-MM'    { month, P, OP, H, total_baht }
//   meta      key = name               { key, value }  e.g. lastBackup

const DB_NAME = 'elecbill';
const DB_VERSION = 1;

let dbPromise = null;

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    // Runs only when the database is first created or DB_VERSION is increased.
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('readings')) db.createObjectStore('readings', { keyPath: 'date' });
      if (!db.objectStoreNames.contains('bills')) db.createObjectStore('bills', { keyPath: 'month' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

// Run fn(store) inside a transaction and resolve when the transaction completes.
async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    let result;
    const req = fn(store);
    if (req) req.onsuccess = () => { result = req.result; };
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const get = (store, key) => withStore(store, 'readonly', (s) => s.get(key));
export const getAll = (store) => withStore(store, 'readonly', (s) => s.getAll()); // sorted by key
export const count = (store) => withStore(store, 'readonly', (s) => s.count());
export const put = (store, value) => withStore(store, 'readwrite', (s) => s.put(value));
export const del = (store, key) => withStore(store, 'readwrite', (s) => s.delete(key));
export const clear = (store) => withStore(store, 'readwrite', (s) => s.clear());

// Write many records in one transaction (all succeed or none do).
export const putMany = (store, values) =>
  withStore(store, 'readwrite', (s) => { for (const v of values) s.put(v); });

// Replace the entire contents of several stores atomically (used by Import).
// data = { readings: [...], bills: [...] }
export async function replaceAll(data) {
  const db = await openDB();
  const names = Object.keys(data);
  return new Promise((resolve, reject) => {
    const tx = db.transaction(names, 'readwrite');
    for (const name of names) {
      const s = tx.objectStore(name);
      s.clear();
      for (const v of data[name]) s.put(v);
    }
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

// Convenience for the meta store.
export async function getMeta(key) {
  const rec = await get('meta', key);
  return rec ? rec.value : undefined;
}
export const setMeta = (key, value) => put('meta', { key, value });
