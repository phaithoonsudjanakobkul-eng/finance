// Floating clock widget — V12.
//
// Position:fixed clock visible on every tab. Drag to position; right-
// click for context menu (color / font / show date / reset). Edge-hold
// gesture stows into a corner FAB (no on-screen stow zone — rejected
// per project memory). The nav clock stays as a smaller secondary
// indicator (untouched).
//
// Persistence (per-theme so dark/light can have distinct positions):
//   ps_clock_pos_dark / ps_clock_pos_light  — JSON {x, y}
//   ps_clock_fab_pos_dark / _light          — JSON {x, y} (when stowed)
//   ps_clock_color_dark / _light            — hex color string
//   ps_clock_font                           — font family name
//   ps_clock_show_date                      — '1' or '0'
//   ps_clock_vis                            — '1' = visible, '0' = hidden
//   ps_clock_stowed                         — '1' if currently stowed
//
// Migration: a one-time read of legacy ps_clock_color (single global)
// seeds both _dark and _light keys.

import { bus } from '../../core/bus.js';
import { lsGet, lsSave } from '../../core/storage.js';
import { clampToViewport, edgeDistance, shouldStow, stowFabFor } from './position.js';

const STOW_HOLD_MS = 700;
const W = 160, H = 60;
const FAB = 44;

/** @returns {'dark' | 'light'} */
function theme() {
    return (typeof document !== 'undefined' && document.documentElement.classList.contains('dark')) ? 'dark' : 'light';
}

function key(/** @type {string} */ base) { return `${base}_${theme()}`; }

/** @returns {{ x: number, y: number }} */
function loadPos() {
    try {
        const raw = lsGet(key('ps_clock_pos'), '');
        const p = raw ? JSON.parse(/** @type {string} */ (raw)) : null;
        if (p && typeof p.x === 'number' && typeof p.y === 'number') return p;
    } catch (_) { /* swallow */ }
    return { x: 24, y: 24 };
}
function savePos(/** @type {{ x: number, y: number }} */ p) {
    try { lsSave(key('ps_clock_pos'), JSON.stringify(p)); } catch (_) { /* swallow */ }
}

function loadColor() {
    return lsGet(key('ps_clock_color'), '') || lsGet('ps_clock_color', '') || '';
}
function saveColor(/** @type {string} */ c) {
    lsSave(key('ps_clock_color'), c);
}

function loadFont()       { return lsGet('ps_clock_font', '') || 'var(--font-mono, monospace)'; }
function saveFont(/** @type {string} */ f) { lsSave('ps_clock_font', f); }
function showDate()       { return lsGet('ps_clock_show_date', '1') !== '0'; }
function saveShowDate(/** @type {boolean} */ b) { lsSave('ps_clock_show_date', b ? '1' : '0'); }
function isHidden()       { return lsGet('ps_clock_vis', '1') === '0'; }
function saveVis(/** @type {boolean} */ visible) { lsSave('ps_clock_vis', visible ? '1' : '0'); }
function isStowed()       { return lsGet('ps_clock_stowed', '0') === '1'; }
function saveStowed(/** @type {boolean} */ s) { lsSave('ps_clock_stowed', s ? '1' : '0'); }

/** @typedef {{ destroy: () => void }} ClockHandle */

/**
 * Mount the floating clock onto `document.body`. Idempotent — calling
 * twice is a no-op (the existing handle is returned). Returns destroy().
 * @returns {ClockHandle | null}
 */
