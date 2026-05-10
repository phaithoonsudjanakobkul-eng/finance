// PS Background Remover — lazy module (Session 3l heavy-logic port, 2026-05-10)
//
// Status: HEAVY DONE — RMBG-1.4 (HF transformers.js) + imgly Fast/Pro tiers,
// color-key fast path with sRGB→Lab perceptual distance, smart auto-dispatch,
// Tier 2 mask refinement (sigmoid → morph open → island filter → feather +
// expand/shrink), letterbox preprocessing for HF tier, real composite + PNG
// blob output. Replaces the magenta-tint stub.
//
// DEFERRED to Session 3m+:
//   · SAM 2 click-to-segment (Web Worker — separate big feature)
//   · Pro zoom/pan/fit viewer + Restore/Erase brush
//   · Pick BG eyedropper (depends on Pro viewer)
//   · 5-phase roadmap polish (Phase 3 ViTMatte / Phase 4 color decontam /
//     Phase 5 BG replacement)
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
/** @type {Record<string, { label: string, size: string, quality: string, type: 'imgly' | 'hf', model: string }>} */
export const _PSBGR_TIERS = {
    fast:  { label: 'Fast',    size: '11MB',  quality: '~88%', type: 'imgly', model: 'isnet_quint8' },
    pro:   { label: 'Pro',     size: '80MB',  quality: '~93%', type: 'imgly', model: 'isnet' },
    ultra: { label: 'Ultra',   size: '180MB', quality: '~97%', type: 'hf',    model: 'briaai/RMBG-1.4' },
};

// Lib cache per tier — populated on first model load (CDN ESM dynamic import)
/** @type {Record<string, any>} */
const _psbgrLibCache = {};

// State container — heavy fields are kept across runs so live slider
// adjustments can re-refine without re-decoding the file.
/** @type {{
 *   currentFile: File | null,
 *   currentImageUrl: string | null,
 *   outputBlob: Blob | null,
 *   outputUrl: string | null,
 *   lastMode: 'color-key' | 'neural' | null,
 *   tier: 'fast' | 'pro' | 'ultra',
 *   forceMode: 'auto' | 'neural' | 'color-key',
 *   refineSettings: { threshold: number, feather: number, expand: number },
 *   origImgData:    { data: Uint8ClampedArray, width: number, height: number } | null,
 *   rawMask:        Uint8Array | null,
 *   editedMask:     Uint8Array | null,
 *   rawSource:      'neural' | 'color-key' | 'sam' | null,
 *   bgInfo:         any,
 *   compositeCanvas: HTMLCanvasElement | null,
 *   forcedBgLab:    [number, number, number] | null,
 *   processing:     boolean,
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
    origImgData:     null,
    rawMask:         null,
    editedMask:      null,
    rawSource:       null,
    bgInfo:          null,
    compositeCanvas: null,
    forcedBgLab:     null,
    processing:      false,
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

// ══════════════════════════════════════════════════════════════════════
//  Image loading helper
// ══════════════════════════════════════════════════════════════════════

/** @param {Blob | string} src @returns {Promise<{ data: Uint8ClampedArray, width: number, height: number }>} */
function loadImgData(src) {
    return new Promise((resolve, reject) => {
        const isBlob = src instanceof Blob;
        const url = isBlob ? URL.createObjectURL(src) : src;
        const img = new Image();
        img.onload = () => {
            if (isBlob) URL.revokeObjectURL(url);
            const w = img.naturalWidth, h = img.naturalHeight;
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const ctx = c.getContext('2d');
            if (!ctx) { reject(new Error('no 2d context')); return; }
            ctx.drawImage(img, 0, 0);
            resolve({ data: ctx.getImageData(0, 0, w, h).data, width: w, height: h });
        };
        img.onerror = () => {
            if (isBlob) URL.revokeObjectURL(url);
            reject(new Error('Failed to load image'));
        };
        img.src = url;
    });
}

// ══════════════════════════════════════════════════════════════════════
//  Color space (sRGB → CIELab) — perceptual distance
// ══════════════════════════════════════════════════════════════════════
//  RGB euclidean fails on human-similar hues; Lab matches human vision.

