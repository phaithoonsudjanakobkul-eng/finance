// PS Micro Imaging — lazy module (Session 3i UI port — 3 stages + canvas + display adj, 2026-05-09)
//
// Status: PARTIAL PORT (3 collapsible stages, calibration profile picker,
// file load + canvas preview, display adjustment sliders, scale bar settings,
// Save PNG). Real OpenCV.js operations, histogram Web Worker engine,
// annotation tools (line/angle/area/freehand), loupe magnifier, spline LUT,
// per-channel histogram editing all stay in monolith index.html until
// Session 3j+ port. PSI's heaviest dep: OpenCV.js (~10 MB WASM, lazy).
//
// Ported in 3i:
//   - psImagingState container (kept from skeleton)
//   - Calibration storage (loadCalibration / saveCalibration / profiles)
//   - OpenCV readiness check (kept)
//   - Stage UI: 3 collapsible sections (Calibrate / Load / Adjust)
//   - File loader + canvas preview (fit-to-box, no full-res viewer yet)
//   - Display adjustment sliders (black/white/gamma + channel select)
//   - Scale bar settings (visible toggle + color + position fraction)
//   - Save PNG (exports canvas as data URL download)
//
// CRITICAL invariants (DO NOT regress):
//   - Histogram engine MUST be a Web Worker (Coding Rule 12) — Session 3j wires this
//   - canvasId never redrawn after initial — bgCanvas holds clean image
//   - overlayCanvas is the ONLY surface for annotations
//   - LUT apply uses cached _bgPixels + reusable _applyDst (avoid GC churn)
//   - bgBitmap = GPU-resident ImageBitmap for fast loupe reads (don't drop)

import { lsSave, lsGet, lsGetJson } from '../../core/storage.js';
import { bus } from '../../core/bus.js';

const _PSI_LS_CALIB        = 'pslink_micro_calibration';
const _PSI_LS_LAST_PROFILE = 'pslink_calib_last_profile';
const _PSI_CP_KEY          = 'pslink_micro_calib_profiles';

/** @type {{
 *   pixelPerMicron: number | null,
 *   currentFile: File | null,
 *   currentImageUrl: string | null,
 *   calibration: any,
 *   scaleBar: { visible: boolean, x: number, y: number, color: string, niceUm: number | null, fontSize: number, bgOpacity: number, lineWidth: number, endCaps: string },
 *   displayAdj: { black: number, white: number, gamma: number, channel: 'all' | 'r' | 'g' | 'b', enabled: boolean, splineMode: boolean, splinePoints: any },
 * }} */
export const psImagingState = {
    pixelPerMicron:   null,
    currentFile:      null,
    currentImageUrl:  null,
    calibration:      null,
    scaleBar:         { visible: false, x: 0.88, y: 0.88, color: '#ffffff', niceUm: null, fontSize: 11, bgOpacity: 0, lineWidth: 2, endCaps: 'bracket' },
    displayAdj:       { black: 0, white: 255, gamma: 1.0, channel: 'all', enabled: false, splineMode: false, splinePoints: null },
};

/** @type {HTMLElement | null} */
let _psiPanel = null;

/** @type {{ [stage: string]: boolean }} */
const _psiStageOpen = { '1': true, '2': true, '3': false };

// ── Persistence ────────────────────────────────────────────────────────
export function loadCalibration() {
    const cal = lsGetJson(_PSI_LS_CALIB, /** @type {any} */ (null));
    if (cal) psImagingState.calibration = cal;
    return cal;
}
export function saveCalibration() {
    if (!psImagingState.calibration) return;
    lsSave(_PSI_LS_CALIB, JSON.stringify(psImagingState.calibration));
    bus.emit('psi:calib-saved', { calib: psImagingState.calibration });
}
export function loadCalibProfiles() { return lsGetJson(_PSI_CP_KEY, /** @type {Array<any>} */ ([])); }
/** @param {Array<any>} profiles */
export function saveCalibProfiles(profiles) { lsSave(_PSI_CP_KEY, JSON.stringify(profiles)); }

/**
 * OpenCV.js readiness — real loader stays in monolith. This just reflects
 * current global window.cv presence. Phase 3j will own the loader logic too.
 */
