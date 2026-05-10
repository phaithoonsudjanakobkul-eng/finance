// Utilities tab — sidebar of utility modules + content area. Wraps the 7
// already-ported modules (PSAI / PSBGR / PSEC / PSF / PSI / PSQ / PSUP) into
// a single tab shell so they can route via the same lazy-load pattern as
// dashboard / records / watchlist / news.
//
// Module loading is delegated to main.js's loadModule() — that already owns
// the lazy import registry + caching + bus emit. This shell just renders the
// sidebar + click handler.

import { bus } from '../../core/bus.js';

const _ITEMS = [
    { id: 'psai',  label: 'PS AI Studio',         tag: 'Flux Kontext' },
    { id: 'psbgr', label: 'PS Background Remover', tag: 'RMBG + SAM' },
    { id: 'psec',  label: 'PS Email Composer',     tag: '9 Outlook builders' },
    { id: 'psf',   label: 'PS SpecFlow',           tag: 'OOXML DOCX' },
    { id: 'psi',   label: 'PS Micro Imaging',      tag: 'Worker hist' },
    { id: 'psq',   label: 'PS Quotation',          tag: 'xlsx + PDF' },
    { id: 'psup',  label: 'PS Upscaler',           tag: 'ORT-Web · WebGPU' },
];

/** @type {HTMLElement | null} */
let _panel = null;
/** @type {string} */
let _activeId = '';

function renderPanel(/** @type {HTMLElement} */ rootEl) {
    rootEl.innerHTML = `
        <div style="display:flex;gap:14px;padding:14px;height:100%;box-sizing:border-box;">
            <aside style="flex:0 0 220px;display:flex;flex-direction:column;gap:6px;">
                <div style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);padding:0 4px 4px;">Utilities</div>
                ${_ITEMS.map((it) => `
                    <button
                        data-util="${it.id}"
                        style="text-align:left;background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:8px 10px;border-radius:8px;cursor:pointer;font-family:var(--sans, sans-serif);font-size:13px;display:flex;flex-direction:column;gap:2px;">
                        <span style="font-weight:600;">${it.label}</span>
                        <span style="font-size:10px;color:var(--dim, #888);font-family:var(--mono, monospace);">${it.tag}</span>
                    </button>
                `).join('')}
            </aside>
            <section id="util-content" style="flex:1;min-width:0;background:var(--bg, #0d0d0d);border:1px solid var(--border, #2a2a2a);border-radius:10px;overflow:auto;">
                <div style="padding:18px;color:var(--dim, #888);font-size:13px;">Pick a utility from the left.</div>
            </section>
        </div>
    `;
}

function wireEvents() {
    if (!_panel) return;
    _panel.addEventListener('click', async (/** @type {Event} */ e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        const btn = t && t.closest && /** @type {HTMLElement | null} */ (t.closest('button[data-util]'));
        if (!btn) return;
        const id = btn.getAttribute('data-util');
        if (!id || id === _activeId) return;
        const content = _panel ? /** @type {HTMLElement | null} */ (_panel.querySelector('#util-content')) : null;
        if (!content) return;
        content.innerHTML = '<div style="padding:18px;color:var(--dim, #888);font-size:13px;">Loading…</div>';
        const w = /** @type {any} */ (window);
        const loader = w && w.__psLoadModule;
        if (typeof loader !== 'function') {
            content.innerHTML = '<div style="padding:18px;color:var(--dim, #888);">loadModule unavailable on window.</div>';
            return;
        }
        try {
            await loader(id, content);
            _activeId = id;
            bus.emit('tab:utilities:moduleActivated', { id });
        } catch (err) {
            const msg = (err && /** @type {any} */ (err).message) || String(err);
            content.innerHTML = `<div style="padding:18px;color:var(--dim, #888);">Error: ${msg}</div>`;
        }
    });
}

export function init(/** @type {HTMLElement} */ rootEl) {
    _panel = rootEl;
    renderPanel(rootEl);
    wireEvents();
    bus.emit('tab:utilities:init', { rootEl });
    return { id: 'utilities', version: '0.1-step6-skeleton', ready: true, kind: 'tab', utilities: _ITEMS.length };
}

export function destroy() {
    _panel = null;
    _activeId = '';
    bus.emit('tab:utilities:destroy');
}
