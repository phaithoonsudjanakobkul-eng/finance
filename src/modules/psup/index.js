// PS Upscaler — lazy module (Session 3p heavy-logic port, 2026-05-10)
//
// Status: HEAVY DONE — full ORT-Web 1.22 WebGPU inference worker + tile
// pipeline (192/128 px feathered blend, edge-clamp pad) + per-model lazy load
// (CDN → IDB cache, R2 deferred until R2 ports to Vite) + per-item modelId
// dispatch + tier-driven post-process (HF detail injection + film grain +
// sharpen + contrast/sat) + 2× downscale path + 8× recursive path. Replaces
// the queued-only stub.
//
// DEFERRED to Session 3q+ (PSUP Pro UX):
//   · Compare grid mode (synced pan/zoom across 2-4 done items)
//   · A/B slider compare with split handle drag
//   · Right-click context menu for per-item Apply Model
//   · R2 encrypted model fetch (depends on R2 lib port)
//   · Profile/Playlist hooks (depends on those modules)
//   · FSA Download All (Save dir handle)
//
// CRITICAL invariants from project_psup_state memory (DO NOT regress):
//   1. CFG model storage: all 3 in user R2 + v1/v2 cdnUrl fallback
//   2. R2 worker accepts psup/*.enc.onnx (100 MB limit)
//   3. FP32 only — DAT2 FP16 fails (don't retry)
//   4. freeDimensionOverrides REQUIRED for WebGPU EP
//   5. Per-item modelId — sidebar Default Model + right-click Apply Model
//   6. tierMul attenuates additive (HF/grain/sharpen) via 1 + (val-1)*mul
//   7. Memory monitor: 600 MB hard refuse · 400 warn · 200 caution

import { lsSave, lsGetJson } from '../../core/storage.js';
import { bus } from '../../core/bus.js';

// ── Memory monitor thresholds (MB peak runtime memory per upscale job) ──
export const PSUP_MEM_LIMIT_MB    = 600;
export const PSUP_MEM_WARN_MB     = 400;
export const PSUP_MEM_CAUTION_MB  = 200;

/** @typedef {{
 *   key: string, file: string, cdnUrl?: string,
 *   tileSize: number, arch: 'ESRGAN' | 'DAT2',
 *   label: string, sub: string, size: string, tierMul: number,
 * }} PsupModel */

/** @type {Record<string, PsupModel>} */
export const PSUP_MODEL_REGISTRY = {
    'ultrasharp-v1': {
        key:      '4x-UltraSharp-onnx',
        file:     '4x-UltraSharp.onnx',
        cdnUrl:   'https://huggingface.co/Kim2091/UltraSharp/resolve/main/ONNX/4x-UltraSharp-fp32-opset17.onnx',
        tileSize: 192,  arch: 'ESRGAN', label: 'UltraSharp v1', sub: 'ESRGAN · classic',         size: '64 MB', tierMul: 1.0,
    },
    'ultrasharp-v2': {
        key:      '4x-UltraSharpV2-onnx',
        file:     '4x-UltraSharpV2_fp32_op17.onnx',
        cdnUrl:   'https://huggingface.co/Kim2091/UltraSharpV2/resolve/main/4x-UltraSharpV2_fp32_op17.onnx',
        tileSize: 128,  arch: 'DAT2',   label: 'UltraSharp v2', sub: 'DAT2 · multi-domain',      size: '52 MB', tierMul: 0.5,
    },
    'bhi-dat2-real': {
        key:      '4xBHI_dat2_real-onnx',
        file:     '4xBHI_dat2_real_fp32_op17.onnx',
        // No public CDN — must come from user's R2 (uploaded via Settings)
        tileSize: 128,  arch: 'DAT2',   label: 'BHI dat2',      sub: 'DAT2 · BHI · newest',       size: '49 MB', tierMul: 0.4,
    },
};

/** @type {Record<string, { hf1: number, hf2: number, grain: number, sharpen: number, contrast: number, sat: number }>} */
export const TIER_PRESETS = {
    fast:     { hf1: 0.00, hf2: 0.00, grain: 0, sharpen: 0.00, contrast: 1.00, sat: 1.00 },
    balanced: { hf1: 0.30, hf2: 0.30, grain: 3, sharpen: 0.18, contrast: 1.04, sat: 1.04 },
    maximum:  { hf1: 0.55, hf2: 0.55, grain: 6, sharpen: 0.28, contrast: 1.06, sat: 1.06 },
};

/** @typedef {{
 *   id: string, name: string,
 *   status: 'queued' | 'processing' | 'done' | 'failed' | 'skipped',
 *   width?: number, height?: number, modelId?: string,
 *   inputBlob?: Blob, inputUrl?: string,
 *   outputBlob?: Blob, outputUrl?: string,
 *   error?: string,
 * }} PsupQueueItem */

/** @type {PsupQueueItem[]} */
const _psupQueue = [];
/** @type {string | null} */
let _psupActiveId = null;

/** @type {{ tier: 'fast' | 'balanced' | 'maximum', scale: number, content: 'auto' | 'photo' | 'art', format: 'png' | 'webp' | 'jpg' }} */
let _psupSettings = lsGetJson('ps_psup_settings', { tier: 'balanced', scale: 4, content: 'auto', format: 'png' });

/** @type {string} */
let _psupCurrentModelId = (function () {
    const saved = lsGetJson('ps_psup_model', /** @type {any} */ (null));
    if (saved && PSUP_MODEL_REGISTRY[saved]) return saved;
    return 'ultrasharp-v1';
})();

/** @type {HTMLElement | null} */
let _psupPanel = null;

export function getQueue()     { return _psupQueue; }
export function getActiveId()  { return _psupActiveId; }
export function getSettings()  { return _psupSettings; }
export function getCurrentModelId() { return _psupCurrentModelId; }

/** @param {Partial<typeof _psupSettings>} patch */
export function updateSettings(patch) {
    _psupSettings = Object.assign(_psupSettings, patch);
    lsSave('ps_psup_settings', JSON.stringify(_psupSettings));
    bus.emit('psup:settings-changed', { settings: _psupSettings });
}

/** @param {string} modelId */
export function setCurrentModel(modelId) {
    if (!PSUP_MODEL_REGISTRY[modelId]) return;
    _psupCurrentModelId = modelId;
    lsSave('ps_psup_model', modelId);
    bus.emit('psup:model-changed', { modelId });
}