/** @param {number} r @param {number} g @param {number} b @returns {[number, number, number]} */
function rgbToLab(r, g, b) {
    r /= 255; g /= 255; b /= 255;
    r = r > 0.04045 ? Math.pow((r + 0.055) / 1.055, 2.4) : r / 12.92;
    g = g > 0.04045 ? Math.pow((g + 0.055) / 1.055, 2.4) : g / 12.92;
    b = b > 0.04045 ? Math.pow((b + 0.055) / 1.055, 2.4) : b / 12.92;
    let x = r * 0.4124564 + g * 0.3575761 + b * 0.1804375;
    let y = r * 0.2126729 + g * 0.7151522 + b * 0.0721750;
    let z = r * 0.0193339 + g * 0.1191920 + b * 0.9503041;
    x /= 0.95047; y /= 1.00000; z /= 1.08883;
    /** @param {number} t */
    const f = (t) => t > 0.008856 ? Math.pow(t, 1/3) : 7.787 * t + 16/116;
    const fx = f(x), fy = f(y), fz = f(z);
    return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** @param {[number, number, number]} a @param {[number, number, number]} b */
function labDist(a, b) {
    const dL = a[0] - b[0], dA = a[1] - b[1], dB = a[2] - b[2];
    return Math.sqrt(dL * dL + dA * dA + dB * dB);
}

// ══════════════════════════════════════════════════════════════════════
//  Tier 1 — Flat-background detection + color-key mask
// ══════════════════════════════════════════════════════════════════════

/**
 * Detects flat solid-color backgrounds (logos, products on white, etc.)
 * via Lab variance on a 4-px edge strip and edge-vs-center distinction.
 * @param {Uint8ClampedArray} rgba @param {number} w @param {number} h
 */
function detectBackground(rgba, w, h) {
    /** @type {Array<[number, number, number]>} */
    const edgeRGB = [];
    /** @param {number} x @param {number} y */
    const pushAt = (x, y) => {
        const i = (y * w + x) * 4;
        edgeRGB.push([rgba[i], rgba[i+1], rgba[i+2]]);
    };
    const topBot = [0, 1, 2, 3, h-4, h-3, h-2, h-1];
    const leftRight = [0, 1, 2, 3, w-4, w-3, w-2, w-1];
    const wStep = Math.max(1, (w / 64) | 0);
    const hStep = Math.max(1, (h / 64) | 0);
    for (const y of topBot) {
        if (y < 0 || y >= h) continue;
        for (let x = 0; x < w; x += wStep) pushAt(x, y);
    }
    for (const x of leftRight) {
        if (x < 0 || x >= w) continue;
        for (let y = 0; y < h; y += hStep) pushAt(x, y);
    }
    if (edgeRGB.length < 16) return { isFlat: false, confidence: 0, stdDev: 0, edgeToCenter: 0, bgRgb: [0,0,0], bgLab: /** @type {[number,number,number]} */ ([0,0,0]) };

    let sumR = 0, sumG = 0, sumB = 0;
    for (const c of edgeRGB) { sumR += c[0]; sumG += c[1]; sumB += c[2]; }
    const meanRgb = [sumR / edgeRGB.length, sumG / edgeRGB.length, sumB / edgeRGB.length];
    const meanLab = rgbToLab(meanRgb[0], meanRgb[1], meanRgb[2]);
    let varSum = 0;
    for (const c of edgeRGB) {
        const lab = rgbToLab(c[0], c[1], c[2]);
        const d = labDist(lab, meanLab);
        varSum += d * d;
    }
    const stdDev = Math.sqrt(varSum / edgeRGB.length);

    const x0 = (w * 0.25) | 0, x1 = (w * 0.75) | 0;
    const y0 = (h * 0.25) | 0, y1 = (h * 0.75) | 0;
    const cxStep = Math.max(1, ((x1 - x0) / 16) | 0);
    const cyStep = Math.max(1, ((y1 - y0) / 16) | 0);
    let cR = 0, cG = 0, cB = 0, cN = 0;
    for (let y = y0; y < y1; y += cyStep) {
        for (let x = x0; x < x1; x += cxStep) {
            const i = (y * w + x) * 4;
            cR += rgba[i]; cG += rgba[i+1]; cB += rgba[i+2]; cN++;
        }
    }
    const centerLab = rgbToLab(cR / cN, cG / cN, cB / cN);
    const edgeToCenter = labDist(meanLab, centerLab);

    const isFlat = stdDev < 10 && edgeToCenter > 10;
    let confidence = 0;
    if (isFlat) {
        const stdScore = Math.max(0, Math.min(1, (10 - stdDev) / 10));
        const distScore = Math.max(0, Math.min(1, (edgeToCenter - 10) / 30));
        confidence = 0.5 * stdScore + 0.5 * distScore;
    }
    return {
        isFlat, confidence, stdDev, edgeToCenter,
        bgRgb: [meanRgb[0] | 0, meanRgb[1] | 0, meanRgb[2] | 0],
        bgLab: meanLab,
    };
}

/**
 * Lab distance to background → smoothstep alpha. NEAR=8, FAR=22.
 * @param {Uint8ClampedArray} rgba @param {number} w @param {number} h @param {[number, number, number]} bgLab
 */
function colorKeyMask(rgba, w, h, bgLab) {
    const NEAR = 8, FAR = 22;
    const span = FAR - NEAR;
    const n = w * h;
    const mask = new Uint8Array(n);
    for (let i = 0, p = 0; i < n; i++, p += 4) {
        const lab = rgbToLab(rgba[p], rgba[p+1], rgba[p+2]);
        const d = labDist(lab, bgLab);
        if (d <= NEAR) mask[i] = 0;
        else if (d >= FAR) mask[i] = 255;
        else {
            const t = (d - NEAR) / span;
            mask[i] = (t * t * (3 - 2 * t) * 255) | 0;
        }
    }
    return mask;
}

// ══════════════════════════════════════════════════════════════════════
//  Tier 2 — Mask refinement pipeline
// ══════════════════════════════════════════════════════════════════════

/** @param {Uint8Array} mask @param {number} k */
function sigmoidBoost(mask, k) {
    const n = mask.length;
    for (let i = 0; i < n; i++) {
        const v = mask[i] / 255 - 0.5;
        mask[i] = (255 / (1 + Math.exp(-k * v))) | 0;
    }
}

/** @param {Uint8Array} mask @param {number} w @param {number} h @param {'erode' | 'dilate'} mode */
function morph3x3(mask, w, h, mode) {
    const out = new Uint8Array(w * h);
    const isErode = mode === 'erode';
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            let v = isErode ? 255 : 0;
            const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
            const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
            for (let yy = y0; yy <= y1; yy++) {
                for (let xx = x0; xx <= x1; xx++) {
                    const s = mask[yy * w + xx];
                    if (isErode) { if (s < v) v = s; }
                    else         { if (s > v) v = s; }
                }
            }
            out[y * w + x] = v;
        }
    }
    return out;
}

