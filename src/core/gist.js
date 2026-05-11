// PSLink Vite — Gist sync (read + push, 2026-05-10).
//
// READ side: hydrates v2 from the monolith's encrypted GitHub Gist so a
// fresh device (no localStorage, no monolith pre-load) can boot v2
// directly with all records / watchlist / API keys / preset choice in
// place.
//
// PUSH side: rebuilds the monolith export shape from current
// localStorage and PATCHes the Gist with an AES-GCM envelope. Rate
// limited to GIST_MIN_INTERVAL_MS so a burst of edits doesn't burn
// the GitHub API budget. v2-only push paths (records:saved,
// watchlist:pinned, settings:changed) are wired by main.js — manual
// "Push to Gist" lives in Settings.
//
// Encryption format MUST match the monolith verbatim (CLAUDE.md "Gist
// Sync System"):
//   • Salt:  'PSLink-Gist-v1'  (NOT the R2 salt 'PSLink-R2-v1')
//   • HKDF:  SHA-256, info 'aes-gcm-256'
//   • Cipher: AES-GCM 256-bit, 12-byte IV, base64-wrapped JSON envelope
//             { enc: 1, iv: <b64>, d: <b64> }
//   • Backward-compat: if `parsed.enc !== 1`, return parsed (plain JSON)
//
// API-key obfuscation (matches monolith _encKey/_decKey):
//   base64( unescape( encodeURIComponent( utf8 ) ) )
// — NOT plain btoa(), so non-ASCII tokens round-trip safely.

import { lsSave, lsGet, lsGetJson, lsRemove } from './storage.js';
import { bus } from './bus.js';

export const GIST_ID       = '5f913baf7d6636bf42da5e5d07a1570c';
export const GIST_FILENAME = 'PSLink Database.json';
export const GIST_MIN_INTERVAL_MS = 4_000;

// ── Helpers ────────────────────────────────────────────────────────────

const _enc = new TextEncoder();
const _dec = new TextDecoder();

/** @param {ArrayBuffer | Uint8Array} buf */
function _b64(buf) {
    const u = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let s = '';
    for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]);
    return btoa(s);
}

/** @param {string} s */
function _unb64(s) {
    return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}

// ── Crypto ─────────────────────────────────────────────────────────────

/** @param {string} token @param {KeyUsage[]} usage */
async function _deriveKey(token, usage) {
    const km = await crypto.subtle.importKey('raw', _enc.encode(token), 'HKDF', false, ['deriveKey']);
    return crypto.subtle.deriveKey(
        { name: 'HKDF', hash: 'SHA-256', salt: _enc.encode('PSLink-Gist-v1'), info: _enc.encode('aes-gcm-256') },
        km,
        { name: 'AES-GCM', length: 256 },
        false,
        usage,
    );
}

/**
 * Encrypt a JSON-serializable object — wire-compatible with monolith
 * `_gistEncrypt`. Provided for parity; not yet called by v2 (push side
 * still goes through monolith).
 * @param {string} token
 * @param {any} plainObj
 * @returns {Promise<string>}
 */
export async function gistEncrypt(token, plainObj) {
    const key = await _deriveKey(token, ['encrypt']);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, _enc.encode(JSON.stringify(plainObj)));
    return JSON.stringify({ enc: 1, iv: _b64(iv), d: _b64(ct) });
}

/**
 * Decrypt monolith-format envelope. Plain JSON (legacy/v1) passes through
 * unchanged so a hand-edited Gist still works.
 * @param {string} token
 * @param {string} content
 * @returns {Promise<any>}
 */
export async function gistDecrypt(token, content) {
    /** @type {any} */
    let parsed;
    try { parsed = JSON.parse(content); }
    catch (e) { throw new Error('Invalid Gist content (not JSON)'); }
    if (!parsed || parsed.enc !== 1) return parsed;
    const key = await _deriveKey(token, ['decrypt']);
    const plain = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: _unb64(parsed.iv) }, key, _unb64(parsed.d));
    return JSON.parse(_dec.decode(plain));
}

// ── API-key obfuscation (matches monolith _encKey/_decKey) ─────────────

/** @param {string} v */
export function encKey(v) {
    return v ? btoa(unescape(encodeURIComponent(v))) : '';
}

/** @param {string} v */
export function decKey(v) {
    try { return v ? decodeURIComponent(escape(atob(v))) : ''; }
    catch (e) { return ''; }
}

// ── Fetch ──────────────────────────────────────────────────────────────

/**
 * GET the Gist + return the raw content of the v2-tracked filename.
 * Throws on auth failure / missing file. Cache-buster query param so a
 * fresh boot always sees the latest revision.
 * @param {string} token
 * @returns {Promise<string>}
 */