// ══════════════════════════════════════════════════════════════════════
//  ORT-Web inference Web Worker — verbatim from monolith
// ══════════════════════════════════════════════════════════════════════
//  WebGPU requires `freeDimensionOverrides {batch_size:1, height:tileSize,
//  width:tileSize}` so the Conv shaders can compile (otherwise EP fails with
//  Kernel '[Conv]' compile error on dynamic axes). Tile size differs per arch:
//  ESRGAN (192) faster; DAT2 transformer (128) limits VRAM.
//
//  Tier-driven post-process applied AFTER the ONNX 4× output:
//    Fast     = clean (no HF, no grain) — fastest, model-only
//    Balanced = subtle texture lift (default)
//    Maximum  = aggressive HF + grain (portraits, low-detail sources)
//
//  tierMul attenuates additive params (HF/grain/sharpen scale linearly) and
//  multiplicative params (contrast/sat around 1.0). DAT2 baseline is already
//  sharp → tierMul 0.4–0.5 to avoid over-process; ESRGAN 1.0.
//
//  Image never leaves the device (Rule 17). Worker source loaded as Blob URL
//  + module worker, ORT-Web imported via CDN ESM dynamic import.

const _PSUP_WORKER_SRC = `
let ort = null;
let session = null;
let modelKey = null;
let cancelled = false;
let backend = 'wasm';
let inputName = 'input';
let outputName = 'output';

self.addEventListener('message', async (e) => {
    const { id, type, data } = e.data;
    try {
        if (type === 'init') {
            if (!ort) {
                ort = await import('https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/+esm');
                ort.env.wasm.wasmPaths = 'https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
            }
            self.postMessage({ id, type: 'done', data: { ready: true, runtime: 'onnxruntime-web 1.22' } });
        } else if (type === 'load') {
            const { modelUrl, modelBytes, key, tileSize } = data;
            if (modelKey === key && session) { self.postMessage({ id, type: 'done', data: { cached: true } }); return; }
            self.postMessage({ id, type: 'progress', data: { status: 'downloading', file: key } });
            const dimOverrides = { batch_size: 1, height: tileSize, width: tileSize };
            const tryEPs = [['webgpu'], ['webgl'], ['wasm']];
            const modelInput = modelBytes || modelUrl;
            const errors = [];
            for (const eps of tryEPs) {
                try {
                    session = await ort.InferenceSession.create(modelInput, {
                        executionProviders: eps,
                        graphOptimizationLevel: 'all',
                        freeDimensionOverrides: dimOverrides
                    });
                    backend = eps[0];
                    break;
                } catch (e) { errors.push(eps[0] + ': ' + ((e && e.message) || String(e)).slice(0, 120)); session = null; }
            }
            if (!session) throw new Error('all EPs failed: ' + errors.join(' || '));
            inputName = session.inputNames && session.inputNames[0] || 'input';
            outputName = session.outputNames && session.outputNames[0] || 'output';
            modelKey = key;
            self.postMessage({ id, type: 'done', data: { cached: false, key, backend, inputName, outputName } });
        } else if (type === 'process') {
            cancelled = false;
            const { bitmap, scale, tileSize, tier, tierMul } = data;
            const result = await processImage(bitmap, scale, tileSize, tier, id, tierMul);
            self.postMessage({ id, type: 'done', data: { bitmap: result } }, [result]);
        } else if (type === 'cancel') {
            cancelled = true;
        }
    } catch (err) {
        const msg = (err && err.message) || String(err);
        const stack = (err && err.stack) ? String(err.stack).split('\\n').slice(0, 3).join(' | ') : '';
        self.postMessage({ id, type: 'error', data: msg + (stack ? ' [' + stack + ']' : '') });
    }
});

async function inferenceTile(imageData, tileW, tileH) {
    const total = tileW * tileH;
    const inputData = new Float32Array(total * 3);
    const px = imageData.data;
    for (let i = 0, p = 0; i < total; i++, p += 4) {
        inputData[i]             = px[p]     / 255;
        inputData[total + i]     = px[p + 1] / 255;
        inputData[total * 2 + i] = px[p + 2] / 255;
    }
    const inputTensor = new ort.Tensor('float32', inputData, [1, 3, tileH, tileW]);
    const feeds = {}; feeds[inputName] = inputTensor;
    const results = await session.run(feeds);
    const output = results[outputName];
    const outH = output.dims[2], outW = output.dims[3];
    const outTotal = outW * outH;
    const od = output.data;
    const out = new Uint8Array(outTotal * 3);
    for (let i = 0; i < outTotal; i++) {
        const r = od[i] * 255, g = od[outTotal + i] * 255, b = od[outTotal * 2 + i] * 255;
        out[i * 3]     = r < 0 ? 0 : (r > 255 ? 255 : Math.round(r));
        out[i * 3 + 1] = g < 0 ? 0 : (g > 255 ? 255 : Math.round(g));
        out[i * 3 + 2] = b < 0 ? 0 : (b > 255 ? 255 : Math.round(b));
    }
    return { data: out, width: outW, height: outH };
}

async function processImage(srcBmp, scale, tileSize, tier, id, tierMul) {
    const W = srcBmp.width, H = srcBmp.height;
    const _mul = (typeof tierMul === 'number' && tierMul >= 0) ? tierMul : 1.0;
    const modelScale = 4;
    const overlap = Math.max(8, Math.floor(tileSize / 16));
    const intW = W * modelScale, intH = H * modelScale;
    const stride = tileSize - overlap;
    const cols = Math.max(1, Math.ceil((W - overlap) / stride));
    const rows = Math.max(1, Math.ceil((H - overlap) / stride));
    const total = rows * cols;
    const outOverlap = overlap * modelScale;

    const colorBuf = new Float32Array(intW * intH * 3);
    const weightBuf = new Float32Array(intW * intH);

    let idx = 0;
    for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
            if (cancelled) throw new Error('cancelled');
            const x = Math.min(c * stride, Math.max(0, W - tileSize));
            const y = Math.min(r * stride, Math.max(0, H - tileSize));
            const tw = Math.min(tileSize, W - x);
            const th = Math.min(tileSize, H - y);
            const tcv = new OffscreenCanvas(tileSize, tileSize);
            const tctx = tcv.getContext('2d');
            tctx.drawImage(srcBmp, x, y, tw, th, 0, 0, tw, th);
            if (tw < tileSize)  tctx.drawImage(tcv, tw - 1, 0, 1, tileSize, tw, 0, tileSize - tw, tileSize);
            if (th < tileSize)  tctx.drawImage(tcv, 0, th - 1, tileSize, 1, 0, th, tileSize, tileSize - th);
            const imgData = tctx.getImageData(0, 0, tileSize, tileSize);
            const upTile = await inferenceTile(imgData, tileSize, tileSize);
            const upW = upTile.width, upH = upTile.height;
            const outX = x * modelScale, outY = y * modelScale;
            const fadeL = c > 0, fadeT = r > 0;
            const fadeR = c < cols - 1, fadeB = r < rows - 1;
            const validUpW = tw * modelScale, validUpH = th * modelScale;
            for (let py = 0; py < validUpH; py++) {
                let wy = 1;
                if (fadeT && py < outOverlap) wy = (py + 1) / outOverlap;
                else if (fadeB && py >= validUpH - outOverlap) wy = (validUpH - py) / outOverlap;
                for (let pxi = 0; pxi < validUpW; pxi++) {
                    let wx = 1;
                    if (fadeL && pxi < outOverlap) wx = (pxi + 1) / outOverlap;
                    else if (fadeR && pxi >= validUpW - outOverlap) wx = (validUpW - pxi) / outOverlap;
                    const wt = wx * wy;
                    if (wt <= 0) continue;
                    const dstIdx = (outY + py) * intW + (outX + pxi);
                    const sIdx = (py * upW + pxi) * 3;
                    colorBuf[dstIdx * 3]     += upTile.data[sIdx]     * wt;
                    colorBuf[dstIdx * 3 + 1] += upTile.data[sIdx + 1] * wt;
                    colorBuf[dstIdx * 3 + 2] += upTile.data[sIdx + 2] * wt;
                    weightBuf[dstIdx] += wt;
                }
            }
            idx++;
            self.postMessage({ id, type: 'tile', data: { idx, total, scale: modelScale, stage: 1, totalStages: 1 } });
        }
    }

    const finCv = new OffscreenCanvas(intW, intH);
    const finCtx = finCv.getContext('2d');
    const imd = finCtx.createImageData(intW, intH);
    for (let i = 0, n = intW * intH; i < n; i++) {
        const w = weightBuf[i] || 1;
        imd.data[i*4]   = Math.max(0, Math.min(255, Math.round(colorBuf[i*3]   / w)));
        imd.data[i*4+1] = Math.max(0, Math.min(255, Math.round(colorBuf[i*3+1] / w)));
        imd.data[i*4+2] = Math.max(0, Math.min(255, Math.round(colorBuf[i*3+2] / w)));
        imd.data[i*4+3] = 255;
    }
    finCtx.putImageData(imd, 0, 0);

    const TIER_PRESETS = {
        fast:     { hf1: 0.00, hf2: 0.00, grain: 0, sharpen: 0.00, contrast: 1.00, sat: 1.00 },
        balanced: { hf1: 0.30, hf2: 0.30, grain: 3, sharpen: 0.18, contrast: 1.04, sat: 1.04 },
        maximum:  { hf1: 0.55, hf2: 0.55, grain: 6, sharpen: 0.28, contrast: 1.06, sat: 1.06 }
    };
    const tpRaw = TIER_PRESETS[tier] || TIER_PRESETS.balanced;
    const tp = {
        hf1:      tpRaw.hf1      * _mul,
        hf2:      tpRaw.hf2      * _mul,
        grain:    tpRaw.grain    * _mul,
        sharpen:  tpRaw.sharpen  * _mul,
        contrast: 1 + (tpRaw.contrast - 1) * _mul,
        sat:      1 + (tpRaw.sat      - 1) * _mul,
    };
    const HF1_ALPHA = tp.hf1, HF1_BLUR = 1.4;
    const HF2_ALPHA = tp.hf2, HF2_BLUR = 0.6;
    const GRAIN_AMPL = tp.grain;
    if (HF1_ALPHA > 0 || HF2_ALPHA > 0 || GRAIN_AMPL > 0) {
        const hfCv = new OffscreenCanvas(intW, intH);
        const hfCtx = hfCv.getContext('2d');
        hfCtx.imageSmoothingEnabled = true;
        hfCtx.imageSmoothingQuality = 'high';
        hfCtx.drawImage(srcBmp, 0, 0, W, H, 0, 0, intW, intH);
        const lanczosData = hfCtx.getImageData(0, 0, intW, intH).data;
        const blur1Cv = new OffscreenCanvas(intW, intH);
        const blur1Ctx = blur1Cv.getContext('2d');
        blur1Ctx.filter = 'blur(' + HF1_BLUR + 'px)';
        blur1Ctx.drawImage(hfCv, 0, 0);
        const blur1Data = blur1Ctx.getImageData(0, 0, intW, intH).data;
        const blur2Cv = new OffscreenCanvas(intW, intH);
        const blur2Ctx = blur2Cv.getContext('2d');
        blur2Ctx.filter = 'blur(' + HF2_BLUR + 'px)';
        blur2Ctx.drawImage(hfCv, 0, 0);
        const blur2Data = blur2Ctx.getImageData(0, 0, intW, intH).data;
        const reMix = finCtx.getImageData(0, 0, intW, intH);
        const reArr = reMix.data;
        for (let i = 0; i < reArr.length; i += 4) {
            const grain = (Math.random() - 0.5) * 2 * GRAIN_AMPL;
            for (let c = 0; c < 3; c++) {
                const lanc = lanczosData[i + c];
                const hf1 = lanc - blur1Data[i + c];
                const hf2 = lanc - blur2Data[i + c];
                const v = reArr[i + c] + HF1_ALPHA * hf1 + HF2_ALPHA * hf2 + grain;
                reArr[i + c] = v < 0 ? 0 : (v > 255 ? 255 : v);
            }
        }
        finCtx.putImageData(reMix, 0, 0);
    }

    const POST_SHARPEN = tp.sharpen;
    const POST_CONTRAST = tp.contrast;
    const POST_SAT = tp.sat;
    if (POST_SHARPEN > 0) {
        const orig = finCtx.getImageData(0, 0, intW, intH);
        const psBlurCv = new OffscreenCanvas(intW, intH);
        const psBlurCtx = psBlurCv.getContext('2d');
        psBlurCtx.filter = 'blur(1.0px)';
        psBlurCtx.drawImage(finCv, 0, 0);
        const psBlur = psBlurCtx.getImageData(0, 0, intW, intH);
        const o = orig.data, b = psBlur.data;
        for (let i = 0; i < o.length; i += 4) {
            o[i]   = Math.max(0, Math.min(255, o[i]   + POST_SHARPEN * (o[i]   - b[i])));
            o[i+1] = Math.max(0, Math.min(255, o[i+1] + POST_SHARPEN * (o[i+1] - b[i+1])));
            o[i+2] = Math.max(0, Math.min(255, o[i+2] + POST_SHARPEN * (o[i+2] - b[i+2])));
        }
        finCtx.putImageData(orig, 0, 0);
    }
    let outCv = finCv;
    if (POST_CONTRAST !== 1 || POST_SAT !== 1) {
        const psCv = new OffscreenCanvas(intW, intH);
        const psCtx = psCv.getContext('2d');
        psCtx.filter = 'contrast(' + POST_CONTRAST + ') saturate(' + POST_SAT + ')';
        psCtx.drawImage(finCv, 0, 0);
        outCv = psCv;
    }

    if (scale === 2) {
        const dstW = W * 2, dstH = H * 2;
        const downCv = new OffscreenCanvas(dstW, dstH);
        const downCtx = downCv.getContext('2d');
        downCtx.imageSmoothingEnabled = true;
        downCtx.imageSmoothingQuality = 'high';
        downCtx.drawImage(outCv, 0, 0, dstW, dstH);
        return downCv.transferToImageBitmap();
    }
    if (scale === 8) {
        const intermediate = outCv.transferToImageBitmap();
        return await processImage(intermediate, 4, tileSize, tier, id, tierMul);
    }
    return outCv.transferToImageBitmap();
}
`;

