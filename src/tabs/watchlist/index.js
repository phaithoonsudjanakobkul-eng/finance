// Watchlist tab — read-only view of cached quote data.
//
// Phase 1 port (Step 6 sub-session): renders the symbols stored in
// `ps_watchlist` against the last-fetched quote data in `ps_wl_cache`. No
// WebSocket, no real-time updates, no sparkline, no scanner, no AI chat —
// those make up the heavy hot-path subsystem and need their own multi-session
// port.
//
// Field shape from monolith wlDataCache[sym]: c (last), pc (prev close),
// d (Δ$), dp (Δ%), o/h/l (OHLC), v (volume), name (display), logo, plus
// premarket / afterhours / 52w / fundamentals. We read tolerantly — any
// missing field renders a dash.
//
// DEFERRED to dedicated Watchlist sub-sessions:
// - WS pipeline (Alpaca + Finnhub) + rAF coalesce + viewport culling
// - Sparkline cache (ps_wl_spark_cache_v5) + 1D regular-session render
// - Market scanner (gainers/losers × regular/pre/AH)
// - Lightweight Charts side panel
// - News fetch per symbol + AI chat FAB
// - Sort by column / pin / unpin / drag-reorder

import { bus } from '../../core/bus.js';
import { lsGetJson } from '../../core/storage.js';

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

// ── Render ─────────────────────────────────────────────────────────────

function renderPanel(/** @type {HTMLElement} */ rootEl) {
    rootEl.innerHTML = `
        <div id="wl-root" style="display:flex;flex-direction:column;gap:12px;padding:16px;color:var(--fg, #f5f5f7);">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;">Watchlist</span>
                <span style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);">tab/watchlist · read-only</span>
                <button id="wl-refresh" style="margin-left:auto;background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;">Reload from cache</button>
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

// ── Lifecycle ──────────────────────────────────────────────────────────

export function init(/** @type {HTMLElement} */ rootEl) {
    _panel = rootEl;
    renderPanel(rootEl);
    repaint();
    rootEl.addEventListener('click', (/** @type {Event} */ e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (t && t.id === 'wl-refresh') repaint();
    });
    bus.emit('tab:watchlist:init', { rootEl });
    return { id: 'watchlist', version: '0.2-step6-watchlist-readonly', ready: true, kind: 'tab' };
}

export function destroy() {
    _panel = null;
    bus.emit('tab:watchlist:destroy');
}
