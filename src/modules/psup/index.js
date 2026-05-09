// PS Upscaler — lazy module (Session 3g UI port — drop zone + queue + tier + model + memory monitor, 2026-05-09)
//
// Status: PARTIAL PORT (drop zone multi-file, queue list, tier picker, model
// picker, settings, memory tier display per item, Process button stub).
// Full ORT-Web inference, tile pipeline, queue runner, compare grid with
// synced pan/zoom, per-item right-click model assign all stay in monolith
// index.html until Session 3h+ port. PSUP carries the heaviest external dep
// (ORT-Web 1.22 + WebGPU + ~50MB model files).
//
// Ported in 3g:
//   - Model registry (kept from skeleton — ultrasharp v1/v2 + bhi-dat2-real)
//   - TIER_PRESETS (Fast/Balanced/Maximum post-process knobs) + tierMul application
//   - State container + getters/setters
//   - estPeakMB / memTier (kept from skeleton)
//   - lifecycle: load files → queue → process stub → output blob
//   - renderPanel(rootEl) — drop zone + queue list + tier picker + model picker + settings + actions
//   - wireEvents() — drop, file input, tier select, model select, scale change, process click, clear click
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

// ── Process stub ───────────────────────────────────────────────────────
// Real ONNX inference + tile pipeline + WebGPU EP lives in monolith. Stub
// just marks each queued item as done with the input image as output —
// proves queue lifecycle works end-to-end before Session 3h+ wires real model.
async function processQueue() {
    const pending = _psupQueue.filter((x) => x.status === 'queued');
    if (pending.length === 0) {
        setStatus('Queue ว่าง — เพิ่มรูปก่อน', 'err');
        return;
    }
    setStatus(`Processing ${pending.length} items (stub — real model port deferred to Session 3h)...`, '');
    for (const item of pending) {
        // Memory check — refuse if exceeds hard limit
        if (item.width && item.height) {
            const peakMB = estPeakMB(item.width * _psupSettings.scale, item.height * _psupSettings.scale);
            if (peakMB >= PSUP_MEM_LIMIT_MB) {
                item.status = 'skipped';
                item.error  = `peak ${peakMB.toFixed(0)}MB > ${PSUP_MEM_LIMIT_MB}MB`;
                renderQueue();
                continue;
            }
        }
        item.status = 'processing';
        renderQueue();
        await new Promise((r) => setTimeout(r, 300));
        // Stub output = input blob unchanged (real model would upscale)
        item.outputBlob = item.inputBlob;
        item.outputUrl  = item.inputUrl;
        item.status     = 'done';
        renderQueue();
    }
    const done = _psupQueue.filter((x) => x.status === 'done').length;
    setStatus(`Done (stub) · ${done}/${_psupQueue.length} items`, 'ok');
    bus.emit('psup:processed', { done });
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
        version:      '0.2-session3g-ui-port',
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
    _psupPanel = null;
    bus.emit('psup:destroy');
}
