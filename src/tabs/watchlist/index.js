// Watchlist tab — Phase 1 read-only view + Phase 2a HTTP refresh.
//
// Phase 1 (read-only): renders ps_watchlist symbols against ps_wl_cache last-
// fetched quote data.
// Phase 2a (HTTP refresh): button-triggered fan-out fetch to Finnhub /quote
// for every watched symbol. Updates ps_wl_cache in place + repaints. Free-tier
// rate limit is 60 calls/min — typical 27-30 symbol watchlist stays within
// budget on a single click. Per-symbol failure swallowed.
//
// Field shape from monolith wlDataCache[sym]: c (last), pc (prev close),
// d (Δ$), dp (Δ%), o/h/l (OHLC), v (volume), name (display), logo, plus
// premarket / afterhours / 52w / fundamentals. We read tolerantly — any
// missing field renders a dash.
//
// DEFERRED to dedicated Watchlist sub-sessions:
// - Phase 2b: WS pipeline (Alpaca + Finnhub) + rAF coalesce + viewport culling
// - Phase 2c: Sparkline cache (ps_wl_spark_cache_v5) + 1D regular-session render
// - Phase 2d: Market scanner (gainers/losers × regular/pre/AH)
// - Phase 2e: Lightweight Charts side panel + AI chat FAB
// - Sort by column / pin / unpin / drag-reorder

import { bus } from '../../core/bus.js';
import { lsGet, lsSave, lsGetJson } from '../../core/storage.js';

/** @typedef {{
 *   c?: number, pc?: number, d?: number, dp?: number,
 *   o?: number, h?: number, l?: number, v?: number,
 *   name?: string, logo?: string, type?: string,
 * }} WlCacheEntry */

const _PRICE_FMT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const _DELTA_FMT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' });
const _VOL_FMT   = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

const AUTO_INTERVAL_MS = 30_000;
const AUTO_LS_KEY = 'ps_v2_wl_auto';
const WS_LS_KEY = 'ps_v2_wl_ws';
const SORT_LS_KEY = 'ps_v2_wl_sort';
const WS_PERSIST_INTERVAL_MS = 5_000;

/** @typedef {'sym' | 'name' | 'c' | 'd' | 'dp' | 'v'} SortField */

/** @type {{ field: SortField, dir: 'asc' | 'desc' }} */
let _sort = { field: 'sym', dir: 'asc' };
/** @type {string} */
let _filter = '';
/** @type {string} */
let _focusSym = '';

/** @type {HTMLElement | null} */
let _panel = null;
/** @type {AbortController | null} */
let _ctrl = null;
/** @type {number} */
let _autoTimer = 0;
/** @type {(() => void) | null} */
let _visOff = null;

/** @type {Record<string, WlCacheEntry> | null} */
let _liveCache = null;
/** @type {WebSocket | null} */
let _ws = null;
/** @type {string[]} */
let _wsSubscribed = [];
/** @type {Map<string, number>} */
const _pendingTicks = new Map();
/** @type {number} */
let _wsRaf = 0;
/** @type {number} */
let _wsPersistTimer = 0;
/** @type {number} */
let _wsTickCount = 0;
/** @type {number} */
let _wsReconnectTimer = 0;

// ── Reads ──────────────────────────────────────────────────────────────

/** @returns {string[]} */
function loadSymbols() {
    const raw = /** @type {any} */ (lsGetJson('ps_watchlist', []));
    if (!Array.isArray(raw)) return [];
    return raw.filter((/** @type {any} */ s) => typeof s === 'string' && s.length);
}

/** @returns {Record<string, WlCacheEntry>} */
function loadCache() {
    if (_liveCache) return _liveCache;
    const raw = /** @type {any} */ (lsGetJson('ps_wl_cache', {}));
    return (raw && typeof raw === 'object') ? raw : {};
}

/** @returns {Record<string, WlCacheEntry>} */
function ensureLiveCache() {
    if (_liveCache) return _liveCache;
    const raw = /** @type {any} */ (lsGetJson('ps_wl_cache', {}));
    /** @type {Record<string, WlCacheEntry>} */
    const fresh = (raw && typeof raw === 'object') ? raw : {};
    _liveCache = fresh;
    return fresh;
}

/**
 * Load ps_wl_spark_cache_v5 — { ts, data: { SYM: { prices: number[], ... } } }.
 * Returns the inner `data` map. Empty object if cache absent.
 * @returns {Record<string, { prices?: number[] }>}
 */
