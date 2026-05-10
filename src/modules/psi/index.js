// PS Micro Imaging — lazy module (Session 3r histogram Web Worker port, 2026-05-10)
//
// Status: HISTOGRAM ENGINE LIVE — Web Worker computes per-channel R/G/B
// histograms off main thread (CLAUDE.md Rule 12 "reference pattern"). 2MP+
// images auto-downsampled before worker call. Worker source = inline blob,
// no transferable contention. Histogram canvas renders ZEN-style under the
// display adjustment sliders.
//
// DEFERRED to Session 3s+:
//   · OpenCV.js lazy loader (~10 MB WASM) — needed only when measurements port
//   · Annotation tools (line/angle/area/freehand) — uses overlayCanvas + cv.Mat
//   · Loupe magnifier — needs bgBitmap GPU read
//   · Spline LUT (Catmull-Rom) — replaces simple black/white/gamma
//   · Real LUT apply via cached _bgPixels + reusable _applyDst (avoid GC)
//
// CRITICAL invariants (DO NOT regress):
//   - Histogram engine MUST be a Web Worker (Coding Rule 12) — DONE
//   - canvasId never redrawn after initial — bgCanvas holds clean image
//   - overlayCanvas is the ONLY surface for annotations (Session 3s)
//   - LUT apply uses cached _bgPixels + reusable _applyDst (Session 3s)
//   - bgBitmap = GPU-resident ImageBitmap for fast loupe reads (Session 3s)

import { lsSave, lsGet, lsGetJson } from '../../core/storage.js';
import { bus } from '../../core/bus.js';
import { distancePx, computePpm, canvasPointFromClick } from './calibrate.js';
import { angleDeg, polygonAreaPx, polygonCentroid } from './measure.js';
import { loadProfiles, addProfile, deleteProfile, findProfile, PSI_LAST_PROFILE_KEY } from './profiles.js';

const _PSI_LS_CALIB        = 'pslink_micro_calibration';

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

/** Calibration line-tool state — see attachCalibrateHandlers below */
/** @type {boolean} */
let _psiCalibMode = false;
/** @type {{x: number, y: number}[]} */
const _psiCalibPts = [];

/** Persistent measurements drawn over the image. Each entry stays
 *  until "Clear all" so the user can compare multiple features. */
/** @typedef {{ kind: 'line', a: {x:number,y:number}, b: {x:number,y:number}, microns: number | null }} _PsiLineMeasure */
/** @typedef {{ kind: 'angle', a: {x:number,y:number}, b: {x:number,y:number}, c: {x:number,y:number}, deg: number | null }} _PsiAngleMeasure */
/** @typedef {{ kind: 'area', pts: Array<{x:number,y:number}>, areaMicrons2: number | null }} _PsiAreaMeasure */
/** @type {Array<_PsiLineMeasure | _PsiAngleMeasure | _PsiAreaMeasure>} */
const _psiMeasurements = [];
/** @type {boolean} */
let _psiMeasureMode = false;
/** @type {{x: number, y: number}[]} */
const _psiMeasurePts = [];
/** @type {boolean} */
let _psiAngleMode = false;
/** @type {{x: number, y: number}[]} */
const _psiAnglePts = [];
/** @type {boolean} */
let _psiAreaMode = false;
/** @type {{x: number, y: number}[]} */
const _psiAreaPts = [];
/** @type {boolean} */
let _psiFreehandMode = false;
/** @type {boolean} */
let _psiFreehandDragging = false;
/** @type {{x: number, y: number}[]} */
const _psiFreehandPts = [];

/** @type {{ [stage: string]: boolean }} */
const _psiStageOpen = { '1': true, '2': true, '3': false, '4': false };

// ── Histogram Web Worker (CLAUDE.md Rule 12 reference pattern) ─────────
// Inline blob worker — counts R/G/B occurrences in pixel data buffer.
// Returns three Uint32Array(256) channel histograms transferred back so the
// main thread doesn't re-copy. Worker construction + termination happens per
// compute call (cheap, no shared state to manage).

/** @type {{ url: string | null, R: Uint32Array | null, G: Uint32Array | null, B: Uint32Array | null, bgCanvas: HTMLCanvasElement | null }} */
const _psiHist = { url: null, R: null, G: null, B: null, bgCanvas: null };

(function _initHistWorker() {
    const code = [
        'self.onmessage=function(e){',
        '  var d=e.data,hR=new Uint32Array(256),hG=new Uint32Array(256),hB=new Uint32Array(256);',
        '  for(var i=0;i<d.length;i+=4){hR[d[i]]++;hG[d[i+1]]++;hB[d[i+2]]++;}',
        '  self.postMessage({hR:hR,hG:hG,hB:hB},[hR.buffer,hG.buffer,hB.buffer]);',
        '};',
    ].join('');
    try {
        _psiHist.url = URL.createObjectURL(new Blob([code], { type: 'application/javascript' }));
    } catch (_e) { _psiHist.url = null; }
})();

/**
 * Compute R/G/B histograms via Web Worker. Down-samples > 2MP images to
 * ~500k samples before posting so worker doesn't burn cycles on huge frames.
 * On completion, stores results in `_psiHist.R/G/B` and re-renders the
 * histogram canvas.
 */
