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

/** @type {HTMLElement | null} */
let _panel = null;
/** @type {AbortController | null} */
let _ctrl = null;

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
                <button id="wl-reload" style="margin-left:auto;background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;">Reload cache</button>
                <button id="wl-refresh-live" style="background:var(--accent, #089981);color:#000;border:0;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">Refresh live</button>
            </div>
            <div style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;overflow:hidden;">
                <div id="wl-table-wrap" style="overflow:auto;max-height:60vh;">
                    <table id="watchlist-table" style="width:100%;border-collapse:collapse;font-family:'Inter','IBM Plex Sans Thai',system-ui,sans-serif;font-size:13px;font-variant-numeric:tabular-nums;">
                        <thead>
                            <tr style="background:var(--bg, #0d0d0d);position:sticky;top:0;">
                                <th style="text-align:left;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;">Symbol</th>
                                <th style="text-align:left;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;">Name</th>
                                <th style="text-align:right;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;">Last</th>
                                <th style="text-align:right;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;">Δ $</th>
                                <th style="text-align:right;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;">Δ %</th>
                                <th style="text-align:right;padding:10px 12px;font-size:10px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;">Vol</th>
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
        tbody.innerHTML = `<tr><td colspan="6" style="padding:18px;text-align:center;color:var(--dim, #888);">No symbols in <code>ps_watchlist</code>. Add via the monolith Watchlist tab to populate.</td></tr>`;
        if (status) status.textContent = '0 symbols · empty watchlist';
        return;
    }
    const rows = symbols.map((sym) => {
        const c = cache[sym] || {};
        const last = (typeof c.c === 'number') ? _PRICE_FMT.format(c.c) : '—';
        const dRaw = (typeof c.d === 'number') ? c.d : null;
        const dpRaw = (typeof c.dp === 'number') ? c.dp : null;
        const d = (dRaw !== null) ? _DELTA_FMT.format(dRaw) : '—';
        const dp = (dpRaw !== null) ? _DELTA_FMT.format(dpRaw) + '%' : '—';
        const dColor = dRaw !== null ? (dRaw >= 0 ? 'var(--wl-up, #10b981)' : 'var(--wl-dn, #ef4444)') : 'var(--dim, #888)';
        const vol = (typeof c.v === 'number') ? _VOL_FMT.format(c.v) : '—';
        const name = c.name ? escapeHtml(String(c.name)) : '';
        return `<tr class="wl-row" data-sym="${escapeAttr(sym)}" style="border-top:1px solid var(--border, #2a2a2a);">
            <td style="padding:10px 12px;font-family:var(--mono, monospace);font-weight:700;letter-spacing:0.02em;">${escapeHtml(sym)}</td>
            <td style="padding:10px 12px;color:var(--dim, #888);max-width:280px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name || '—'}</td>
            <td style="padding:10px 12px;text-align:right;font-family:var(--mono, monospace);">${last}</td>
            <td style="padding:10px 12px;text-align:right;font-family:var(--mono, monospace);color:${dColor};">${d}</td>
            <td style="padding:10px 12px;text-align:right;font-family:var(--mono, monospace);color:${dColor};">${dp}</td>
            <td style="padding:10px 12px;text-align:right;font-family:var(--mono, monospace);color:var(--dim, #888);">${vol}</td>
        </tr>`;
    }).join('');
    tbody.innerHTML = rows;
    const cached = symbols.filter((s) => cache[s] && typeof cache[s].c === 'number').length;
    if (status) status.textContent = `${symbols.length} symbol(s) · ${cached} with cached price · NO real-time updates (read-only port)`;
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

// ── Lifecycle ──────────────────────────────────────────────────────────

export function init(/** @type {HTMLElement} */ rootEl) {
    _panel = rootEl;
    renderPanel(rootEl);
    repaint();
    rootEl.addEventListener('click', (/** @type {Event} */ e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (!t) return;
        if (t.id === 'wl-reload')       { repaint(); return; }
        if (t.id === 'wl-refresh-live') { refreshLive(); return; }
    });
    bus.emit('tab:watchlist:init', { rootEl });
    return { id: 'watchlist', version: '0.2-step6-watchlist-readonly', ready: true, kind: 'tab' };
}

export function destroy() {
    if (_ctrl) { try { _ctrl.abort(); } catch (e) { /* swallow */ } }
    _ctrl = null;
    _panel = null;
    bus.emit('tab:watchlist:destroy');
}
