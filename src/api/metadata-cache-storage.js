const DB_NAME = 'spid-registry-navigator';
const DB_VERSION = 1;
const STORE = 'metadata';
const CACHE_RECORD_KEY = 'store';
const BUNDLED_VERSION_KEY = 'bundledVersion';

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onerror = () => reject(req.error);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
  });
}

async function idbGet(key) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result ?? null);
    req.onerror = () => reject(req.error);
  });
}

async function idbSet(key, value) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export function isIndexedDbAvailable() {
  return typeof indexedDB !== 'undefined';
}

export async function loadStoreFromIdb() {
  if (!isIndexedDbAvailable()) return null;
  try {
    return await idbGet(CACHE_RECORD_KEY);
  } catch {
    return null;
  }
}

export async function saveStoreToIdb(store) {
  if (!isIndexedDbAvailable()) return false;
  await idbSet(CACHE_RECORD_KEY, store);
  return true;
}

export async function getBundledVersionMarker() {
  if (!isIndexedDbAvailable()) return null;
  try {
    return (await idbGet(BUNDLED_VERSION_KEY)) || null;
  } catch {
    return null;
  }
}

export async function setBundledVersionMarker(version) {
  if (!isIndexedDbAvailable()) return;
  await idbSet(BUNDLED_VERSION_KEY, version);
}