// ── Worker management (init + send + pending map + ensureModelReady) ──

/** @type {Worker | null} */
let _psupWorker = null;
let _psupWorkerReady = false;
let _psupWorkerLoading = false;
/** @type {string | null} */
let _psupModelLoaded = null;
let _psupReqId = 0;
/** @type {Map<number, { resolve: (v: any) => void, reject: (e: any) => void, onProgress?: (ev: any) => void }>} */
const _psupPending = new Map();
/** @type {string} */
export let _psupBackend = '—';

function _psupInitWorker() {
    if (_psupWorker) return;
    const blob = new Blob([_PSUP_WORKER_SRC], { type: 'application/javascript' });
    const url = URL.createObjectURL(blob);
    _psupWorker = new Worker(url, { type: 'module' });
    _psupWorker.addEventListener('message', (e) => {
        const { id, type, data } = e.data;
        const p = _psupPending.get(id);
        if (!p) return;
        if (type === 'progress' || type === 'tile') {
            if (p.onProgress) p.onProgress({ type, data });
            return;
        }
        _psupPending.delete(id);
        if (type === 'error') p.reject(new Error(data));
        else p.resolve(data);
    });
    _psupWorker.addEventListener('error', (e) => {
        if (typeof console !== 'undefined') console.warn('[psup worker]', e.message || e);
    });
}

