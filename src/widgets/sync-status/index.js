// Sync status widget — Gist sync indicator dot + click-to-pull.
//
// Listens on bus for: gist:syncing / gist:pulled / gist:pushed / gist:error.
// State machine:
//   idle  — green dot, last sync ok (or no sync yet)
//   sync  — yellow dot, pull/push in flight
//   error — red dot, last attempt failed (auto-clears on next success)
//
// Click → force pull (ignores throttle / debounce). No-op if no token set.

import { bus } from '../../core/bus.js';
import { lsGet } from '../../core/storage.js';
import { pullFromGist } from '../../core/gist.js';

/** @typedef {'idle' | 'sync' | 'error'} SyncStateName */

const COLORS = {
    idle:  '#10b981', // green
    sync:  '#f59e0b', // amber
    error: '#ef4444', // red
};

/** @typedef {{ destroy: () => void, getState: () => SyncStateName }} SyncWidgetHandle */

/**
 * Mount the SYNC indicator button into host.
 * @param {HTMLElement} host
 * @returns {SyncWidgetHandle}
 */
export function mount(host) {
    /** @type {SyncStateName} */
    let state = 'idle';
    /** @type {string} */
    let lastError = '';

    const btn = document.createElement('button');
    btn.id = 'nav-sync';
    btn.title = 'Sync from Gist (click to pull)';
    btn.style.cssText = 'background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:6px 10px;border-radius:6px;cursor:pointer;font-size:11px;line-height:1;display:inline-flex;align-items:center;gap:6px;font-family:var(--mono, monospace);font-weight:700;letter-spacing:0.06em;text-transform:uppercase;';

    const dot = document.createElement('span');
    dot.style.cssText = 'width:8px;height:8px;border-radius:50%;display:inline-block;transition:background .15s;';
    const label = document.createElement('span');
    label.textContent = 'SYNC';
    btn.appendChild(dot);
    btn.appendChild(label);

    function paint() {
        dot.style.background = COLORS[state];
        btn.style.opacity = state === 'sync' ? '0.7' : '1';
        if (state === 'error' && lastError) btn.title = 'Last sync failed: ' + lastError + ' — click to retry';
        else if (state === 'sync') btn.title = 'Syncing…';
        else btn.title = 'Sync from Gist (click to pull)';
    }
    paint();

    const onSyncing = () => { state = 'sync'; paint(); };
    const onPulled  = () => { state = 'idle'; lastError = ''; paint(); };
    const onPushed  = () => { state = 'idle'; lastError = ''; paint(); };
    const onError   = (/** @type {any} */ d) => {
        state = 'error';
        lastError = (d && d.error) || 'unknown';
        paint();
    };

    const offSyncing = bus.on('gist:syncing', onSyncing);
    const offPulled  = bus.on('gist:pulled',  onPulled);
    const offPushed  = bus.on('gist:pushed',  onPushed);
    const offError   = bus.on('gist:error',   onError);

    function click() {
        const token = lsGet('ps_gist_token', '');
        if (!token) {
            lastError = 'no Gist token set';
            state = 'error';
            paint();
            return;
        }
        if (state === 'sync') return; // already in flight
        pullFromGist(/** @type {string} */ (token)).catch(() => {/* gist:error already emitted */});
    }
    btn.addEventListener('click', click);

    host.appendChild(btn);

    return {
        destroy() {
            btn.removeEventListener('click', click);
            offSyncing && offSyncing();
            offPulled  && offPulled();
            offPushed  && offPushed();
            offError   && offError();
            if (btn.parentNode) btn.parentNode.removeChild(btn);
        },
        getState() { return state; },
    };
}