function _psiHistCompute() {
    const bg = _psiHist.bgCanvas;
    if (!bg) return;
    let raw;
    try {
        const ctx = bg.getContext('2d');
        if (!ctx) return;
        raw = ctx.getImageData(0, 0, bg.width, bg.height).data;
    } catch (_e) { return; }
    const pixels = raw.length / 4;
    const step = (pixels > 2e6) ? Math.ceil(raw.length / (4 * 500000)) * 4 : 4;
    /** @type {Uint8Array} */
    let sampled;
    if (step > 4) {
        sampled = new Uint8Array(Math.ceil(raw.length / step) * 4);
        let si = 0;
        for (let i = 0; i < raw.length; i += step) {
            sampled[si++] = raw[i];
            sampled[si++] = raw[i + 1];
            sampled[si++] = raw[i + 2];
            sampled[si++] = raw[i + 3];
        }
    } else {
        sampled = new Uint8Array(raw.buffer.slice(0));
    }
    if (_psiHist.url) {
        const w = new Worker(_psiHist.url);
        w.onmessage = (ev) => {
            _psiHist.R = ev.data.hR;
            _psiHist.G = ev.data.hG;
            _psiHist.B = ev.data.hB;
            w.terminate();
            _psiHistDraw();
            bus.emit('psi:hist-computed', { samples: sampled.length / 4 });
        };
        w.postMessage(sampled, [sampled.buffer]);
    } else {
        // Fallback: sync compute on main thread
        const hR = new Uint32Array(256), hG = new Uint32Array(256), hB = new Uint32Array(256);
        for (let i = 0; i < sampled.length; i += 4) {
            hR[sampled[i]]++; hG[sampled[i + 1]]++; hB[sampled[i + 2]]++;
        }
        _psiHist.R = hR; _psiHist.G = hG; _psiHist.B = hB;
        _psiHistDraw();
    }
}

/**
 * Render the histogram on the Stage-3 canvas (ZEN-style: light gray bg,
 * gridlines at 50/100/150/200, per-channel bars in additive blend mode).
 */
function _psiHistDraw() {
    if (!_psiPanel) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-hist-canvas'));
    const wrap   = /** @type {HTMLElement | null} */     (_psiPanel.querySelector('#psi-hist-wrap'));
    if (!canvas || !wrap) return;
    const W = wrap.clientWidth, H = wrap.clientHeight;
    if (W < 4 || H < 4) return;
    canvas.width = W; canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, W, H);

    const LABEL_H = 10;
    const barH = H - LABEL_H;

    // Background — ZEN light gray
    ctx.fillStyle = '#e4e5e1';
    ctx.fillRect(0, 0, W, H);

    // Grid: horizontal at 25/50/75% + vertical at 50/100/150/200
    const gridVals = [50, 100, 150, 200];
    ctx.strokeStyle = 'rgba(0,0,0,0.10)'; ctx.lineWidth = 1;
    [0.25, 0.5, 0.75].forEach((f) => {
        const gy = Math.round(barH * (1 - f) * 0.96 + LABEL_H) + 0.5;
        ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    });
    ctx.strokeStyle = 'rgba(0,0,0,0.18)';
    gridVals.forEach((v) => {
        const gx = Math.round(v * W / 255) + 0.5;
        ctx.beginPath(); ctx.moveTo(gx, LABEL_H); ctx.lineTo(gx, barH); ctx.stroke();
    });
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.font = 'bold 7.5px monospace';
    ctx.textAlign = 'center';
    gridVals.forEach((v) => ctx.fillText(String(v), Math.round(v * W / 255), LABEL_H - 1));

    const adj = psImagingState.displayAdj || { black: 0, white: 255, gamma: 1.0, channel: 'all' };
    const ch = adj.channel || 'all';
    const hR = _psiHist.R, hG = _psiHist.G, hB = _psiHist.B;
    if (!hR || !hG || !hB) {
        ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.textAlign = 'center';
        ctx.font = '10px sans-serif';
        ctx.fillText('Open an image to see histogram', W / 2, barH / 2 + 4);
        return;
    }

    // Effective peak from mid-bins (1-254) only, ignore saturation 0/255
    /** @type {Uint32Array[]} */
    const chs = ch === 'r' ? [hR] : ch === 'g' ? [hG] : ch === 'b' ? [hB] : [hR, hG, hB];
    let effPeak = 0;
    for (const arr of chs) {
        for (let v = 1; v <= 254; v++) if (arr[v] > effPeak) effPeak = arr[v];
    }
    if (effPeak < 1) effPeak = 1;

    // Per-channel bars — additive blend so overlap shows white-ish (RGB sum)
    /** @type {Array<[Uint32Array, string]>} */
    const colored = ch === 'r' ? [[hR, 'rgba(220,40,40,0.85)']]
                  : ch === 'g' ? [[hG, 'rgba(40,180,40,0.85)']]
                  : ch === 'b' ? [[hB, 'rgba(40,80,220,0.85)']]
                  : [[hR, 'rgba(220,40,40,0.6)'], [hG, 'rgba(40,180,40,0.6)'], [hB, 'rgba(40,80,220,0.6)']];
    const prevComp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = ch === 'all' ? 'multiply' : 'source-over';
    for (const [arr, color] of colored) {
        ctx.fillStyle = color;
        for (let v = 0; v < 256; v++) {
            const x = Math.round(v * W / 255);
            const xNext = Math.round((v + 1) * W / 255);
            const bw = Math.max(1, xNext - x);
            const h = Math.min(barH, (arr[v] / effPeak) * barH * 0.96);
            ctx.fillRect(x, LABEL_H + (barH - h), bw, h);
        }
    }
    ctx.globalCompositeOperation = prevComp;

    // Black/white-point markers — vertical lines at adj.black + adj.white
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.setLineDash([2, 3]);
    const xb = Math.round(adj.black * W / 255) + 0.5;
    const xw = Math.round(adj.white * W / 255) + 0.5;
    ctx.beginPath(); ctx.moveTo(xb, LABEL_H); ctx.lineTo(xb, barH); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(xw, LABEL_H); ctx.lineTo(xw, barH); ctx.stroke();
    ctx.setLineDash([]);
}

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
export { loadProfiles as loadCalibProfiles } from './profiles.js';

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
        redrawAllMeasurements();
        if (placeholder) placeholder.style.display = 'none';
        canvas.style.display = '';
        // Hook histogram compute — bgCanvas is the rendered preview canvas itself
        // (full-res cache deferred to Session 3s when we wire bgBitmap).
        _psiHist.bgCanvas = canvas;
        _psiHistCompute();
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
                    <div class="actions" style="margin-top:10px;">
                        <button class="act" id="psi-calib-line">Draw calibration line</button>
                        <span id="psi-calib-hint" style="font-size:11px;color:var(--dim, #888);"></span>
                    </div>
                    <div style="font-size:11px;color:var(--dim, #888);margin-top:8px;line-height:1.5;">
                        Click two points on a stage micrometer image, then enter the known distance in microns. Pixels per micron is computed automatically.
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
                    <label>Histogram (R / G / B · ZEN-style · Web Worker)</label>
                    <div id="psi-hist-wrap" style="position:relative;width:100%;height:96px;background:#e4e5e1;border:1px solid var(--border, #2a2a2a);border-radius:6px;overflow:hidden;margin-bottom:10px;">
                        <canvas id="psi-hist-canvas" style="display:block;width:100%;height:100%;"></canvas>
                    </div>

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

            <div class="stage" data-stage="4" data-open="${_psiStageOpen['4']}">
                <div class="stage-hdr" data-toggle="4">
                    <span class="num">Stage 4</span>
                    <span class="title">Measurements</span>
                    <span class="arrow">›</span>
                </div>
                <div class="stage-body">
                    <div class="actions">
                        <button class="act" id="psi-measure-line">Measure line</button>
                        <button class="act" id="psi-measure-angle">Measure angle</button>
                        <button class="act" id="psi-measure-area">Measure area</button>
                        <button class="act" id="psi-measure-freehand">Freehand area</button>
                        <button class="act ghost" id="psi-measure-clear">Clear all</button>
                        <span id="psi-measure-hint" style="font-size:11px;color:var(--dim, #888);"></span>
                    </div>
                    <div id="psi-measure-list" style="margin-top:10px;font-family:var(--mono, monospace);font-size:11px;color:var(--dim, #888);"></div>
                    <div style="font-size:11px;color:var(--dim, #888);margin-top:8px;line-height:1.5;">
                        Calibrate first (Stage 1) for real micron readouts; uncalibrated lines show pixel length only.
                    </div>
                </div>
            </div>

            <div class="actions">
                <button class="act"       id="psi-save-btn">Save PNG</button>
                <button class="act ghost" id="psi-redraw-btn">Redraw</button>
                <span id="psi-status"></span>
            </div>

            <div class="stub-note">
                <strong>Session 3r port</strong> — Histogram Web Worker engine live (CLAUDE.md Rule 12 reference): R/G/B per-channel + ZEN-style render + 2MP+ downsample. OpenCV.js measurements + annotation tools + loupe + spline LUT ship in Session 3s+.
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
    const profiles = loadProfiles();
    const last = lsGet(PSI_LAST_PROFILE_KEY, '');
    sel.innerHTML = '<option value="">— no profile —</option>' +
        profiles.map((p) => `<option value="${he(p.id)}" ${p.id === last ? 'selected' : ''}>${he(p.name)} · ${p.ratio.toFixed(2)} px/µm</option>`).join('');
}

