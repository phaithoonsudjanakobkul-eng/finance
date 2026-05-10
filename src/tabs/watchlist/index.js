// Watchlist tab — full stock table + market scanner + quick chart. Skeleton port
// (Step 6 Session 1). Heavy logic — WebSocket tick pipeline, rAF batching,
// IntersectionObserver culling, sparkline cache, Lightweight Charts side panel —
// comes in dedicated sub-sessions. The hot-path code already lives in monolith
// per CLAUDE.md "WebSocket tick pipeline" section; the port must preserve all
// 3 sparkline invariants + rAF coalesce + viewport culling Sets.

import { bus } from '../../core/bus.js';
import { lsGetJson } from '../../core/storage.js';

let _panel = null;

function renderPanel(/** @type {HTMLElement} */ rootEl) {
    /** @type {string[]} */
    const wl = lsGetJson('ps_watchlist', []) || [];
    const symbols = Array.isArray(wl) ? wl : [];
    const sample = symbols.slice(0, 10).join(', ');
    rootEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px;padding:16px;">
            <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;">Watchlist</span>
                <span style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);">tab/watchlist · skeleton</span>
            </div>
            <div style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;">
                <div class="dash-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:8px;">Symbols restored</div>
                <div style="font-family:var(--font-data, var(--mono, monospace));font-size:13px;">${symbols.length} · ${sample}${symbols.length > 10 ? '…' : ''}</div>
                <div style="font-size:12px;color:var(--dim, #888);margin-top:6px;">WS pipeline + sparkline cache + scanner port — multi-session</div>
            </div>
        </div>
    `;
}

export function init(/** @type {HTMLElement} */ rootEl) {
    _panel = rootEl;
    renderPanel(rootEl);
    bus.emit('tab:watchlist:init', { rootEl });
    return { id: 'watchlist', version: '0.1-step6-skeleton', ready: true, kind: 'tab' };
}

export function destroy() {
    _panel = null;
    bus.emit('tab:watchlist:destroy');
}