/** @param {Uint8Array} mask @param {number} w @param {number} h @param {number} minSize */
function removeSmallIslands(mask, w, h, minSize) {
    const n = w * h;
    const visited = new Uint8Array(n);
    const stack = new Int32Array(n);
    for (let start = 0; start < n; start++) {
        if (visited[start] || mask[start] < 128) continue;
        let top = 0;
        stack[top++] = start;
        visited[start] = 1;
        const comp = [start];
        while (top > 0) {
            const idx = stack[--top];
            const x = idx % w, y = (idx / w) | 0;
            let k;
            if (x > 0)   { k = idx - 1; if (!visited[k] && mask[k] >= 128) { visited[k] = 1; stack[top++] = k; comp.push(k); } }
            if (x < w-1) { k = idx + 1; if (!visited[k] && mask[k] >= 128) { visited[k] = 1; stack[top++] = k; comp.push(k); } }
            if (y > 0)   { k = idx - w; if (!visited[k] && mask[k] >= 128) { visited[k] = 1; stack[top++] = k; comp.push(k); } }
            if (y < h-1) { k = idx + w; if (!visited[k] && mask[k] >= 128) { visited[k] = 1; stack[top++] = k; comp.push(k); } }
        }
        if (comp.length < minSize) {
            for (const k of comp) mask[k] = 0;
        }
    }
}

/** @param {Uint8Array} mask @param {number} w @param {number} h @param {number} radius */
function featherBoundary(mask, w, h, radius) {
    const n = w * h;
    const boundary = new Uint8Array(n);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            const fg = mask[idx] >= 128;
            let atEdge = false;
            const y0 = Math.max(0, y - 1), y1 = Math.min(h - 1, y + 1);
            const x0 = Math.max(0, x - 1), x1 = Math.min(w - 1, x + 1);
            for (let yy = y0; yy <= y1 && !atEdge; yy++) {
                for (let xx = x0; xx <= x1; xx++) {
                    if ((mask[yy * w + xx] >= 128) !== fg) { atEdge = true; break; }
                }
            }
            if (atEdge) boundary[idx] = 1;
        }
    }
    const src = new Uint8Array(mask);
    const r = radius | 0;
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            if (!boundary[idx]) continue;
            let sum = 0, cnt = 0;
            const y0 = Math.max(0, y - r), y1 = Math.min(h - 1, y + r);
            const x0 = Math.max(0, x - r), x1 = Math.min(w - 1, x + r);
            for (let yy = y0; yy <= y1; yy++) {
                for (let xx = x0; xx <= x1; xx++) {
                    sum += src[yy * w + xx]; cnt++;
                }
            }
            mask[idx] = (sum / cnt) | 0;
        }
    }
}

/**
 * Expand (dilate) or shrink (erode) the mask by |radius| Manhattan pixels.
 * radius > 0 → grow outward (recover lost body parts); < 0 → shrink inward.
 * O(w·h) two-pass distance transform — fast enough for live slider.
 * @param {Uint8Array} mask @param {number} w @param {number} h @param {number} radius
 */
function expandMask(mask, w, h, radius) {
    if (!radius) return;
    const n = w * h;
    const INF = 0x3fffffff;
    const dist = new Int32Array(n);
    if (radius > 0) {
        for (let i = 0; i < n; i++) dist[i] = mask[i] >= 128 ? 0 : INF;
    } else {
        for (let i = 0; i < n; i++) dist[i] = mask[i] < 128 ? 0 : INF;
    }
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const idx = y * w + x;
            if (x > 0) { const v = dist[idx - 1] + 1; if (v < dist[idx]) dist[idx] = v; }
            if (y > 0) { const v = dist[idx - w] + 1; if (v < dist[idx]) dist[idx] = v; }
        }
    }
    for (let y = h - 1; y >= 0; y--) {
        for (let x = w - 1; x >= 0; x--) {
            const idx = y * w + x;
            if (x < w - 1) { const v = dist[idx + 1] + 1; if (v < dist[idx]) dist[idx] = v; }
            if (y < h - 1) { const v = dist[idx + w] + 1; if (v < dist[idx]) dist[idx] = v; }
        }
    }
    const r = Math.abs(radius);
    if (radius > 0) {
        for (let i = 0; i < n; i++) { if (dist[i] <= r) mask[i] = 255; }
    } else {
        for (let i = 0; i < n; i++) { if (dist[i] <= r) mask[i] = 0; }
    }
}

