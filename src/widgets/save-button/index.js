// Save button widget — pending-push indicator + click-to-force-push.
//
// auto-push in main.js debounces by 5s. This widget mirrors that pending
// state so the user can see "edits queued" and force a push immediately
// (skip the wait) by clicking. After gist:pushed it goes back to idle.
//
// Listens to the same edit bus events main.js auto-push subscribes to,
// plus gist:pushed / gist:error to clear / mark error.

import { bus } from '../../core/bus.js';
import { lsGet } from '../../core/storage.js';
import { pushToGist } from '../../core/gist.js';

/** @typedef {'idle' | 'pending' | 'pushing' | 'error'} SaveStateName */

/** @typedef {{ destroy: () => void, getState: () => SaveStateName }} SaveWidgetHandle */

/**
 * Mount the SAVE button into host.
 * @param {HTMLElement} host
 * @returns {SaveWidgetHandle}
 */
export function mount(host) {
    /** @type {SaveStateName} */
    let state = 'idle';

    const btn = document.createElement('button');
    btn.id = 'nav-save';
    btn.title = 'Push edits to Gist now';
    btn.style.cssText = 'background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--dim, #888);padding:6px 10px;border-radius:6px;cursor:pointer;font-size:11px;line-height:1;font-family:var(--mono, monospace);font-weight:700;letter-spacing:0.06em;text-transform:uppercase;transition:color .15s, background .15s, border-color .15s;';
    btn.textContent = 'SAVE';

    function paint() {
        if (state === 'pending') {
            btn.style.color = '#000';
            btn.style.background = 'var(--accent, #089981)';
            btn.style.borderColor = 'var(--accent, #089981)';
            btn.title = 'Pending edits — click to push now';
        } else if (state === 'pushing') {
            btn.style.color = 'var(--dim, #888)';
            btn.style.background = 'var(--card, #1a1a1a)';
            btn.style.borderColor = 'var(--border, #2a2a2a)';
            btn.style.opacity = '0.65';
            btn.title = 'Pushing…';
        } else if (state === 'error') {
            btn.style.color = '#fff';
            btn.style.background = '#ef4444';
            btn.style.borderColor = '#ef4444';
            btn.title = 'Push failed — click to retry';
            btn.style.opacity = '1';
        } else {
            btn.style.color = 'var(--dim, #888)';
            btn.style.background = 'var(--card, #1a1a1a)';
            btn.style.borderColor = 'var(--border, #2a2a2a)';
            btn.style.opacity = '1';
            btn.title = 'Push edits to Gist now';
        }
    }
    paint();

    const onDirty = () => {
        // Only flip to pending if we're idle or coming back from error
        if (state === 'idle' || state === 'error') {
            state = 'pending';
            paint();
        }
    };
    const onSyncing = (/** @type {any} */ d) => {
        if (d && d.dir === 'push') {
            state = 'pushing';
            paint();
        }
    };
    const onPushed = () => {
        state = 'idle';
        paint();
    };
    const onError = (/** @type {any} */ d) => {
        if (d && d.dir === 'push') {
            state = 'error';
            paint();
        }
    };

    // Same edit events main.js auto-push listens to. Keep in sync if that list grows.
    const offSaved    = bus.on('records:saved',     onDirty);
    const offWlAdd    = bus.on('watchlist:added',   onDirty);
    const offWlRm     = bus.on('watchlist:removed', onDirty);
    const offWlPin    = bus.on('watchlist:pinned',  onDirty);
    const offSettings = bus.on('settings:changed',  onDirty);
    const offSyncing  = bus.on('gist:syncing',      onSyncing);
    const offPushed   = bus.on('gist:pushed',       onPushed);
    const offError    = bus.on('gist:error',        onError);

    function click() {
        const token = lsGet('ps_gist_token', '');
        if (!token) {
            state = 'error';
            paint();
            btn.title = 'No Gist token set — open Settings to add one';
            return;
        }
        if (state === 'pushing') return;
        pushToGist(/** @type {string} */ (token)).catch(() => {/* gist:error emitted */});
    }
    btn.addEventListener('click', click);

    host.appendChild(btn);

    return {
        destroy() {
            btn.removeEventListener('click', click);
            offSaved    && offSaved();
            offWlAdd    && offWlAdd();
            offWlRm     && offWlRm();
            offWlPin    && offWlPin();
            offSettings && offSettings();
            offSyncing  && offSyncing();
            offPushed   && offPushed();
            offError    && offError();
            if (btn.parentNode) btn.parentNode.removeChild(btn);
        },
        getState() { return state; },
    };
}