/** Apply the chosen profile's ratio as the active calibration. */
function applyProfileById(/** @type {string} */ id) {
    if (!id) return;
    const p = findProfile(id);
    if (!p) return;
    psImagingState.pixelPerMicron = p.ratio;
    psImagingState.calibration = { pixelPerMicron: p.ratio, lastUpdated: Date.now(), method: 'profile', profileId: p.id, profileName: p.name };
    saveCalibration();
    lsSave(PSI_LAST_PROFILE_KEY, p.id);
    if (_psiPanel) {
        const ppmInput = /** @type {HTMLInputElement | null} */ (_psiPanel.querySelector('#psi-ppm'));
        if (ppmInput) ppmInput.value = p.ratio.toFixed(3);
    }
    renderInfoBar();
    setStatus(`Profile applied: ${p.name} (${p.ratio.toFixed(3)} px/µm)`, 'ok');
    bus.emit('psi:profile-applied', { id: p.id, name: p.name, ratio: p.ratio });
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
                _psiHistDraw();
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
            _psiHistDraw();
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

    // Calibration profiles
    panel.querySelector('#psi-calib-add')?.addEventListener('click', () => openProfileModal());
    panel.querySelector('#psi-calib-clear')?.addEventListener('click', () => {
        psImagingState.calibration = null;
        psImagingState.pixelPerMicron = null;
        if (ppmInput) ppmInput.value = '';
        renderInfoBar();
        setStatus('Cleared calibration', 'ok');
    });
    const calibSelect = /** @type {HTMLSelectElement | null} */ (panel.querySelector('#psi-calib-select'));
    if (calibSelect) calibSelect.addEventListener('change', () => applyProfileById(calibSelect.value));

    // Save / Redraw
    panel.querySelector('#psi-save-btn')?.addEventListener('click', () => savePng());
    panel.querySelector('#psi-redraw-btn')?.addEventListener('click', () => drawCanvas(psImagingState.currentImageUrl));

    // Calibration line tool
    panel.querySelector('#psi-calib-line')?.addEventListener('click', () => startCalibLine());
    panel.querySelector('#psi-measure-line')?.addEventListener('click', () => startMeasureLine());
    panel.querySelector('#psi-measure-angle')?.addEventListener('click', () => startMeasureAngle());
    panel.querySelector('#psi-measure-area')?.addEventListener('click', () => toggleAreaMode());
    panel.querySelector('#psi-measure-freehand')?.addEventListener('click', () => startFreehandMode());
    panel.querySelector('#psi-measure-clear')?.addEventListener('click', () => clearMeasurements());
    const canvas = /** @type {HTMLCanvasElement | null} */ (panel.querySelector('#psi-canvas'));
    if (canvas) {
        canvas.addEventListener('click', (ev) => {
            if (_psiCalibMode) onCalibCanvasClick(ev);
            else if (_psiMeasureMode) onMeasureCanvasClick(ev);
            else if (_psiAngleMode) onAngleCanvasClick(ev);
            else if (_psiAreaMode) onAreaCanvasClick(ev);
        });
        canvas.addEventListener('mousedown', (ev) => {
            if (_psiFreehandMode) onFreehandMouseDown(ev);
        });
        canvas.addEventListener('mousemove', (ev) => {
            if (_psiFreehandMode && _psiFreehandDragging) onFreehandMouseMove(ev);
        });
        canvas.addEventListener('mouseup', (ev) => {
            if (_psiFreehandMode && _psiFreehandDragging) onFreehandMouseUp(ev);
        });
        canvas.addEventListener('mouseleave', () => {
            if (_psiFreehandMode && _psiFreehandDragging) onFreehandMouseUp(null);
        });
    }
}