export function isOpenCvReady() {
    const w = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
    return !!(w.cv && typeof w.cv.Mat === 'function');
}

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
    if (psImagingState.currentImageUrl) URL.revokeObjectURL(psImagingState.currentImageUrl);
    psImagingState.currentFile     = file;
    psImagingState.currentImageUrl = URL.createObjectURL(file);
    drawCanvas(psImagingState.currentImageUrl);
    setStatus(`Loaded ${file.name}`, 'ok');
    bus.emit('psi:file-loaded', { name: file.name, size: file.size });
}

/** @param {string | null} src */
function drawCanvas(src) {
    if (!_psiPanel) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    const placeholder = /** @type {HTMLElement | null} */ (_psiPanel.querySelector('#psi-canvas-ph'));
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
        // Fit to 480×360 max preserving aspect ratio
        const maxW = 480, maxH = 360;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        applyDisplayAdjPreview();
        if (psImagingState.scaleBar.visible) drawScaleBar();
        if (placeholder) placeholder.style.display = 'none';
        canvas.style.display = '';
    };
    img.onerror = () => setStatus('โหลดรูปไม่ได้', 'err');
    img.src = src;
}

// ── Display adjustment preview (basic LUT — no Worker yet) ─────────────
function applyDisplayAdjPreview() {
    if (!_psiPanel) return;
    if (!psImagingState.displayAdj.enabled) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const adj = psImagingState.displayAdj;
    const black = Math.max(0, Math.min(254, adj.black));
    const white = Math.max(black + 1, Math.min(255, adj.white));
    const gamma = Math.max(0.01, Math.min(9.99, adj.gamma));
    // Build LUT once
    const lut = new Uint8ClampedArray(256);
    const range = white - black;
    for (let i = 0; i < 256; i++) {
        let v = (i - black) / range;
        v = Math.max(0, Math.min(1, v));
        v = Math.pow(v, 1 / gamma);
        lut[i] = Math.round(v * 255);
    }
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const p = data.data;
    const ch = adj.channel;
    for (let i = 0; i < p.length; i += 4) {
        if (ch === 'all' || ch === 'r') p[i]     = lut[p[i]];
        if (ch === 'all' || ch === 'g') p[i + 1] = lut[p[i + 1]];
        if (ch === 'all' || ch === 'b') p[i + 2] = lut[p[i + 2]];
    }
    ctx.putImageData(data, 0, 0);
}

