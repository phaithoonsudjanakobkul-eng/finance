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
const MODULES_WITH_UI = new Set(['psai', 'psec', 'psbgr', 'psup']);

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
});

// Expose loader for legacy interop during cutover
/** @type {any} */ (window).__psLoadModule = loadModule;