// ── Calibration line tool ──────────────────────────────────────────────

function paintCalibHint(/** @type {string} */ text) {
    if (!_psiPanel) return;
    const el = _psiPanel.querySelector('#psi-calib-hint');
    if (el) el.textContent = text;
}

function startCalibLine() {
    if (!_psiPanel) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (!canvas || canvas.style.display === 'none') {
        setStatus('Load an image first', 'err');
        return;
    }
    _psiCalibMode = true;
    _psiCalibPts.length = 0;
    canvas.style.cursor = 'crosshair';
    paintCalibHint('Click point 1 of the known distance');
}

function exitCalibLine() {
    if (!_psiPanel) return;
    _psiCalibMode = false;
    _psiCalibPts.length = 0;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (canvas) canvas.style.cursor = '';
    paintCalibHint('');
    drawCanvas(psImagingState.currentImageUrl); // redraw clean (clears markers)
}

/** @param {MouseEvent} ev */
function onCalibCanvasClick(ev) {
    if (!_psiCalibMode || !_psiPanel) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (!canvas) return;
    const pt = canvasPointFromClick(canvas, ev);
    _psiCalibPts.push(pt);
    drawCalibMarker(canvas, pt, _psiCalibPts.length);
    if (_psiCalibPts.length === 1) {
        paintCalibHint('Click point 2');
        return;
    }
    // Two points collected — draw the line + prompt for distance
    drawCalibLine(canvas, _psiCalibPts[0], _psiCalibPts[1]);
    const px = distancePx(_psiCalibPts[0], _psiCalibPts[1]);
    paintCalibHint(`Line: ${px.toFixed(1)}px`);
    const input = window.prompt(`Line is ${px.toFixed(1)}px. Enter the known distance in microns:`, '100');
    if (input === null) { exitCalibLine(); return; }
    const um = parseFloat(input);
    const ppm = computePpm(_psiCalibPts[0], _psiCalibPts[1], um);
    if (ppm === null) {
        setStatus('Invalid distance — calibration cancelled', 'err');
        exitCalibLine();
        return;
    }
    psImagingState.pixelPerMicron = ppm;
    psImagingState.calibration = { pixelPerMicron: ppm, lastUpdated: Date.now(), method: 'line-tool', linePx: px, knownMicrons: um };
    // Line-tool calibration replaces any active profile selection — clear the
    // dropdown highlight so the user isn't confused which calibration is live.
    try { localStorage.removeItem(PSI_LAST_PROFILE_KEY); } catch (_e) { /* private mode */ }
    const ppmInput = /** @type {HTMLInputElement | null} */ (_psiPanel.querySelector('#psi-ppm'));
    if (ppmInput) ppmInput.value = ppm.toFixed(3);
    saveCalibration();
    renderCalibSelect();
    renderInfoBar();
    setStatus(`Calibration: ${ppm.toFixed(3)} px/µm (${px.toFixed(1)}px = ${um}µm)`, 'ok');
    exitCalibLine();
}

function drawCalibMarker(/** @type {HTMLCanvasElement} */ canvas, /** @type {{x:number,y:number}} */ pt, /** @type {number} */ idx) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = '#089981';
    ctx.fillStyle = '#089981';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 6, 0, Math.PI * 2);
    ctx.stroke();
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#000';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#089981';
    ctx.fillText(String(idx), pt.x, pt.y);
    ctx.restore();
}

function drawCalibLine(/** @type {HTMLCanvasElement} */ canvas, /** @type {{x:number,y:number}} */ a, /** @type {{x:number,y:number}} */ b) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = '#089981';
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.restore();
}

// ── Measurement line tool ──────────────────────────────────────────────

function paintMeasureHint(/** @type {string} */ text) {
    if (!_psiPanel) return;
    const el = _psiPanel.querySelector('#psi-measure-hint');
    if (el) el.textContent = text;
}

function startMeasureLine() {
    if (!_psiPanel) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (!canvas || canvas.style.display === 'none') {
        setStatus('Load an image first', 'err');
        return;
    }
    if (_psiCalibMode) exitCalibLine();
    if (_psiAngleMode) exitAngleMode();
    _psiMeasureMode = true;
    _psiMeasurePts.length = 0;
    canvas.style.cursor = 'crosshair';
    paintMeasureHint('Click point 1');
}

function exitMeasureMode() {
    if (!_psiPanel) return;
    _psiMeasureMode = false;
    _psiMeasurePts.length = 0;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (canvas) canvas.style.cursor = '';
    paintMeasureHint('');
}

function startMeasureAngle() {
    if (!_psiPanel) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (!canvas || canvas.style.display === 'none') {
        setStatus('Load an image first', 'err');
        return;
    }
    if (_psiCalibMode) exitCalibLine();
    if (_psiMeasureMode) exitMeasureMode();
    if (_psiAreaMode) exitAreaMode();
    _psiAngleMode = true;
    _psiAnglePts.length = 0;
    canvas.style.cursor = 'crosshair';
    paintMeasureHint('Click first ray endpoint');
}

