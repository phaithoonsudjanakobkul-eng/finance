// Records tab — monthly income/expense tracker. Skeleton port (Step 6 Session 1).
// Heavy logic — saveAndCalc, loadMonth, updateDashboard, financial-bar grid,
// month picker — comes in a dedicated sub-session.

import { bus } from '../../core/bus.js';
import { lsGetJson } from '../../core/storage.js';

let _panel = null;

function renderPanel(/** @type {HTMLElement} */ rootEl) {
    /** @type {any[]} */
    const records = lsGetJson('ps_records', []) || [];
    const count = Array.isArray(records) ? records.length : 0;
    const total = Array.isArray(records)
        ? records.reduce((/** @type {number} */ a, /** @type {any} */ r) => a + (Number(r && r.amount) || 0), 0)
        : 0;
    rootEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px;padding:16px;">
            <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;">Records</span>
                <span style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);">tab/records · skeleton</span>
            </div>
            <div style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;">
                <div class="dash-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:8px;">Restored</div>
                <div style="font-family:var(--font-data, var(--mono, monospace));font-size:13px;">${count} record(s) · sum ${total.toLocaleString()}</div>
                <div style="font-size:12px;color:var(--dim, #888);margin-top:6px;">Full month-picker + per-row entry UI ports in Step 6 sub-session</div>
            </div>
        </div>
    `;
}

export function init(/** @type {HTMLElement} */ rootEl) {
    _panel = rootEl;
    renderPanel(rootEl);
    bus.emit('tab:records:init', { rootEl });
    return { id: 'records', version: '0.1-step6-skeleton', ready: true, kind: 'tab' };
}

export function destroy() {
    _panel = null;
    bus.emit('tab:records:destroy');
}
