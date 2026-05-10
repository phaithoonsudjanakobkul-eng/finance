// News tab — aggregated news from watchlist symbols. Skeleton port (Step 6
// Session 1). Heavy logic — Yahoo + Finnhub fan-out, dedupe, live polling,
// modal reader — comes in a dedicated sub-session.

import { bus } from '../../core/bus.js';

let _panel = null;

function renderPanel(/** @type {HTMLElement} */ rootEl) {
    rootEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px;padding:16px;">
            <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;">News</span>
                <span style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);">tab/news · skeleton</span>
            </div>
            <div style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;">
                <div class="dash-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:8px;">Status</div>
                <div style="font-size:12px;color:var(--dim, #888);">News aggregator port pending — multi-source fan-out + dedupe + live polling.</div>
            </div>
        </div>
    `;
}

export function init(/** @type {HTMLElement} */ rootEl) {
    _panel = rootEl;
    renderPanel(rootEl);
    bus.emit('tab:news:init', { rootEl });
    return { id: 'news', version: '0.1-step6-skeleton', ready: true, kind: 'tab' };
}

export function destroy() {
    _panel = null;
    bus.emit('tab:news:destroy');
}