function loadSparkCache() {
    const raw = /** @type {any} */ (lsGetJson('ps_wl_spark_cache_v5', null));
    if (!raw || typeof raw !== 'object') return {};
    const d = /** @type {any} */ (raw.data);
    return (d && typeof d === 'object') ? d : {};
}

/**
 * Build an SVG polyline path from a price array. Returns the path 'd'
 * attribute + last-vs-first sign for color decision. Empty path if too few
 * bars.
 * @param {number[]} prices
 * @param {number} W width
 * @param {number} H height
 * @returns {{ d: string, sign: number }}
 */
function buildSparkPath(prices, W, H) {
    if (!Array.isArray(prices) || prices.length < 2) return { d: '', sign: 0 };
    let mn = Infinity, mx = -Infinity;
    for (const p of prices) { if (p < mn) mn = p; if (p > mx) mx = p; }
    const range = mx - mn || 1;
    const step = (W - 2) / (prices.length - 1);
    let d = '';
    for (let i = 0; i < prices.length; i++) {
        const x = 1 + i * step;
        const y = (H - 2) - ((prices[i] - mn) / range) * (H - 2);
        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }
    const sign = Math.sign(prices[prices.length - 1] - prices[0]);
    return { d, sign };
}

/** @param {Record<string, WlCacheEntry>} cache */
function persistCache(cache) {
    try { lsSave('ps_wl_cache', JSON.stringify(cache)); }
    catch (e) { console.warn('[wl] cache save failed:', e); }
}

/**
 * Finnhub /quote returns { c, d, dp, h, l, o, pc, t } — field names match
 * our cache shape so we can shallow-merge.
 * @param {string} symbol
 * @param {string} key
 * @param {AbortSignal} signal
 * @returns {Promise<WlCacheEntry>}
 */