/**
 * Live-adjustable refinement — color-key already crisp → only feather + expand.
 * Neural needs the full stack (sigmoid → open → islands → expand → feather).
 * @param {Uint8Array} mask @param {number} w @param {number} h
 */
function applyRefinement(mask, w, h) {
    const s = _psbgrState.refineSettings;
    if (_psbgrState.rawSource === 'color-key') {
        if (s.expand)  expandMask(mask, w, h, s.expand);
        if (s.feather > 0) featherBoundary(mask, w, h, s.feather);
        return;
    }
    if (s.threshold > 0) sigmoidBoost(mask, s.threshold);
    const eroded = morph3x3(mask, w, h, 'erode');
    const opened = morph3x3(eroded, w, h, 'dilate');
    mask.set(opened);
    const minSize = Math.max(16, (w * h * 0.0005) | 0);
    removeSmallIslands(mask, w, h, minSize);
    if (s.expand)  expandMask(mask, w, h, s.expand);
    if (s.feather > 0) featherBoundary(mask, w, h, s.feather);
}

// ══════════════════════════════════════════════════════════════════════
//  Tier 3 — Letterbox preprocessing for neural path
// ══════════════════════════════════════════════════════════════════════

/** @param {HTMLImageElement | HTMLCanvasElement} srcImg @param {number} targetSize */
function letterbox(srcImg, targetSize) {
    const srcW = /** @type {any} */ (srcImg).naturalWidth || srcImg.width;
    const srcH = /** @type {any} */ (srcImg).naturalHeight || srcImg.height;
    const scale = targetSize / Math.max(srcW, srcH);
    const dstW = Math.round(srcW * scale);
    const dstH = Math.round(srcH * scale);
    const padX = ((targetSize - dstW) / 2) | 0;
    const padY = ((targetSize - dstH) / 2) | 0;
    const c = document.createElement('canvas');
    c.width = targetSize; c.height = targetSize;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    // Neutral grey minimizes edge-bleed at padding border
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, targetSize, targetSize);
    ctx.imageSmoothingEnabled = true;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(srcImg, padX, padY, dstW, dstH);
    return { canvas: c, scale, padX, padY, dstW, dstH, origW: srcW, origH: srcH };
}

/** @param {Uint8Array} srcMask @param {number} srcW @param {number} srcH @param {number} dstW @param {number} dstH */
function upscaleMask(srcMask, srcW, srcH, dstW, dstH) {
    const srcCanvas = document.createElement('canvas');
    srcCanvas.width = srcW; srcCanvas.height = srcH;
    const srcCtx = srcCanvas.getContext('2d');
    if (!srcCtx) throw new Error('no 2d context');
    const src = srcCtx.createImageData(srcW, srcH);
    for (let i = 0, j = 0; i < srcMask.length; i++, j += 4) {
        src.data[j] = src.data[j+1] = src.data[j+2] = srcMask[i];
        src.data[j+3] = 255;
    }
    srcCtx.putImageData(src, 0, 0);

    const dstCanvas = document.createElement('canvas');
    dstCanvas.width = dstW; dstCanvas.height = dstH;
    const dstCtx = dstCanvas.getContext('2d');
    if (!dstCtx) throw new Error('no 2d context');
    dstCtx.imageSmoothingEnabled = true;
    dstCtx.imageSmoothingQuality = 'high';
    dstCtx.drawImage(srcCanvas, 0, 0, dstW, dstH);
    const d = dstCtx.getImageData(0, 0, dstW, dstH).data;
    const out = new Uint8Array(dstW * dstH);
    for (let i = 0, j = 0; i < out.length; i++, j += 4) out[i] = d[j];
    return out;
}

// ══════════════════════════════════════════════════════════════════════
//  Library loaders (imgly + transformers.js)
// ══════════════════════════════════════════════════════════════════════
//  CDN ESM dynamic import — Vite leaves these as runtime imports (no bundle).
//  @vite-ignore comment prevents Vite from trying to resolve the URL at build.