function exitAngleMode() {
    if (!_psiPanel) return;
    _psiAngleMode = false;
    _psiAnglePts.length = 0;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (canvas) canvas.style.cursor = '';
    paintMeasureHint('');
}

function paintAreaButton() {
    if (!_psiPanel) return;
    const btn = /** @type {HTMLButtonElement | null} */ (_psiPanel.querySelector('#psi-measure-area'));
    if (!btn) return;
    btn.textContent = _psiAreaMode ? 'Finish polygon' : 'Measure area';
}

function toggleAreaMode() {
    if (!_psiAreaMode) startAreaMode();
    else finishAreaPolygon();
}

function startAreaMode() {
    if (!_psiPanel) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (!canvas || canvas.style.display === 'none') {
        setStatus('Load an image first', 'err');
        return;
    }
    if (_psiCalibMode) exitCalibLine();
    if (_psiMeasureMode) exitMeasureMode();
    if (_psiAngleMode) exitAngleMode();
    _psiAreaMode = true;
    _psiAreaPts.length = 0;
    canvas.style.cursor = 'crosshair';
    paintMeasureHint('Click polygon vertices · finish to close');
    paintAreaButton();
}

function exitAreaMode() {
    if (!_psiPanel) return;
    _psiAreaMode = false;
    _psiAreaPts.length = 0;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (canvas) canvas.style.cursor = '';
    paintMeasureHint('');
    paintAreaButton();
}

function finishAreaPolygon() {
    if (!_psiAreaMode) return;
    if (_psiAreaPts.length < 3) {
        setStatus('Polygon needs at least 3 points', 'err');
        exitAreaMode();
        drawCanvas(psImagingState.currentImageUrl);
        return;
    }
    const pts = _psiAreaPts.slice();
    const areaPx2 = polygonAreaPx(pts);
    const ppm = psImagingState.pixelPerMicron;
    const areaMicrons2 = (typeof ppm === 'number' && ppm > 0) ? areaPx2 / (ppm * ppm) : null;
    _psiMeasurements.push({ kind: 'area', pts, areaMicrons2 });
    exitAreaMode();
    drawCanvas(psImagingState.currentImageUrl);
    renderMeasureList();
    setStatus(
        areaMicrons2 != null
            ? `Area ${_psiMeasurements.length}: ${areaMicrons2.toFixed(2)} µm²`
            : `Area ${_psiMeasurements.length}: ${areaPx2.toFixed(1)} px²`,
        'ok',
    );
}

function startFreehandMode() {
    if (!_psiPanel) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (!canvas || canvas.style.display === 'none') {
        setStatus('Load an image first', 'err');
        return;
    }
    if (_psiCalibMode) exitCalibLine();
    if (_psiMeasureMode) exitMeasureMode();
    if (_psiAngleMode) exitAngleMode();
    if (_psiAreaMode) exitAreaMode();
    _psiFreehandMode = true;
    _psiFreehandDragging = false;
    _psiFreehandPts.length = 0;
    canvas.style.cursor = 'crosshair';
    paintMeasureHint('Click & drag to outline a region');
}

function exitFreehandMode() {
    if (!_psiPanel) return;
    _psiFreehandMode = false;
    _psiFreehandDragging = false;
    _psiFreehandPts.length = 0;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (canvas) canvas.style.cursor = '';
    paintMeasureHint('');
}

const _PSI_FREEHAND_MIN_DIST_PX = 3; // distance-based simplification — drops noise samples while preserving curve fidelity

/** @param {MouseEvent} ev */
function onFreehandMouseDown(ev) {
    if (!_psiFreehandMode || !_psiPanel) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (!canvas) return;
    const pt = canvasPointFromClick(canvas, ev);
    _psiFreehandDragging = true;
    _psiFreehandPts.length = 0;
    _psiFreehandPts.push(pt);
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
}

/** @param {MouseEvent} ev */
function onFreehandMouseMove(ev) {
    if (!_psiFreehandMode || !_psiFreehandDragging || !_psiPanel) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (!canvas) return;
    const pt = canvasPointFromClick(canvas, ev);
    const last = _psiFreehandPts[_psiFreehandPts.length - 1];
    if (!last) return;
    if (distancePx(last, pt) < _PSI_FREEHAND_MIN_DIST_PX) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    ctx.moveTo(last.x, last.y);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
    ctx.restore();
    _psiFreehandPts.push(pt);
}

/** @param {MouseEvent | null} _ev */
function onFreehandMouseUp(_ev) {
    if (!_psiFreehandMode || !_psiFreehandDragging) return;
    _psiFreehandDragging = false;
    if (_psiFreehandPts.length < 3) {
        setStatus('Freehand region too small (< 3 points)', 'err');
        exitFreehandMode();
        drawCanvas(psImagingState.currentImageUrl);
        return;
    }
    const pts = _psiFreehandPts.slice();
    const areaPx2 = polygonAreaPx(pts);
    const ppm = psImagingState.pixelPerMicron;
    const areaMicrons2 = (typeof ppm === 'number' && ppm > 0) ? areaPx2 / (ppm * ppm) : null;
    _psiMeasurements.push({ kind: 'area', pts, areaMicrons2 });
    exitFreehandMode();
    drawCanvas(psImagingState.currentImageUrl);
    renderMeasureList();
    setStatus(
        areaMicrons2 != null
            ? `Freehand ${_psiMeasurements.length}: ${areaMicrons2.toFixed(2)} µm² · ${pts.length} samples`
            : `Freehand ${_psiMeasurements.length}: ${areaPx2.toFixed(1)} px² · ${pts.length} samples`,
        'ok',
    );
}

function clearMeasurements() {
    _psiMeasurements.length = 0;
    renderMeasureList();
    drawCanvas(psImagingState.currentImageUrl);
    setStatus('Cleared measurements', 'ok');
}