async function fetchQuote(symbol, key, signal) {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Finnhub ${res.status} for ${symbol}`);
    const body = await res.json();
    return /** @type {WlCacheEntry} */ ({
        c: typeof body.c === 'number' ? body.c : undefined,
        d: typeof body.d === 'number' ? body.d : undefined,
        dp: typeof body.dp === 'number' ? body.dp : undefined,
        h: typeof body.h === 'number' ? body.h : undefined,
        l: typeof body.l === 'number' ? body.l : undefined,
        o: typeof body.o === 'number' ? body.o : undefined,
        pc: typeof body.pc === 'number' ? body.pc : undefined,
    });
}

// ── Render ─────────────────────────────────────────────────────────────

function renderPanel(/** @type {HTMLElement} */ rootEl) {
    rootEl.innerHTML = `
        <div id="wl-root" style="display:flex;flex-direction:column;gap:12px;padding:16px;color:var(--fg, #f5f5f7);">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;">Watchlist</span>
                <span style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);">tab/watchlist · read-only</span>
                <input id="wl-filter" type="search" placeholder="Filter symbol or name…" autocomplete="off" style="margin-left:auto;background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:6px 10px;border-radius:6px;font-family:var(--mono, monospace);font-size:12px;min-width:200px;outline:none;">
                <span id="wl-ws-indicator" style="display:none;align-items:center;gap:4px;font-size:10px;color:var(--dim, #888);font-family:var(--mono, monospace);">
                    <span id="wl-ws-dot" style="width:6px;height:6px;border-radius:50%;background:var(--dim, #888);"></span>
                    <span id="wl-ws-tickcount">0</span>
                </span>
                <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);cursor:pointer;user-select:none;">
                    <input id="wl-ws" type="checkbox" style="cursor:pointer;accent-color:var(--accent, #089981);">
                    live ws
                </label>
                <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);cursor:pointer;user-select:none;">
                    <input id="wl-auto" type="checkbox" style="cursor:pointer;accent-color:var(--accent, #089981);">
                    auto 30s
                </label>
                <button id="wl-reload" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;">Reload cache</button>
                <button id="wl-refresh-live" style="background:var(--accent, #089981);color:#000;border:0;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">Refresh live</button>
            </div>
            <div id="wl-focus-card"></div>
            <div style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;overflow:hidden;">
                <div id="wl-table-wrap" style="overflow:auto;max-height:60vh;">
                    <table id="watchlist-table" style="width:100%;border-collapse:collapse;font-family:'Inter','IBM Plex Sans Thai',system-ui,sans-serif;font-size:13px;font-variant-numeric:tabular-nums;">
                        <thead>
                            <tr style="background:var(--bg, #0d0d0d);position:sticky;top:0;">
                                <th data-sort="sym"  style="text-align:left;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;cursor:pointer;user-select:none;">Symbol</th>
                                <th data-sort="name" style="text-align:left;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;cursor:pointer;user-select:none;">Name</th>
                                <th data-sort="c"    style="text-align:right;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;cursor:pointer;user-select:none;">Last</th>
                                <th data-sort="d"    style="text-align:right;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;cursor:pointer;user-select:none;">Δ $</th>
                                <th data-sort="dp"   style="text-align:right;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;cursor:pointer;user-select:none;">Δ %</th>
                                <th style="text-align:center;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;">Trend</th>
                                <th data-sort="v"    style="text-align:right;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;cursor:pointer;user-select:none;">Vol</th>
                            </tr>
                        </thead>
                        <tbody id="wl-tbody"></tbody>
                    </table>
                </div>
            </div>
            <div id="wl-status" style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);">Idle</div>
        </div>
    `;
}

function repaint() {
    if (!_panel) return;
    const tbody = /** @type {HTMLElement | null} */ (_panel.querySelector('#wl-tbody'));
    const status = /** @type {HTMLElement | null} */ (_panel.querySelector('#wl-status'));
    if (!tbody) return;
    const symbols = loadSymbols();
    const cache = loadCache();
    if (!symbols.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="padding:18px;text-align:center;color:var(--dim, #888);">No symbols in <code>ps_watchlist</code>. Add via the monolith Watchlist tab to populate.</td></tr>`;
        if (status) status.textContent = '0 symbols · empty watchlist';
        return;
    }
    const sparkData = loadSparkCache();
    const sorted = sortSymbols(symbols, cache);
    const q = _filter.trim().toLowerCase();
    const filtered = q ? sorted.filter((sym) => {
        if (sym.toLowerCase().includes(q)) return true;
        const n = (cache[sym] && cache[sym].name) || '';
        return String(n).toLowerCase().includes(q);
    }) : sorted;
    if (q && !filtered.length) {
        tbody.innerHTML = `<tr><td colspan="7" style="padding:18px;text-align:center;color:var(--dim, #888);">No matches for &ldquo;${escapeHtml(q)}&rdquo;.</td></tr>`;
        paintSortIndicators();
        if (status) status.textContent = `0 / ${symbols.length} symbol(s) shown · filter "${q}"`;
        return;
    }
    const rows = filtered.map((sym) => {
        const c = cache[sym] || {};
        const last = (typeof c.c === 'number') ? _PRICE_FMT.format(c.c) : '—';
        const dRaw = (typeof c.d === 'number') ? c.d : null;
        const dpRaw = (typeof c.dp === 'number') ? c.dp : null;
        const d = (dRaw !== null) ? _DELTA_FMT.format(dRaw) : '—';
        const dp = (dpRaw !== null) ? _DELTA_FMT.format(dpRaw) + '%' : '—';
        const dColor = dRaw !== null ? (dRaw >= 0 ? 'var(--wl-up, #10b981)' : 'var(--wl-dn, #ef4444)') : 'var(--dim, #888)';
        const vol = (typeof c.v === 'number') ? _VOL_FMT.format(c.v) : '—';
        const name = c.name ? escapeHtml(String(c.name)) : '';
        const sparkEntry = sparkData[sym];
        const prices = (sparkEntry && Array.isArray(sparkEntry.prices)) ? sparkEntry.prices : [];
        const { d: sparkD, sign: sparkSign } = buildSparkPath(prices, 80, 26);
        const sparkColor = sparkSign > 0 ? 'var(--wl-up, #10b981)' : sparkSign < 0 ? 'var(--wl-dn, #ef4444)' : 'var(--dim, #888)';
        const sparkSvg = sparkD
            ? `<svg viewBox="0 0 80 26" preserveAspectRatio="none" width="80" height="26" style="display:block;"><path d="${sparkD}" stroke="${sparkColor}" stroke-width="1.4" fill="none" vector-effect="non-scaling-stroke"/></svg>`
            : `<span style="color:var(--dim, #888);font-family:var(--mono, monospace);font-size:11px;">—</span>`;
        return `<tr class="wl-row" data-sym="${escapeAttr(sym)}" style="border-top:1px solid var(--border, #2a2a2a);">
            <td style="padding:10px 12px;font-family:var(--mono, monospace);font-weight:700;letter-spacing:0.02em;">${escapeHtml(sym)}</td>
            <td style="padding:10px 12px;color:var(--dim, #888);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name || '—'}</td>
            <td style="padding:10px 12px;text-align:right;font-family:var(--mono, monospace);">${last}</td>
            <td style="padding:10px 12px;text-align:right;font-family:var(--mono, monospace);color:${dColor};">${d}</td>
            <td style="padding:10px 12px;text-align:right;font-family:var(--mono, monospace);color:${dColor};">${dp}</td>
            <td style="padding:6px 12px;text-align:center;width:96px;">${sparkSvg}</td>
            <td style="padding:10px 12px;text-align:right;font-family:var(--mono, monospace);color:var(--dim, #888);">${vol}</td>
        </tr>`;
    }).join('');
    tbody.innerHTML = rows;
    paintSortIndicators();
    paintFocusActive();
    renderFocusCard();
    const cached = symbols.filter((s) => cache[s] && typeof cache[s].c === 'number').length;
    const shown = filtered.length;
    const filterPart = q ? ` · filter "${q}" (${shown}/${symbols.length})` : '';
    if (status) status.textContent = `${shown} symbol(s) shown · ${cached} cached · sort ${_sort.field} ${_sort.dir}${filterPart}`;
}

