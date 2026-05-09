// PS Background Remover — lazy module (Session 3f UI port — drop zone + tier + mode + sliders, 2026-05-09)
//
// Status: PARTIAL PORT (drop zone + file upload + tier picker + detection
// mode toggle + refine sliders + result canvas + Save PNG). Full neural
// inference (RMBG-1.4 / BiRefNet via transformers.js), color-key algorithm,
// SAM 2 click-to-segment, brush tool, eyedropper, zoom/pan viewer all stay
// in monolith index.html until Session 3g+ port.
//
// Ported in 3f:
//   - Tier registry (kept from skeleton — fast/pro/ultra)
//   - State container (currentFile, outputBlob, tier, forceMode, refineSettings)
//   - setTier / getTier (kept from skeleton)
//   - lifecycle: load image, render canvas preview, "process" stub
//   - renderPanel(rootEl) — drop zone + tier chip bar + mode toggle + refine sliders + preview canvas + actions
//   - wireEvents() — drop, file input, tier select, mode toggle, slider input, process click, save click
//
// Roadmap (5 phases approved 2026-04-24, see project_psbgr_bleeding_edge_roadmap):
//   1. Foundation upgrade — RMBG-1.4 → BiRefNet-lite (RMBG-2.0 reverted)
//   2. SAM 2 click-to-segment (white-on-white case)
//   3. Alpha matting refinement — ViTMatte / MODNet
//   4. Color decontamination — fgColor = (pixel - (1-α)*bgColor) / α
//   5. BG replacement — composite over new bg

import { lsSave, lsGet } from '../../core/storage.js';
import { bus } from '../../core/bus.js';

// Tier registry — 3 model sizes per user's hardware budget. Lazy-loaded only
// on first use of each tier (~370 MB total budget, user downloads only what
// they invoke).
/** @type {Record<string, { label: string, size: string, quality: string, type: string, model: string }>} */
export const _PSBGR_TIERS = {
    fast:  { label: 'Fast',    size: '11MB',  quality: '~88%', type: 'imgly', model: 'isnet_quint8' },
    pro:   { label: 'Pro',     size: '80MB',  quality: '~93%', type: 'imgly', model: 'isnet' },
    ultra: { label: 'Ultra',   size: '180MB', quality: '~97%', type: 'hf',    model: 'briaai/RMBG-1.4' },
};

// Lib cache per tier — populated on first model load (deferred to Session 3g+)
/** @type {Record<string, any>} */
const _psbgrLibCache = {};

// State container
/** @type {{
 *   currentFile: File | null,
 *   currentImageUrl: string | null,
 *   outputBlob: Blob | null,
 *   outputUrl: string | null,
 *   lastMode: 'color-key' | 'neural' | null,
 *   tier: 'fast' | 'pro' | 'ultra',
 *   forceMode: 'auto' | 'neural' | 'color-key',
 *   refineSettings: { threshold: number, feather: number, expand: number },
 * }} */
const _psbgrState = {
    currentFile:     null,
    currentImageUrl: null,
    outputBlob:      null,
    outputUrl:       null,
    lastMode:        null,
    tier:            /** @type {any} */ (lsGet('ps_bgr_tier', 'pro')),
    forceMode:       'auto',
    refineSettings:  { threshold: 8, feather: 1, expand: 0 },
};

/** @type {HTMLElement | null} */
let _psbgrPanel = null;

/** @param {'fast' | 'pro' | 'ultra'} tier */
export function setTier(tier) {
    if (!_PSBGR_TIERS[tier]) return;
    _psbgrState.tier = tier;
    lsSave('ps_bgr_tier', tier);
    bus.emit('psbgr:tier-changed', { tier });
}
/** @returns {'fast' | 'pro' | 'ultra'} */
export function getTier() { return _psbgrState.tier; }
export function _state() { return { ..._psbgrState }; }

