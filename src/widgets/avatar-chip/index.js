// Avatar chip — 32px circle in nav with current avatar.
//
// Phase V2 click handler: navigates to Settings tab (profile edit modal
// port is deferred to §4 in MIGRATION-VISUAL-PHASE.md). Once §4 lands,
// swap the click target to open the modal instead.
//
// Avatar source: ps_avatar (base64 thumbnail, <50 KB). Reacts to
// gist:pulled so pulling on a fresh device refreshes the chip without a
// page reload.

import { bus } from '../../core/bus.js';
import { lsGet } from '../../core/storage.js';

/** @typedef {{ destroy: () => void }} AvatarChipHandle */

function pickInitial() {
    try {
        const raw = localStorage.getItem('ps_profile');
        if (raw) {
            const p = JSON.parse(raw);
            const name = (p && (p.displayName || p.name || p.fullName)) || '';
            if (name && name[0]) return name[0].toUpperCase();
        }
    } catch (e) { /* swallow */ }
    return 'P';
}

/**
 * @param {HTMLElement} host
 * @returns {AvatarChipHandle}
 */
export function mount(host) {
    const btn = document.createElement('button');
    btn.id = 'nav-avatar';
    btn.title = 'Profile — opens Settings (edit modal coming in V4)';
    btn.style.cssText = 'width:32px;height:32px;border-radius:50%;border:1px solid var(--border, #2a2a2a);background:var(--card, #1a1a1a);cursor:pointer;display:inline-flex;align-items:center;justify-content:center;font-family:var(--font-display, var(--mono, monospace));font-size:13px;font-weight:700;color:var(--accent, #089981);overflow:hidden;padding:0;flex-shrink:0;';

    function paint() {
        const avatar = lsGet('ps_avatar', '');
        if (avatar && avatar.length > 64) {
            btn.textContent = '';
            btn.style.background = `center/cover url("${avatar}")`;
        } else {
            btn.textContent = pickInitial();
            btn.style.background = 'var(--card, #1a1a1a)';
        }
    }
    paint();

    function click() {
        // V2: just go to Settings. V4 will replace with modal open.
        const showTab = /** @type {any} */ (window).__psShowTab;
        const mount = document.getElementById('tab-mount');
        if (showTab && mount) {
            showTab('settings', mount).catch(() => {/* swallow */});
            try {
                const next = '#tab=settings';
                if (location.hash !== next) history.replaceState(null, '', location.pathname + location.search + next);
            } catch (e) { /* swallow */ }
            // also update pill active state
            document.querySelectorAll('button[data-tab]').forEach((b) => {
                b.classList.toggle('is-active', /** @type {HTMLElement} */ (b).dataset.tab === 'settings');
            });
        }
    }
    btn.addEventListener('click', click);

    const offPulled = bus.on('gist:pulled', paint);

    host.appendChild(btn);

    return {
        destroy() {
            btn.removeEventListener('click', click);
            offPulled && offPulled();
            if (btn.parentNode) btn.parentNode.removeChild(btn);
        },
    };
}