/** @param {'fast' | 'pro' | 'ultra'} tier @param {(label: string, pct: number) => void} [progressCb] */
async function loadLib(tier, progressCb) {
    const cfg = _PSBGR_TIERS[tier];
    if (!cfg) throw new Error('Unknown tier: ' + tier);
    if (_psbgrLibCache[tier] && _psbgrLibCache[tier].ready) return _psbgrLibCache[tier];

    // CDN ESM import via Function-cloaked specifier — TypeScript can't follow URL
    // imports, and Vite needs @vite-ignore. Wrapping in a helper that takes a
    // string keeps both happy without polluting the loader with @ts-ignore.
    /** @param {string} url @returns {Promise<any>} */
    const cdnImport = (url) => /** @type {any} */ (
        // eslint-disable-next-line no-new-func
        new Function('u', 'return import(/* @vite-ignore */ u)')(url)
    );

    if (cfg.type === 'imgly') {
        if (progressCb) progressCb('Loading AI library…', 0);
        const mod = await cdnImport('https://cdn.jsdelivr.net/npm/@imgly/background-removal@1.7.0/+esm');
        _psbgrLibCache[tier] = { ready: true, type: 'imgly', lib: mod, model: cfg.model };
        return _psbgrLibCache[tier];
    } else if (cfg.type === 'hf') {
        if (progressCb) progressCb('Loading HuggingFace transformers…', 0);
        const tf = await cdnImport('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2/+esm');
        if (progressCb) progressCb('Initializing RMBG-1.4 model…', 0);
        const model = await tf.AutoModel.from_pretrained(cfg.model, {
            /** @param {any} ev */
            progress_callback: (ev) => {
                if (!progressCb) return;
                if (ev.status === 'progress') {
                    progressCb('Downloading ' + (ev.file || 'model') + '…', (ev.progress || 0) / 100);
                } else if (ev.status === 'done') {
                    progressCb('Model ready', 1);
                }
            },
        });
        // do_resize:false — we letterbox ourselves to preserve aspect ratio
        const processor = await tf.AutoProcessor.from_pretrained(cfg.model, {
            config: {
                do_normalize: true, do_pad: false, do_rescale: true, do_resize: false,
                image_mean: [0.5, 0.5, 0.5], image_std: [1.0, 1.0, 1.0],
                rescale_factor: 0.00392156862745098,
                size: { width: 1024, height: 1024 },
            },
        });
        _psbgrLibCache[tier] = { ready: true, type: 'hf', lib: tf, model, processor };
        return _psbgrLibCache[tier];
    }
    throw new Error('Unknown tier type: ' + cfg.type);
}

// ══════════════════════════════════════════════════════════════════════
//  Composite + canvas-to-blob
// ══════════════════════════════════════════════════════════════════════

function renderComposite() {
    if (!_psbgrState.origImgData || !_psbgrState.editedMask) return;
    const { data, width, height } = _psbgrState.origImgData;
    if (!_psbgrState.compositeCanvas) _psbgrState.compositeCanvas = document.createElement('canvas');
    const c = _psbgrState.compositeCanvas;
    if (c.width !== width || c.height !== height) {
        c.width = width;
        c.height = height;
    }
    const ctx = c.getContext('2d');
    if (!ctx) return;
    const out = ctx.createImageData(width, height);
    const dst = out.data;
    const n = width * height;
    for (let i = 0, j = 0; i < n; i++, j += 4) {
        dst[j]   = data[j];
        dst[j+1] = data[j+1];
        dst[j+2] = data[j+2];
        dst[j+3] = _psbgrState.editedMask[i];
    }
    ctx.putImageData(out, 0, 0);
}

/** @param {HTMLCanvasElement} canvas @returns {Promise<Blob>} */
function canvasToBlob(canvas) {
    return new Promise((resolve, reject) => {
        canvas.toBlob((b) => b ? resolve(b) : reject(new Error('canvas.toBlob failed')), 'image/png');
    });
}

// Re-refine from cached rawMask with current settings (used by sliders).
function reRefine() {
    if (!_psbgrState.rawMask || !_psbgrState.origImgData) return;
    const { width: w, height: h } = _psbgrState.origImgData;
    _psbgrState.editedMask = new Uint8Array(_psbgrState.rawMask);
    applyRefinement(_psbgrState.editedMask, w, h);
    renderComposite();
    refreshResultPreview();
}

// ══════════════════════════════════════════════════════════════════════
//  Main pipeline — orchestrates Tiers 1 → 2 → 3
// ══════════════════════════════════════════════════════════════════════

/**
 * @param {File} file @param {'fast' | 'pro' | 'ultra'} tier
 * @param {(label: string, pct: number) => void} [progressCb]
 */
