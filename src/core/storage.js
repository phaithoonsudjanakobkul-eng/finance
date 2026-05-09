// PSLink — core storage wrapper (Session 3a, 2026-05-09)
//
// Port of _lsSave from monolith index.html (post-F1 hardening). Same contract:
//   - try { localStorage.setItem(k, v) } catch QuotaExceededError → toast
//   - bracket notation `localStorage['setItem']` to keep replace_all-safe
//   - silent on success
//
// In Vite-bundled Phase B, all module localStorage writes funnel through here.
// Legacy root index.html still uses its own inline _lsSave — both share the
// same QuotaExceededError-aware contract so behavior is identical.

/**
 * Safe localStorage setter. Catches quota errors and surfaces a toast via
 * the optional handler. Returns true on success, false on quota fail.
 * @param {string} key
 * @param {string} value
 * @returns {boolean}
 */
export function lsSave(key, value) {
    try {
        // Bracket notation matches the legacy hack documented in index.html:56518 —
        // protects against an accidental find/replace of `localStorage.setItem(`.
        localStorage['setItem'](key, value);
        return true;
    } catch (e) {
        const err = /** @type {any} */ (e);
        if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22)) {
            // Defer to legacy showGistStatus when present (will be replaced by core/toast.js in Phase 4)
            const w = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
            if (typeof w.showGistStatus === 'function') {
                w.showGistStatus('⚠ Storage เต็ม — บันทึก Gist เท่านั้น', 'text-rose-400');
            }
            return false;
        }
        throw e;
    }
}

/**
 * Safe localStorage getter — returns fallback on missing or parse error.
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @returns {string | T}
 */
export function lsGet(key, fallback) {
    try {
        const v = localStorage.getItem(key);
        return v == null ? fallback : v;
    } catch (e) {
        return fallback;
    }
}

/**
 * Safe JSON parse from localStorage with fallback.
 * @template T
 * @param {string} key
 * @param {T} fallback
 * @returns {T}
 */
export function lsGetJson(key, fallback) {
    try {
        const raw = localStorage.getItem(key);
        if (raw == null) return fallback;
        return JSON.parse(raw);
    } catch (e) {
        return fallback;
    }
}

/**
 * Safe JSON write — calls lsSave with stringified value.
 * @param {string} key
 * @param {any} value
 * @returns {boolean}
 */
export function lsSaveJson(key, value) {
    try {
        return lsSave(key, JSON.stringify(value));
    } catch (e) {
        return false;
    }
}

/**
 * Remove a key — always safe, never throws.
 * @param {string} key
 */
export function lsRemove(key) {
    try { localStorage.removeItem(key); } catch (e) {}
}
