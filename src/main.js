// PSLink — Vite entry point (Session 3a, 2026-05-09)
//
// Status: PROOF-OF-CONFEPT shell. Real production still ships from root
// `index.html` (the 57k-line monolith). This file is the seed for the future
// modular shell that Session 3b/3c will grow into a feature-complete
// replacement before the cutover (per MIGRATION-PLAN.md → Adding new features
// recipe + Session 3 plan).
//
// What's wired today:
//   - core/bus event bus (cross-module pub/sub)
//   - core/storage lsSave wrapper (quota-safe localStorage)
//   - utility module lazy loader via dynamic import()
//   - PSAI proof-of-concept module loaded on click
//
// What's NOT wired (future Session 3 sub-sessions):
//   - boot pipeline (theme apply, splash, sync hooks)
//   - tab router
//   - shell UI (nav, modals, widgets)
//   - other 6 utility modules (PSBGR, PSEC, PSF, PSI, PSQ, PSUP)
//   - Muse widget (stays in shell, NOT lazy)

import { bus } from './core/bus.js';
import { lsSave, lsGet } from './core/storage.js';
import { applyPreset, applyVariant, presets, restoreActive } from './core/presets/index.js';
import { mount as mountPrivacy } from './widgets/privacy/index.js';
import './styles/privacy.css';

console.log('[PSLink/v2] main.js boot — bus, storage ready');

// Loader registry — module IDs map to dynamic imports. Vite splits each
// import() into its own chunk under dist/assets/. Idle pre-warm fires after
// 2s so first click is instant.
/** @type {Record<string, () => Promise<any>>} */
const _moduleLoaders = {
    psai:  () => import('./modules/psai/index.js'),
    psbgr: () => import('./modules/psbgr/index.js'),
    psec:  () => import('./modules/psec/index.js'),
    psf:   () => import('./modules/psf/index.js'),
    psi:   () => import('./modules/psi/index.js'),   // OpenCV.js (~10MB CDN, lazy on first use)
    psq:   () => import('./modules/psq/index.js'),   // SheetJS (CDN, will be `npm i xlsx` later)
    psup:  () => import('./modules/psup/index.js'),  // ORT-Web 1.22 + WebGPU EP
    // All 7 utility modules now lazy-loadable. Cutover (Phase B end) will
    // delete inline copies in monolith index.html once feature parity confirmed.
};

/** @type {Map<string, any>} */
const _loadedModules = new Map();

/**
 * Load a utility module (lazy). Cached after first load.
 * @param {string} id — module key in _moduleLoaders
 * @param {HTMLElement} rootEl — DOM mount point passed to module.init()
 * @returns {Promise<any>} resolves to module's init() return value
 */
export async function loadModule(id, rootEl) {
    const loader = _moduleLoaders[id];
    if (!loader) throw new Error(`[PSLink/v2] unknown module: ${id}`);

    let mod = _loadedModules.get(id);
    if (!mod) {
        const t0 = performance.now();
        mod = await loader();
        const dt = (performance.now() - t0).toFixed(1);
        console.log(`[PSLink/v2] loaded module "${id}" in ${dt}ms`);
        _loadedModules.set(id, mod);
        bus.emit('module:loaded', { id, dt });
    }
    if (typeof mod.init === 'function') {
        return mod.init(rootEl, { bus, lsSave, lsGet });
    }
    return mod;
}

/**
 * Idle pre-warm — fetches all registered module chunks after 2s so first
 * click is instant. Skipped if browser doesn't expose requestIdleCallback
 * (Safari < 17) or if user is on slow connection.
 */
export function prewarmModules() {
    const w = /** @type {any} */ (window);
    /** @type {(cb: () => void) => void} */
    const ric = w.requestIdleCallback || ((cb) => { setTimeout(cb, 2000); });
    ric(() => {
        const conn = /** @type {any} */ (navigator).connection;
        if (conn && (conn.saveData || /^(slow-)?2g$/.test(conn.effectiveType))) {
            console.log('[PSLink/v2] skip pre-warm: data saver / slow connection');
            return;
        }
        for (const id of Object.keys(_moduleLoaders)) {
            _moduleLoaders[id]().catch(() => {/* swallow — pre-warm best-effort */});
        }
    });
}

// Wire the proof-of-concept demo buttons (only present in src/index.html, not prod).
// Each button's data-module attribute selects which lazy chunk to load.
//
// Routing:
//   - Modules with a real UI (currently only `psai`) render into #module-mount
//   - Other (skeleton-only) modules pass their JSON return to #demo-output
// As more module UIs port over, add their id to MODULES_WITH_UI below.
// Session 3j: ALL 7 modules now have real UI ports.
const MODULES_WITH_UI = new Set(['psai', 'psbgr', 'psec', 'psf', 'psi', 'psq', 'psup']);

