// Muse video clip ↔ R2 helpers — V9.
//
// After V8 trim save, an unencrypted Blob lives in IDB. This module
// adds the cross-device leg:
//   client → AES-GCM encrypt → R2 upload (key derived from a SHA-256
//   content hash so duplicates dedupe naturally)
//
// Fresh-device path:
//   slot has r2Key but no local IDB cache → r2DownloadDecrypted →
//   write to IDB under the slot's idbKey → return Blob for playback
//
// Empty/missing config: every function is a no-op that returns null.

import { idbGet, idbPut } from '../../core/idb.js';
import { r2UploadEncrypted, r2DownloadDecrypted, isR2Configured } from '../../core/r2.js';

/**
 * SHA-256 of a Blob → first 24 hex chars (truncated for R2 key brevity).
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
export async function blobShortHash(blob) {
    const buf = await blob.arrayBuffer();
    const d = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

/**
 * R2 key for a muse clip — prefix `muse/{first-hex-char}/{hash}.enc.webm`
 * so the bucket gets fan-out for browsing in the R2 dashboard.
 * @param {string} hash @returns {string}
 */
export function clipKey(hash) {
    return `muse/${hash[0] || '0'}/${hash}.enc.webm`;
}

/**
 * Encrypt + upload `blob` to R2. Returns the R2 key on success, or null
 * if R2 isn't configured / network failed.
 * @param {Blob} blob
 * @returns {Promise<string | null>}
 */
export async function uploadClipToR2(blob) {
    if (!isR2Configured()) return null;
    const hash = await blobShortHash(blob);
    const key = clipKey(hash);
    const ok = await r2UploadEncrypted(key, blob);
    return ok ? key : null;
}

/**
 * Fetch + decrypt a clip from R2. Caches into IDB under `idbKey` so the
 * next playback skips the network. Returns the Blob, or null on miss.
 * @param {string} r2Key
 * @param {string} idbKey
 * @returns {Promise<Blob | null>}
 */
export async function downloadClipFromR2(r2Key, idbKey) {
    if (!isR2Configured()) return null;
    const blob = await r2DownloadDecrypted(r2Key, 'video/webm');
    if (!blob) return null;
    try { await idbPut(idbKey, blob); } catch (_) { /* swallow quota */ }
    return blob;
}

/**
 * High-level: get a Blob for a slot, preferring IDB cache, falling back
 * to R2 download (which writes back through to IDB).
 * @param {{ idbKey?: string, r2Key?: string }} slot
 * @returns {Promise<Blob | null>}
 */
export async function loadClipForSlot(slot) {
    if (!slot) return null;
    if (slot.idbKey) {
        const cached = await idbGet(slot.idbKey);
        if (cached) return cached;
        if (slot.r2Key) {
            return await downloadClipFromR2(slot.r2Key, slot.idbKey);
        }
    } else if (slot.r2Key) {
        const fallbackKey = 'muse-cache:' + slot.r2Key;
        return await downloadClipFromR2(slot.r2Key, fallbackKey);
    }
    return null;
}