function renderMeasureList() {
    if (!_psiPanel) return;
    const el = _psiPanel.querySelector('#psi-measure-list');
    if (!el) return;
    if (!_psiMeasurements.length) { el.textContent = ''; return; }
    el.innerHTML = _psiMeasurements.map((m, i) => {
        if (m.kind === 'line') {
            const px = distancePx(m.a, m.b);
            const txt = m.microns != null ? m.microns.toFixed(2) + ' µm' : `${px.toFixed(1)}px (no calib)`;
            return `<div style="padding:3px 0;">${i + 1}. line — ${txt}</div>`;
        }
        if (m.kind === 'angle') {
            const txt = m.deg != null ? m.deg.toFixed(2) + '°' : '—';
            return `<div style="padding:3px 0;">${i + 1}. angle — ${txt}</div>`;
        }
        // area
        const px2 = polygonAreaPx(m.pts);
        const txt = m.areaMicrons2 != null ? m.areaMicrons2.toFixed(2) + ' µm²' : `${px2.toFixed(1)}px² (no calib)`;
        return `<div style="padding:3px 0;">${i + 1}. area — ${txt} · ${m.pts.length} vertices</div>`;
    }).join('');
}

/** @param {HTMLCanvasElement} canvas @param {_PsiLineMeasure} m */
function drawLineMeasure(canvas, m) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = '#fbbf24';
    ctx.fillStyle = '#fbbf24';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(m.a.x, m.a.y);
    ctx.lineTo(m.b.x, m.b.y);
    ctx.stroke();
    // Tick marks at endpoints (perpendicular to line)
    const dx = m.b.x - m.a.x, dy = m.b.y - m.a.y;
    const len = Math.sqrt(dx * dx + dy * dy) || 1;
    const nx = -dy / len * 5, ny = dx / len * 5;
    [m.a, m.b].forEach((p) => {
        ctx.beginPath();
        ctx.moveTo(p.x - nx, p.y - ny);
        ctx.lineTo(p.x + nx, p.y + ny);
        ctx.stroke();
    });
    // Label at midpoint
    const mx = (m.a.x + m.b.x) / 2, my = (m.a.y + m.b.y) / 2;
    const label = m.microns != null ? `${m.microns.toFixed(2)} µm` : `${distancePx(m.a, m.b).toFixed(1)}px`;
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(mx - w / 2 - 4, my - 8, w + 8, 16);
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(label, mx, my);
    ctx.restore();
}

/** @param {HTMLCanvasElement} canvas @param {_PsiAngleMeasure} m */
function drawAngleMeasure(canvas, m) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.save();
    ctx.strokeStyle = '#fbbf24';
    ctx.fillStyle = '#fbbf24';
    ctx.lineWidth = 2;
    // Two rays from vertex b
    ctx.beginPath();
    ctx.moveTo(m.a.x, m.a.y);
    ctx.lineTo(m.b.x, m.b.y);
    ctx.lineTo(m.c.x, m.c.y);
    ctx.stroke();
    // Arc at the vertex — 22px radius capped at 35% of shorter ray, so a tiny
    // angle on a long pair of rays still gets a proportional arc.
    const r1 = Math.sqrt((m.a.x - m.b.x) ** 2 + (m.a.y - m.b.y) ** 2);
    const r2 = Math.sqrt((m.c.x - m.b.x) ** 2 + (m.c.y - m.b.y) ** 2);
    const arcR = Math.min(22, Math.min(r1, r2) * 0.35);
    if (arcR > 1) {
        const a1 = Math.atan2(m.a.y - m.b.y, m.a.x - m.b.x);
        const a2 = Math.atan2(m.c.y - m.b.y, m.c.x - m.b.x);
        // Choose the SHORT arc direction so the visual matches angleDeg's [0,180] result
        let delta = a2 - a1;
        while (delta >  Math.PI) delta -= 2 * Math.PI;
        while (delta < -Math.PI) delta += 2 * Math.PI;
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(m.b.x, m.b.y, arcR, a1, a1 + delta, delta < 0);
        ctx.stroke();
    }
    // Label outside the arc, along the angle bisector
    const a1 = Math.atan2(m.a.y - m.b.y, m.a.x - m.b.x);
    const a2 = Math.atan2(m.c.y - m.b.y, m.c.x - m.b.x);
    let bisect = (a1 + a2) / 2;
    // If rays span > 180°, bisector flips — push to the inside
    if (Math.abs(a2 - a1) > Math.PI) bisect += Math.PI;
    const labelR = arcR + 14;
    const lx = m.b.x + Math.cos(bisect) * labelR;
    const ly = m.b.y + Math.sin(bisect) * labelR;
    const label = m.deg != null ? `${m.deg.toFixed(1)}°` : '—';
    ctx.font = 'bold 11px monospace';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(label).width;
    ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
    ctx.fillRect(lx - w / 2 - 4, ly - 8, w + 8, 16);
    ctx.fillStyle = '#fbbf24';
    ctx.fillText(label, lx, ly);
    ctx.restore();
}

/** @param {HTMLCanvasElement} canvas @param {_PsiAreaMeasure} m */
function drawAreaMeasure(canvas, m) {
    const ctx = canvas.getContext('2d');
    if (!ctx || m.pts.length < 2) return;
    ctx.save();
    ctx.strokeStyle = '#fbbf24';
    ctx.fillStyle = 'rgba(251, 191, 36, 0.18)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(m.pts[0].x, m.pts[0].y);
    for (let i = 1; i < m.pts.length; i++) ctx.lineTo(m.pts[i].x, m.pts[i].y);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Label at centroid
    const c = polygonCentroid(m.pts);
    if (c) {
        const px2 = polygonAreaPx(m.pts);
        const label = m.areaMicrons2 != null
            ? `${m.areaMicrons2.toFixed(2)} µm²`
            : `${px2.toFixed(1)} px²`;
        ctx.font = 'bold 11px monospace';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const w = ctx.measureText(label).width;
        ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
        ctx.fillRect(c.x - w / 2 - 4, c.y - 8, w + 8, 16);
        ctx.fillStyle = '#fbbf24';
        ctx.fillText(label, c.x, c.y);
    }
    ctx.restore();
}