export async function fetchGistContent(token) {
    const res = await fetch(`https://api.github.com/gists/${GIST_ID}?_=${Date.now()}`, {
        headers: {
            Authorization: 'token ' + token,
            Accept: 'application/vnd.github+json',
        },
        cache: 'no-store',
    });
    if (res.status === 401) throw new Error('Gist token unauthorized (401) — check ps_gist_token');
    if (res.status === 403) throw new Error('Gist rate-limited or forbidden (403)');
    if (res.status === 404) throw new Error('Gist not found (404) — wrong GIST_ID or token lacks gist scope');
    if (!res.ok) throw new Error(`Gist fetch failed: HTTP ${res.status}`);
    /** @type {any} */
    const body = await res.json();
    const file = body && body.files && body.files[GIST_FILENAME];
    if (!file || typeof file.content !== 'string') {
        throw new Error(`Gist missing file "${GIST_FILENAME}"`);
    }
    return file.content;
}

// ── Apply restored shape to localStorage ───────────────────────────────

/**
 * Map the monolith export shape onto localStorage keys v2 cares about.
 * Everything written here is non-destructive in the sense that it
 * matches the monolith's own contract — so when the monolith is loaded
 * next it sees an identical state.
 *
 * Kept conservative: only fields v2 actively reads (records, watchlist,
 * wlCache, pinnedWl, apiKeys, meta.preset, psqState, psecState,
 * chartPrefs, uiState). Other fields (museData, profilePresets, fx
 * self-track, profile notes, profile photos) are preserved verbatim
 * via direct localStorage writes when the monolith later refreshes them.
 * v2 doesn't touch them so we don't need to apply them here.
 *
 * @param {any} data — decrypted export object
 * @returns {{ applied: string[], skipped: string[] }}
 */
export function applyToLocalStorage(data) {
    /** @type {string[]} */
    const applied = [];
    /** @type {string[]} */
    const skipped = [];

    if (!data || typeof data !== 'object') {
        return { applied, skipped: ['not-an-object'] };
    }

    // Records (financial)
    if (Array.isArray(data.records)) {
        lsSave('ps_records', JSON.stringify(data.records));
        applied.push('ps_records');
    } else { skipped.push('records'); }

    // Watchlist symbols
    if (Array.isArray(data.watchlist)) {
        lsSave('ps_watchlist', JSON.stringify(data.watchlist));
        applied.push('ps_watchlist');
    } else { skipped.push('watchlist'); }

    // Watchlist cache — merge wl + profile fields per symbol so v2 reads
    // a single object shape ({ c, d, dp, name, logo, ... }) like monolith.
    if (data.wlCache && typeof data.wlCache === 'object') {
        /** @type {Record<string, any>} */
        const merged = {};
        const wl = data.wlCache.wl || {};
        const prof = data.wlCache.profile || {};
        for (const s in wl) merged[s] = Object.assign({}, wl[s]);
        for (const s in prof) merged[s] = Object.assign({}, merged[s] || {}, prof[s]);
        if (Object.keys(merged).length) {
            lsSave('ps_wl_cache', JSON.stringify(merged));
            applied.push('ps_wl_cache');
        }
    }

    // Pinned watchlist (lives under profileCard in the export)
    if (data.profileCard && typeof data.profileCard.pinnedWl === 'string') {
        lsSave('ps_pinned_wl', data.profileCard.pinnedWl);
        applied.push('ps_pinned_wl');
    }

    // API keys (base64-decoded from _encKey)
    if (data.apiKeys && typeof data.apiKeys === 'object') {
        for (const k in data.apiKeys) {
            if (!data.apiKeys[k]) continue;
            const decoded = decKey(String(data.apiKeys[k]));
            if (decoded) {
                lsSave(k, decoded);
                applied.push(k);
            }
        }
    }

    // Preset / variant per mode
    if (data.meta && data.meta.preset) {
        const p = data.meta.preset;
        if (p.active)        { lsSave('ps_preset',         String(p.active));        applied.push('ps_preset'); }
        if (p.activeVariant) { lsSave('ps_preset_variant', String(p.activeVariant)); applied.push('ps_preset_variant'); }
        if (p.dark)          { lsSave('ps_preset_dark',    String(p.dark));          applied.push('ps_preset_dark'); }
        if (p.light)         { lsSave('ps_preset_light',   String(p.light));         applied.push('ps_preset_light'); }
        if (p.variantDark)   { lsSave('ps_variant_dark',   String(p.variantDark));   applied.push('ps_variant_dark'); }
        if (p.variantLight)  { lsSave('ps_variant_light',  String(p.variantLight));  applied.push('ps_variant_light'); }
    }

    // Meta scalars
    if (data.meta) {
        if (typeof data.meta.dark === 'boolean') {
            lsSave('ps_dark', data.meta.dark ? '1' : '0');
            applied.push('ps_dark');
        }
        if (typeof data.meta.privacy === 'boolean') {
            lsSave('ps_privacy', data.meta.privacy ? '1' : '0');
            applied.push('ps_privacy');
        }
    }

    // Chart prefs (lwc)
    if (data.chartPrefs && typeof data.chartPrefs === 'object') {
        lsSave('ps_lwc_prefs', JSON.stringify(data.chartPrefs));
        applied.push('ps_lwc_prefs');
    }

    // PSQ + PSEC state
    if (data.psqState  && typeof data.psqState  === 'object') { lsSave('ps_psq_state',  JSON.stringify(data.psqState));  applied.push('ps_psq_state'); }
    if (data.psecState && typeof data.psecState === 'object') { lsSave('ps_psec_state', JSON.stringify(data.psecState)); applied.push('ps_psec_state'); }

    // UI state
    if (data.uiState) {
        if (typeof data.uiState.tab === 'string')        { lsSave('ps_tab', data.uiState.tab); applied.push('ps_tab'); }
        if (data.uiState.dashSectionOrder)               { lsSave('ps_dash_section_order', JSON.stringify(data.uiState.dashSectionOrder)); applied.push('ps_dash_section_order'); }
        if (data.uiState.dashSectionCollapsed)           { lsSave('ps_dash_collapsed',     JSON.stringify(data.uiState.dashSectionCollapsed)); applied.push('ps_dash_collapsed'); }
    }

    return { applied, skipped };
}