window.addEventListener('DOMContentLoaded', () => {
    const out   = document.getElementById('demo-output');
    const mount = document.getElementById('module-mount');
    if (!out || !mount) return; // not on the demo page

    /** @type {NodeListOf<HTMLButtonElement>} */
    const btns = document.querySelectorAll('button[data-module]');
    if (btns.length === 0) return;

    btns.forEach((btn) => {
        btn.addEventListener('click', async () => {
            const modId = btn.dataset.module;
            if (!modId) return;
            btns.forEach((b) => b.setAttribute('disabled', 'true'));
            const target = MODULES_WITH_UI.has(modId) ? mount : out;
            target.textContent = `Loading "${modId}" module via dynamic import()...`;
            try {
                const result = await loadModule(modId, /** @type {HTMLElement} */ (target));
                if (MODULES_WITH_UI.has(modId)) {
                    // UI module already rendered into target — write summary to out
                    out.textContent = `${modId} loaded — init() returned:\n` + JSON.stringify(result, null, 2);
                } else {
                    target.textContent = `${modId} loaded — init() returned:\n` + JSON.stringify(result, null, 2);
                }
            } catch (e) {
                const err = /** @type {any} */ (e);
                const msg = `Error loading "${modId}": ${err.message || err}`;
                target.textContent = msg;
                if (target !== out) out.textContent = msg;
            } finally {
                btns.forEach((b) => b.removeAttribute('disabled'));
            }
        });
    });

    // Pre-warm in the background — first click feels instant
    prewarmModules();

    // ── Preset switcher demo (Session 3t — Step 5) ───────────────────────
    const presetOut = document.getElementById('preset-output');
    const variantBar = document.getElementById('variant-bar');
    const darkToggle = document.getElementById('toggle-dark');

    function renderVariantBar() {
        if (!variantBar) return;
        const id = document.documentElement.getAttribute('data-preset') || 'origin';
        const p = presets[id];
        if (!p || !p.variants || !p.variants.length) {
            variantBar.innerHTML = '<span style="opacity:.6;">no variants</span>';
            return;
        }
        const active = document.documentElement.getAttribute('data-variant') || p.defaultVariant;
        variantBar.innerHTML = '<span style="opacity:.6;">variants:</span> ' + p.variants.map((v) => {
            const isActive = v === active;
            const style = isActive
                ? 'background:var(--accent, #089981);color:#000;'
                : 'background:var(--card, #1a1a1a);color:var(--fg, #f5f5f7);border:1px solid var(--border, #2a2a2a);';
            return `<button data-variant="${v}" style="${style}font-size:11px;padding:3px 9px;border-radius:6px;font-weight:600;cursor:pointer;">${v}</button>`;
        }).join(' ');
    }

    function reportPreset(/** @type {any} */ res) {
        if (!presetOut) return;
        if (!res) { presetOut.textContent = 'No-op (preset unknown)'; return; }
        const p = presets[res.preset];
        presetOut.textContent =
            `Applied · ${p.name} (${res.preset})` +
            (res.variant ? ` · ${res.variant}` : '') +
            ` · mode: ${res.mode}\n` +
            `font-display: ${getComputedStyle(document.documentElement).getPropertyValue('--font-display').trim()}\n` +
            `radius-md:    ${getComputedStyle(document.documentElement).getPropertyValue('--radius-md').trim()}\n` +
            `accent:       ${getComputedStyle(document.documentElement).getPropertyValue('--accent').trim() || '(theme default)'}`;
        renderVariantBar();
    }

    document.querySelectorAll('button[data-preset]').forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = /** @type {HTMLElement} */ (btn).dataset.preset || 'origin';
            reportPreset(applyPreset(id));
        });
    });
    if (variantBar) {
        variantBar.addEventListener('click', (e) => {
            const t = /** @type {HTMLElement} */ (e.target);
            const v = t && t.dataset && t.dataset.variant;
            if (v) reportPreset(applyVariant(v));
        });
    }
    if (darkToggle) {
        darkToggle.addEventListener('click', () => {
            document.documentElement.classList.toggle('dark');
            // Re-apply active preset so variant colors pick the correct mode slot
            const cur = document.documentElement.getAttribute('data-preset') || 'origin';
            const curVar = document.documentElement.getAttribute('data-variant') || undefined;
            reportPreset(applyPreset(cur, curVar));
        });
    }

    // Boot: restore last preset (defaults to Origin if no storage)
    document.documentElement.classList.add('dark'); // v2 shell defaults dark
    reportPreset(restoreActive(true));
});

// Expose loader for legacy interop during cutover
/** @type {any} */ (window).__psLoadModule = loadModule;

// ── Tab router (Step 6 — Session 1 skeleton) ─────────────────────────────
// Each tab is its own dynamic-import chunk. Switching tabs calls destroy() on
// the previous tab so listeners + RAFs + WS handles get freed before the next
// tab boots. activeTabId persists in localStorage so refresh restores last tab.