/** @param {string} type @param {any} data @param {(ev: any) => void} [onProgress] @param {Transferable[]} [transfer] */
function _psupSend(type, data, onProgress, transfer) {
    _psupInitWorker();
    return new Promise((resolve, reject) => {
        const id = ++_psupReqId;
        _psupPending.set(id, { resolve, reject, onProgress });
        if (!_psupWorker) { reject(new Error('PSUP worker init failed')); return; }
        _psupWorker.postMessage({ id, type, data }, transfer || []);
    });
}

// IDB cache for model bytes — lazy-init on first use.
/** @type {IDBDatabase | null} */
let _psupIdb = null;

function _psupOpenIdb() {
    if (_psupIdb) return Promise.resolve(_psupIdb);
    return new Promise((resolve, reject) => {
        const req = indexedDB.open('PSLinkPSUP', 1);
        req.onupgradeneeded = () => {
            const db = req.result;
            if (!db.objectStoreNames.contains('models')) db.createObjectStore('models');
        };
        req.onsuccess = () => { _psupIdb = req.result; resolve(_psupIdb); };
        req.onerror = () => reject(req.error);
    });
}

/** @param {string} key @returns {Promise<Uint8Array | null>} */
async function _psupIdbGet(key) {
    try {
        const db = await _psupOpenIdb();
        return await new Promise((resolve, reject) => {
            const tx = db.transaction('models', 'readonly');
            const req = tx.objectStore('models').get(key);
            req.onsuccess = () => resolve(req.result || null);
            req.onerror = () => reject(req.error);
        });
    } catch (_e) { return null; }
}

/** @param {string} key @param {Uint8Array} bytes */
async function _psupIdbPut(key, bytes) {
    try {
        const db = await _psupOpenIdb();
        await new Promise((resolve, reject) => {
            const tx = db.transaction('models', 'readwrite');
            tx.objectStore('models').put(bytes, key);
            tx.oncomplete = () => resolve(undefined);
            tx.onerror = () => reject(tx.error);
        });
    } catch (_e) {}
}

/**
 * Fetch model bytes — IDB cache → CDN. R2 path deferred until R2 lib ports to Vite.
 * Returns Uint8Array of raw .onnx bytes (caller transfers to worker).
 * @param {PsupModel} m
 * @param {(ev: any) => void} [onProgress]
 */
async function _psupGetModelData(m, onProgress) {
    const idbKey = 'psup-model:' + m.file.replace(/\.onnx$/, '');
    const cached = await _psupIdbGet(idbKey);
    if (cached && cached.byteLength > 1024 * 1024) {
        if (onProgress) onProgress({ data: { status: 'progress', progress: 100, file: 'IDB cache · ' + m.label } });
        return cached;
    }
    if (!m.cdnUrl) {
        throw new Error(m.file + ' has no public CDN — port R2 fetch in 3q+');
    }
    if (onProgress) onProgress({ data: { status: 'downloading', file: 'CDN · ' + m.label } });
    const res = await fetch(m.cdnUrl);
    if (!res.ok) throw new Error('model fetch failed (' + res.status + '): ' + m.cdnUrl);
    const buf = new Uint8Array(await res.arrayBuffer());
    await _psupIdbPut(idbKey, buf);
    return buf;
}

/**
 * Make sure the worker has the target model loaded. Loads init session first,
 * then swaps in the requested model (re-uses cached session if same key).
 * @param {PsupModel} targetM
 * @param {(ev: any) => void} [onProgress]
 */