// ── Top-level pull ─────────────────────────────────────────────────────

/**
 * Full read pipeline: fetch → decrypt → apply. Bus event 'gist:pulled'
 * fires on success with `{ applied, skipped, lastModifiedTs }`. On
 * failure throws — caller decides whether to surface the error.
 *
 * @param {string} token
 * @returns {Promise<{ applied: string[], skipped: string[], lastModifiedTs: number | null }>}
 */
export async function pullFromGist(token) {
    if (!token) throw new Error('No Gist token');
    bus.emit('gist:syncing', { dir: 'pull' });
    try {
        const content = await fetchGistContent(token);
        const data = await gistDecrypt(token, content);
        const result = applyToLocalStorage(data);
        const ts = (data && typeof data.lastModifiedTs === 'number') ? data.lastModifiedTs : null;
        bus.emit('gist:pulled', { applied: result.applied, skipped: result.skipped, lastModifiedTs: ts });
        return Object.assign({ lastModifiedTs: ts }, result);
    } catch (e) {
        bus.emit('gist:error', { dir: 'pull', error: /** @type {any} */ (e) && /** @type {any} */ (e).message || String(e) });
        throw e;
    }
}

// ── Push: rebuild export shape + PATCH ─────────────────────────────────
//
// Inverse of applyToLocalStorage. Reads every localStorage key v2 owns
// (or that monolith maintains in parallel) and produces an object whose
// shape matches monolith _buildExportData close enough that:
//   • monolith reading it → resumes happily
//   • v2 reading it → applyToLocalStorage round-trips
// Monolith-only fields (museData / profilePresets / fxSelfTrack /
// profileCard.notesHtml etc.) are preserved verbatim from existing
// localStorage values when present, so a v2-pushed payload doesn't
// truncate state the monolith owns.

const _API_KEY_LIST = [
    'ps_finnhub_key','ps_fmp_key','ps_erapi_key','ps_twelvedata_key',
    'ps_alpaca_key','ps_alpaca_secret','ps_openrouter_key',
    'ps_r2_worker_url','ps_r2_auth_token',
    'ps_psq_wopi_url','ps_psq_wopi_token','ps_psq_collabora_url',
    'ps_pdf_worker_url','ps_pdf_auth_token','ps_psq_local_base',
];

