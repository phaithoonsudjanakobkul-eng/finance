// Muse playlist state — preset registry, slot arrays, password hashes.
//
// Mirrors monolith storage shape so records round-trip cross-build:
//   ps_muse_clips_{a..f}  — per-preset slot array (JSON)
//   ps_muse_preset_idx    — active preset index 0..5
//   ps_muse_active_slot   — JSON array of last-active slot per preset
//   ps_muse_pws           — JSON array of SHA-256 password hashes (or null)
//   ps_muse_slot_count    — 0=auto, 4-10=fixed
//   ps_muse_autorotate    — '1' or ''
//   ps_muse_transition    — 'fade' / 'slide' / ''
//
// Six presets A-F; each slot is { type: 'empty'|'image'|'video'|'tiktok', ... }.

import { lsGet, lsSave } from '../../core/storage.js';

export const PRESET_KEYS = ['ps_muse_clips_a','ps_muse_clips_b','ps_muse_clips_c','ps_muse_clips_d','ps_muse_clips_e','ps_muse_clips_f'];
export const PRESET_LETTERS = ['A','B','C','D','E','F'];
export const PRESET_IDX_KEY      = 'ps_muse_preset_idx';
export const ACTIVE_SLOT_KEY     = 'ps_muse_active_slot';
export const PASSWORD_HASHES_KEY = 'ps_muse_pws';
export const SLOT_COUNT_KEY      = 'ps_muse_slot_count';
export const AUTOROTATE_KEY      = 'ps_muse_autorotate';
export const TRANSITION_KEY      = 'ps_muse_transition';

/** @typedef {{ type: 'empty' } | { type: 'image', thumb: string, src: string, panFracX?: number, panFracY?: number, zoom?: number } | { type: 'video', thumb: string, r2Key?: string, idbKey?: string, src?: string, duration?: number, panFracX?: number, panFracY?: number, zoom?: number } | { type: 'tiktok', url: string, thumb?: string }} Slot */

/** @returns {number} 0..5 */
export function getActivePresetIdx() {
    const raw = parseInt(lsGet(PRESET_IDX_KEY, '0'), 10);
    if (!isFinite(raw) || raw < 0 || raw >= PRESET_KEYS.length) return 0;
    return raw;
}

/** @param {number} idx */
export function setActivePresetIdx(idx) {
    if (idx < 0 || idx >= PRESET_KEYS.length) return;
    lsSave(PRESET_IDX_KEY, String(idx));
}

/** @param {number} idx @returns {Slot[]} */
export function loadSlots(idx) {
    const key = PRESET_KEYS[idx];
    if (!key) return [];
    try {
        const raw = lsGet(key, '');
        if (!raw) return [];
        const parsed = JSON.parse(/** @type {string} */ (raw));
        return Array.isArray(parsed) ? parsed : [];
    } catch (_) { return []; }
}

/** @param {number} idx @param {Slot[]} slots */
export function saveSlots(idx, slots) {
    const key = PRESET_KEYS[idx];
    if (!key) return;
    try { lsSave(key, JSON.stringify(slots)); } catch (_) { /* quota */ }
}

/** @returns {number[]} active-slot index per preset (defaults to 0) */
export function loadActiveSlots() {
    try {
        const raw = lsGet(ACTIVE_SLOT_KEY, '');
        const parsed = raw ? JSON.parse(/** @type {string} */ (raw)) : [];
        const out = Array.isArray(parsed) ? parsed.slice() : [];
        while (out.length < PRESET_KEYS.length) out.push(0);
        return out;
    } catch (_) { return PRESET_KEYS.map(() => 0); }
}

/** @param {number[]} arr */
export function saveActiveSlots(arr) {
    try { lsSave(ACTIVE_SLOT_KEY, JSON.stringify(arr)); } catch (_) { /* quota */ }
}

/** @returns {(string | null)[]} */
export function loadPasswordHashes() {
    try {
        const raw = lsGet(PASSWORD_HASHES_KEY, '');
        const parsed = raw ? JSON.parse(/** @type {string} */ (raw)) : [];
        const out = Array.isArray(parsed) ? parsed.slice() : [];
        while (out.length < PRESET_KEYS.length) out.push(null);
        return out;
    } catch (_) { return PRESET_KEYS.map(() => null); }
}

/** @param {(string | null)[]} hashes */
export function savePasswordHashes(hashes) {
    try { lsSave(PASSWORD_HASHES_KEY, JSON.stringify(hashes)); } catch (_) { /* quota */ }
}

/**
 * Default visible slot count when not explicitly set:
 *   0 in storage → auto-fit to current slots.length (clamped 4..10)
 *   N in storage → use N
 * @returns {number}
 */
export function getSlotCount() {
    const raw = parseInt(lsGet(SLOT_COUNT_KEY, '0'), 10);
    if (raw >= 4 && raw <= 10) return raw;
    return 0; // auto
}

/** @param {number} n */
export function setSlotCount(n) {
    if (!(n === 0 || (n >= 4 && n <= 10))) return;
    lsSave(SLOT_COUNT_KEY, String(n));
}

/**
 * Visible slot count derived from the auto rule + stored fixed value.
 * @param {Slot[]} slots @returns {number}
 */
export function deriveVisibleSlotCount(slots) {
    const fixed = getSlotCount();
    if (fixed > 0) return fixed;
    return Math.max(4, Math.min(10, slots.length || 7));
}

// ── SHA-256 password hashing (matches monolith _museHashPw) ──

/**
 * @param {string} pw
 * @returns {Promise<string>} hex digest
 */
export async function hashPassword(pw) {
    const buf = new TextEncoder().encode(pw);
    const out = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(out)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {string} pw
 * @param {string | null} hash
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(pw, hash) {
    if (!hash) return true; // no password set
    const h = await hashPassword(pw);
    return h === hash;
}

// ── Slot helpers ──

/**
 * Reorder an array by moving the item at `from` to `to`. Pure — returns
 * a new array, doesn't mutate.
 * @param {Slot[]} slots @param {number} from @param {number} to
 * @returns {Slot[]}
 */
export function reorderSlots(slots, from, to) {
    if (from === to || from < 0 || to < 0 || from >= slots.length || to >= slots.length) {
        return slots.slice();
    }
    const out = slots.slice();
    const [moved] = out.splice(from, 1);
    out.splice(to, 0, moved);
    return out;
}

/**
 * Ensure the slot array is exactly `count` long, padding with empty slots.
 * @param {Slot[]} slots @param {number} count
 * @returns {Slot[]}
 */
export function padSlots(slots, count) {
    const out = slots.slice(0, count);
    while (out.length < count) out.push({ type: 'empty' });
    return out;
}