// ── Scale bar overlay (simple — full annotation system in monolith) ────
function drawScaleBar() {
    if (!_psiPanel) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const sb = psImagingState.scaleBar;
    const ppm = psImagingState.pixelPerMicron;
    if (!ppm) return; // need calibration to render real µm scale bar
    // Pick a "nice" length (50/100/200 µm) based on canvas width
    const targetPx = canvas.width * 0.18;
    const targetUm = targetPx / ppm;
    const niceVals = [10, 20, 50, 100, 200, 500, 1000];
    let chosen = niceVals[0];
    for (const v of niceVals) if (Math.abs(v - targetUm) < Math.abs(chosen - targetUm)) chosen = v;
    const widthPx = chosen * ppm;
    const x = sb.x * canvas.width  - widthPx / 2;
    const y = sb.y * canvas.height;
    ctx.strokeStyle = sb.color;
    ctx.fillStyle   = sb.color;
    ctx.lineWidth   = sb.lineWidth;
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + widthPx, y);
    ctx.stroke();
    ctx.font = `${sb.fontSize}px Inter, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'bottom';
    ctx.fillText(`${chosen} µm`, x + widthPx / 2, y - 4);
}

function savePng() {
    if (!_psiPanel) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (!canvas || canvas.style.display === 'none') {
        setStatus('โหลดรูปก่อน', 'err');
        return;
    }
    const a = document.createElement('a');
    a.href = canvas.toDataURL('image/png');
    a.download = (psImagingState.currentFile?.name?.replace(/\.[^.]+$/, '') || 'output') + '-psi.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setStatus('Downloaded', 'ok');
}

// ── UI render ──────────────────────────────────────────────────────────
/** @param {HTMLElement} rootEl */
function renderPanel(rootEl) {
    rootEl.innerHTML = `
        <div class="psi-panel" style="font-family:var(--sans, system-ui, sans-serif);color:var(--fg, #f5f5f7);">
            <style>
                .psi-panel label { display:block; font-size:10px; color:var(--dim, #888); text-transform:uppercase; letter-spacing:.08em; margin:6px 0 4px; font-weight:700; }
                .psi-panel input[type="text"], .psi-panel input[type="number"], .psi-panel select { background:var(--bg, #0d0d0d); color:var(--fg, #f5f5f7); border:1px solid var(--border, #2a2a2a); border-radius:6px; padding:6px 10px; font-size:12px; outline:none; font-family:inherit; }
                .psi-panel input[type="color"] { background:transparent; border:1px solid var(--border, #2a2a2a); border-radius:6px; padding:2px; height:28px; width:40px; cursor:pointer; }
                .psi-panel input[type="checkbox"] { accent-color:var(--accent, #089981); }
                .psi-panel .stage { background:var(--bg, #0d0d0d); border:1px solid var(--border, #2a2a2a); border-radius:8px; margin-bottom:10px; overflow:hidden; }
                .psi-panel .stage-hdr { display:flex; align-items:center; padding:10px 14px; cursor:pointer; user-select:none; }
                .psi-panel .stage-hdr:hover { background:rgba(255,255,255,0.02); }
                .psi-panel .stage-hdr .num { font-family:var(--mono); font-size:11px; color:var(--accent, #089981); font-weight:700; margin-right:8px; }
                .psi-panel .stage-hdr .title { font-size:13px; font-weight:600; flex:1; }
                .psi-panel .stage-hdr .arrow { color:var(--dim, #888); transition:transform .15s; }
                .psi-panel .stage[data-open="true"] .stage-hdr .arrow { transform:rotate(90deg); }
                .psi-panel .stage-body { padding:0 14px 14px; display:none; }
                .psi-panel .stage[data-open="true"] .stage-body { display:block; }
                .psi-panel .canvas-host { background:#000; border:1px solid var(--border, #2a2a2a); border-radius:8px; padding:8px; min-height:200px; display:flex; align-items:center; justify-content:center; margin-bottom:12px; position:relative; overflow:hidden; }
                .psi-panel .canvas-host .ph { color:var(--dim, #888); font-size:12px; }
                .psi-panel canvas { max-width:100%; height:auto; display:none; image-rendering:pixelated; }
                .psi-panel .row { display:grid; grid-template-columns:80px 1fr 50px; gap:8px; align-items:center; margin-bottom:6px; }
                .psi-panel .row label { margin:0; }
                .psi-panel .row input[type="range"] { accent-color:var(--accent, #089981); }
                .psi-panel .row .val { font-family:var(--mono); font-size:11px; color:var(--accent, #089981); text-align:right; }
                .psi-panel .chip-bar { display:flex; flex-wrap:wrap; gap:4px; margin-bottom:8px; }
                .psi-panel .chip { font-size:11px; font-weight:600; padding:5px 10px; border:1px solid var(--border, #2a2a2a); border-radius:999px; background:transparent; color:var(--fg, #f5f5f7); cursor:pointer; transition:all .15s; }
                .psi-panel .chip.active { background:var(--accent, #089981); border-color:var(--accent, #089981); color:#000; }
                .psi-panel .actions { display:flex; gap:8px; margin-top:10px; align-items:center; flex-wrap:wrap; }
                .psi-panel button.act { background:var(--accent, #089981); color:#000; border:0; padding:8px 14px; border-radius:6px; font-weight:600; font-size:12px; cursor:pointer; font-family:inherit; }
                .psi-panel button.act.ghost { background:var(--card, #1a1a1a); color:var(--fg, #f5f5f7); border:1px solid var(--border, #2a2a2a); }
                .psi-panel button.act:hover { opacity:.85; }
                .psi-panel #psi-status { display:inline-flex; align-items:center; padding:0 8px; font-size:12px; color:var(--dim, #888); }
                .psi-panel #psi-status[data-type="ok"] { color:var(--accent, #089981); }
                .psi-panel #psi-status[data-type="err"] { color:#f43f5e; }
                .psi-panel .info-bar { display:flex; gap:14px; padding:10px 14px; background:rgba(8, 153, 129, 0.06); border:1px solid var(--accent, #089981); border-radius:8px; margin-bottom:14px; font-size:12px; align-items:center; flex-wrap:wrap; }
                .psi-panel .info-bar .item { display:flex; flex-direction:column; }
                .psi-panel .info-bar .lbl { font-size:9px; text-transform:uppercase; letter-spacing:.06em; color:var(--dim, #888); font-weight:700; }
                .psi-panel .info-bar .val { font-family:var(--mono); font-size:13px; color:var(--accent, #089981); font-weight:700; }
                .psi-panel .stub-note { background:rgba(245, 158, 11, 0.08); border-left:3px solid #f59e0b; padding:10px 14px; font-size:12px; color:var(--dim, #888); margin-top:12px; border-radius:4px; }
            </style>

            <div class="info-bar" id="psi-info-bar"></div>

            <div class="canvas-host">
                <div class="ph" id="psi-canvas-ph">— load an image —</div>
                <canvas id="psi-canvas"></canvas>
            </div>

            <div class="stage" data-stage="1" data-open="${_psiStageOpen['1']}">
                <div class="stage-hdr" data-toggle="1">
                    <span class="num">Stage 1</span>
                    <span class="title">Calibration</span>
                    <span class="arrow">›</span>
                </div>
                <div class="stage-body">
                    <label>Calibration profile (objective lens)</label>
                    <select id="psi-calib-select"></select>
                    <div class="actions">
                        <button class="act ghost" id="psi-calib-add">+ Add profile</button>
                        <button class="act ghost" id="psi-calib-clear" style="color:#f43f5e;">Clear current</button>
                    </div>
                    <div style="font-size:11px;color:var(--dim, #888);margin-top:8px;line-height:1.5;">
                        Real calibration draws a known-length line on a stage micrometer image. Manual entry below for now (Session 3j+ ports the line tool).
                    </div>
                    <label style="margin-top:10px;">Pixels per micron (manual)</label>
                    <input id="psi-ppm" type="number" step="0.01" min="0" placeholder="e.g. 2.5" value="${psImagingState.pixelPerMicron || ''}" style="width:160px;" />
                </div>
            </div>

            <div class="stage" data-stage="2" data-open="${_psiStageOpen['2']}">
                <div class="stage-hdr" data-toggle="2">
                    <span class="num">Stage 2</span>
                    <span class="title">Load Image</span>
                    <span class="arrow">›</span>
                </div>
                <div class="stage-body">
                    <button class="act" id="psi-browse-btn">Choose image</button>
                    <input type="file" id="psi-file-input" accept="image/*" style="display:none;" />
                    <div style="font-size:11px;color:var(--dim, #888);margin-top:8px;">JPG · PNG · TIFF · WEBP — Ctrl+O shortcut deferred to Session 3j+</div>
                </div>
            </div>

            <div class="stage" data-stage="3" data-open="${_psiStageOpen['3']}">
                <div class="stage-hdr" data-toggle="3">
                    <span class="num">Stage 3</span>
                    <span class="title">Display Adjustment</span>
                    <span class="arrow">›</span>
                </div>
                <div class="stage-body">
                    <label><input type="checkbox" id="psi-adj-enabled" ${psImagingState.displayAdj.enabled ? 'checked' : ''} style="vertical-align:middle;"> Enable display adjustment (LUT preview)</label>

                    <label>Channel</label>
                    <div class="chip-bar" id="psi-channel-bar"></div>

                    <div class="row">
                        <label for="psi-adj-black">Black</label>
                        <input id="psi-adj-black" type="range" min="0" max="254" step="1" value="${psImagingState.displayAdj.black}" />
                        <span class="val" id="psi-adj-black-val">${psImagingState.displayAdj.black}</span>
                    </div>
                    <div class="row">
                        <label for="psi-adj-white">White</label>
                        <input id="psi-adj-white" type="range" min="1" max="255" step="1" value="${psImagingState.displayAdj.white}" />
                        <span class="val" id="psi-adj-white-val">${psImagingState.displayAdj.white}</span>
                    </div>
                    <div class="row">
                        <label for="psi-adj-gamma">Gamma</label>
                        <input id="psi-adj-gamma" type="range" min="0.1" max="3.0" step="0.05" value="${psImagingState.displayAdj.gamma}" />
                        <span class="val" id="psi-adj-gamma-val">${psImagingState.displayAdj.gamma}</span>
                    </div>

                    <hr style="border:0;border-top:1px solid var(--border, #2a2a2a);margin:12px 0;" />

                    <label><input type="checkbox" id="psi-sb-visible" ${psImagingState.scaleBar.visible ? 'checked' : ''} style="vertical-align:middle;"> Show scale bar (requires calibration)</label>
                    <div class="row" style="grid-template-columns:80px 1fr 50px;">
                        <label for="psi-sb-color">Color</label>
                        <input id="psi-sb-color" type="color" value="${psImagingState.scaleBar.color}" />
                        <span></span>
                    </div>
                </div>
            </div>

            <div class="actions">
                <button class="act"       id="psi-save-btn">Save PNG</button>
                <button class="act ghost" id="psi-redraw-btn">Redraw</button>
                <span id="psi-status"></span>
            </div>

            <div class="stub-note">
                <strong>Session 3i port</strong> — 3 stages (Calibration / Load / Display Adj) + canvas viewer + LUT preview (basic) + scale bar overlay live; Real OpenCV.js operations + Web Worker histogram engine + annotation tools (line/angle/area/freehand) + loupe magnifier + spline LUT editing ship in Session 3j+.
            </div>
        </div>
    `;
}

function renderInfoBar() {
    if (!_psiPanel) return;
    const bar = _psiPanel.querySelector('#psi-info-bar');
    if (!bar) return;
    const cv = isOpenCvReady() ? '<span style="color:var(--accent, #089981);">ready</span>' : 'pending lazy load';
    const cal = psImagingState.pixelPerMicron ? `${psImagingState.pixelPerMicron.toFixed(2)} px/µm` : '—';
    const fname = psImagingState.currentFile?.name || '—';
    bar.innerHTML = `
        <div class="item"><span class="lbl">OpenCV.js</span><span class="val">${cv}</span></div>
        <div class="item"><span class="lbl">Calibration</span><span class="val">${he(cal)}</span></div>
        <div class="item"><span class="lbl">Image</span><span class="val">${he(fname)}</span></div>
    `;
}

function renderCalibSelect() {
    if (!_psiPanel) return;
    const sel = /** @type {HTMLSelectElement | null} */ (_psiPanel.querySelector('#psi-calib-select'));
    if (!sel) return;
    const profiles = loadCalibProfiles();
    const last = lsGet(_PSI_LS_LAST_PROFILE, '');
    sel.innerHTML = '<option value="">— no profile —</option>' +
        profiles.map((p) => `<option value="${he(p.id || p.name)}" ${(p.id || p.name) === last ? 'selected' : ''}>${he(p.name)} · ${he(String(p.pixelPerMicron))} px/µm</option>`).join('');
}

function renderChannelBar() {
    if (!_psiPanel) return;
    const bar = _psiPanel.querySelector('#psi-channel-bar');
    if (!bar) return;
    const channels = ['all', 'r', 'g', 'b'];
    bar.innerHTML = channels.map((c) => {
        const active = c === psImagingState.displayAdj.channel ? ' active' : '';
        return `<button class="chip${active}" data-channel="${c}">${c.toUpperCase()}</button>`;
    }).join('');
}

/** @param {string} msg @param {'ok' | 'err' | ''} [type] */
function setStatus(msg, type) {
    if (!_psiPanel) return;
    const el = /** @type {HTMLElement | null} */ (_psiPanel.querySelector('#psi-status'));
    if (!el) return;
    el.textContent = msg;
    el.dataset.type = type || '';
    if (msg && type === 'ok') setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; el.dataset.type = ''; } }, 4000);
}

function wireEvents() {
    if (!_psiPanel) return;
    const panel = _psiPanel;

    // Stage toggles
    panel.addEventListener('click', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        const toggle = t.closest('[data-toggle]');
        if (toggle) {
            const n = /** @type {HTMLElement} */ (toggle).dataset.toggle;
            if (n) {
                _psiStageOpen[n] = !_psiStageOpen[n];
                const stage = panel.querySelector(`[data-stage="${n}"]`);
                if (stage) stage.setAttribute('data-open', String(_psiStageOpen[n]));
            }
            return;
        }
        // Channel chip
        const chBtn = t.closest('[data-channel]');
        if (chBtn) {
            const ch = /** @type {HTMLElement} */ (chBtn).dataset.channel;
            if (ch === 'all' || ch === 'r' || ch === 'g' || ch === 'b') {
                psImagingState.displayAdj.channel = ch;
                renderChannelBar();
                drawCanvas(psImagingState.currentImageUrl);
            }
            return;
        }
    });

    // File pick
    const fileInput = /** @type {HTMLInputElement | null} */ (panel.querySelector('#psi-file-input'));
    panel.querySelector('#psi-browse-btn')?.addEventListener('click', () => fileInput?.click());
    if (fileInput) fileInput.addEventListener('change', () => {
        const f = fileInput.files && fileInput.files[0];
        if (f) loadFile(f);
    });

    // Calibration manual entry
    const ppmInput = /** @type {HTMLInputElement | null} */ (panel.querySelector('#psi-ppm'));
    if (ppmInput) ppmInput.addEventListener('input', () => {
        const v = parseFloat(ppmInput.value);
        psImagingState.pixelPerMicron = isFinite(v) && v > 0 ? v : null;
        renderInfoBar();
        if (psImagingState.scaleBar.visible) drawCanvas(psImagingState.currentImageUrl);
    });

    // Display adjustment
    const adjEnabled = /** @type {HTMLInputElement | null} */ (panel.querySelector('#psi-adj-enabled'));
    if (adjEnabled) adjEnabled.addEventListener('change', () => {
        psImagingState.displayAdj.enabled = adjEnabled.checked;
        drawCanvas(psImagingState.currentImageUrl);
    });
    /** @param {string} key @param {string} valId @param {boolean} [parseFloat_] */
    const wireSlider = (key, valId, parseFloat_) => {
        const slider = /** @type {HTMLInputElement | null} */ (panel.querySelector(`#psi-adj-${key}`));
        const valLabel = panel.querySelector(`#${valId}`);
        if (!slider || !valLabel) return;
        slider.addEventListener('input', () => {
            const v = parseFloat_ ? parseFloat(slider.value) : parseInt(slider.value, 10);
            /** @type {any} */ (psImagingState.displayAdj)[key] = v;
            valLabel.textContent = String(v);
            drawCanvas(psImagingState.currentImageUrl);
        });
    };
    wireSlider('black', 'psi-adj-black-val');
    wireSlider('white', 'psi-adj-white-val');
    wireSlider('gamma', 'psi-adj-gamma-val', true);

    // Scale bar
    const sbVis = /** @type {HTMLInputElement | null} */ (panel.querySelector('#psi-sb-visible'));
    if (sbVis) sbVis.addEventListener('change', () => {
        psImagingState.scaleBar.visible = sbVis.checked;
        drawCanvas(psImagingState.currentImageUrl);
    });
    const sbColor = /** @type {HTMLInputElement | null} */ (panel.querySelector('#psi-sb-color'));
    if (sbColor) sbColor.addEventListener('input', () => {
        psImagingState.scaleBar.color = sbColor.value;
        drawCanvas(psImagingState.currentImageUrl);
    });

    // Calibration profiles (stub — full add modal in monolith)
    panel.querySelector('#psi-calib-add')?.addEventListener('click', () => setStatus('Add profile (stub) — full modal ships in Session 3j+', ''));
    panel.querySelector('#psi-calib-clear')?.addEventListener('click', () => {
        psImagingState.calibration = null;
        psImagingState.pixelPerMicron = null;
        if (ppmInput) ppmInput.value = '';
        renderInfoBar();
        setStatus('Cleared calibration', 'ok');
    });

    // Save / Redraw
    panel.querySelector('#psi-save-btn')?.addEventListener('click', () => savePng());
    panel.querySelector('#psi-redraw-btn')?.addEventListener('click', () => drawCanvas(psImagingState.currentImageUrl));
}

// ── Module lifecycle ───────────────────────────────────────────────────
/**
 * @param {HTMLElement} rootEl
 * @param {{ bus?: any, lsSave?: any, lsGet?: any }} [_ctx]
 */
export function init(rootEl, _ctx) {
    loadCalibration();
    _psiPanel = rootEl;
    renderPanel(rootEl);
    renderInfoBar();
    renderCalibSelect();
    renderChannelBar();
    wireEvents();
    bus.emit('psi:init', { rootEl, cvReady: isOpenCvReady() });
    return {
        id:             'psi',
        version:        '0.2-session3i-ui-port',
        ready:          true,
        opencvReady:    isOpenCvReady(),
        opencvNote:     'OpenCV.js will lazy-load on first use (~10MB CDN) — port deferred to Session 3j+',
        calibrationSet: !!psImagingState.calibration,
        scaleBarOn:     psImagingState.scaleBar.visible,
        displayAdjOn:   psImagingState.displayAdj.enabled,
    };
}

export function destroy() {
    if (psImagingState.currentImageUrl) URL.revokeObjectURL(psImagingState.currentImageUrl);
    psImagingState.currentImageUrl = null;
    psImagingState.currentFile     = null;
    _psiPanel = null;
    bus.emit('psi:destroy');
}