async function _psupEnsureModelReady(targetM, onProgress) {
    if (_psupWorkerReady && _psupModelLoaded === targetM.key) return;
    if (_psupWorkerLoading) {
        while (_psupWorkerLoading) await new Promise((r) => setTimeout(r, 80));
        if (_psupModelLoaded !== targetM.key) return _psupEnsureModelReady(targetM, onProgress);
        return;
    }
    _psupWorkerLoading = true;
    try {
        if (!_psupWorkerReady) {
            const info = await _psupSend('init', null, onProgress);
            if (info && info.runtime && typeof console !== 'undefined') console.log('[psup]', info.runtime);
            _psupWorkerReady = true;
        }
        if (_psupModelLoaded !== targetM.key) {
            const modelBytes = await _psupGetModelData(targetM, onProgress);
            const loadResp = await _psupSend('load',
                { modelBytes, key: targetM.key, tileSize: targetM.tileSize },
                onProgress,
                [modelBytes.buffer]);
            if (loadResp && loadResp.backend) _psupBackend = loadResp.backend;
            _psupModelLoaded = targetM.key;
            bus.emit('psup:model-loaded', { modelId: targetM.key, backend: _psupBackend });
        }
    } finally { _psupWorkerLoading = false; }
}

/** @param {PsupQueueItem} item @returns {PsupModel} */
function _psupGetItemModel(item) {
    if (item && item.modelId && PSUP_MODEL_REGISTRY[item.modelId]) return PSUP_MODEL_REGISTRY[item.modelId];
    return PSUP_MODEL_REGISTRY[_psupCurrentModelId] || PSUP_MODEL_REGISTRY['ultrasharp-v1'];
}

/** @param {number} outputW @param {number} outputH */
export function estPeakMB(outputW, outputH) {
    const pixels = outputW * outputH;
    return (pixels * 4 * 6) / (1024 * 1024);
}

/** @param {number} mb */
export function memTier(mb) {
    if (mb >= PSUP_MEM_LIMIT_MB)   return { tier: 'block',   color: '#f43f5e', label: 'too large' };
    if (mb >= PSUP_MEM_WARN_MB)    return { tier: 'warn',    color: '#f59e0b', label: 'heavy'    };
    if (mb >= PSUP_MEM_CAUTION_MB) return { tier: 'caution', color: '#eab308', label: 'medium'   };
    return { tier: 'ok', color: '#10b981', label: 'light' };
}