// ── Focus card ─────────────────────────────────────────────────────────

function paintFocusActive() {
    if (!_panel) return;
    _panel.querySelectorAll('.wl-row').forEach((r) => {
        const isActive = r.getAttribute('data-sym') === _focusSym;
        /** @type {HTMLElement} */ (r).style.background = isActive ? 'color-mix(in srgb, var(--accent, #089981) 12%, transparent)' : '';
    });
}

function renderFocusCard() {
    if (!_panel) return;
    const host = /** @type {HTMLElement | null} */ (_panel.querySelector('#wl-focus-card'));
    if (!host) return;
    if (!_focusSym) { host.innerHTML = ''; return; }
    const cache = loadCache();
    const c = cache[_focusSym] || {};
    const sparkData = loadSparkCache();
    const sparkEntry = sparkData[_focusSym];
    /** @type {number[]} */
    const prices = (sparkEntry && Array.isArray(sparkEntry.prices)) ? sparkEntry.prices : [];
    const last = (typeof c.c === 'number') ? _PRICE_FMT.format(c.c) : '—';
    const dRaw = (typeof c.d === 'number') ? c.d : null;
    const dpRaw = (typeof c.dp === 'number') ? c.dp : null;
    const d = (dRaw !== null) ? _DELTA_FMT.format(dRaw) : '—';
    const dp = (dpRaw !== null) ? _DELTA_FMT.format(dpRaw) + '%' : '—';
    const dColor = dRaw !== null ? (dRaw >= 0 ? 'var(--wl-up, #10b981)' : 'var(--wl-dn, #ef4444)') : 'var(--dim, #888)';
    const range = (typeof c.h === 'number' && typeof c.l === 'number')
        ? `${_PRICE_FMT.format(c.l)} – ${_PRICE_FMT.format(c.h)}` : '—';
    const open = (typeof c.o === 'number') ? _PRICE_FMT.format(c.o) : '—';
    const prevClose = (typeof c.pc === 'number') ? _PRICE_FMT.format(c.pc) : '—';
    const W = 360, H = 120;
    const { d: sparkD, sign } = buildSparkPath(prices, W, H);
    const sparkColor = sign > 0 ? 'var(--wl-up, #10b981)' : sign < 0 ? 'var(--wl-dn, #ef4444)' : 'var(--dim, #888)';
    const sparkSvg = sparkD
        ? `<svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" style="width:100%;height:120px;display:block;"><path d="${sparkD}" stroke="${sparkColor}" stroke-width="1.6" fill="none" vector-effect="non-scaling-stroke"/></svg>`
        : `<div style="height:120px;display:flex;align-items:center;justify-content:center;color:var(--dim, #888);font-family:var(--mono, monospace);font-size:12px;">No sparkline data cached</div>`;
    const name = c.name ? escapeHtml(String(c.name)) : '';
    host.innerHTML = `
        <div style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;display:grid;grid-template-columns:minmax(200px, 1fr) 2fr;gap:14px;align-items:start;">
            <div>
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px;">
                    <span style="font-family:var(--mono, monospace);font-size:18px;font-weight:700;letter-spacing:0.02em;">${escapeHtml(_focusSym)}</span>
                    <button id="wl-focus-close" title="Clear (Esc)" style="margin-left:auto;background:transparent;border:0;color:var(--dim, #888);cursor:pointer;font-size:18px;line-height:1;padding:0 4px;">×</button>
                </div>
                ${name ? `<div style="font-size:12px;color:var(--dim, #888);margin-bottom:10px;max-width:100%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</div>` : ''}
                <div style="display:flex;align-items:baseline;gap:8px;margin-bottom:6px;">
                    <span style="font-family:var(--font-data, var(--mono, monospace));font-size:24px;font-weight:700;letter-spacing:-0.01em;font-variant-numeric:tabular-nums;">${last}</span>
                    <span style="font-family:var(--mono, monospace);color:${dColor};font-size:13px;font-variant-numeric:tabular-nums;">${d}</span>
                    <span style="font-family:var(--mono, monospace);color:${dColor};font-size:13px;font-variant-numeric:tabular-nums;">${dp}</span>
                </div>
                <div style="display:grid;grid-template-columns:auto 1fr;gap:4px 10px;font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);">
                    <span>Range</span><span style="color:var(--fg, #f5f5f7);font-variant-numeric:tabular-nums;">${range}</span>
                    <span>Open</span><span style="color:var(--fg, #f5f5f7);font-variant-numeric:tabular-nums;">${open}</span>
                    <span>Prev</span><span style="color:var(--fg, #f5f5f7);font-variant-numeric:tabular-nums;">${prevClose}</span>
                    <span>Bars</span><span style="color:var(--fg, #f5f5f7);font-variant-numeric:tabular-nums;">${prices.length}</span>
                </div>
            </div>
            <div style="background:var(--bg, #0d0d0d);border:1px solid var(--border, #2a2a2a);border-radius:8px;padding:8px;">
                ${sparkSvg}
            </div>
        </div>
    `;
}

// ── Sort ───────────────────────────────────────────────────────────────

function loadSortPref() {
    const raw = lsGet(SORT_LS_KEY, '');
    if (!raw) return;
    const m = raw.match(/^(sym|name|c|d|dp|v):(asc|desc)$/);
    if (m) _sort = { field: /** @type {SortField} */ (m[1]), dir: /** @type {'asc' | 'desc'} */ (m[2]) };
}

function persistSortPref() {
    lsSave(SORT_LS_KEY, `${_sort.field}:${_sort.dir}`);
}

/**
 * @param {string[]} syms
 * @param {Record<string, WlCacheEntry>} cache
 */
function sortSymbols(syms, cache) {
    const f = _sort.field;
    const sign = _sort.dir === 'asc' ? 1 : -1;
    const arr = syms.slice();
    arr.sort((a, b) => {
        const ca = cache[a] || {};
        const cb = cache[b] || {};
        if (f === 'sym')  return a.localeCompare(b) * sign;
        if (f === 'name') return String(ca.name || a).localeCompare(String(cb.name || b)) * sign;
        const va = (typeof /** @type {any} */ (ca)[f] === 'number') ? /** @type {any} */ (ca)[f] : -Infinity;
        const vb = (typeof /** @type {any} */ (cb)[f] === 'number') ? /** @type {any} */ (cb)[f] : -Infinity;
        if (va === vb) return a.localeCompare(b);
        return (va - vb) * sign;
    });
    return arr;
}

/** @param {SortField} field */
function applySort(field) {
    if (_sort.field === field) {
        _sort.dir = _sort.dir === 'asc' ? 'desc' : 'asc';
    } else {
        _sort.field = field;
        // Symbol/name default asc; numeric defaults desc (biggest first)
        _sort.dir = (field === 'sym' || field === 'name') ? 'asc' : 'desc';
    }
    persistSortPref();
    repaint();
}

function paintSortIndicators() {
    if (!_panel) return;
    const ths = _panel.querySelectorAll('th[data-sort]');
    ths.forEach((th) => {
        const f = th.getAttribute('data-sort');
        const isActive = f === _sort.field;
        const arrow = isActive ? (_sort.dir === 'asc' ? ' ▲' : ' ▼') : '';
        const base = String(th.getAttribute('data-label') || th.textContent || '').replace(/\s*[▲▼]$/, '');
        th.setAttribute('data-label', base);
        th.textContent = base + arrow;
        /** @type {HTMLElement} */ (th).style.color = isActive ? 'var(--fg, #f5f5f7)' : 'var(--accent, #089981)';
    });
}

function escapeHtml(/** @type {string} */ s) {
    return String(s).replace(/[&<>]/g, (c) => /** @type {Record<string,string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}
function escapeAttr(/** @type {string} */ s) {
    return String(s).replace(/[&"<>]/g, (c) => /** @type {Record<string,string>} */ ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]);
}

// ── Phase 2a: HTTP refresh ─────────────────────────────────────────────

async function refreshLive() {
    if (!_panel) return;
    if (_ctrl) _ctrl.abort();
    _ctrl = new AbortController();
    const symbols = loadSymbols();
    if (!symbols.length) {
        setStatus('No symbols to refresh');
        return;
    }
    const key = lsGet('ps_finnhub_key', '');
    if (!key) {
        setStatus('Finnhub API key missing — set ps_finnhub_key via monolith Settings');
        return;
    }
    const btn = /** @type {HTMLButtonElement | null} */ (_panel.querySelector('#wl-refresh-live'));
    if (btn) { btn.setAttribute('disabled', 'true'); btn.textContent = 'Refreshing…'; }
    setStatus(`Fetching ${symbols.length} quote(s)…`);
    const cache = loadCache();
    const t0 = performance.now();
    let ok = 0, fail = 0;
    await Promise.all(symbols.map((sym) =>
        fetchQuote(sym, key, /** @type {AbortSignal} */ ((_ctrl && _ctrl.signal)))
            .then((entry) => {
                cache[sym] = { ...(cache[sym] || {}), ...entry };
                ok++;
            })
            .catch((/** @type {any} */ e) => {
                if (e && e.name !== 'AbortError') { fail++; console.warn('[wl]', sym, e && e.message); }
            })
    ));
    persistCache(cache);
    if (btn) { btn.removeAttribute('disabled'); btn.textContent = 'Refresh live'; }
    const dt = ((performance.now() - t0) / 1000).toFixed(1);
    repaint();
    setStatus(`Refreshed ${ok}/${symbols.length} quote(s) in ${dt}s${fail ? ` · ${fail} failed` : ''} · ${new Date().toLocaleTimeString()}`);
    bus.emit('watchlist:refreshed', { ok, fail });
}

function setStatus(/** @type {string} */ s) {
    if (!_panel) return;
    const el = _panel.querySelector('#wl-status');
    if (el) el.textContent = s;
}

// ── Auto-refresh ───────────────────────────────────────────────────────

function startAuto() {
    stopAuto();
    if (typeof document !== 'undefined' && document.hidden) {
        // Don't burn API calls while tab is hidden; resume on visibility change
        return;
    }
    _autoTimer = /** @type {any} */ (setInterval(() => {
        // If user navigates away from the tab, pause until they come back
        if (typeof document !== 'undefined' && document.hidden) return;
        refreshLive();
    }, AUTO_INTERVAL_MS));
}

function stopAuto() {
    if (_autoTimer) clearInterval(_autoTimer);
    _autoTimer = 0;
}

function isAutoOn() {
    return lsGet(AUTO_LS_KEY, '') === '1';
}

function setAuto(/** @type {boolean} */ on) {
    lsSave(AUTO_LS_KEY, on ? '1' : '0');
    if (on) {
        // First refresh fires immediately so user sees data without waiting 30s
        refreshLive();
        startAuto();
    } else {
        stopAuto();
    }
}

// ── WebSocket pipeline ─────────────────────────────────────────────────

function isWsOn() {
    return lsGet(WS_LS_KEY, '') === '1';
}

/** @param {boolean} on */
function setWs(on) {
    lsSave(WS_LS_KEY, on ? '1' : '0');
    if (on) startWs();
    else stopWs();
}

function paintWsIndicator(/** @type {'on' | 'off' | 'connecting' | 'error'} */ state) {
    if (!_panel) return;
    const ind = /** @type {HTMLElement | null} */ (_panel.querySelector('#wl-ws-indicator'));
    const dot = /** @type {HTMLElement | null} */ (_panel.querySelector('#wl-ws-dot'));
    const cnt = /** @type {HTMLElement | null} */ (_panel.querySelector('#wl-ws-tickcount'));
    if (ind) ind.style.display = state === 'off' ? 'none' : 'inline-flex';
    if (dot) {
        const colors = { on: 'var(--accent, #089981)', connecting: '#f59e0b', error: 'var(--wl-dn, #ef4444)', off: 'var(--dim, #888)' };
        dot.style.background = colors[state];
        dot.style.boxShadow = state === 'on' ? '0 0 6px var(--accent, #089981)' : 'none';
    }
    if (cnt) cnt.textContent = String(_wsTickCount);
}

function startWs() {
    if (_ws) return;
    if (typeof document !== 'undefined' && document.hidden) return; // resume on visibility
    const key = lsGet('ps_finnhub_key', '');
    if (!key) {
        setStatus('WS skipped — Finnhub key missing (set in Settings)');
        paintWsIndicator('error');
        return;
    }
    paintWsIndicator('connecting');
    setStatus('WS · connecting to Finnhub…');
    let ws;
    try { ws = new WebSocket(`wss://ws.finnhub.io?token=${encodeURIComponent(key)}`); }
    catch (e) {
        setStatus(`WS failed: ${(e && /** @type {any} */ (e).message) || e}`);
        paintWsIndicator('error');
        return;
    }
    _ws = ws;
    _wsTickCount = 0;
    ws.onopen = () => {
        if (_ws !== ws) return;
        const symbols = loadSymbols();
        for (const sym of symbols) {
            try { ws.send(JSON.stringify({ type: 'subscribe', symbol: sym })); } catch (e) { /* swallow */ }
        }
        _wsSubscribed = symbols.slice();
        paintWsIndicator('on');
        setStatus(`WS · subscribed to ${symbols.length} symbol(s)`);
        startWsPersist();
    };
    ws.onmessage = (ev) => {
        if (_ws !== ws) return;
        let msg;
        try { msg = JSON.parse(ev.data); } catch (e) { return; }
        if (!msg || msg.type !== 'trade' || !Array.isArray(msg.data)) return;
        for (const trade of msg.data) {
            if (!trade || !trade.s || typeof trade.p !== 'number') continue;
            // Last-write-wins per symbol per frame
            _pendingTicks.set(trade.s, trade.p);
        }
        if (!_wsRaf) _wsRaf = requestAnimationFrame(flushTicks);
    };
    ws.onerror = () => {
        if (_ws !== ws) return;
        paintWsIndicator('error');
    };
    ws.onclose = () => {
        if (_ws !== ws) return;
        _ws = null;
        _wsSubscribed = [];
        stopWsPersist();
        paintWsIndicator('off');
        // Auto-reconnect if user still has WS toggle on AND tab is visible
        if (isWsOn() && (typeof document === 'undefined' || !document.hidden)) {
            if (_wsReconnectTimer) clearTimeout(_wsReconnectTimer);
            _wsReconnectTimer = /** @type {any} */ (setTimeout(() => { _wsReconnectTimer = 0; startWs(); }, 4000));
        }
    };
}