/** @param {string} s */
function he(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── File handling ──────────────────────────────────────────────────────
/** @param {File} file */
function loadFile(file) {
    if (!file || !file.type.startsWith('image/')) {
        setStatus('ไฟล์ไม่ใช่รูปภาพ', 'err');
        return;
    }
    if (file.size > 10 * 1024 * 1024) {
        setStatus('ไฟล์ใหญ่เกิน 10 MB', 'err');
        return;
    }
    // Release prior object URLs to avoid leaks
    if (_psbgrState.currentImageUrl) URL.revokeObjectURL(_psbgrState.currentImageUrl);
    if (_psbgrState.outputUrl)       URL.revokeObjectURL(_psbgrState.outputUrl);
    _psbgrState.currentFile     = file;
    _psbgrState.currentImageUrl = URL.createObjectURL(file);
    _psbgrState.outputBlob      = null;
    _psbgrState.outputUrl       = null;
    drawCanvas('orig', _psbgrState.currentImageUrl);
    drawCanvas('result', null); // clear result
    showWorkspace();
    setStatus('โหลดรูปแล้ว — กด Remove Background', 'ok');
    bus.emit('psbgr:file-loaded', { name: file.name, size: file.size });
}

/** @param {'orig' | 'result'} which @param {string | null} src */
function drawCanvas(which, src) {
    if (!_psbgrPanel) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psbgrPanel.querySelector(`#psbgr-canvas-${which}`));
    const placeholder = /** @type {HTMLElement | null} */ (_psbgrPanel.querySelector(`#psbgr-ph-${which}`));
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    if (!src) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        if (placeholder) placeholder.style.display = '';
        canvas.style.display = 'none';
        return;
    }
    const img = new Image();
    img.onload = () => {
        // Fit canvas to a max box (320×240) preserving aspect ratio
        const maxW = 320, maxH = 240;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (placeholder) placeholder.style.display = 'none';
        canvas.style.display = '';
    };
    img.onerror = () => setStatus('โหลดรูปไม่ได้', 'err');
    img.src = src;
}

function showWorkspace() {
    if (!_psbgrPanel) return;
    const ws = /** @type {HTMLElement | null} */ (_psbgrPanel.querySelector('#psbgr-workspace'));
    if (ws) ws.style.display = '';
}

// ── Process stub ───────────────────────────────────────────────────────
// Real BG removal pipeline (color-key dispatch + neural inference + alpha
// refinement) lives in monolith. This stub copies the input to result so
// the UI feels alive — Session 3g+ will replace with the real pipeline.
async function processImage() {
    if (!_psbgrState.currentImageUrl) {
        setStatus('โหลดรูปก่อน', 'err');
        return;
    }
    setStatus('Processing (stub — real model port deferred to Session 3g)...', '');
    // Simulate async work
    await new Promise((r) => setTimeout(r, 300));

    // Stub: produce result canvas = original with checkerboard alpha overlay
    // so users see something happen. Real pipeline: model.predict → alpha mask
    // → refine → composite onto transparency.
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
        const c = document.createElement('canvas');
        c.width = img.width; c.height = img.height;
        const ctx = c.getContext('2d');
        if (!ctx) return;
        ctx.drawImage(img, 0, 0);
        // Add a translucent magenta tint as visual marker that "processing happened"
        ctx.fillStyle = 'rgba(236, 72, 153, 0.15)';
        ctx.fillRect(0, 0, c.width, c.height);
        c.toBlob((blob) => {
            if (!blob) return;
            if (_psbgrState.outputUrl) URL.revokeObjectURL(_psbgrState.outputUrl);
            _psbgrState.outputBlob = blob;
            _psbgrState.outputUrl  = URL.createObjectURL(blob);
            _psbgrState.lastMode   = _psbgrState.forceMode === 'auto' ? 'neural' : _psbgrState.forceMode;
            drawCanvas('result', _psbgrState.outputUrl);
            setStatus(`Done (stub) · mode: ${_psbgrState.lastMode} · tier: ${_psbgrState.tier}`, 'ok');
            bus.emit('psbgr:processed', { mode: _psbgrState.lastMode, tier: _psbgrState.tier });
        }, 'image/png');
    };
    img.src = _psbgrState.currentImageUrl;
}

// ── Save result PNG ────────────────────────────────────────────────────
function saveResult() {
    if (!_psbgrState.outputUrl || !_psbgrState.outputBlob) {
        setStatus('ยังไม่มี result — กด Remove Background ก่อน', 'err');
        return;
    }
    const a = document.createElement('a');
    a.href = _psbgrState.outputUrl;
    a.download = (_psbgrState.currentFile?.name?.replace(/\.[^.]+$/, '') || 'output') + '-bgremoved.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setStatus('Downloaded', 'ok');
}

