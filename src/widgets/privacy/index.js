// Privacy widget — eye-icon toggle that masks money amounts.
//
// Adds `.privacy-on` to <html> when active. CSS in src/styles/privacy.css
// applies `-webkit-text-security: disc` to scoped elements (Records +
// Dashboard amounts) so numbers render as bullet points. Watchlist prices
// stay visible (public info per CLAUDE.md).
//
// Persistence: ps_privacy localStorage. Pre-paint default for fresh device
// happens in src/index.html boot script (so first frame doesn't flash real
// numbers before this widget mounts).

import { lsGet, lsSave } from '../../core/storage.js';
import { bus } from '../../core/bus.js';

const LS_KEY = 'ps_privacy';

function isOn() {
    return lsGet(LS_KEY, '') === '1';
}

/** @param {boolean} on */
function apply(on) {
    if (typeof document === 'undefined') return;
    document.documentElement.classList.toggle('privacy-on', on);
}

/** @param {boolean} on */
function setState(on) {
    apply(on);
    lsSave(LS_KEY, on ? '1' : '0');
    bus.emit('privacy:changed', { on });
}

/**
 * Mount a button into the given host element. Returns destroy().
 * @param {HTMLElement} host
 */
export function mount(host) {
    const btn = document.createElement('button');
    btn.id = 'privacy-toggle';
    btn.title = 'Toggle privacy mode (mask money amounts)';
    btn.style.cssText = 'background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:6px 10px;border-radius:6px;cursor:pointer;font-size:14px;line-height:1;display:inline-flex;align-items:center;gap:4px;';
    function paint() {
        const on = isOn();
        btn.textContent = on ? '👁‍🗨 ON' : '👁 OFF';
        btn.style.color = on ? 'var(--accent, #089981)' : 'var(--fg, #f5f5f7)';
    }
    paint();
    const click = () => {
        const next = !isOn();
        setState(next);
        paint();
    };
    btn.addEventListener('click', click);
    host.appendChild(btn);
    apply(isOn());
    return () => {
        btn.removeEventListener('click', click);
        if (btn.parentNode) btn.parentNode.removeChild(btn);
    };
}

// Boot apply (so the class is set even before mount, in case main.js calls
// the widget after first paint)
if (typeof document !== 'undefined') apply(isOn());