/** @param {string} s */
function he(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function uid() {
    return 'psup-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

// ── File handling ──────────────────────────────────────────────────────
/** @param {FileList | File[]} files */
function addFiles(files) {
    const arr = Array.from(files);
    let added = 0;
    for (const file of arr) {
        if (!file.type.startsWith('image/')) continue;
        if (file.size > 50 * 1024 * 1024) continue; // 50 MB cap per source image
        const id = uid();
        const inputUrl = URL.createObjectURL(file);
        // Probe dimensions for memory tier (deferred — fires on image load)
        const img = new Image();
        img.onload = () => {
            const item = _psupQueue.find((x) => x.id === id);
            if (item) {
                item.width  = img.width;
                item.height = img.height;
                renderQueue();
            }
        };
        img.src = inputUrl;
        _psupQueue.push({
            id, name: file.name, status: 'queued',
            modelId: _psupCurrentModelId, inputBlob: file, inputUrl,
        });
        added++;
    }
    if (added > 0) {
        renderQueue();
        setStatus(`เพิ่ม ${added} ไฟล์ลง queue`, 'ok');
        bus.emit('psup:files-added', { count: added });
    }
}

/** @param {string} id */
function removeItem(id) {
    const idx = _psupQueue.findIndex((x) => x.id === id);
    if (idx === -1) return;
    const item = _psupQueue[idx];
    if (item.inputUrl)  URL.revokeObjectURL(item.inputUrl);
    if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
    _psupQueue.splice(idx, 1);
    if (_psupActiveId === id) _psupActiveId = null;
    renderQueue();
}

function clearQueue() {
    for (const item of _psupQueue) {
        if (item.inputUrl)  URL.revokeObjectURL(item.inputUrl);
        if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
    }
    _psupQueue.length = 0;
    _psupActiveId = null;
    renderQueue();
    setStatus('Cleared queue', 'ok');
}

// ══════════════════════════════════════════════════════════════════════
//  Real per-item processing — ONNX inference + tile pipeline
// ══════════════════════════════════════════════════════════════════════

/** @param {PsupQueueItem} item */
async function processItem(item) {
    const targetM = _psupGetItemModel(item);
    const W = item.width || 0, H = item.height || 0;
    if (!W || !H || !item.inputBlob) {
        item.status = 'failed';
        item.error  = 'no source dimensions';
        renderQueue();
        return;
    }
    const scale = _psupSettings.scale;
    const peakMB = estPeakMB(W * scale, H * scale);
    if (peakMB >= PSUP_MEM_LIMIT_MB) {
        item.status = 'skipped';
        item.error  = `~${peakMB.toFixed(0)}MB > ${PSUP_MEM_LIMIT_MB}MB`;
        renderQueue();
        return;
    }

    item.status = 'processing';
    renderQueue();

    try {
        // Decode source as ImageBitmap for transfer to worker
        const srcBmp = await createImageBitmap(item.inputBlob);

        // Ensure worker has THIS item's model loaded (may differ from previous)
        const onLoad = (/** @type {any} */ ev) => {
            const e = ev && ev.data;
            if (!e) return;
            if (e.status === 'progress') {
                const pct = (typeof e.progress === 'number') ? e.progress.toFixed(0) : '?';
                setStatus(`Loading ${targetM.label}… ${pct}%`, '');
            } else if (e.status === 'downloading') {
                setStatus(`Downloading ${e.file || targetM.label}…`, '');
            } else if (e.status === 'compiling') {
                setStatus('Compiling shaders…', '');
            }
        };
        await _psupEnsureModelReady(targetM, onLoad);

        // Run inference (worker reports tile progress via onProgress)
        const t0 = (typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now();
        const onTile = (/** @type {any} */ ev) => {
            if (ev.type !== 'tile') return;
            const { idx, total } = ev.data;
            setStatus(`Upscaling ${item.name} · tile ${idx}/${total} · ${targetM.label}`, '');
        };
        const resp = await _psupSend(
            'process',
            { bitmap: srcBmp, scale, tileSize: targetM.tileSize, tier: _psupSettings.tier, tierMul: targetM.tierMul },
            onTile,
            [srcBmp]
        );
        const dt = ((typeof performance !== 'undefined' && performance.now) ? performance.now() : Date.now()) - t0;
        if (!resp || !resp.bitmap) throw new Error('no bitmap returned');

        // Encode result as Blob in chosen format
        const outBmp = /** @type {ImageBitmap} */ (resp.bitmap);
        const fmt = _psupSettings.format || 'png';
        const mime = fmt === 'png' ? 'image/png' : (fmt === 'webp' ? 'image/webp' : 'image/jpeg');
        const oc = (typeof OffscreenCanvas !== 'undefined')
            ? new OffscreenCanvas(outBmp.width, outBmp.height)
            : Object.assign(document.createElement('canvas'), { width: outBmp.width, height: outBmp.height });
        const octx = /** @type {any} */ (oc).getContext('2d');
        octx.drawImage(outBmp, 0, 0);
        /** @type {Blob} */
        const blob = await /** @type {any} */ (oc).convertToBlob
            ? /** @type {any} */ (oc).convertToBlob({ type: mime, quality: 0.92 })
            : new Promise((res, rej) => /** @type {HTMLCanvasElement} */ (oc).toBlob((b) => b ? res(b) : rej(new Error('toBlob failed')), mime, 0.92));
        if (item.outputUrl) URL.revokeObjectURL(item.outputUrl);
        item.outputBlob = blob;
        item.outputUrl  = URL.createObjectURL(blob);
        item.status     = 'done';
        // Stamp model + dimensions so re-runs show which model produced this output
        /** @type {any} */ (item).modelKey   = targetM.key;
        /** @type {any} */ (item).modelLabel = targetM.label;
        /** @type {any} */ (item).durationMs = dt;
        /** @type {any} */ (item).outWidth   = outBmp.width;
        /** @type {any} */ (item).outHeight  = outBmp.height;
        try { outBmp.close(); } catch (_e) {}
        renderQueue();
        bus.emit('psup:item-done', { id: item.id, durationMs: dt, modelId: targetM.key });
    } catch (err) {
        const e = /** @type {any} */ (err);
        item.status = 'failed';
        item.error  = ((e && e.message) || String(e)).slice(0, 80);
        renderQueue();
        if (typeof console !== 'undefined') console.warn('[psup] error on ' + item.name, e);
    }
}

/** Run ONNX inference on every queued/failed item sequentially. */
async function processQueue() {
    const pending = _psupQueue.filter((x) => x.status === 'queued' || x.status === 'failed');
    if (pending.length === 0) {
        setStatus('Queue ว่าง — เพิ่มรูปก่อน', 'err');
        return;
    }
    setStatus(`Processing ${pending.length} items (real ORT-Web inference)…`, '');
    let doneCount = 0;
    for (const item of pending) {
        await processItem(item);
        if (item.status === 'done') doneCount++;
    }
    const failed = _psupQueue.filter((x) => x.status === 'failed').length;
    const skipped = _psupQueue.filter((x) => x.status === 'skipped').length;
    const tail = (failed ? ` · ${failed} failed` : '') + (skipped ? ` · ${skipped} skipped` : '');
    setStatus(`Done · ${doneCount}/${pending.length}${tail} · backend: ${_psupBackend}`, 'ok');
    bus.emit('psup:processed', { done: doneCount, failed, skipped });
}

// ── UI render ──────────────────────────────────────────────────────────
/** @param {HTMLElement} rootEl */
function renderPanel(rootEl) {
    rootEl.innerHTML = `
        <div class="psup-panel" style="font-family:var(--sans, system-ui, sans-serif);color:var(--fg, #f5f5f7);">
            <style>
                .psup-panel label { display:block; font-size:10px; color:var(--dim, #888); text-transform:uppercase; letter-spacing:.08em; margin:6px 0 4px; font-weight:700; }
                .psup-panel select { background:var(--bg, #0d0d0d); color:var(--fg, #f5f5f7); border:1px solid var(--border, #2a2a2a); border-radius:6px; padding:6px 10px; font-size:12px; outline:none; font-family:inherit; }
                .psup-panel .chip-bar { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:12px; }
                .psup-panel .chip { font-size:11px; font-weight:600; padding:6px 12px; border:1px solid var(--border, #2a2a2a); border-radius:999px; background:transparent; color:var(--fg, #f5f5f7); cursor:pointer; transition:all .15s; }
                .psup-panel .chip.active { background:var(--accent, #089981); border-color:var(--accent, #089981); color:#000; }
                .psup-panel .chip:hover:not(.active) { border-color:var(--accent, #089981); }
                .psup-panel .dropzone { border:2px dashed var(--border, #2a2a2a); border-radius:12px; padding:24px 16px; text-align:center; cursor:pointer; transition:all .15s; background:rgba(8, 153, 129, 0.03); margin-bottom:12px; }
                .psup-panel .dropzone.drag { border-color:var(--accent, #089981); background:rgba(8, 153, 129, 0.08); }
                .psup-panel .dropzone-title { font-size:13px; font-weight:600; margin-bottom:4px; }
                .psup-panel .dropzone-desc { font-size:11px; color:var(--dim, #888); margin-bottom:10px; }
                .psup-panel .grid-2 { display:grid; grid-template-columns:1fr 1fr; gap:12px; align-items:stretch; }
                @media (max-width: 720px) { .psup-panel .grid-2 { grid-template-columns:1fr; } }
                .psup-panel .pane { background:var(--bg, #0d0d0d); border:1px solid var(--border, #2a2a2a); border-radius:8px; padding:12px; max-height:380px; overflow:auto; }
                .psup-panel .pane h3 { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim, #888); margin-bottom:8px; }
                .psup-panel .qrow { display:flex; align-items:center; gap:8px; padding:8px 10px; border:1px solid var(--border, #2a2a2a); border-radius:6px; margin-bottom:6px; background:rgba(255,255,255,0.02); }
                .psup-panel .qrow .name { flex:1; font-size:12px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
                .psup-panel .qrow .meta { font-size:10px; color:var(--dim, #888); }
                .psup-panel .qrow .badge { font-size:10px; font-weight:700; padding:2px 8px; border-radius:999px; }
                .psup-panel .qrow .x-btn { background:transparent; border:0; color:var(--dim, #888); cursor:pointer; padding:2px 6px; }
                .psup-panel .qrow .x-btn:hover { color:#f43f5e; }
                .psup-panel .empty { font-size:12px; color:var(--dim, #888); padding:18px; text-align:center; }
                .psup-panel .actions { display:flex; gap:8px; margin-top:12px; align-items:center; flex-wrap:wrap; }
                .psup-panel button.act { background:var(--accent, #089981); color:#000; border:0; padding:10px 18px; border-radius:8px; font-weight:600; font-size:13px; cursor:pointer; font-family:inherit; }
                .psup-panel button.act.ghost { background:var(--card, #1a1a1a); color:var(--fg, #f5f5f7); border:1px solid var(--border, #2a2a2a); }
                .psup-panel button.act:hover { opacity:.85; }
                .psup-panel #psup-status { display:inline-flex; align-items:center; padding:0 8px; font-size:12px; color:var(--dim, #888); }
                .psup-panel #psup-status[data-type="ok"] { color:var(--accent, #089981); }
                .psup-panel #psup-status[data-type="err"] { color:#f43f5e; }
                .psup-panel .stub-note { background:rgba(245, 158, 11, 0.08); border-left:3px solid #f59e0b; padding:10px 14px; font-size:12px; color:var(--dim, #888); margin-top:12px; border-radius:4px; }
                .psup-panel .settings-row { display:grid; grid-template-columns:1fr 1fr; gap:12px; margin-bottom:8px; }
            </style>

            <div id="psup-dropzone" class="dropzone">
                <div class="dropzone-title">Drop multiple images or click to browse</div>
                <div class="dropzone-desc">JPG · PNG · WEBP — up to 50 MB per image</div>
                <button class="act" id="psup-browse-btn">Choose images</button>
                <input type="file" id="psup-file-input" accept="image/*" multiple style="display:none;" />
            </div>

            <div class="grid-2">
                <div class="pane">
                    <h3>Queue</h3>
                    <div id="psup-queue-list"></div>
                    <div id="psup-compare-wrap" style="margin-top:10px;display:none;">
                        <h3 style="margin-bottom:8px;">Compare done</h3>
                        <div id="psup-compare" style="display:grid;gap:8px;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));"></div>
                    </div>
                </div>
                <div class="pane">
                    <h3>Settings</h3>

                    <label>Default Model</label>
                    <div class="chip-bar" id="psup-model-bar"></div>

                    <label>Tier (post-process intensity)</label>
                    <div class="chip-bar" id="psup-tier-bar"></div>

                    <div class="settings-row">
                        <div>
                            <label for="psup-scale">Scale</label>
                            <select id="psup-scale">
                                <option value="2" ${_psupSettings.scale === 2 ? 'selected' : ''}>2×</option>
                                <option value="3" ${_psupSettings.scale === 3 ? 'selected' : ''}>3×</option>
                                <option value="4" ${_psupSettings.scale === 4 ? 'selected' : ''}>4×</option>
                            </select>
                        </div>
                        <div>
                            <label for="psup-format">Format</label>
                            <select id="psup-format">
                                <option value="png"  ${_psupSettings.format === 'png'  ? 'selected' : ''}>PNG</option>
                                <option value="webp" ${_psupSettings.format === 'webp' ? 'selected' : ''}>WEBP</option>
                                <option value="jpg"  ${_psupSettings.format === 'jpg'  ? 'selected' : ''}>JPG</option>
                            </select>
                        </div>
                    </div>

                    <div style="font-size:10px;color:var(--dim, #888);margin-top:8px;line-height:1.5;">
                        Memory monitor: <strong style="color:#10b981;">≤ ${PSUP_MEM_CAUTION_MB} light</strong> ·
                        <strong style="color:#eab308;">≤ ${PSUP_MEM_WARN_MB} medium</strong> ·
                        <strong style="color:#f59e0b;">≤ ${PSUP_MEM_LIMIT_MB} heavy</strong> ·
                        <strong style="color:#f43f5e;">&gt; ${PSUP_MEM_LIMIT_MB} skip</strong>
                    </div>
                </div>
            </div>

            <div class="actions">
                <button class="act"       id="psup-process-btn">Process Queue</button>
                <button class="act ghost" id="psup-clear-btn">Clear Queue</button>
                <span id="psup-status"></span>
            </div>

            <div class="stub-note">
                <strong>Session 3g port</strong> — drop zone (multi-file) + queue + tier picker + model picker + memory tier monitor live; "Process Queue" runs a stub (marks queued items done without actual upscaling). Real ORT-Web inference + tile pipeline + WebGPU EP + compare grid ship in Session 3h+.
            </div>
        </div>
    `;
}

function renderModelBar() {
    if (!_psupPanel) return;
    const bar = _psupPanel.querySelector('#psup-model-bar');
    if (!bar) return;
    bar.innerHTML = Object.keys(PSUP_MODEL_REGISTRY).map((id) => {
        const m = PSUP_MODEL_REGISTRY[id];
        const active = id === _psupCurrentModelId ? ' active' : '';
        return `<button class="chip${active}" data-model="${id}" title="${he(m.sub)} · ${he(m.size)}">${he(m.label)}</button>`;
    }).join('');
}

function renderTierBar() {
    if (!_psupPanel) return;
    const bar = _psupPanel.querySelector('#psup-tier-bar');
    if (!bar) return;
    const tiers = [
        { id: 'fast',     label: 'Fast'     },
        { id: 'balanced', label: 'Balanced' },
        { id: 'maximum',  label: 'Maximum'  },
    ];
    bar.innerHTML = tiers.map((t) => {
        const active = t.id === _psupSettings.tier ? ' active' : '';
        return `<button class="chip${active}" data-tier="${t.id}">${he(t.label)}</button>`;
    }).join('');
}

function renderQueue() {
    if (!_psupPanel) return;
    const host = _psupPanel.querySelector('#psup-queue-list');
    if (!host) return;
    renderCompare();
    if (_psupQueue.length === 0) {
        host.innerHTML = '<div class="empty">Queue ว่าง — drop รูปด้านบนเพื่อเริ่ม</div>';
        return;
    }
    host.innerHTML = _psupQueue.map((item) => {
        const dim = (item.width && item.height) ? `${item.width}×${item.height}` : '...';
        let memBadge = '';
        if (item.width && item.height) {
            const peakMB = estPeakMB(item.width * _psupSettings.scale, item.height * _psupSettings.scale);
            const m = memTier(peakMB);
            memBadge = `<span class="badge" style="background:${m.color}22;color:${m.color};">${peakMB.toFixed(0)}MB ${m.label}</span>`;
        }
        const statusColor = {
            queued:     'var(--dim, #888)',
            processing: '#f59e0b',
            done:       '#10b981',
            failed:     '#f43f5e',
            skipped:    '#f43f5e',
        }[item.status] || 'var(--dim, #888)';
        return `<div class="qrow" data-item="${item.id}">
            <div style="flex:1;min-width:0;">
                <div class="name" title="${he(item.name)}">${he(item.name)}</div>
                <div class="meta">${dim} · ${he(item.modelId || '?')}</div>
            </div>
            ${memBadge}
            <span class="badge" style="background:${statusColor}22;color:${statusColor};">${item.status}</span>
            <button class="x-btn" data-remove="${item.id}" title="Remove">✕</button>
        </div>`;
    }).join('');
}

function renderCompare() {
    if (!_psupPanel) return;
    const wrap = /** @type {HTMLElement | null} */ (_psupPanel.querySelector('#psup-compare-wrap'));
    const host = /** @type {HTMLElement | null} */ (_psupPanel.querySelector('#psup-compare'));
    if (!wrap || !host) return;
    const done = _psupQueue.filter((x) => x && x.status === 'done' && x.outputUrl);
    if (done.length < 2) {
        wrap.style.display = 'none';
        host.innerHTML = '';
        return;
    }
    wrap.style.display = '';
    host.innerHTML = done.slice(0, 6).map((it) => {
        const dim = (it.width && it.height)
            ? `${it.width * (_psupSettings.scale || 1)}×${it.height * (_psupSettings.scale || 1)}`
            : '';
        const name = he(it.name || it.id || '');
        return `<div style="background:var(--bg, #0d0d0d);border:1px solid var(--border, #2a2a2a);border-radius:8px;padding:6px;display:flex;flex-direction:column;gap:4px;">
            <img src="${he(it.outputUrl || '')}" alt="" style="width:100%;height:200px;object-fit:contain;background:#000;border-radius:4px;display:block;" loading="lazy">
            <div style="font-size:11px;font-family:var(--mono, monospace);color:var(--dim, #888);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${name}</div>
            <div style="font-size:10px;font-family:var(--mono, monospace);color:var(--dim, #888);">${he(it.modelId || '')} · ${dim}</div>
        </div>`;
    }).join('');
}

/** @param {string} msg @param {'ok' | 'err' | ''} [type] */
function setStatus(msg, type) {
    if (!_psupPanel) return;
    const el = /** @type {HTMLElement | null} */ (_psupPanel.querySelector('#psup-status'));
    if (!el) return;
    el.textContent = msg;
    el.dataset.type = type || '';
    if (msg && type === 'ok') setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; el.dataset.type = ''; } }, 4000);
}