function redrawAllMeasurements() {
    if (!_psiPanel) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (!canvas) return;
    for (const m of _psiMeasurements) {
        if (m.kind === 'line') drawLineMeasure(canvas, m);
        else if (m.kind === 'angle') drawAngleMeasure(canvas, m);
        else drawAreaMeasure(canvas, m);
    }
}

/** @param {MouseEvent} ev */
function onAreaCanvasClick(ev) {
    if (!_psiAreaMode || !_psiPanel) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const pt = canvasPointFromClick(canvas, ev);
    // Incremental paint: connect previous vertex to this one, then drop a marker.
    // Avoids reloading the image (drawCanvas is async via img.onload) on every click.
    const prevLen = _psiAreaPts.length;
    ctx.save();
    ctx.strokeStyle = '#fbbf24';
    ctx.lineWidth = 2;
    if (prevLen > 0) {
        ctx.beginPath();
        ctx.moveTo(_psiAreaPts[prevLen - 1].x, _psiAreaPts[prevLen - 1].y);
        ctx.lineTo(pt.x, pt.y);
        ctx.stroke();
    }
    ctx.fillStyle = '#fbbf24';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
    _psiAreaPts.push(pt);
    paintMeasureHint(
        _psiAreaPts.length < 3
            ? `Vertex ${_psiAreaPts.length} — need ${3 - _psiAreaPts.length} more`
            : `${_psiAreaPts.length} vertices — click "Finish polygon" to close`,
    );
}

/** @param {MouseEvent} ev */
function onMeasureCanvasClick(ev) {
    if (!_psiMeasureMode || !_psiPanel) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (!canvas) return;
    const pt = canvasPointFromClick(canvas, ev);
    _psiMeasurePts.push(pt);
    drawCalibMarker(canvas, pt, _psiMeasurePts.length);
    if (_psiMeasurePts.length === 1) {
        paintMeasureHint('Click point 2');
        return;
    }
    const a = _psiMeasurePts[0], b = _psiMeasurePts[1];
    const px = distancePx(a, b);
    if (px <= 0) { exitMeasureMode(); return; }
    const ppm = psImagingState.pixelPerMicron;
    const microns = (typeof ppm === 'number' && ppm > 0) ? px / ppm : null;
    _psiMeasurements.push({ kind: 'line', a, b, microns });
    drawCanvas(psImagingState.currentImageUrl); // clean redraw — new measurement painted via redrawAllMeasurements after image loads
    renderMeasureList();
    setStatus(microns != null ? `Line ${_psiMeasurements.length}: ${microns.toFixed(2)} µm` : `Line ${_psiMeasurements.length}: ${px.toFixed(1)}px`, 'ok');
    exitMeasureMode();
}

/** @param {MouseEvent} ev */
function onAngleCanvasClick(ev) {
    if (!_psiAngleMode || !_psiPanel) return;
    const canvas = /** @type {HTMLCanvasElement | null} */ (_psiPanel.querySelector('#psi-canvas'));
    if (!canvas) return;
    const pt = canvasPointFromClick(canvas, ev);
    _psiAnglePts.push(pt);
    drawCalibMarker(canvas, pt, _psiAnglePts.length);
    if (_psiAnglePts.length === 1) {
        paintMeasureHint('Click vertex');
        return;
    }
    if (_psiAnglePts.length === 2) {
        paintMeasureHint('Click second ray endpoint');
        return;
    }
    const a = _psiAnglePts[0], b = _psiAnglePts[1], c = _psiAnglePts[2];
    const deg = angleDeg(a, b, c);
    if (deg === null) {
        setStatus('Cannot measure — points overlap', 'err');
        exitAngleMode();
        drawCanvas(psImagingState.currentImageUrl);
        return;
    }
    _psiMeasurements.push({ kind: 'angle', a, b, c, deg });
    drawCanvas(psImagingState.currentImageUrl);
    renderMeasureList();
    setStatus(`Angle ${_psiMeasurements.length}: ${deg.toFixed(2)}°`, 'ok');
    exitAngleMode();
}

// ── Calibration profile modal ──────────────────────────────────────────

/** @type {HTMLElement | null} */
let _psiProfileModal = null;

function closeProfileModal() {
    if (!_psiProfileModal) return;
    const m = _psiProfileModal;
    _psiProfileModal = null;
    m.classList.remove('show');
    setTimeout(() => { try { m.remove(); } catch (_e) { /* already gone */ } }, 160);
}