// ── UI render ──────────────────────────────────────────────────────────
/** @param {HTMLElement} rootEl */
function renderPanel(rootEl) {
    rootEl.innerHTML = `
        <div class="psbgr-panel" style="font-family:var(--sans, system-ui, sans-serif);color:var(--fg, #f5f5f7);">
            <style>
                .psbgr-panel label { display:block; font-size:10px; color:var(--dim, #888); text-transform:uppercase; letter-spacing:.08em; margin:6px 0 4px; font-weight:700; }
                .psbgr-panel .chip-bar { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
                .psbgr-panel .chip { font-size:11px; font-weight:600; padding:6px 12px; border:1px solid var(--border, #2a2a2a); border-radius:999px; background:transparent; color:var(--fg, #f5f5f7); cursor:pointer; transition:all .15s; }
                .psbgr-panel .chip.active { background:var(--accent, #089981); border-color:var(--accent, #089981); color:#000; }
                .psbgr-panel .chip:hover:not(.active) { border-color:var(--accent, #089981); }
                .psbgr-panel .chip .meta { opacity:.6; margin-left:6px; font-weight:400; font-size:10px; }
                .psbgr-panel .dropzone { border:2px dashed var(--border, #2a2a2a); border-radius:12px; padding:32px 24px; text-align:center; cursor:pointer; transition:all .15s; background:rgba(8, 153, 129, 0.03); }
                .psbgr-panel .dropzone.drag { border-color:var(--accent, #089981); background:rgba(8, 153, 129, 0.08); }
                .psbgr-panel .dropzone:hover { border-color:var(--accent, #089981); }
                .psbgr-panel .dropzone-title { font-size:14px; font-weight:600; color:var(--fg, #f5f5f7); margin-bottom:4px; }
                .psbgr-panel .dropzone-desc { font-size:12px; color:var(--dim, #888); margin-bottom:12px; }
                .psbgr-panel .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin:12px 0; }
                @media (max-width: 640px) { .psbgr-panel .grid-2 { grid-template-columns:1fr; } }
                .psbgr-panel .canvas-host { background:#000; border:1px solid var(--border, #2a2a2a); border-radius:8px; padding:8px; min-height:120px; display:flex; align-items:center; justify-content:center; position:relative; }
                .psbgr-panel .canvas-host .ph { color:var(--dim, #888); font-size:12px; }
                .psbgr-panel canvas.viewer { max-width:100%; height:auto; display:none; image-rendering:pixelated; }
                .psbgr-panel .canvas-cap { font-size:11px; font-weight:600; color:var(--dim, #888); text-transform:uppercase; letter-spacing:.06em; margin-bottom:4px; }
                .psbgr-panel .slider-row { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
                .psbgr-panel .slider-row label { margin:0; flex-shrink:0; min-width:78px; }
                .psbgr-panel .slider-row input[type=range] { flex:1; accent-color:var(--accent, #089981); }
                .psbgr-panel .slider-row .val { font-family:var(--mono); font-size:11px; color:var(--accent, #089981); min-width:36px; text-align:right; }
                .psbgr-panel .actions { display:flex; gap:8px; margin-top:12px; align-items:center; flex-wrap:wrap; }
                .psbgr-panel button.act { background:var(--accent, #089981); color:#000; border:0; padding:10px 18px; border-radius:8px; font-weight:600; font-size:13px; cursor:pointer; font-family:inherit; }
                .psbgr-panel button.act.ghost { background:var(--card, #1a1a1a); color:var(--fg, #f5f5f7); border:1px solid var(--border, #2a2a2a); }
                .psbgr-panel button.act:hover { opacity:.85; }
                .psbgr-panel button.act[disabled] { opacity:.5; cursor:not-allowed; }
                .psbgr-panel #psbgr-status { display:inline-flex; align-items:center; padding:0 8px; font-size:12px; color:var(--dim, #888); }
                .psbgr-panel #psbgr-status[data-type="ok"] { color:var(--accent, #089981); }
                .psbgr-panel #psbgr-status[data-type="err"] { color:#f43f5e; }
                .psbgr-panel .stub-note { background:rgba(245, 158, 11, 0.08); border-left:3px solid #f59e0b; padding:10px 14px; font-size:12px; color:var(--dim, #888); margin-top:12px; border-radius:4px; }
            </style>

            <div id="psbgr-dropzone" class="dropzone">
                <div class="dropzone-title">Drop image here or click to browse</div>
                <div class="dropzone-desc">JPG · PNG · WEBP — up to 10 MB</div>
                <button class="act" id="psbgr-browse-btn">Choose image</button>
                <input type="file" id="psbgr-file-input" accept="image/*" style="display:none;" />
            </div>

            <div id="psbgr-workspace" style="display:none;">
                <div class="grid-2">
                    <div>
                        <div class="canvas-cap">Original</div>
                        <div class="canvas-host">
                            <div class="ph" id="psbgr-ph-orig">—</div>
                            <canvas class="viewer" id="psbgr-canvas-orig"></canvas>
                        </div>
                    </div>
                    <div>
                        <div class="canvas-cap">Result</div>
                        <div class="canvas-host">
                            <div class="ph" id="psbgr-ph-result">click "Remove Background"</div>
                            <canvas class="viewer" id="psbgr-canvas-result"></canvas>
                        </div>
                    </div>
                </div>

                <label>Tier (model size vs quality)</label>
                <div class="chip-bar" id="psbgr-tier-bar"></div>

                <label>Detection Mode</label>
                <div class="chip-bar" id="psbgr-mode-bar"></div>

                <label>Refine</label>
                <div class="slider-row">
                    <label for="psbgr-threshold">Threshold</label>
                    <input id="psbgr-threshold" type="range" min="0" max="32" step="1" value="${_psbgrState.refineSettings.threshold}" />
                    <span class="val" id="psbgr-threshold-val">${_psbgrState.refineSettings.threshold}</span>
                </div>
                <div class="slider-row">
                    <label for="psbgr-feather">Feather</label>
                    <input id="psbgr-feather" type="range" min="0" max="10" step="1" value="${_psbgrState.refineSettings.feather}" />
                    <span class="val" id="psbgr-feather-val">${_psbgrState.refineSettings.feather}</span>
                </div>
                <div class="slider-row">
                    <label for="psbgr-expand">Expand</label>
                    <input id="psbgr-expand" type="range" min="-10" max="10" step="1" value="${_psbgrState.refineSettings.expand}" />
                    <span class="val" id="psbgr-expand-val">${_psbgrState.refineSettings.expand}</span>
                </div>

                <div class="actions">
                    <button class="act"       id="psbgr-process-btn">Remove Background</button>
                    <button class="act ghost" id="psbgr-save-btn">Save PNG</button>
                    <button class="act ghost" id="psbgr-reset-btn">Reset</button>
                    <span id="psbgr-status"></span>
                </div>
            </div>

            <div class="stub-note">
                <strong>Session 3f port</strong> — drop zone + tier picker + mode toggle + refine sliders + result canvas live; "Remove Background" runs a stub (tints the image magenta to confirm pipeline). Real RMBG/BiRefNet inference + color-key + SAM + brush ship in Session 3g+.
            </div>
        </div>
    `;
}