function wireEvents() {
    if (!_psupPanel) return;
    const panel = _psupPanel;
    const dropzone = /** @type {HTMLElement | null} */ (panel.querySelector('#psup-dropzone'));
    const fileInput = /** @type {HTMLInputElement | null} */ (panel.querySelector('#psup-file-input'));
    const browseBtn = panel.querySelector('#psup-browse-btn');

    if (dropzone) {
        ['dragenter', 'dragover'].forEach((ev) => {
            dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.add('drag'); });
        });
        ['dragleave', 'drop'].forEach((ev) => {
            dropzone.addEventListener(ev, (e) => { e.preventDefault(); dropzone.classList.remove('drag'); });
        });
        dropzone.addEventListener('drop', (e) => {
            const dt = /** @type {DragEvent} */ (e).dataTransfer;
            if (dt && dt.files && dt.files.length > 0) addFiles(dt.files);
        });
        dropzone.addEventListener('click', () => fileInput?.click());
    }
    if (browseBtn) browseBtn.addEventListener('click', (e) => { e.stopPropagation(); fileInput?.click(); });
    if (fileInput) fileInput.addEventListener('change', () => {
        if (fileInput.files && fileInput.files.length > 0) addFiles(fileInput.files);
    });

    panel.addEventListener('click', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        // Model chip
        const modelBtn = t.closest('[data-model]');
        if (modelBtn) {
            const mid = /** @type {HTMLElement} */ (modelBtn).dataset.model;
            if (mid && PSUP_MODEL_REGISTRY[mid]) {
                setCurrentModel(mid);
                renderModelBar();
                // Apply to queued items that don't have a per-item override
                for (const item of _psupQueue) if (item.status === 'queued') item.modelId = mid;
                renderQueue();
            }
            return;
        }
        // Tier chip
        const tierBtn = t.closest('[data-tier]');
        if (tierBtn) {
            const tid = /** @type {HTMLElement} */ (tierBtn).dataset.tier;
            if (tid && TIER_PRESETS[tid]) {
                updateSettings({ tier: /** @type {any} */ (tid) });
                renderTierBar();
            }
            return;
        }
        // Remove item
        const xBtn = t.closest('[data-remove]');
        if (xBtn) {
            const rid = /** @type {HTMLElement} */ (xBtn).dataset.remove;
            if (rid) removeItem(rid);
            return;
        }
    });

    // Settings selects
    const scaleSel = /** @type {HTMLSelectElement | null} */ (panel.querySelector('#psup-scale'));
    const fmtSel   = /** @type {HTMLSelectElement | null} */ (panel.querySelector('#psup-format'));
    if (scaleSel) scaleSel.addEventListener('change', () => {
        updateSettings({ scale: parseInt(scaleSel.value, 10) });
        renderQueue(); // mem badges depend on scale
    });
    if (fmtSel) fmtSel.addEventListener('change', () => updateSettings({ format: /** @type {any} */ (fmtSel.value) }));

    // Action buttons
    const procBtn  = panel.querySelector('#psup-process-btn');
    const clearBtn = panel.querySelector('#psup-clear-btn');
    if (procBtn)  procBtn.addEventListener('click', () => processQueue());
    if (clearBtn) clearBtn.addEventListener('click', () => clearQueue());
}