function renderProfileModalBody() {
    if (!_psiProfileModal) return;
    const list = _psiProfileModal.querySelector('#psi-prof-list');
    if (!list) return;
    const profiles = loadProfiles();
    if (profiles.length === 0) {
        list.innerHTML = '<div style="padding:16px 0;text-align:center;color:var(--dim, #888);font-size:11px;">No profiles saved yet</div>';
    } else {
        list.innerHTML = profiles.map((p) => `
            <div class="psi-prof-row" data-pid="${he(p.id)}" style="display:flex;align-items:center;justify-content:space-between;padding:8px 10px;border:1px solid var(--border, #2a2a2a);border-radius:6px;margin-bottom:6px;">
                <div style="display:flex;flex-direction:column;gap:2px;min-width:0;">
                    <span style="font-size:12px;font-weight:600;color:var(--fg, #f5f5f7);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${he(p.name)}</span>
                    <span style="font-family:var(--mono, monospace);font-size:10px;color:var(--accent, #089981);">${p.ratio.toFixed(3)} px/µm</span>
                </div>
                <button data-act="del" data-pid="${he(p.id)}" title="Delete profile" style="background:transparent;border:1px solid var(--border, #2a2a2a);border-radius:6px;padding:4px 8px;cursor:pointer;font-size:11px;color:#f43f5e;">&times;</button>
            </div>
        `).join('');
    }
    // Update Save button state based on current ppm
    const saveBtn = /** @type {HTMLButtonElement | null} */ (_psiProfileModal.querySelector('#psi-prof-save'));
    const nameInput = /** @type {HTMLInputElement | null} */ (_psiProfileModal.querySelector('#psi-prof-name'));
    const status = /** @type {HTMLElement | null} */ (_psiProfileModal.querySelector('#psi-prof-status'));
    const ppm = psImagingState.pixelPerMicron;
    const havePpm = typeof ppm === 'number' && ppm > 0;
    if (status) {
        status.textContent = havePpm
            ? `Current calibration: ${ppm.toFixed(3)} px/µm`
            : 'Calibrate first (Stage 1) to enable saving';
        status.style.color = havePpm ? 'var(--accent, #089981)' : 'var(--dim, #888)';
    }
    if (saveBtn) saveBtn.disabled = !havePpm;
    if (nameInput) nameInput.disabled = !havePpm;
}

function openProfileModal() {
    if (_psiProfileModal) return; // already open
    const m = document.createElement('div');
    m.className = 'psi-prof-modal';
    m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.55);z-index:9000;display:flex;align-items:center;justify-content:center;opacity:0;transition:opacity .16s ease;';
    m.innerHTML = `
        <div role="dialog" aria-modal="true" style="background:var(--bg, #0d0d0d);color:var(--fg, #f5f5f7);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:18px;width:min(420px, 92vw);max-height:80vh;overflow-y:auto;box-shadow:0 10px 40px rgba(0,0,0,0.6);font-family:var(--sans, system-ui, sans-serif);">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:12px;">
                <strong style="font-size:14px;">Calibration profiles</strong>
                <button id="psi-prof-close" style="background:transparent;border:0;color:var(--dim, #888);font-size:18px;cursor:pointer;">&times;</button>
            </div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim, #888);font-weight:700;margin-bottom:6px;">Save current calibration</div>
            <div id="psi-prof-status" style="font-size:11px;margin-bottom:8px;"></div>
            <div style="display:flex;gap:6px;margin-bottom:14px;">
                <input id="psi-prof-name" type="text" placeholder="e.g. 10× Olympus BX53" maxlength="60" style="flex:1;background:var(--bg, #0d0d0d);color:var(--fg, #f5f5f7);border:1px solid var(--border, #2a2a2a);border-radius:6px;padding:6px 10px;font-size:12px;outline:none;font-family:inherit;" />
                <button id="psi-prof-save" style="background:var(--accent, #089981);color:#000;border:0;padding:6px 14px;border-radius:6px;font-weight:600;font-size:12px;cursor:pointer;">Save</button>
            </div>
            <div style="font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim, #888);font-weight:700;margin-bottom:6px;">Saved profiles</div>
            <div id="psi-prof-list"></div>
        </div>
    `;
    document.body.appendChild(m);
    _psiProfileModal = m;
    requestAnimationFrame(() => { m.style.opacity = '1'; m.classList.add('show'); });
    renderProfileModalBody();

    // Wire interactions
    m.querySelector('#psi-prof-close')?.addEventListener('click', closeProfileModal);
    m.addEventListener('mousedown', (e) => { if (e.target === m) closeProfileModal(); });
    document.addEventListener('keydown', _psiProfileModalEscHandler);

    const nameInput = /** @type {HTMLInputElement | null} */ (m.querySelector('#psi-prof-name'));
    const saveBtn = m.querySelector('#psi-prof-save');
    const doSave = () => {
        if (!nameInput) return;
        const ppm = psImagingState.pixelPerMicron;
        if (typeof ppm !== 'number' || ppm <= 0) return;
        const result = addProfile(nameInput.value, ppm);
        if (!result) {
            setStatus('Profile name required', 'err');
            return;
        }
        nameInput.value = '';
        renderProfileModalBody();
        renderCalibSelect();
        setStatus(`Profile saved: ${result.added.name}`, 'ok');
    };
    saveBtn?.addEventListener('click', doSave);
    nameInput?.addEventListener('keydown', (ev) => {
        if (ev.key === 'Enter') { ev.preventDefault(); doSave(); }
    });
    setTimeout(() => nameInput?.focus(), 50);

    // Delete button delegate
    m.addEventListener('click', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        const btn = t.closest('[data-act="del"]');
        if (!btn) return;
        const pid = /** @type {HTMLElement} */ (btn).dataset.pid;
        if (!pid) return;
        const target = findProfile(pid);
        if (!target) return;
        if (!confirm(`Delete profile "${target.name}"?`)) return;
        deleteProfile(pid);
        // If the deleted profile was the active one, clear last-profile pointer
        if (lsGet(PSI_LAST_PROFILE_KEY, '') === pid) {
            try { localStorage.removeItem(PSI_LAST_PROFILE_KEY); } catch (_e) { /* private mode */ }
        }
        renderProfileModalBody();
        renderCalibSelect();
        setStatus(`Deleted: ${target.name}`, 'ok');
    });
}

/** @param {KeyboardEvent} ev */
function _psiProfileModalEscHandler(ev) {
    if (ev.key === 'Escape' && _psiProfileModal) {
        closeProfileModal();
        document.removeEventListener('keydown', _psiProfileModalEscHandler);
    }
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
        version:        '0.3-session3r-hist-worker',
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
    closeProfileModal();
    document.removeEventListener('keydown', _psiProfileModalEscHandler);
    _psiPanel = null;
    bus.emit('psi:destroy');
}
