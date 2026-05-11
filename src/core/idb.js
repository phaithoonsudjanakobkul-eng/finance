// IndexedDB helpers for v2 — PSLinkMedia / blobs store.
//
// Mirrors monolith _r2InitIdb / _r2IdbPut/Get/Delete so that records
// written by monolith and v2 round-trip without migration. Each blob
// is keyed by a string (e.g. 'avatar:full', 'photo:full', R2 key for
// muse clips). Reads return null on miss / unsupported / quota error.

const DB_NAME = 'PSLinkMedia';
const DB_STORE = 'blobs';
const DB_VERSION = 1;

/** @type {IDBDatabase | null} */
let _db = null;

/** @returns {Promise<IDBDatabase | null>} */
export function initIdb() {
    return new Promise((resolve) => {
        if (_db) return resolve(_db);
        try {
            const req = indexedDB.open(DB_NAME, DB_VERSION);
            req.onupgradeneeded = (e) => {
                const db = /** @type {IDBOpenDBRequest} */ (e.target).result;
                if (!db.objectStoreNames.contains(DB_STORE)) {
                    db.createObjectStore(DB_STORE, { keyPath: 'key' });
                }
            };
            req.onsuccess = (e) => {
                _db = /** @type {IDBOpenDBRequest} */ (e.target).result;
                resolve(_db);
            };
            req.onerror = () => resolve(null);
        } catch (_e) {
            resolve(null);
        }
    });
}

/**
 * @param {string} key
 * @param {Blob} blob
 * @returns {Promise<boolean>}
 */
export async function idbPut(key, blob) {
    const db = await initIdb();
    if (!db) return false;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(DB_STORE, 'readwrite');
            tx.objectStore(DB_STORE).put({ key, blob, ts: Date.now() });
            tx.oncomplete = () => resolve(true);
            tx.onerror    = () => resolve(false);
        } catch (_e) { resolve(false); }
    });
}

/**
 * @param {string} key
 * @returns {Promise<Blob | null>}
 */
export async function idbGet(key) {
    const db = await initIdb();
    if (!db) return null;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(DB_STORE, 'readonly');
            const req = tx.objectStore(DB_STORE).get(key);
            req.onsuccess = () => {
                const r = /** @type {any} */ (req.result);
                resolve(r ? (r.blob || null) : null);
            };
            req.onerror = () => resolve(null);
        } catch (_e) { resolve(null); }
    });
}

/**
 * @param {string} key
 * @returns {Promise<void>}
 */
export async function idbDelete(key) {
    const db = await initIdb();
    if (!db) return;
    return new Promise((resolve) => {
        try {
            const tx = db.transaction(DB_STORE, 'readwrite');
            tx.objectStore(DB_STORE).delete(key);
            tx.oncomplete = () => resolve();
            tx.onerror    = () => resolve();
        } catch (_e) { resolve(); }
    });
}

// Test helper — wipe in-memory db handle so a fresh open() runs next call
export function _resetIdbForTests() {
    _db = null;
}