// ── Module lifecycle ───────────────────────────────────────────────────
/**
 * @param {HTMLElement} rootEl
 * @param {{ bus?: any, lsSave?: any, lsGet?: any }} [_ctx]
 */
export function init(rootEl, _ctx) {
    _psupPanel = rootEl;
    renderPanel(rootEl);
    renderModelBar();
    renderTierBar();
    renderQueue();
    wireEvents();
    bus.emit('psup:init', { rootEl, modelId: _psupCurrentModelId });
    return {
        id:           'psup',
        version:      '0.3-session3p-heavy-port',
        ready:        true,
        currentModel: _psupCurrentModelId,
        modelMeta:    PSUP_MODEL_REGISTRY[_psupCurrentModelId],
        availableModels: Object.keys(PSUP_MODEL_REGISTRY),
        queueLength:  _psupQueue.length,
        settings:     { ..._psupSettings },
        memLimits:    { hard: PSUP_MEM_LIMIT_MB, warn: PSUP_MEM_WARN_MB, caution: PSUP_MEM_CAUTION_MB },
    };
}

export function destroy() {
    clearQueue();
    if (_psupWorker) {
        try { _psupWorker.terminate(); } catch (_e) {}
        _psupWorker = null;
        _psupWorkerReady = false;
        _psupModelLoaded = null;
        _psupPending.clear();
    }
    if (_psupIdb) {
        try { _psupIdb.close(); } catch (_e) {}
        _psupIdb = null;
    }
    _psupPanel = null;
    bus.emit('psup:destroy');
}
