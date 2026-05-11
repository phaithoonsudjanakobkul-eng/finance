// Quick chart side panel — V15.
//
// Opens a TradingView embed iframe pinned to the right side of the
// viewport for the symbol in the watchlist focus card. Timeframe
// preference persists via ps_lwc_prefs JSON; a single iframe is
// reused across symbol switches (we just swap src), so we don't pile
// up DOM nodes when the user clicks through their watchlist.

import { bus } from '../../core/bus.js';
import { lsGet, lsSave } from '../../core/storage.js';

const PREFS_KEY = 'ps_lwc_prefs';

/** Valid TradingView intervals we expose in the UI. */
export const TF_OPTIONS = /** @type {const} */ (['15', '60', 'D', 'W', 'M']);

/** Map interval → display label. */
export const TF_LABEL = /** @type {Record<string, string>} */ ({
    '15': '15m', '60': '1h', D: '1D', W: '1W', M: '1M',
});

/**
 * Read the persisted preferences JSON safely.
 * @returns {{ timeframe: string }}
 */
export function readPrefs() {
    try {
        const raw = lsGet(PREFS_KEY, '');
        const p = raw ? JSON.parse(/** @type {string} */ (raw)) : null;
        if (p && TF_OPTIONS.indexOf(p.timeframe) !== -1) return { timeframe: p.timeframe };
    } catch (_) { /* swallow */ }
    return { timeframe: 'D' };
}
/** @param {{ timeframe: string }} prefs */
export function savePrefs(prefs) {
    try { lsSave(PREFS_KEY, JSON.stringify(prefs)); } catch (_) { /* swallow */ }
}

/**
 * Build the TradingView widget embed URL for a symbol + timeframe.
 * Symbol passes through as-is (TradingView resolves exchanges itself).
 * @param {string} sym @param {string} timeframe @returns {string}
 */
export function buildEmbedUrl(sym, timeframe) {
    const tf = TF_OPTIONS.indexOf(/** @type {any} */ (timeframe)) !== -1 ? timeframe : 'D';
    const symb = encodeURIComponent(String(sym).toUpperCase());
    return `https://s.tradingview.com/widgetembed/?symbol=${symb}&interval=${tf}&theme=dark&style=1&hide_top_toolbar=0&hide_legend=0`;
}

/** @type {HTMLElement | null} */
let _panel = null;
let _currentSym = '';
let _currentTf = 'D';
/** @type {(() => void) | null} */
let _busOff = null;

function ensurePanel() {
    if (_panel && _panel.isConnected) return _panel;
    const p = document.createElement('div');
    p.id = 'quickchart-panel';
    p.style.cssText = 'position:fixed;top:64px;right:0;bottom:0;width:min(560px, 90vw);z-index:5400;background:var(--card, #1a1a1a);border-left:1px solid var(--border, #2a2a2a);box-shadow:-12px 0 32px rgb(0 0 0 / 0.35);display:flex;flex-direction:column;color:var(--fg, #f5f5f7);font-family:var(--font-ui, var(--sans, system-ui));transform:translateX(100%);transition:transform .25s ease-out;';
    p.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border, #2a2a2a);">
            <span id="quickchart-sym" style="font-family:var(--font-display, var(--sans, system-ui));font-size:16px;font-weight:700;letter-spacing:-0.01em;"></span>
            <div id="quickchart-tf-bar" style="display:flex;gap:4px;margin-left:8px;"></div>
            <button id="quickchart-close" title="Close" style="margin-left:auto;background:transparent;border:0;color:var(--dim, #888);cursor:pointer;font-size:20px;line-height:1;padding:0 4px;">×</button>
        </div>
        <iframe id="quickchart-iframe" frameborder="0" style="flex:1;width:100%;background:#000;display:block;"></iframe>
    `;
    document.body.appendChild(p);
    _panel = p;
    p.querySelector('#quickchart-close')?.addEventListener('click', () => close());
    p.querySelector('#quickchart-tf-bar')?.addEventListener('click', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        const tf = t && t.dataset && t.dataset.tf;
        if (!tf) return;
        _currentTf = tf;
        savePrefs({ timeframe: tf });
        paint();
    });
    return p;
}

function renderTfBar() {
    if (!_panel) return;
    const bar = _panel.querySelector('#quickchart-tf-bar');
    if (!bar) return;
    bar.innerHTML = TF_OPTIONS.map((tf) => {
        const active = tf === _currentTf;
        const style = active
            ? 'background:var(--accent, #089981);color:#000;'
            : 'background:transparent;color:var(--dim, #888);border:1px solid var(--border, #2a2a2a);';
        return `<button data-tf="${tf}" style="${style}padding:2px 8px;border-radius:6px;border:0;cursor:pointer;font-family:var(--mono, monospace);font-size:11px;font-weight:700;letter-spacing:0.06em;">${TF_LABEL[tf]}</button>`;
    }).join('');
}

function paint() {
    if (!_panel) return;
    const sym = _panel.querySelector('#quickchart-sym');
    if (sym) sym.textContent = _currentSym;
    const iframe = /** @type {HTMLIFrameElement | null} */ (_panel.querySelector('#quickchart-iframe'));
    if (iframe) iframe.src = buildEmbedUrl(_currentSym, _currentTf);
    renderTfBar();
}

/**
 * Open the panel for `sym`. Idempotent — re-uses the same iframe across
 * symbol switches.
 * @param {string} sym
 */
export function open(sym) {
    if (!sym) return;
    ensurePanel();
    _currentSym = String(sym).toUpperCase();
    _currentTf = readPrefs().timeframe;
    paint();
    // Slide in
    if (_panel) requestAnimationFrame(() => { if (_panel) _panel.style.transform = 'translateX(0)'; });
    bus.emit('quickchart:opened', { sym: _currentSym, tf: _currentTf });
}

export function close() {
    if (!_panel) return;
    _panel.style.transform = 'translateX(100%)';
    bus.emit('quickchart:closed');
}

/** @returns {boolean} */
export function isOpen() { return !!_panel && _panel.style.transform === 'translateX(0)'; }

/**
 * Mount lifecycle — listens for the bus event the watchlist tab fires
 * when the user clicks the chart button on a row's focus card.
 * @returns {{ destroy: () => void }}
 */
export function mount() {
    if (_busOff) return { destroy: () => { _busOff && _busOff(); _busOff = null; } };
    _busOff = bus.on('quickchart:request', (d) => {
        if (d && d.sym) open(d.sym);
    });
    return {
        destroy() {
            _busOff && _busOff();
            _busOff = null;
            if (_panel && _panel.parentNode) _panel.parentNode.removeChild(_panel);
            _panel = null;
        },
    };
}