async function runPipeline(file, tier, progressCb) {
    if (progressCb) progressCb('Analyzing image…', 0.02);
    if (!_psbgrState.origImgData) _psbgrState.origImgData = await loadImgData(file);
    const W = _psbgrState.origImgData.width, H = _psbgrState.origImgData.height;
    const bg = detectBackground(_psbgrState.origImgData.data, W, H);
    _psbgrState.bgInfo = bg;

    // Resolve path — forceMode beats auto-detect
    let useColorKey = false;
    if (_psbgrState.forceMode === 'color-key') useColorKey = true;
    else if (_psbgrState.forceMode === 'neural') useColorKey = false;
    else useColorKey = bg.isFlat && bg.confidence > 0.55;

    if (useColorKey) {
        _psbgrState.lastMode  = 'color-key';
        _psbgrState.rawSource = 'color-key';
        if (progressCb) progressCb('Color-key mode…', 0.25);
        let bgLab = _psbgrState.forcedBgLab || bg.bgLab;
        if (!bgLab) {
            const d = _psbgrState.origImgData.data;
            bgLab = rgbToLab(d[0], d[1], d[2]);
        }
        _psbgrState.rawMask = colorKeyMask(_psbgrState.origImgData.data, W, H, bgLab);
    } else {
        _psbgrState.lastMode  = 'neural';
        _psbgrState.rawSource = 'neural';
        const info = await loadLib(tier, progressCb);

        if (info.type === 'imgly') {
            const composed = await info.lib.removeBackground(file, {
                model: info.model,
                /** @param {string} key @param {number} cur @param {number} tot */
                progress: (key, cur, tot) => {
                    if (!progressCb) return;
                    const pct = tot > 0 ? cur / tot : 0;
                    let label = key;
                    if (key && key.startsWith('fetch:')) label = 'Downloading model';
                    else if (key && key.startsWith('compute:')) label = 'Removing background';
                    progressCb(label, pct);
                },
                output: { format: 'image/png', quality: 0.9 },
            });
            if (progressCb) progressCb('Extracting mask…', 0.78);
            const composedData = await loadImgData(composed);
            const n = composedData.width * composedData.height;
            _psbgrState.rawMask = new Uint8Array(n);
            for (let i = 0, j = 3; i < n; i++, j += 4) _psbgrState.rawMask[i] = composedData.data[j];
        } else if (info.type === 'hf') {
            // Letterbox to 1024×1024 with neutral grey padding
            if (progressCb) progressCb('Preprocessing…', 0.25);
            const srcUrl = URL.createObjectURL(file);
            /** @type {ReturnType<typeof letterbox>} */
            let lb;
            try {
                /** @type {HTMLImageElement} */
                const htmlImg = await new Promise((res, rej) => {
                    const i = new Image();
                    i.onload = () => res(i);
                    i.onerror = () => rej(new Error('img load failed'));
                    i.src = srcUrl;
                });
                lb = letterbox(htmlImg, 1024);
            } finally {
                URL.revokeObjectURL(srcUrl);
            }
            /** @type {Blob} */
            const lbBlob = await new Promise((res, rej) => lb.canvas.toBlob((b) => b ? res(b) : rej(new Error('letterbox toBlob failed')), 'image/png'));
            const lbUrl = URL.createObjectURL(lbBlob);
            let pixel_values;
            try {
                const rawImg = await info.lib.RawImage.fromURL(lbUrl);
                ({ pixel_values } = await info.processor(rawImg));
            } finally {
                URL.revokeObjectURL(lbUrl);
            }
            if (progressCb) progressCb('Running AI inference…', 0.5);
            const { output } = await info.model({ input: pixel_values });
            if (progressCb) progressCb('Unletterboxing mask…', 0.78);

            const full = await info.lib.interpolate_4d(output, { size: [1024, 1024], mode: 'bilinear' });
            const fullData = full.mul(255).to('uint8').data;
            const cropped = new Uint8Array(lb.dstW * lb.dstH);
            for (let y = 0; y < lb.dstH; y++) {
                const srcRow = (y + lb.padY) * 1024 + lb.padX;
                const dstRow = y * lb.dstW;
                for (let x = 0; x < lb.dstW; x++) cropped[dstRow + x] = fullData[srcRow + x];
            }
            _psbgrState.rawMask = upscaleMask(cropped, lb.dstW, lb.dstH, lb.origW, lb.origH);
        }
    }

    if (progressCb) progressCb('Refining mask…', 0.9);
    _psbgrState.editedMask = new Uint8Array(_psbgrState.rawMask || new Uint8Array(W * H));
    applyRefinement(_psbgrState.editedMask, W, H);

    if (progressCb) progressCb('Compositing…', 0.96);
    renderComposite();
    if (!_psbgrState.compositeCanvas) throw new Error('composite failed');
    return canvasToBlob(_psbgrState.compositeCanvas);
}

// ══════════════════════════════════════════════════════════════════════
//  UI plumbing — matches existing 3f panel layout
// ══════════════════════════════════════════════════════════════════════

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
    if (_psbgrState.currentImageUrl) URL.revokeObjectURL(_psbgrState.currentImageUrl);
    if (_psbgrState.outputUrl)       URL.revokeObjectURL(_psbgrState.outputUrl);
    _psbgrState.currentFile     = file;
    _psbgrState.currentImageUrl = URL.createObjectURL(file);
    _psbgrState.outputBlob      = null;
    _psbgrState.outputUrl       = null;
    // Invalidate pipeline caches — different file
    _psbgrState.origImgData     = null;
    _psbgrState.rawMask         = null;
    _psbgrState.editedMask      = null;
    _psbgrState.bgInfo          = null;
    _psbgrState.forcedBgLab     = null;
    drawCanvas('orig', _psbgrState.currentImageUrl);
    drawCanvas('result', null);
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
        const maxW = 320, maxH = 240;
        const scale = Math.min(maxW / img.width, maxH / img.height, 1);
        canvas.width  = Math.round(img.width  * scale);
        canvas.height = Math.round(img.height * scale);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        // Checkerboard for result canvas (transparency indicator)
        if (which === 'result') {
            const tile = 8;
            for (let y = 0; y < canvas.height; y += tile) {
                for (let x = 0; x < canvas.width; x += tile) {
                    ctx.fillStyle = ((x / tile + y / tile) | 0) % 2 ? '#222' : '#1a1a1a';
                    ctx.fillRect(x, y, tile, tile);
                }
            }
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        if (placeholder) placeholder.style.display = 'none';
        canvas.style.display = '';
    };
    img.onerror = () => setStatus('โหลดรูปไม่ได้', 'err');
    img.src = src;
}

