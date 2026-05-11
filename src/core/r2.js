// Cloudflare R2 helpers — encrypted media sync.
//
// Pipeline:
//   client → AES-256-GCM encrypt (HKDF from Gist token, salt 'PSLink-R2-v1')
//          → POST /upload to the pslink-r2 worker
//          → R2 bucket
//
//   client ← GET decoded bytes → AES-256-GCM decrypt → Blob
//
// Domain-separated from Gist (different HKDF salt) so leak of one key
// material doesn't compromise the other channel.
//
// Worker URL + bearer token are stored in localStorage:
//   ps_r2_worker_url  · e.g. https://pslink-r2.<user>.workers.dev
//   ps_r2_auth_token  · Bearer token configured on the worker
//
// All functions degrade to no-op / null on missing config so callers
// don't need to gate every call site.

import { lsGet } from './storage.js';

const HKDF_SALT = 'PSLink-R2-v1';
const HKDF_INFO = 'aes-gcm-256';

/** @returns {{ url: string, token: string } | null} */
function readR2Config() {
    const url   = lsGet('ps_r2_worker_url', '');
    const token = lsGet('ps_r2_auth_token', '');
    if (!url || !token) return null;
    return { url: url.replace(/\/$/, ''), token };
}

/** Read the Gist token used to derive the R2 encryption key. @returns {string} */
function readGistToken() { return lsGet('ps_gist_token', '') || ''; }

/**
 * Derive an AES-GCM key from a Gist token via HKDF.
 * @param {string} token
 * @returns {Promise<CryptoKey>}
 */
export async function deriveR2Key(token) {
    const enc = new TextEncoder();
    const km = await crypto.subtle.importKey('raw', enc.encode(token), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: enc.encode(HKDF_SALT), info: enc.encode(HKDF_INFO) },
        km, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
    );
}

/**
 * Encrypt a blob → returns a new blob with [12-byte IV | ciphertext].
 * @param {string} token
 * @param {Blob} blob
 * @returns {Promise<Blob>}
 */
export async function encryptBlob(token, blob) {
    const key = await deriveR2Key(token);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ab = await blob.arrayBuffer();
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, ab);
    const out = new Uint8Array(12 + ct.byteLength);
    out.set(iv, 0);
    out.set(new Uint8Array(ct), 12);
    return new Blob([out], { type: 'application/octet-stream' });
}

/**
 * Decrypt an [IV|CT] ArrayBuffer back into raw bytes.
 * @param {string} token
 * @param {ArrayBuffer} encBuf
 * @returns {Promise<ArrayBuffer>}
 */
export async function decryptBlob(token, encBuf) {
    const key = await deriveR2Key(token);
    const iv  = new Uint8Array(encBuf, 0, 12);
    const ct  = new Uint8Array(encBuf, 12);
    return crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, ct);
}

/**
 * Upload an encrypted blob to the R2 worker.
 * Returns true on success, false if config is missing / network fails.
 * @param {string} key — R2 key (e.g. 'profile/avatar.enc.jpg')
 * @param {Blob} blob — already encrypted bytes
 * @returns {Promise<boolean>}
 */
export async function r2Upload(key, blob) {
    const cfg = readR2Config();
    if (!cfg) return false;
    try {
        const res = await fetch(`${cfg.url}/upload?key=${encodeURIComponent(key)}`, {
            method: 'PUT',
            headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/octet-stream' },
            body: blob,
        });
        return res.ok;
    } catch (_e) { return false; }
}

/**
 * Download an encrypted blob from the R2 worker. Returns an ArrayBuffer
 * (the ciphertext); pass through decryptBlob to get the plaintext.
 * @param {string} key
 * @returns {Promise<ArrayBuffer | null>}
 */
export async function r2Download(key) {
    const cfg = readR2Config();
    if (!cfg) return null;
    try {
        const res = await fetch(`${cfg.url}/download`, {
            method: 'POST',
            headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
            body: JSON.stringify({ key }),
        });
        if (!res.ok) return null;
        return await res.arrayBuffer();
    } catch (_e) { return null; }
}

/**
 * High-level: encrypt + upload `blob` to R2 under `key`. Returns true on
 * success. Uses the Gist token as the key-deriving material; if no Gist
 * token is set, returns false (we never push unencrypted bytes).
 * @param {string} key
 * @param {Blob} blob
 * @returns {Promise<boolean>}
 */
export async function r2UploadEncrypted(key, blob) {
    const token = readGistToken();
    if (!token) return false;
    if (!readR2Config()) return false;
    try {
        const enc = await encryptBlob(token, blob);
        return await r2Upload(key, enc);
    } catch (_e) { return false; }
}

/**
 * High-level: download + decrypt `key` from R2. Returns a Blob with the
 * plaintext bytes, or null on any failure.
 * @param {string} key
 * @param {string} [mime] -- MIME type to stamp onto the resulting Blob
 * @returns {Promise<Blob | null>}
 */
export async function r2DownloadDecrypted(key, mime) {
    const token = readGistToken();
    if (!token) return null;
    if (!readR2Config()) return null;
    try {
        const buf = await r2Download(key);
        if (!buf) return null;
        const plain = await decryptBlob(token, buf);
        return new Blob([plain], { type: mime || 'application/octet-stream' });
    } catch (_e) { return null; }
}

/** @returns {boolean} */
export function isR2Configured() {
    return readR2Config() !== null && readGistToken() !== '';
}