function stopWs() {
    if (_wsReconnectTimer) { clearTimeout(_wsReconnectTimer); _wsReconnectTimer = 0; }
    stopWsPersist();
    if (_wsRaf) { cancelAnimationFrame(_wsRaf); _wsRaf = 0; }
    _pendingTicks.clear();
    if (_liveCache) {
        // Final flush to localStorage before dropping the live ref
        persistCache(_liveCache);
        _liveCache = null;
    }
    if (_ws) {
        const ws = _ws;
        _ws = null;
        try {
            for (const sym of _wsSubscribed) {
                try { ws.send(JSON.stringify({ type: 'unsubscribe', symbol: sym })); } catch (e) { /* swallow */ }
            }
            ws.close();
        } catch (e) { /* swallow */ }
        _wsSubscribed = [];
    }
    paintWsIndicator('off');
}

function flushTicks() {
    _wsRaf = 0;
    if (!_panel || !_pendingTicks.size) return;
    const cache = ensureLiveCache();
    let touched = 0;
    for (const [sym, price] of _pendingTicks) {
        const c = cache[sym] || (cache[sym] = {});
        const prev = (typeof c.pc === 'number') ? c.pc : ((typeof c.c === 'number') ? c.c : null);
        c.c = price;
        if (typeof c.pc === 'number') {
            c.d = price - c.pc;
            c.dp = c.pc !== 0 ? ((price - c.pc) / c.pc) * 100 : 0;
        }
        if (typeof c.h !== 'number' || price > c.h) c.h = price;
        if (typeof c.l !== 'number' || price < c.l) c.l = price;
        // Hot-path partial DOM update — surgical update without rebuilding rows.
        // Skips if row is off-DOM (filter active or wasn't rendered).
        const row = /** @type {HTMLElement | null} */ (_panel.querySelector(`tr[data-sym="${cssEscapeAttr(sym)}"]`));
        if (row) {
            const cells = row.children;
            // Cell index: 0 sym | 1 name | 2 last | 3 d | 4 dp | 5 trend | 6 vol
            if (cells[2]) cells[2].textContent = _PRICE_FMT.format(price);
            if (typeof c.d === 'number') {
                const sign = c.d >= 0;
                const color = sign ? 'var(--wl-up, #10b981)' : 'var(--wl-dn, #ef4444)';
                if (cells[3]) {
                    cells[3].textContent = _DELTA_FMT.format(c.d);
                    /** @type {HTMLElement} */ (cells[3]).style.color = color;
                }
                if (cells[4] && typeof c.dp === 'number') {
                    cells[4].textContent = _DELTA_FMT.format(c.dp) + '%';
                    /** @type {HTMLElement} */ (cells[4]).style.color = color;
                }
            }
        }
        touched++;
        // If focus card is showing this symbol, refresh it too (cheap re-render)
        if (sym === _focusSym) renderFocusCard();
    }
    _pendingTicks.clear();
    _wsTickCount += touched;
    paintWsIndicator('on');
    // NOTE: cache write happens on a slow timer (startWsPersist), not every frame
}