// Update result preview from current outputUrl (used after re-refine)
function refreshResultPreview() {
    if (!_psbgrState.compositeCanvas) return;
    canvasToBlob(_psbgrState.compositeCanvas).then((blob) => {
        if (_psbgrState.outputUrl) URL.revokeObjectURL(_psbgrState.outputUrl);
        _psbgrState.outputBlob = blob;
        _psbgrState.outputUrl  = URL.createObjectURL(blob);
        drawCanvas('result', _psbgrState.outputUrl);
    }).catch(() => {});
}

function showWorkspace() {
    if (!_psbgrPanel) return;
    const ws = /** @type {HTMLElement | null} */ (_psbgrPanel.querySelector('#psbgr-workspace'));
    if (ws) ws.style.display = '';
}

// ── Real BG removal pipeline — replaces the 3f magenta-tint stub ──────
async function processImage() {
    if (_psbgrState.processing) return;
    if (!_psbgrState.currentFile) {
        setStatus('โหลดรูปก่อน', 'err');
        return;
    }
    _psbgrState.processing = true;
    setProcessButtonBusy(true);
    setStatus('Processing…', '');

    try {
        const blob = await runPipeline(_psbgrState.currentFile, _psbgrState.tier, (label, pct) => {
            const pctText = pct > 0 ? ' · ' + Math.round(pct * 100) + '%' : '';
            setStatus(label + pctText, '');
        });
        if (_psbgrState.outputUrl) URL.revokeObjectURL(_psbgrState.outputUrl);
        _psbgrState.outputBlob = blob;
        _psbgrState.outputUrl  = URL.createObjectURL(blob);
        drawCanvas('result', _psbgrState.outputUrl);
        const info = _psbgrState.bgInfo;
        const debug = info ? ` · stdDev:${info.stdDev?.toFixed?.(1) || '–'} conf:${(info.confidence * 100 || 0).toFixed(0)}%` : '';
        setStatus(`Done · mode: ${_psbgrState.lastMode} · tier: ${_psbgrState.tier}${debug}`, 'ok');
        bus.emit('psbgr:processed', { mode: _psbgrState.lastMode, tier: _psbgrState.tier, info });
    } catch (err) {
        const e = /** @type {any} */ (err);
        setStatus('Error: ' + ((e && e.message) || e), 'err');
        if (typeof console !== 'undefined') console.warn('[PSBGR]', e);
    } finally {
        _psbgrState.processing = false;
        setProcessButtonBusy(false);
    }
}

/** @param {boolean} busy */
function setProcessButtonBusy(busy) {
    if (!_psbgrPanel) return;
    const btn = /** @type {HTMLButtonElement | null} */ (_psbgrPanel.querySelector('#psbgr-process-btn'));
    if (!btn) return;
    btn.disabled = !!busy;
    btn.textContent = busy ? 'Processing…' : 'Remove Background';
}

function saveResult() {
    if (!_psbgrState.outputUrl || !_psbgrState.outputBlob) {
        setStatus('ยังไม่มี result — กด Remove Background ก่อน', 'err');
        return;
    }
    const a = document.createElement('a');
    a.href = _psbgrState.outputUrl;
    const base = _psbgrState.currentFile && _psbgrState.currentFile.name
        ? _psbgrState.currentFile.name.replace(/\.[^.]+$/, '')
        : 'output';
    a.download = base + '-bgremoved.png';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setStatus('Downloaded', 'ok');
}

function clearResult() {
    if (_psbgrState.outputUrl) URL.revokeObjectURL(_psbgrState.outputUrl);
    _psbgrState.outputBlob = null;
    _psbgrState.outputUrl  = null;
    _psbgrState.editedMask = null;
    _psbgrState.rawMask    = null;
    _psbgrState.compositeCanvas = null;
    drawCanvas('result', null);
    setStatus('Result cleared', 'ok');
}

