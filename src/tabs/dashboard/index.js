// Dashboard tab — profile card, LOW alerts, pinned watchlist, Muse playlist,
// financial charts. Skeleton port (Step 6 Session 1). Heavy logic — pinned
// renderer, profile card, Muse state machine, Chart.js builders — comes in
// dedicated sub-sessions per the same pattern as utility modules (3k+).
//
// Contract matches src/modules/<prefix>/index.js: init(rootEl, ctx) → state
// object · destroy() · bus emits.

import { bus } from '../../core/bus.js';
import { lsGetJson } from '../../core/storage.js';

let _panel = null;

function renderPanel(/** @type {HTMLElement} */ rootEl) {
    rootEl.innerHTML = `
        <div style="display:flex;flex-direction:column;gap:12px;padding:16px;">
            <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;">Dashboard</span>
                <span style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);">tab/dashboard · skeleton</span>
            </div>
            <div style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:8px;">Profile</div>
                <div id="dash-profile-name" style="font-family:var(--font-display, var(--mono, monospace));font-size:20px;font-weight:700;letter-spacing:-0.02em;">—</div>
                <div id="dash-profile-status" style="font-size:12px;color:var(--dim, #888);margin-top:4px;">No data restored</div>
            </div>
            <div style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;">
                <div class="sec-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:8px;">Pinned watchlist</div>
                <div id="dash-pinned-list" style="font-size:13px;color:var(--dim, #888);font-family:var(--mono, monospace);">Pinned port — Step 6 sub-session</div>
            </div>
            <div style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;">
                <div class="dash-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:8px;">Muse playlist</div>
                <div style="font-size:13px;color:var(--dim, #888);">Port pending — see project_muse_pan_zoom + project_pslink_cinematic</div>
            </div>
        </div>
    `;
    const nameEl = rootEl.querySelector('#dash-profile-name');
    const statusEl = rootEl.querySelector('#dash-profile-status');
    const profile = /** @type {any} */ (lsGetJson('ps_profile', null));
    if (profile && nameEl && statusEl) {
        const name = profile.displayName || profile.name;
        if (name) {
            nameEl.textContent = String(name);
            statusEl.textContent = 'Restored from localStorage';
        }
    }
}

export function init(/** @type {HTMLElement} */ rootEl) {
    _panel = rootEl;
    renderPanel(rootEl);
    bus.emit('tab:dashboard:init', { rootEl });
    return { id: 'dashboard', version: '0.1-step6-skeleton', ready: true, kind: 'tab' };
}

export function destroy() {
    _panel = null;
    bus.emit('tab:dashboard:destroy');
}