function startWsPersist() {
    if (_wsPersistTimer) return;
    _wsPersistTimer = /** @type {any} */ (setInterval(() => {
        if (_liveCache) persistCache(_liveCache);
    }, WS_PERSIST_INTERVAL_MS));
}

function stopWsPersist() {
    if (_wsPersistTimer) { clearInterval(_wsPersistTimer); _wsPersistTimer = 0; }
}

function cssEscapeAttr(/** @type {string} */ s) {
    return String(s).replace(/(["\\])/g, '\\$1');
}

// ── Lifecycle ──────────────────────────────────────────────────────────

export function init(/** @type {HTMLElement} */ rootEl) {
    _panel = rootEl;
    loadSortPref();
    renderPanel(rootEl);
    repaint();
    const autoBox = /** @type {HTMLInputElement | null} */ (rootEl.querySelector('#wl-auto'));
    if (autoBox) autoBox.checked = isAutoOn();
    const wsBox = /** @type {HTMLInputElement | null} */ (rootEl.querySelector('#wl-ws'));
    if (wsBox) wsBox.checked = isWsOn();
    rootEl.addEventListener('click', (/** @type {Event} */ e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (!t) return;
        if (t.id === 'wl-reload')       { repaint(); return; }
        if (t.id === 'wl-refresh-live') { refreshLive(); return; }
        const sortHeader = t.closest('th[data-sort]');
        if (sortHeader) {
            const f = sortHeader.getAttribute('data-sort');
            if (f) applySort(/** @type {SortField} */ (f));
            return;
        }
        if (t.id === 'wl-focus-close') {
            _focusSym = '';
            renderFocusCard();
            paintFocusActive();
            return;
        }
        const row = t.closest && t.closest('.wl-row');
        if (row) {
            const sym = row.getAttribute('data-sym') || '';
            _focusSym = (_focusSym === sym) ? '' : sym;
            renderFocusCard();
            paintFocusActive();
            return;
        }
    });
    rootEl.addEventListener('change', (/** @type {Event} */ e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        if (t && t.id === 'wl-auto') setAuto(t.checked);
        if (t && t.id === 'wl-ws')   setWs(t.checked);
    });
    rootEl.addEventListener('input', (/** @type {Event} */ e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        if (t && t.id === 'wl-filter') {
            _filter = t.value;
            repaint();
        }
    });
    // Resume / pause on tab visibility — keeps API rate sane when hidden
    const onVis = () => {
        if (isAutoOn()) {
            if (document.hidden) stopAuto();
            else startAuto();
        }
        if (isWsOn()) {
            if (document.hidden) stopWs();
            else startWs();
        }
    };
    document.addEventListener('visibilitychange', onVis);
    const onKey = (/** @type {KeyboardEvent} */ e) => {
        if (e.key === 'Escape' && _focusSym) {
            _focusSym = '';
            renderFocusCard();
            paintFocusActive();
        }
    };
    document.addEventListener('keydown', onKey);
    _visOff = () => {
        document.removeEventListener('visibilitychange', onVis);
        document.removeEventListener('keydown', onKey);
    };
    if (isAutoOn()) startAuto();
    if (isWsOn()) startWs();
    bus.emit('tab:watchlist:init', { rootEl });
    return { id: 'watchlist', version: '0.3-step6-watchlist-2a-auto', ready: true, kind: 'tab' };
}

export function destroy() {
    if (_ctrl) { try { _ctrl.abort(); } catch (e) { /* swallow */ } }
    _ctrl = null;
    stopAuto();
    stopWs();
    if (_visOff) { try { _visOff(); } catch (e) { /* swallow */ } }
    _visOff = null;
    _focusSym = '';
    _filter = '';
    _panel = null;
    bus.emit('tab:watchlist:destroy');
}