function renderTierBar() {
    if (!_psbgrPanel) return;
    const bar = _psbgrPanel.querySelector('#psbgr-tier-bar');
    if (!bar) return;
    bar.innerHTML = Object.keys(_PSBGR_TIERS).map((id) => {
        const t = _PSBGR_TIERS[id];
        const active = id === _psbgrState.tier ? ' active' : '';
        return `<button class="chip${active}" data-tier="${id}">${he(t.label)}<span class="meta">${he(t.size)} · ${he(t.quality)}</span></button>`;
    }).join('');
}

function renderModeBar() {
    if (!_psbgrPanel) return;
    const bar = _psbgrPanel.querySelector('#psbgr-mode-bar');
    if (!bar) return;
    const modes = [
        { id: 'auto',      label: 'Auto',      desc: 'Smart dispatch — color-key for flat bg, neural for complex' },
        { id: 'neural',    label: 'Neural',    desc: 'Force neural — best for photos / complex subjects' },
        { id: 'color-key', label: 'Color-key', desc: 'Force color-key — best for logos / flat solid bg' },
    ];
    bar.innerHTML = modes.map((m) => {
        const active = m.id === _psbgrState.forceMode ? ' active' : '';
        return `<button class="chip${active}" data-mode="${m.id}" title="${he(m.desc)}">${he(m.label)}</button>`;
    }).join('');
}

/** @param {string} msg @param {'ok' | 'err' | ''} [type] */
function setStatus(msg, type) {
    if (!_psbgrPanel) return;
    const el = /** @type {HTMLElement | null} */ (_psbgrPanel.querySelector('#psbgr-status'));
    if (!el) return;
    el.textContent = msg;
    el.dataset.type = type || '';
    if (msg && type === 'ok') setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; el.dataset.type = ''; } }, 4000);
}

