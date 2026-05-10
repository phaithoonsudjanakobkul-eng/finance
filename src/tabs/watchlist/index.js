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
const SORT_LS_KEY = 'ps_v2_wl_sort';

/** @typedef {'sym' | 'name' | 'c' | 'd' | 'dp' | 'v'} SortField */

/** @type {{ field: SortField, dir: 'asc' | 'desc' }} */
let _sort = { field: 'sym', dir: 'asc' };
/** @type {string} */
let _filter = '';

/** @type {HTMLElement | null} */
let _panel = null;
/** @type {AbortController | null} */
let _ctrl = null;
/** @type {number} */
let _autoTimer = 0;
/** @type {(() => void) | null} */
let _visOff = null;

// ── Reads ──────────────────────────────────────────────────────────────

/** @returns {string[]} */
function loadSymbols() {
    const raw = /** @type {any} */ (lsGetJson('ps_watchlist', []));
    if (!Array.isArray(raw)) return [];
    return raw.filter((/** @type {any} */ s) => typeof s === 'string' && s.length);
}

/** @returns {Record<string, WlCacheEntry>} */
function loadCache() {
    const raw = /** @type {any} */ (lsGetJson('ps_wl_cache', {}));
    return (raw && typeof raw === 'object') ? raw : {};
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
                <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);cursor:pointer;user-select:none;">
                    <input id="wl-auto" type="checkbox" style="cursor:pointer;accent-color:var(--accent, #089981);">
                    auto 30s
                </label>
                <button id="wl-reload" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;">Reload cache</button>
                <button id="wl-refresh-live" style="background:var(--accent, #089981);color:#000;border:0;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">Refresh live</button>
            </div>
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
    const cached = symbols.filter((s) => cache[s] && typeof cache[s].c === 'number').length;
    const shown = filtered.length;
    const filterPart = q ? ` · filter "${q}" (${shown}/${symbols.length})` : '';
    if (status) status.textContent = `${shown} symbol(s) shown · ${cached} cached · sort ${_sort.field} ${_sort.dir}${filterPart}`;
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

// ── Lifecycle ──────────────────────────────────────────────────────────

export function init(/** @type {HTMLElement} */ rootEl) {
    _panel = rootEl;
    loadSortPref();
    renderPanel(rootEl);
    repaint();
    const autoBox = /** @type {HTMLInputElement | null} */ (rootEl.querySelector('#wl-auto'));
    if (autoBox) autoBox.checked = isAutoOn();
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
    });
    rootEl.addEventListener('change', (/** @type {Event} */ e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        if (t && t.id === 'wl-auto') setAuto(t.checked);
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
        if (!isAutoOn()) return;
        if (document.hidden) stopAuto();
        else startAuto();
    };
    document.addEventListener('visibilitychange', onVis);
    _visOff = () => document.removeEventListener('visibilitychange', onVis);
    if (isAutoOn()) startAuto();
    bus.emit('tab:watchlist:init', { rootEl });
    return { id: 'watchlist', version: '0.3-step6-watchlist-2a-auto', ready: true, kind: 'tab' };
}

export function destroy() {
    if (_ctrl) { try { _ctrl.abort(); } catch (e) { /* swallow */ } }
    _ctrl = null;
    stopAuto();
    if (_visOff) { try { _visOff(); } catch (e) { /* swallow */ } }
    _visOff = null;
    _panel = null;
    bus.emit('tab:watchlist:destroy');
}