/** @returns {any} */
export function buildExportFromLocalStorage() {
    /** @type {Record<string, string>} */
    const apiKeys = {};
    for (const k of _API_KEY_LIST) {
        const v = lsGet(k, '');
        if (v) apiKeys[k] = encKey(/** @type {string} */ (v));
    }

    /** @type {any} */
    const wlCacheRaw = lsGetJson('ps_wl_cache', {});
    /** @type {Record<string, any>} */
    const wl = {};
    /** @type {Record<string, any>} */
    const profile = {};
    if (wlCacheRaw && typeof wlCacheRaw === 'object') {
        // Split merged cache back into wl + profile shape so monolith reads it the same
        const PRICE_FIELDS = new Set(['c','d','dp','pc','o','h','l','v']);
        for (const sym in wlCacheRaw) {
            const e = wlCacheRaw[sym];
            if (!e) continue;
            /** @type {any} */
            const w = {};
            /** @type {any} */
            const p = {};
            for (const f in e) {
                if (PRICE_FIELDS.has(f)) w[f] = e[f];
                else p[f] = e[f];
            }
            if (Object.keys(w).length) wl[sym] = w;
            if (Object.keys(p).length) profile[sym] = p;
        }
    }

    return {
        lastModifiedTs: Date.now(),
        meta: {
            avatar:        lsGet('ps_avatar', ''),
            avatarTs:      parseInt(/** @type {string} */ (lsGet('ps_avatar_ts', '0')), 10) || 0,
            profilePhoto:  lsGet('ps_profile_photo', ''),
            profilePhotoTs:parseInt(/** @type {string} */ (lsGet('ps_profile_photo_ts', '0')), 10) || 0,
            dark:          lsGet('ps_dark', '') === '1',
            theme:         lsGet('ps_theme', '') || 'onyx',
            privacy:       lsGet('ps_privacy', '') === '1',
            preset: {
                active:        lsGet('ps_preset', ''),
                activeVariant: lsGet('ps_preset_variant', ''),
                dark:          lsGet('ps_preset_dark', ''),
                light:         lsGet('ps_preset_light', ''),
                variantDark:   lsGet('ps_variant_dark', ''),
                variantLight:  lsGet('ps_variant_light', ''),
            },
        },
        chartPrefs: lsGetJson('ps_lwc_prefs', {}),
        records:   lsGetJson('ps_records', []),
        watchlist: lsGetJson('ps_watchlist', []),
        wlCache:   { wl, profile, valuation: lsGetJson('ps_wl_valuation_cache', {}) },
        profileCard: {
            notesHtml:   lsGet('ps_profile_notes_html', ''),
            notes:       lsGet('ps_profile_notes', ''),
            freeImgs:    lsGet('ps_profile_free_imgs', '[]'),
            pillsHidden: lsGet('ps_profile_pills_hidden', '[]'),
            pinnedWl:    lsGet('ps_pinned_wl', '[]'),
        },
        apiKeys,
        psqState:  lsGetJson('ps_psq_state',  null),
        psecState: lsGetJson('ps_psec_state', null),
        uiState: {
            tab:                  lsGet('ps_tab', 'dashboard'),
            dashSectionOrder:     lsGetJson('ps_dash_section_order', null),
            dashSectionCollapsed: lsGetJson('ps_dash_collapsed',     null),
        },
    };
}

let _lastPushTs = 0;
/** @type {Promise<any> | null} */
let _pushInflight = null;

/**
 * Encrypt a payload + PATCH the Gist. Rate-limited via GIST_MIN_INTERVAL_MS;
 * concurrent calls coalesce onto the in-flight promise. Bus event
 * 'gist:pushed' fires on success.
 *
 * @param {string} token
 * @param {any} [payload] - defaults to buildExportFromLocalStorage()
 * @returns {Promise<{ ok: true, lastModifiedTs: number, throttled?: boolean }>}
 */
export async function pushToGist(token, payload) {
    if (!token) throw new Error('No Gist token');
    const now = Date.now();
    if (now - _lastPushTs < GIST_MIN_INTERVAL_MS) {
        return { ok: true, lastModifiedTs: _lastPushTs, throttled: true };
    }
    if (_pushInflight) return _pushInflight;

    const data = payload || buildExportFromLocalStorage();
    bus.emit('gist:syncing', { dir: 'push' });
    _pushInflight = (async () => {
        const ct = await gistEncrypt(token, data);
        const res = await fetch(`https://api.github.com/gists/${GIST_ID}`, {
            method: 'PATCH',
            headers: {
                Authorization: 'token ' + token,
                Accept: 'application/vnd.github+json',
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({ files: { [GIST_FILENAME]: { content: ct } } }),
        });
        if (res.status === 401) throw new Error('Push 401 — token unauthorized');
        if (res.status === 403) throw new Error('Push 403 — rate limited or forbidden');
        if (!res.ok) throw new Error(`Push failed: HTTP ${res.status}`);
        _lastPushTs = Date.now();
        bus.emit('gist:pushed', { lastModifiedTs: data.lastModifiedTs });
        return { ok: /** @type {true} */ (true), lastModifiedTs: data.lastModifiedTs };
    })();

    try { return await _pushInflight; }
    catch (e) {
        bus.emit('gist:error', { dir: 'push', error: /** @type {any} */ (e) && /** @type {any} */ (e).message || String(e) });
        throw e;
    }
    finally { _pushInflight = null; }
}

// ── Orphan cleanup ─────────────────────────────────────────────────────
// Exposed for tests that need to wipe state between cases.

export function _resetGistEnvelopeForTests() {
    lsRemove('ps_gist_envelope_test_only');
    _lastPushTs = 0;
    _pushInflight = null;
}