// ══════════════════════════════════════════════════════════════════════
//  UI render
// ══════════════════════════════════════════════════════════════════════

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
                .psbgr-panel .info-note { background:rgba(8, 153, 129, 0.06); border-left:3px solid var(--accent, #089981); padding:10px 14px; font-size:12px; color:var(--dim, #888); margin-top:12px; border-radius:4px; }
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
                    <button class="act ghost" id="psbgr-clear-btn">Clear Result</button>
                    <button class="act ghost" id="psbgr-reset-btn">Reset</button>
                    <span id="psbgr-status"></span>
                </div>
            </div>

            <div class="info-note">
                <strong>Session 3l port</strong> — RMBG-1.4 + imgly Fast/Pro live · Smart auto-dispatch · color-key fast path · mask refinement (sigmoid + morph + island filter + feather + expand). SAM 2 click-to-segment + Pro brush + eyedropper deferred to Session 3m+.
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
        dropzone.addEventListener('click', () => fileInput && fileInput.click());
    }
    if (browseBtn) browseBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput && fileInput.click(); });
    if (fileInput) fileInput.addEventListener('change', () => {
        const f = fileInput.files && fileInput.files[0];
        if (f) loadFile(f);
    });

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

    /** @param {'threshold' | 'feather' | 'expand'} key @param {string} valId */
    const wireSlider = (key, valId) => {
        const slider = /** @type {HTMLInputElement | null} */ (panel.querySelector(`#psbgr-${key}`));
        const valLabel = panel.querySelector(`#${valId}`);
        if (!slider || !valLabel) return;
        slider.addEventListener('input', () => {
            const v = parseInt(slider.value, 10);
            _psbgrState.refineSettings[key] = v;
            valLabel.textContent = String(v);
        });
        // Live re-refine on commit (slider release) — avoids burning CPU on drag
        slider.addEventListener('change', () => {
            if (_psbgrState.rawMask) reRefine();
        });
    };
    wireSlider('threshold', 'psbgr-threshold-val');
    wireSlider('feather',   'psbgr-feather-val');
    wireSlider('expand',    'psbgr-expand-val');

    const procBtn  = panel.querySelector('#psbgr-process-btn');
    const saveBtn  = panel.querySelector('#psbgr-save-btn');
    const clearBtn = panel.querySelector('#psbgr-clear-btn');
    const resetBtn = panel.querySelector('#psbgr-reset-btn');
    if (procBtn)  procBtn.addEventListener('click', () => processImage());
    if (saveBtn)  saveBtn.addEventListener('click', () => saveResult());
    if (clearBtn) clearBtn.addEventListener('click', () => clearResult());
    if (resetBtn) resetBtn.addEventListener('click', () => {
        if (_psbgrState.currentImageUrl) URL.revokeObjectURL(_psbgrState.currentImageUrl);
        if (_psbgrState.outputUrl)       URL.revokeObjectURL(_psbgrState.outputUrl);
        _psbgrState.currentFile     = null;
        _psbgrState.currentImageUrl = null;
        _psbgrState.outputBlob      = null;
        _psbgrState.outputUrl       = null;
        _psbgrState.origImgData     = null;
        _psbgrState.rawMask         = null;
        _psbgrState.editedMask      = null;
        _psbgrState.bgInfo          = null;
        _psbgrState.compositeCanvas = null;
        const ws = /** @type {HTMLElement | null} */ (panel.querySelector('#psbgr-workspace'));
        if (ws) ws.style.display = 'none';
        if (fileInput) fileInput.value = '';
        setStatus('Reset', 'ok');
    });
}

// ══════════════════════════════════════════════════════════════════════
//  Module lifecycle
// ══════════════════════════════════════════════════════════════════════

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
        version:  '0.3-session3l-heavy-port',
        ready:    true,
        tier:     _psbgrState.tier,
        tierCfg:  _PSBGR_TIERS[_psbgrState.tier],
        availableTiers: Object.keys(_PSBGR_TIERS),
        forceMode: _psbgrState.forceMode,
    };
}

/** Module teardown — frees lib cache + revokes object URLs. */
export function destroy() {
    for (const k of Object.keys(_psbgrLibCache)) delete _psbgrLibCache[k];
    if (_psbgrState.currentImageUrl) URL.revokeObjectURL(_psbgrState.currentImageUrl);
    if (_psbgrState.outputUrl)       URL.revokeObjectURL(_psbgrState.outputUrl);
    _psbgrState.currentImageUrl = null;
    _psbgrState.outputUrl       = null;
    _psbgrState.currentFile     = null;
    _psbgrState.outputBlob      = null;
    _psbgrState.origImgData     = null;
    _psbgrState.rawMask         = null;
    _psbgrState.editedMask      = null;
    _psbgrState.compositeCanvas = null;
    _psbgrPanel = null;
    bus.emit('psbgr:destroy');
}

// ══════════════════════════════════════════════════════════════════════
//  Named exports for cross-module / legacy interop
// ══════════════════════════════════════════════════════════════════════

export {
    rgbToLab          as _psbgrRgbToLab,
    labDist           as _psbgrLabDist,
    detectBackground  as _psbgrDetectBackground,
    colorKeyMask      as _psbgrColorKeyMask,
    sigmoidBoost      as _psbgrSigmoidBoost,
    morph3x3          as _psbgrMorph3x3,
    removeSmallIslands as _psbgrRemoveSmallIslands,
    featherBoundary   as _psbgrFeatherBoundary,
    expandMask        as _psbgrExpandMask,
    applyRefinement   as _psbgrApplyRefinement,
    letterbox         as _psbgrLetterbox,
    upscaleMask       as _psbgrUpscaleMask,
    loadLib           as _psbgrLoadLib,
    loadImgData       as _psbgrLoadImgData,
    renderComposite   as _psbgrRenderComposite,
    canvasToBlob      as _psbgrCanvasToBlob,
    reRefine          as _psbgrReRefine,
    runPipeline       as _psbgrProcess,
    processImage      as _psbgrProcessFromUI,
};
