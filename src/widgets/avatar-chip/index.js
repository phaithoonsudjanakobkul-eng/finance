// Avatar chip — 32px circle in nav with current avatar.
//
// V4 click handler: opens the profile-edit modal (was: navigate to
// Settings until §4 landed). Modal lives in src/widgets/profile-edit.
//
// Avatar source: ps_avatar (base64 thumbnail, <50 KB). Reacts to:
//   - gist:pulled — fresh-device pull populated the thumbnail
//   - profile:avatar-changed — modal saved a new photo

import { bus } from '../../core/bus.js';
import { lsGet } from '../../core/storage.js';
import { open as openProfileEdit } from '../profile-edit/index.js';

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
    btn.title = 'Edit profile photo';
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
        openProfileEdit();
    }
    btn.addEventListener('click', click);

    const offPulled  = bus.on('gist:pulled',             paint);
    const offChanged = bus.on('profile:avatar-changed',  paint);

    host.appendChild(btn);

    return {
        destroy() {
            btn.removeEventListener('click', click);
            offPulled  && offPulled();
            offChanged && offChanged();
            if (btn.parentNode) btn.parentNode.removeChild(btn);
        },
    };
}