/** @type {Record<string, () => Promise<any>>} */
const _tabLoaders = {
    dashboard: () => import('./tabs/dashboard/index.js'),
    records:   () => import('./tabs/records/index.js'),
    watchlist: () => import('./tabs/watchlist/index.js'),
    news:      () => import('./tabs/news/index.js'),
    utilities: () => import('./tabs/utilities/index.js'),
    settings:  () => import('./tabs/settings/index.js'),
};

/** @type {Map<string, any>} */
const _loadedTabs = new Map();

/** @type {string} */
let _activeTabId = '';

/**
 * Switch the active tab, destroying the previous tab if any.
 * @param {string} id — tab key in _tabLoaders
 * @param {HTMLElement} mountEl — DOM mount for the tab's init()
 */
export async function showTab(id, mountEl) {
    const loader = _tabLoaders[id];
    if (!loader) throw new Error(`[PSLink/v2] unknown tab: ${id}`);
    if (_activeTabId && _activeTabId !== id) {
        const prev = _loadedTabs.get(_activeTabId);
        if (prev && typeof prev.destroy === 'function') {
            try { prev.destroy(); } catch (e) { /* swallow */ }
        }
    }
    let tab = _loadedTabs.get(id);
    if (!tab) {
        const t0 = performance.now();
        tab = await loader();
        const dt = (performance.now() - t0).toFixed(1);
        console.log(`[PSLink/v2] loaded tab "${id}" in ${dt}ms`);
        _loadedTabs.set(id, tab);
        bus.emit('tab:loaded', { id, dt });
    }
    mountEl.innerHTML = '';
    if (typeof tab.init === 'function') {
        const result = tab.init(mountEl, { bus, lsSave, lsGet });
        _activeTabId = id;
        try { lsSave('ps_v2_active_tab', id); } catch (e) { /* swallow */ }
        bus.emit('tab:active', { id });
        return result;
    }
    return tab;
}

/** @type {any} */ (window).__psShowTab = showTab;

window.addEventListener('DOMContentLoaded', () => {
    const tabMount = document.getElementById('tab-mount');
    if (!tabMount) return; // tab demo not on this page

    /** @type {NodeListOf<HTMLButtonElement>} */
    const tabBtns = document.querySelectorAll('button[data-tab]');
    if (tabBtns.length === 0) return;

    function setActiveBtn(/** @type {string} */ id) {
        tabBtns.forEach((b) => {
            const isActive = b.getAttribute('data-tab') === id;
            b.style.background = isActive ? 'var(--accent, #089981)' : 'var(--card, #1a1a1a)';
            b.style.color = isActive ? '#000' : 'var(--fg, #f5f5f7)';
        });
    }

    /**
     * Read tab id from URL hash (#tab=records) — used on boot + on hashchange
     * for browser back/forward / direct-URL share. Falls back to localStorage
     * `ps_v2_active_tab`, then dashboard.
     * @returns {string}
     */
    function readHashTab() {
        const h = (typeof location !== 'undefined' && location.hash) || '';
        const m = h.match(/(?:^|[#&])tab=([a-z]+)/);
        if (m && _tabLoaders[m[1]]) return m[1];
        return '';
    }

    /** @param {string} id */
    function writeHashTab(id) {
        if (typeof location === 'undefined') return;
        const next = '#tab=' + id;
        if (location.hash === next) return;
        // history.replaceState doesn't fire hashchange — keeps the back button clean
        try {
            history.replaceState(null, '', location.pathname + location.search + next);
        } catch (e) {
            location.hash = next;
        }
    }

    const mount = /** @type {HTMLElement} */ (tabMount);

    /** @param {string} id */
    async function activate(id) {
        if (!_tabLoaders[id]) return;
        setActiveBtn(id);
        writeHashTab(id);
        try {
            await showTab(id, mount);
        } catch (e) {
            const err = /** @type {any} */ (e);
            mount.textContent = `Error loading tab "${id}": ${err.message || err}`;
        }
    }

    tabBtns.forEach((btn) => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.tab;
            if (id) activate(id);
        });
    });

    // Browser back/forward — re-activate the tab named in the hash
    window.addEventListener('hashchange', () => {
        const id = readHashTab();
        if (id && id !== _activeTabId) activate(id);
    });

    // Mount global widgets (privacy toggle) into the tab nav row
    const widgetHost = document.getElementById('widget-host');
    if (widgetHost) mountPrivacy(widgetHost);

    // Boot order: hash > last-used localStorage > dashboard default
    const last = lsGet('ps_v2_active_tab', '');
    const initialId = readHashTab() || (_tabLoaders[last] ? last : 'dashboard');
    activate(initialId).then(() => {
        // Fade splash out once first tab init returns. Removing the node a
        // beat after fade keeps it out of the layout tree.
        const splash = document.getElementById('v2-splash');
        if (!splash) return;
        splash.classList.add('v2-splash-fade');
        setTimeout(() => { if (splash.parentNode) splash.parentNode.removeChild(splash); }, 400);
    });
});