function wireEvents() {
    if (!_psbgrPanel) return;
    const panel = _psbgrPanel;
    const dropzone = /** @type {HTMLElement | null} */ (panel.querySelector('#psbgr-dropzone'));
    const fileInput = /** @type {HTMLInputElement | null} */ (panel.querySelector('#psbgr-file-input'));
    const browseBtn = panel.querySelector('#psbgr-browse-btn');

    // Drag-drop
    if (dropzone) {
        ['dragenter', 'dragover'].forEach((ev) => {
            dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
        });
        ['dragleave', 'drop'].forEach((ev) => {
            dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); });
        });
        dropzone.addEventListener('drop', (e) => {
            const dt = /** @type {DragEvent} */ (e).dataTransfer;
            if (dt && dt.files && dt.files[0]) loadFile(dt.files[0]);
        });
        dropzone.addEventListener('click', () => fileInput?.click());
    }
    if (browseBtn) browseBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput?.click(); });
    if (fileInput) fileInput.addEventListener('change', () => {
        const f = fileInput.files && fileInput.files[0];
        if (f) loadFile(f);
    });

    // Chip bars (tier + mode)
    panel.addEventListener('click', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        const tierBtn = t.closest('[data-tier]');
        if (tierBtn) {
            const tid = /** @type {HTMLElement} */ (tierBtn).dataset.tier;
            if (tid && _PSBGR_TIERS[tid]) {
                setTier(/** @type {any} */ (tid));
                renderTierBar();
            }
            return;
        }
        const modeBtn = t.closest('[data-mode]');
        if (modeBtn) {
            const mid = /** @type {HTMLElement} */ (modeBtn).dataset.mode;
            if (mid) {
                _psbgrState.forceMode = /** @type {any} */ (mid);
                renderModeBar();
            }
            return;
        }
    });

    // Sliders — live update + label
    /** @param {string} key @param {string} valId */
    const wireSlider = (key, valId) => {
        const slider = /** @type {HTMLInputElement | null} */ (panel.querySelector(`#psbgr-${key}`));
        const valLabel = panel.querySelector(`#${valId}`);
        if (!slider || !valLabel) return;
        slider.addEventListener('input', () => {
            const v = parseInt(slider.value, 10);
            /** @type {any} */ (_psbgrState.refineSettings)[key] = v;
            valLabel.textContent = String(v);
        });
    };
    wireSlider('threshold', 'psbgr-threshold-val');
    wireSlider('feather',   'psbgr-feather-val');
    wireSlider('expand',    'psbgr-expand-val');

    // Action buttons
    const procBtn  = panel.querySelector('#psbgr-process-btn');
    const saveBtn  = panel.querySelector('#psbgr-save-btn');
    const resetBtn = panel.querySelector('#psbgr-reset-btn');
    if (procBtn) procBtn.addEventListener('click', () => processImage());
    if (saveBtn) saveBtn.addEventListener('click', () => saveResult());
    if (resetBtn) resetBtn.addEventListener('click', () => {
        if (_psbgrState.currentImageUrl) URL.revokeObjectURL(_psbgrState.currentImageUrl);
        if (_psbgrState.outputUrl)       URL.revokeObjectURL(_psbgrState.outputUrl);
        _psbgrState.currentFile     = null;
        _psbgrState.currentImageUrl = null;
        _psbgrState.outputBlob      = null;
        _psbgrState.outputUrl       = null;
        const ws = /** @type {HTMLElement | null} */ (panel.querySelector('#psbgr-workspace'));
        if (ws) ws.style.display = 'none';
        if (fileInput) fileInput.value = '';
        setStatus('Reset', 'ok');
    });
}

// ── Module lifecycle ───────────────────────────────────────────────────
/**
 * @param {HTMLElement} rootEl
 * @param {{ bus?: any, lsSave?: any, lsGet?: any }} [_ctx]
 */
export function init(rootEl, _ctx) {
    _psbgrPanel = rootEl;
    renderPanel(rootEl);
    renderTierBar();
    renderModeBar();
    wireEvents();
    bus.emit('psbgr:init', { rootEl, tier: _psbgrState.tier });
    return {
        id:       'psbgr',
        version:  '0.2-session3f-ui-port',
        ready:    true,
        tier:     _psbgrState.tier,
        tierCfg:  _PSBGR_TIERS[_psbgrState.tier],
        availableTiers: Object.keys(_PSBGR_TIERS),
        forceMode: _psbgrState.forceMode,
    };
}

/**
 * Module teardown — frees lib cache + revokes object URLs.
 */
export function destroy() {
    for (const k of Object.keys(_psbgrLibCache)) delete _psbgrLibCache[k];
    if (_psbgrState.currentImageUrl) URL.revokeObjectURL(_psbgrState.currentImageUrl);
    if (_psbgrState.outputUrl)       URL.revokeObjectURL(_psbgrState.outputUrl);
    _psbgrState.currentImageUrl = null;
    _psbgrState.outputUrl       = null;
    _psbgrState.currentFile     = null;
    _psbgrState.outputBlob      = null;
    _psbgrPanel = null;
    bus.emit('psbgr:destroy');
}
