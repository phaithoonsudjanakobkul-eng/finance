// Theme toggle widget — Slate (light) / Onyx (dark) toggle in nav.
//
// v2 shell defaults to dark; this widget gives the user a manual switch.
// Class `html.dark` drives Onyx theme + darkOnly preset routing (preset
// re-application happens via applyPreset).

import { bus } from '../../core/bus.js';
import { lsGet, lsSave } from '../../core/storage.js';
import { restoreActive } from '../../core/presets/index.js';

/** @typedef {{ destroy: () => void }} ThemeToggleHandle */

/**
 * @param {HTMLElement} host
 * @returns {ThemeToggleHandle}
 */
export function mount(host) {
    const btn = document.createElement('button');
    btn.id = 'nav-theme';
    btn.title = 'Toggle theme (Slate / Onyx)';
    btn.style.cssText = 'background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:6px 10px;border-radius:6px;cursor:pointer;font-size:14px;line-height:1;display:inline-flex;align-items:center;gap:4px;';

    function paint() {
        const isDark = document.documentElement.classList.contains('dark');
        btn.textContent = isDark ? '☾' : '☀';
        btn.title = isDark ? 'Onyx (dark) — click for Slate' : 'Slate (light) — click for Onyx';
    }
    paint();

    function click() {
        const root = document.documentElement;
        const next = !root.classList.contains('dark');
        root.classList.toggle('dark', next);
        lsSave('ps_dark', next ? '1' : '0');
        // Re-apply active preset so variant colors pick the right mode slot
        try { restoreActive(next); } catch (e) { /* swallow */ }
        bus.emit('theme:changed', { dark: next });
        // 'settings:changed' so auto-push picks it up
        bus.emit('settings:changed', { key: 'theme' });
        paint();
    }
    btn.addEventListener('click', click);

    host.appendChild(btn);

    // Initial restore: if ps_dark saved, sync class to it (defensive; main.js
    // also handles this on boot via gist:pulled re-apply)
    if (lsGet('ps_dark', '') === '1') {
        document.documentElement.classList.add('dark');
        paint();
    }

    return {
        destroy() {
            btn.removeEventListener('click', click);
            if (btn.parentNode) btn.parentNode.removeChild(btn);
        },
    };
}