export function mount() {
    if (typeof document === 'undefined') return null;
    if (document.getElementById('ps-floating-clock')) {
        return { destroy: () => {/* already gone */} };
    }
    if (isHidden()) return { destroy: () => {} };

    const el = document.createElement('div');
    el.id = 'ps-floating-clock';
    el.style.cssText = `position:fixed;z-index:5000;background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:8px 12px;color:var(--fg, #f5f5f7);font-family:${loadFont()};font-variant-numeric:tabular-nums;cursor:grab;user-select:none;touch-action:none;display:flex;flex-direction:column;align-items:center;gap:0;min-width:${W}px;text-align:center;box-shadow:0 4px 16px rgb(0 0 0 / 0.25);transition:opacity .15s, transform .25s ease-out, width .25s, height .25s, padding .25s, border-radius .25s;`;
    const customColor = loadColor();
    if (customColor) el.style.color = customColor;

    const timeEl = document.createElement('div');
    timeEl.className = 'ps-clock-time';
    timeEl.style.cssText = 'font-size:22px;font-weight:700;letter-spacing:0;line-height:1.1;';

    const dateEl = document.createElement('div');
    dateEl.className = 'ps-clock-date';
    dateEl.style.cssText = 'font-size:10px;color:var(--dim, #888);text-transform:uppercase;letter-spacing:0.1em;margin-top:2px;';

    el.appendChild(timeEl);
    el.appendChild(dateEl);
    document.body.appendChild(el);

    let pos = loadPos();
    let stowed = isStowed();
    let stowHoldTimer = /** @type {any} */ (0);
    /** @type {{ edge: 'left'|'right'|'top'|'bottom', distance: number } | null} */
    let pendingStowEdge = null;

    function paintClock() {
        const d = new Date();
        const HH = String(d.getHours()).padStart(2, '0');
        const MM = String(d.getMinutes()).padStart(2, '0');
        timeEl.textContent = `${HH}:${MM}`;
        if (showDate()) {
            dateEl.style.display = '';
            dateEl.textContent = d.toLocaleDateString('en-US', { weekday: 'short', day: '2-digit', month: 'short' });
        } else {
            dateEl.style.display = 'none';
        }
    }

    function applyPos() {
        const vw = window.innerWidth, vh = window.innerHeight;
        if (stowed) {
            const fpos = stowFabFor({ edge: 'right', vw, vh, fabSize: FAB });
            // Override with persisted fab pos if available
            try {
                const raw = lsGet(key('ps_clock_fab_pos'), '');
                if (raw) {
                    const p = JSON.parse(/** @type {string} */ (raw));
                    if (p && typeof p.x === 'number') { fpos.x = p.x; fpos.y = p.y; }
                }
            } catch (_) { /* swallow */ }
            el.style.left = fpos.x + 'px';
            el.style.top  = fpos.y + 'px';
            el.style.width = FAB + 'px';
            el.style.height = FAB + 'px';
            el.style.padding = '0';
            el.style.borderRadius = '50%';
            el.style.minWidth = '0';
            timeEl.textContent = '🕒';
            timeEl.style.fontSize = '20px';
            dateEl.style.display = 'none';
        } else {
            const clamped = clampToViewport({ ...pos, w: W, h: H, vw, vh });
            el.style.left = clamped.x + 'px';
            el.style.top  = clamped.y + 'px';
            el.style.width = '';
            el.style.height = '';
            el.style.padding = '8px 12px';
            el.style.borderRadius = '10px';
            el.style.minWidth = W + 'px';
            timeEl.style.fontSize = '22px';
            paintClock();
        }
    }

    paintClock();
    applyPos();

    const tick = setInterval(paintClock, 30_000);

    // ── Drag ───────────────────────────────────────────────────────────
    let dragging = false;
    let dragStartX = 0, dragStartY = 0;
    let dragStartPosX = 0, dragStartPosY = 0;

    function clearStowHold() {
        if (stowHoldTimer) { clearTimeout(stowHoldTimer); stowHoldTimer = 0; }
        pendingStowEdge = null;
        el.style.opacity = '1';
    }

    function onPointerDown(/** @type {PointerEvent} */ e) {
        if (e.button === 2) return; // right click
        if (stowed) {
            // Click on stowed FAB → restore to position
            stowed = false;
            saveStowed(false);
            applyPos();
            return;
        }
        dragging = true;
        dragStartX = e.clientX;
        dragStartY = e.clientY;
        dragStartPosX = pos.x;
        dragStartPosY = pos.y;
        el.style.cursor = 'grabbing';
        el.setPointerCapture(e.pointerId);
    }
    function onPointerMove(/** @type {PointerEvent} */ e) {
        if (!dragging) return;
        const dx = e.clientX - dragStartX;
        const dy = e.clientY - dragStartY;
        const vw = window.innerWidth, vh = window.innerHeight;
        const clamped = clampToViewport({ x: dragStartPosX + dx, y: dragStartPosY + dy, w: W, h: H, vw, vh });
        pos = clamped;
        el.style.left = pos.x + 'px';
        el.style.top  = pos.y + 'px';

        // Edge-hold detection — if user holds near edge for STOW_HOLD_MS,
        // dim widget then stow it on release.
        if (shouldStow({ ...pos, w: W, h: H, vw, vh })) {
            const ed = edgeDistance({ ...pos, w: W, h: H, vw, vh });
            if (!pendingStowEdge || pendingStowEdge.edge !== ed.edge) {
                pendingStowEdge = ed;
                if (stowHoldTimer) clearTimeout(stowHoldTimer);
                stowHoldTimer = setTimeout(() => {
                    el.style.opacity = '0.4';
                }, STOW_HOLD_MS);
            }
        } else {
            clearStowHold();
        }
    }
    function onPointerUp(/** @type {PointerEvent} */ e) {
        if (!dragging) return;
        dragging = false;
        el.style.cursor = 'grab';
        try { el.releasePointerCapture(e.pointerId); } catch (_) {}
        if (pendingStowEdge && el.style.opacity === '0.4') {
            // Commit stow
            const vw = window.innerWidth, vh = window.innerHeight;
            const fpos = stowFabFor({ edge: pendingStowEdge.edge, vw, vh, fabSize: FAB });
            try { lsSave(key('ps_clock_fab_pos'), JSON.stringify(fpos)); } catch (_) {}
            stowed = true;
            saveStowed(true);
            applyPos();
        } else {
            savePos(pos);
        }
        clearStowHold();
    }
    el.addEventListener('pointerdown', onPointerDown);
    el.addEventListener('pointermove', onPointerMove);
    el.addEventListener('pointerup',   onPointerUp);

    // ── Context menu ───────────────────────────────────────────────────
    /** @type {HTMLElement | null} */
    let _menu = null;
    function closeMenu() { if (_menu && _menu.parentNode) _menu.parentNode.removeChild(_menu); _menu = null; }
    function onContextMenu(/** @type {MouseEvent} */ e) {
        e.preventDefault();
        closeMenu();
        const menu = document.createElement('div');
        menu.id = 'ps-clock-menu';
        menu.style.cssText = `position:fixed;left:${e.clientX}px;top:${e.clientY}px;z-index:5100;background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:8px;padding:6px;min-width:200px;box-shadow:0 8px 24px rgb(0 0 0 / 0.45);font-family:var(--font-ui, var(--sans, system-ui));font-size:13px;display:flex;flex-direction:column;gap:2px;`;
        menu.innerHTML = `
            <button data-act="color"     style="background:transparent;border:0;color:var(--fg, #f5f5f7);padding:6px 10px;border-radius:6px;cursor:pointer;text-align:left;">Color…</button>
            <button data-act="font"      style="background:transparent;border:0;color:var(--fg, #f5f5f7);padding:6px 10px;border-radius:6px;cursor:pointer;text-align:left;">Font…</button>
            <button data-act="toggle-date" style="background:transparent;border:0;color:var(--fg, #f5f5f7);padding:6px 10px;border-radius:6px;cursor:pointer;text-align:left;">${showDate() ? 'Hide date' : 'Show date'}</button>
            <button data-act="reset"     style="background:transparent;border:0;color:var(--fg, #f5f5f7);padding:6px 10px;border-radius:6px;cursor:pointer;text-align:left;">Reset position</button>
            <button data-act="hide"      style="background:transparent;border:0;color:var(--danger, #ef4444);padding:6px 10px;border-radius:6px;cursor:pointer;text-align:left;">Hide clock</button>
        `;
        document.body.appendChild(menu);
        _menu = menu;
        menu.addEventListener('click', (ev) => {
            const t = /** @type {HTMLElement} */ (ev.target);
            const act = t && t.dataset && t.dataset.act;
            if (!act) return;
            if (act === 'color') {
                const c = window.prompt('Clock color (hex, e.g. #089981):', loadColor() || '');
                if (c != null) { saveColor(c); el.style.color = c || ''; }
            } else if (act === 'font') {
                const f = window.prompt('Clock font (CSS family):', loadFont());
                if (f) { saveFont(f); el.style.fontFamily = f; }
            } else if (act === 'toggle-date') {
                saveShowDate(!showDate());
                paintClock();
            } else if (act === 'reset') {
                pos = { x: 24, y: 24 };
                savePos(pos);
                stowed = false; saveStowed(false);
                applyPos();
            } else if (act === 'hide') {
                saveVis(false);
                if (el.parentNode) el.parentNode.removeChild(el);
                bus.emit('clock:hidden');
            }
            closeMenu();
            bus.emit('settings:changed', { key: 'clock' });
        });
        const off = (/** @type {Event} */ ev) => {
            if (!_menu) { document.removeEventListener('click', off, true); return; }
            if (!_menu.contains(/** @type {Node} */ (ev.target))) {
                closeMenu();
                document.removeEventListener('click', off, true);
            }
        };
        setTimeout(() => document.addEventListener('click', off, true), 0);
    }
    el.addEventListener('contextmenu', onContextMenu);

    // Re-apply position on viewport resize (keeps clock inside)
    function onResize() { applyPos(); }
    window.addEventListener('resize', onResize);

    // Re-paint when theme flips so per-theme persisted color/pos picks up
    const offTheme = bus.on('theme:changed', () => {
        pos = loadPos();
        const c = loadColor();
        el.style.color = c || '';
        applyPos();
    });

    return {
        destroy() {
            clearInterval(tick);
            el.removeEventListener('pointerdown', onPointerDown);
            el.removeEventListener('pointermove', onPointerMove);
            el.removeEventListener('pointerup',   onPointerUp);
            el.removeEventListener('contextmenu', onContextMenu);
            window.removeEventListener('resize', onResize);
            offTheme && offTheme();
            closeMenu();
            if (el.parentNode) el.parentNode.removeChild(el);
        },
    };
}

/** Programmatically show the clock again after Hide. */
export function showClock() {
    saveVis(true);
    mount();
}
