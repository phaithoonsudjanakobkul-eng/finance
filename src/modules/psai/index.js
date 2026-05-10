// PS AI Studio — lazy module (Session 3k full heavy-logic port, 2026-05-10)
//
// Status: FULL PORT — image input, prompt UI, LoRA stack, advanced controls,
// Generate orchestrator, WebSocket progress, settings modal, result + history.
// All heavy logic from monolith now lives here. Single source of truth for PSAI.
//
// CRITICAL invariants from project_ps_ai_studio memory (DO NOT regress):
//   1. CFG = 1.0 ALWAYS (Flux is guidance-distilled). FluxGuidance node carries
//      real guidance (default 2.5) — NOT the KSampler cfg input.
//   2. LoRA balance: morph (Body_Adjuster_kontext etc.) ≥ 2× preserve
//      (kontext_hires / high_detail). Stacking 3 preserve at high strength fails.
//   3. Prompt structure: state "what to change" explicitly; preserve list SHORT
//      (1-2 items max). Long lists → Kontext over-preserves and ignores change.
//   4. 3D limitation: reflections in mirrors/glass don't update consistently.

import { lsSave, lsGetJson } from '../../core/storage.js';
import { bus } from '../../core/bus.js';

const _PSAI_LS_SETTINGS = 'ps_psai_settings';
const _PSAI_LS_PRESETS  = 'ps_psai_presets';
const _PSAI_DEFAULT_URL = 'http://127.0.0.1:8188';

const _PSAI_FETCH_TIMEOUT  = 5000;
const _PSAI_UPLOAD_TIMEOUT = 60000;
const _PSAI_PROMPT_TIMEOUT = 15000;

/** @type {{
 *   url: string, mode: string, steps: number, cfg: number,
 *   denoise: number, guidance: number, seed: number,
 *   loras: Array<{name: string, strength: number}>
 * }} */
const _psaiSettings = {
    url:      _PSAI_DEFAULT_URL,
    mode:     'smart',
    steps:    24,
    cfg:      1.0,        // invariant #1
    denoise:  1.0,
    guidance: 2.5,
    seed:     -1,
    loras:    [],
};

const _psaiState = {
    connected:    false,
    comfyVersion: /** @type {string | null} */ (null),
    vramTotal:    /** @type {number | null} */ (null),
    vramFree:     /** @type {number | null} */ (null),
    clientId:     /** @type {string | null} */ (null),
    /** @type {WebSocket | null} */
    ws:           null,
    wsReady:      false,
    /** @type {Blob | null} */
    inputBlob:    null,
    /** @type {string | null} */
    inputName:    null,
    /** @type {string | null} */
    inputUrl:     null,
    currentPromptId: /** @type {string | null} */ (null),
    generating:   false,
    queueRemaining: 0,
    progress:     { value: 0, max: 0, node: /** @type {string | null} */ (null) },
    /** @type {Array<string>} */
    loraList:     [],
    /** @type {Array<{ ts: number, prompt: string, mode: string, blob: Blob, blobUrl: string }>} */
    history:      [],
    /** @type {null | 'mixed-content' | 'timeout' | 'unreachable'} */
    envBlocked:   null,
};

// Module-scoped panel ref (was global window._psaiPanel in monolith)
/** @type {HTMLElement | null} */
let _psaiPanel = null;

// ── Persistence ────────────────────────────────────────────────────────
function saveSettings() {
    lsSave(_PSAI_LS_SETTINGS, JSON.stringify(_psaiSettings));
}
function loadSettings() {
    const parsed = lsGetJson(_PSAI_LS_SETTINGS, /** @type {any} */ (null));
    if (parsed && typeof parsed === 'object') Object.assign(_psaiSettings, parsed);
}
/** @returns {Array<any>} */
function loadPresets() { return lsGetJson(_PSAI_LS_PRESETS, /** @type {Array<any>} */ ([])); }
/** @param {Array<any>} list */
function savePresets(list) { lsSave(_PSAI_LS_PRESETS, JSON.stringify(list)); }

function uuid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'psai-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
}
function randSeed() { return Math.floor(Math.random() * 0x7fffffff); }

// ── Environment guard ──────────────────────────────────────────────────
/** @returns {{ ok: boolean, reason?: string, isLocalhost?: boolean }} */
function canConnect() {
    const url = (_psaiSettings.url || '').trim();
    if (!url) return { ok: false, reason: 'no-url' };
    const pageHttps  = location.protocol === 'https:';
    const targetHttp = !/^https:/i.test(url);
    if (pageHttps && targetHttp) return { ok: false, reason: 'mixed-content' };
    const lowerUrl = url.toLowerCase();
    const isLocalhost = lowerUrl.indexOf('localhost') >= 0
                     || lowerUrl.indexOf('127.0.0.1') >= 0
                     || lowerUrl.indexOf('0.0.0.0')   >= 0;
    return { ok: true, isLocalhost };
}

/**
 * @param {string} url
 * @param {RequestInit} [opts]
 * @param {number} [timeoutMs]
 */
function fetchWithTimeout(url, opts, timeoutMs) {
    const ctrl  = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs || _PSAI_FETCH_TIMEOUT);
    return fetch(url, { ...(opts || {}), signal: ctrl.signal }).finally(() => clearTimeout(timer));
}

// ── Toast (routes to panel) ────────────────────────────────────────────
/** @param {string} msg @param {'info' | 'error' | 'success' | 'warn'} [type] */
function toast(msg, type) {
    if (!_psaiPanel) { console.log('[PSAI]', msg); return; }
    const t = /** @type {HTMLElement | null} */ (_psaiPanel.querySelector('#psai-toast'));
    if (!t) return;
    t.textContent = msg;
    t.dataset.type = type || 'info';
    t.classList.add('psai-toast-show');
    const tx = /** @type {any} */ (t);
    clearTimeout(tx._hideTimer);
    tx._hideTimer = setTimeout(() => t.classList.remove('psai-toast-show'), type === 'error' ? 6000 : 3000);
}

// ── Connection badge ───────────────────────────────────────────────────
function updateConnBadge() {
    if (!_psaiPanel) return;
    const dot   = /** @type {HTMLElement | null} */ (_psaiPanel.querySelector('#psai-conn-dot'));
    const label = /** @type {HTMLElement | null} */ (_psaiPanel.querySelector('#psai-conn-label'));
    if (!dot || !label) return;
    if (_psaiState.connected) {
        dot.style.background = 'var(--accent, #089981)';
        const vramStr = _psaiState.vramFree != null && _psaiState.vramTotal != null
            ? ' · VRAM ' + (_psaiState.vramFree/1e9).toFixed(1) + '/' + (_psaiState.vramTotal/1e9).toFixed(1) + 'GB'
            : '';
        label.textContent = 'Connected · ' + (_psaiState.comfyVersion || 'ComfyUI') + vramStr;
        return;
    }
    if (_psaiState.envBlocked === 'mixed-content') {
        dot.style.background = '#f59e0b';
        label.textContent = 'PSLink HTTPS — ComfyUI HTTP ติดต่อไม่ได้ ใช้ npm run dev';
        return;
    }
    if (_psaiState.envBlocked === 'timeout') {
        dot.style.background = '#f59e0b';
        label.textContent = 'ComfyUI ไม่ตอบ (timeout)';
        return;
    }
    dot.style.background = 'var(--text-dim, #888)';
    label.textContent = 'Not connected';
}

// ── ComfyUI HTTP API ───────────────────────────────────────────────────
async function testConnection() {
    const conn = canConnect();
    if (!conn.ok) {
        _psaiState.connected = false;
        _psaiState.envBlocked = /** @type {any} */ (conn.reason);
        updateConnBadge();
        const blockedMsg = conn.reason === 'mixed-content'
            ? 'PSLink HTTPS — เรียก ComfyUI (HTTP localhost) ไม่ได้ ต้องรันผ่าน http://localhost (npm run dev)'
            : 'ยังไม่ได้ตั้ง ComfyUI URL';
        return { ok: false, error: blockedMsg, reason: conn.reason };
    }
    const url = _psaiSettings.url.replace(/\/$/, '');
    try {
        const r = await fetchWithTimeout(url + '/system_stats', { method: 'GET' }, _PSAI_FETCH_TIMEOUT);
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const data = await r.json();
        _psaiState.connected    = true;
        _psaiState.envBlocked   = null;
        _psaiState.comfyVersion = (data.system && data.system.comfyui_version) ? 'ComfyUI ' + data.system.comfyui_version : 'ComfyUI';
        if (data.devices && data.devices[0]) {
            _psaiState.vramTotal = data.devices[0].vram_total || 0;
            _psaiState.vramFree  = data.devices[0].vram_free  || 0;
        }
        updateConnBadge();
        return { ok: true, data };
    } catch (err) {
        const e = /** @type {any} */ (err);
        _psaiState.connected = false;
        const isAbort = e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''));
        _psaiState.envBlocked = isAbort ? 'timeout' : 'unreachable';
        updateConnBadge();
        return { ok: false, error: (e && e.message) || String(e) };
    }
}

async function fetchLoras() {
    const conn = canConnect();
    if (!conn.ok) { _psaiState.loraList = []; throw new Error(conn.reason || 'cannot connect'); }
    const url = _psaiSettings.url.replace(/\/$/, '');
    const r = await fetchWithTimeout(url + '/object_info', { method: 'GET' }, _PSAI_FETCH_TIMEOUT);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const info = await r.json();
    const node = info['LoraLoaderModelOnly'] || info['LoraLoader'];
    /** @type {string[]} */
    let names = [];
    if (node && node.input && node.input.required && node.input.required.lora_name) {
        const entry = node.input.required.lora_name;
        if (Array.isArray(entry) && Array.isArray(entry[0])) names = entry[0];
    }
    _psaiState.loraList = names;
    return names;
}

/** @param {Blob} blob @param {string} [filename] */
async function uploadImage(blob, filename) {
    const url = _psaiSettings.url.replace(/\/$/, '');
    const fd = new FormData();
    fd.append('image', blob, filename || 'psai-input.png');
    fd.append('type', 'input');
    fd.append('overwrite', 'true');
    const r = await fetchWithTimeout(url + '/upload/image', { method: 'POST', body: fd }, _PSAI_UPLOAD_TIMEOUT);
    if (!r.ok) throw new Error('Upload failed: HTTP ' + r.status);
    return await r.json();
}

/** @param {any} workflow */
async function queuePrompt(workflow) {
    const url = _psaiSettings.url.replace(/\/$/, '');
    const body = JSON.stringify({ prompt: workflow, client_id: _psaiState.clientId });
    const r = await fetchWithTimeout(url + '/prompt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body,
    }, _PSAI_PROMPT_TIMEOUT);
    if (!r.ok) {
        let txt = '';
        try { txt = await r.text(); } catch (_) {}
        throw new Error('Queue failed: HTTP ' + r.status + (txt ? ' — ' + txt.slice(0, 240) : ''));
    }
    return await r.json();
}

/** @param {string} filename @param {string} [subfolder] @param {string} [type] */
async function fetchView(filename, subfolder, type) {
    const url = _psaiSettings.url.replace(/\/$/, '');
    const qs = 'filename=' + encodeURIComponent(filename) +
               '&subfolder=' + encodeURIComponent(subfolder || '') +
               '&type='      + encodeURIComponent(type      || 'output');
    const r = await fetchWithTimeout(url + '/view?' + qs, { method: 'GET' }, _PSAI_UPLOAD_TIMEOUT);
    if (!r.ok) throw new Error('View fetch failed: HTTP ' + r.status);
    return await r.blob();
}

/** @param {string} promptId */
async function fetchHistory(promptId) {
    const url = _psaiSettings.url.replace(/\/$/, '');
    const r = await fetchWithTimeout(url + '/history/' + promptId, { method: 'GET' }, _PSAI_PROMPT_TIMEOUT);
    if (!r.ok) throw new Error('History fetch failed: HTTP ' + r.status);
    return await r.json();
}

async function interrupt() {
    try {
        const url = _psaiSettings.url.replace(/\/$/, '');
        await fetchWithTimeout(url + '/interrupt', { method: 'POST', body: '{}' }, _PSAI_FETCH_TIMEOUT);
    } catch (_e) {}
}

// ── WebSocket pipeline ─────────────────────────────────────────────────
function openWS() {
    if (_psaiState.ws && _psaiState.ws.readyState === 1) return;
    const conn = canConnect();
    if (!conn.ok) return;
    try {
        const http = _psaiSettings.url.replace(/\/$/, '');
        const ws   = http.replace(/^http/, 'ws') + '/ws?clientId=' + encodeURIComponent(_psaiState.clientId || '');
        const sock = new WebSocket(ws);
        sock.binaryType = 'arraybuffer';
        sock.onopen    = () => { _psaiState.wsReady = true; };
        sock.onclose   = () => { _psaiState.wsReady = false; _psaiState.ws = null; };
        sock.onerror   = () => { _psaiState.wsReady = false; };
        sock.onmessage = onWsMessage;
        _psaiState.ws  = sock;
    } catch (_e) {
        _psaiState.ws = null;
        _psaiState.wsReady = false;
    }
}

/** @param {MessageEvent} ev */
function onWsMessage(ev) {
    if (typeof ev.data !== 'string') return; // skip binary preview frames
    /** @type {any} */
    let msg;
    try { msg = JSON.parse(ev.data); } catch (_e) { return; }
    if (!msg || !msg.type) return;
    const d = msg.data || {};
    // Filter to our prompt only (status messages exempt)
    if (d.prompt_id && _psaiState.currentPromptId && d.prompt_id !== _psaiState.currentPromptId &&
        msg.type !== 'status') return;
    if (msg.type === 'status') {
        if (d.status && d.status.exec_info)
            _psaiState.queueRemaining = d.status.exec_info.queue_remaining || 0;
    } else if (msg.type === 'executing') {
        if (d.node === null) {
            // Prompt finished — fetch result
            onGenerationDone();
        } else {
            updateProgress({ node: d.node });
        }
    } else if (msg.type === 'progress') {
        updateProgress({ value: d.value, max: d.max, node: d.node });
    } else if (msg.type === 'execution_error') {
        onGenerationError(d.exception_message || 'Execution failed', d);
    }
}

/** @param {{ value?: number, max?: number, node?: string | null }} p */
function updateProgress(p) {
    if (p.value != null) _psaiState.progress.value = p.value;
    if (p.max   != null) _psaiState.progress.max   = p.max;
    if (p.node  != null) _psaiState.progress.node  = p.node;
    if (!_psaiPanel) return;
    const bar = /** @type {HTMLElement | null} */ (_psaiPanel.querySelector('#psai-progress-bar'));
    const txt = /** @type {HTMLElement | null} */ (_psaiPanel.querySelector('#psai-progress-text'));
    if (bar) {
        const pct = (_psaiState.progress.max > 0)
            ? (100 * _psaiState.progress.value / _psaiState.progress.max) : 0;
        bar.style.width = pct.toFixed(1) + '%';
    }
    if (txt) {
        txt.textContent = _psaiState.progress.max > 0
            ? 'Step ' + _psaiState.progress.value + ' / ' + _psaiState.progress.max
            : 'Working…';
    }
}

// ── Workflow builders (Flux Kontext recipe) ────────────────────────────
// Quick mode: minimal — UnetLoaderGGUF + DualCLIPLoader + LoadImage + KSampler
// Smart mode: Phase 1 stub (= Quick). Phase 1.5 will inject IPAdapterFluxLoader
// + IPAdapterApply for jewelry/detail preservation.

/**
 * @param {{ inputName: string, prompt: string, seed: number, steps: number,
 *           cfg: number, denoise: number, guidance: number,
 *           loras: Array<{name: string, strength: number}> }} opts
 */
function buildQuickWorkflow(opts) {
    /** @type {[string, number]} */
    let modelChain = ['1', 0];
    let nextId = 100;
    /** @type {Record<string, { class_type: string, inputs: Record<string, any> }>} */
    const graph = {
        "1": { class_type: "UnetLoaderGGUF",
               inputs: { unet_name: "flux1-kontext-dev-Q4_K_S.gguf" } },
        "2": { class_type: "DualCLIPLoader",
               inputs: { clip_name1: "clip_l.safetensors",
                         clip_name2: "t5xxl_fp8_e4m3fn_scaled.safetensors",
                         type: "flux" } },
        "3": { class_type: "VAELoader",
               inputs: { vae_name: "ae.safetensors" } },
        "4": { class_type: "LoadImage",
               inputs: { image: opts.inputName } },
        "5": { class_type: "FluxKontextImageScale",
               inputs: { image: ["4", 0] } },
        "6": { class_type: "CLIPTextEncode",
               inputs: { text: opts.prompt, clip: ["2", 0] } },
        "7": { class_type: "VAEEncode",
               inputs: { pixels: ["5", 0], vae: ["3", 0] } }
    };
    // LoRA chain: feed UnetLoaderGGUF through each LoraLoaderModelOnly
    (opts.loras || []).forEach((lora) => {
        if (!lora || !lora.name) return;
        const id = String(nextId++);
        graph[id] = {
            class_type: "LoraLoaderModelOnly",
            inputs: {
                model:        modelChain,
                lora_name:    lora.name,
                strength_model: (typeof lora.strength === 'number') ? lora.strength : 1.0
            }
        };
        modelChain = [id, 0];
    });
    // FluxGuidance applied to positive conditioning (Kontext expects this)
    graph["8"] = { class_type: "FluxGuidance",
                   inputs: { guidance: opts.guidance != null ? opts.guidance : 2.5,
                             conditioning: ["6", 0] } };
    // ReferenceLatent so Kontext knows the source latent
    graph["9"] = { class_type: "ReferenceLatent",
                   inputs: { conditioning: ["8", 0], latent: ["7", 0] } };
    graph["10"] = { class_type: "KSampler",
                    inputs: {
                        seed:         (opts.seed >= 0) ? opts.seed : randSeed(),
                        steps:        opts.steps || 24,
                        cfg:          opts.cfg || 1.0,    // invariant #1
                        sampler_name: "euler",
                        scheduler:    "simple",
                        denoise:      (opts.denoise != null) ? opts.denoise : 1.0,
                        model:        modelChain,
                        positive:     ["9", 0],
                        negative:     ["9", 0],
                        latent_image: ["7", 0]
                    } };
    graph["11"] = { class_type: "VAEDecode",
                    inputs: { samples: ["10", 0], vae: ["3", 0] } };
    graph["12"] = { class_type: "SaveImage",
                    inputs: { images: ["11", 0], filename_prefix: "PSAI_" } };
    return graph;
}

/** @param {Parameters<typeof buildQuickWorkflow>[0]} opts */
function buildSmartWorkflow(opts) {
    // Phase 1 stub: same as Quick. Phase 1.5 will inject IP-Adapter.
    return buildQuickWorkflow(opts);
}

/** @param {Parameters<typeof buildQuickWorkflow>[0]} opts */
function buildWorkflow(opts) {
    switch (_psaiSettings.mode) {
        case 'quick': return buildQuickWorkflow(opts);
        case 'smart': return buildSmartWorkflow(opts);
        case 'lock':  return buildSmartWorkflow(opts); // Phase 2: replace
        default:      return buildQuickWorkflow(opts);
    }
}

// ── Generation orchestrator ────────────────────────────────────────────
async function generate() {
    if (_psaiState.generating) { toast('กำลัง generate อยู่ — รอให้เสร็จก่อน', 'warn'); return; }
    if (!_psaiState.inputBlob) { toast('ยังไม่ได้อัพโหลดรูป', 'warn'); return; }
    if (!_psaiPanel) return;
    const promptEl = /** @type {HTMLTextAreaElement | null} */ (_psaiPanel.querySelector('#psai-prompt'));
    const prompt = (promptEl ? promptEl.value : '').trim();
    if (!prompt) { toast('กรอก prompt ก่อนค่ะ', 'warn'); return; }

    // Probe before run
    const test = await testConnection();
    if (!test.ok) { toast('เชื่อม ComfyUI ไม่ได้: ' + test.error, 'error'); return; }

    _psaiState.generating = true;
    _psaiState.progress = { value: 0, max: 0, node: null };
    setGenerateBtn(true);
    updateProgress({});

    try {
        openWS();

        // Stage 1: upload input
        toast('กำลังอัพโหลดรูป…', 'info');
        const ext = (_psaiState.inputBlob.type || '').split('/')[1] || 'png';
        const fname = 'psai-input-' + Date.now() + '.' + ext;
        const up = await uploadImage(_psaiState.inputBlob, fname);
        _psaiState.inputName = up.name;

        // Stage 2: build workflow + queue
        const loras = _psaiSettings.loras.filter((l) => l && l.name && l.strength > 0);
        const workflow = buildWorkflow({
            inputName: up.name,
            prompt:    prompt,
            seed:      _psaiSettings.seed,
            steps:     _psaiSettings.steps,
            cfg:       _psaiSettings.cfg,
            denoise:   _psaiSettings.denoise,
            guidance:  _psaiSettings.guidance,
            loras:     loras
        });
        toast('กำลัง queue งาน…', 'info');
        const resp = await queuePrompt(workflow);
        if (!resp || !resp.prompt_id) throw new Error('No prompt_id returned');
        if (resp.node_errors && Object.keys(resp.node_errors).length) {
            throw new Error('Workflow validation error — ' + JSON.stringify(resp.node_errors).slice(0, 300));
        }
        _psaiState.currentPromptId = resp.prompt_id;
        toast('Generating… (1-3 นาทีตาม mode)', 'info');
    } catch (err) {
        const e = /** @type {any} */ (err);
        onGenerationError((e && e.message) || String(e));
    }
}

async function onGenerationDone() {
    if (!_psaiState.currentPromptId) return;
    try {
        const hist = await fetchHistory(_psaiState.currentPromptId);
        const entry = hist[_psaiState.currentPromptId];
        if (!entry || !entry.outputs) throw new Error('No outputs in history');
        /** @type {{ filename: string, subfolder?: string, type?: string } | null} */
        let imgInfo = null;
        for (const nodeId in entry.outputs) {
            const out = entry.outputs[nodeId];
            if (out && out.images && out.images.length) {
                imgInfo = out.images[0];
                break;
            }
        }
        if (!imgInfo) throw new Error('No image in outputs');
        const blob = await fetchView(imgInfo.filename, imgInfo.subfolder, imgInfo.type);
        pushHistory(blob);
        toast('เสร็จแล้วค่ะ', 'success');
    } catch (err) {
        const e = /** @type {any} */ (err);
        onGenerationError((e && e.message) || String(e));
        return;
    } finally {
        _psaiState.generating = false;
        _psaiState.currentPromptId = null;
        setGenerateBtn(false);
    }
}

/** @param {string} message @param {any} [detail] */
function onGenerationError(message, detail) {
    _psaiState.generating = false;
    _psaiState.currentPromptId = null;
    setGenerateBtn(false);
    let msg = 'Error: ' + (message || 'unknown');
    if (detail && detail.exception_type) msg += ' [' + detail.exception_type + ']';
    toast(msg, 'error');
    if (typeof console !== 'undefined') console.warn('[PSAI]', message, detail || '');
}

/** @param {boolean} busy */
function setGenerateBtn(busy) {
    if (!_psaiPanel) return;
    const btn    = /** @type {HTMLButtonElement | null} */ (_psaiPanel.querySelector('#psai-generate-btn'));
    const cancel = /** @type {HTMLButtonElement | null} */ (_psaiPanel.querySelector('#psai-cancel-btn'));
    const wrap   = /** @type {HTMLElement | null} */    (_psaiPanel.querySelector('#psai-progress-wrap'));
    if (btn) {
        btn.disabled = !!busy;
        btn.textContent = busy ? 'Generating…' : 'Generate';
    }
    if (cancel) cancel.style.display = busy ? 'inline-flex' : 'none';
    if (wrap)   wrap.style.display   = busy ? 'block'        : 'none';
}

async function cancelGeneration() {
    if (!_psaiState.generating) return;
    await interrupt();
    toast('Cancelled', 'info');
    _psaiState.generating = false;
    _psaiState.currentPromptId = null;
    setGenerateBtn(false);
}

// ── History ────────────────────────────────────────────────────────────
/** @param {Blob} blob */
function pushHistory(blob) {
    const url = URL.createObjectURL(blob);
    const promptEl = _psaiPanel ? /** @type {HTMLTextAreaElement | null} */ (_psaiPanel.querySelector('#psai-prompt')) : null;
    const item = {
        ts:      Date.now(),
        prompt:  promptEl ? promptEl.value : '',
        mode:    _psaiSettings.mode,
        blob:    blob,
        blobUrl: url
    };
    _psaiState.history.unshift(item);
    // Cap at 20 in memory
    if (_psaiState.history.length > 20) {
        const old = _psaiState.history.pop();
        if (old && old.blobUrl) URL.revokeObjectURL(old.blobUrl);
    }
    renderResult();
    renderHistory();
    bus.emit('psai:result', { ts: item.ts, prompt: item.prompt, mode: item.mode });
}

/** @param {number} [idx] */
function downloadResult(idx) {
    const item = _psaiState.history[idx || 0];
    if (!item) return;
    const a = document.createElement('a');
    a.href = item.blobUrl;
    a.download = 'psai-' + new Date(item.ts).toISOString().replace(/[:.]/g, '-') + '.png';
    document.body.appendChild(a); a.click(); a.remove();
}

// ── Image input ────────────────────────────────────────────────────────
/** @param {File} f */
function acceptFile(f) {
    if (!f.type.match(/^image\//)) { toast('ต้องเป็นไฟล์รูปภาพ', 'warn'); return; }
    _psaiState.inputBlob = f;
    if (_psaiState.inputUrl) URL.revokeObjectURL(_psaiState.inputUrl);
    _psaiState.inputUrl = URL.createObjectURL(f);
    if (!_psaiPanel) return;
    const prev = /** @type {HTMLImageElement | null} */ (_psaiPanel.querySelector('#psai-drop-prev'));
    const emp  = /** @type {HTMLElement | null} */     (_psaiPanel.querySelector('#psai-drop-empty'));
    if (prev) { prev.src = _psaiState.inputUrl; prev.style.display = 'block'; }
    if (emp)  emp.style.display = 'none';
}

// ── LoRA stack UI ──────────────────────────────────────────────────────
function addLoraSlot() {
    _psaiSettings.loras.push({ name: '', strength: 1.0 });
    saveSettings();
    renderLoraStack();
}

/** @param {number} idx */
function removeLoraSlot(idx) {
    _psaiSettings.loras.splice(idx, 1);
    saveSettings();
    renderLoraStack();
}

function renderLoraStack() {
    if (!_psaiPanel) return;
    const holder = /** @type {HTMLElement | null} */ (_psaiPanel.querySelector('#psai-lora-list'));
    if (!holder) return;
    const loras = _psaiSettings.loras;
    if (!loras.length) {
        holder.innerHTML = '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);padding:6px 0;">ยังไม่มี LoRA — กด + Add เพื่อเพิ่ม</div>';
        return;
    }
    const avail = _psaiState.loraList || [];
    let html = '';
    loras.forEach((lo, i) => {
        let opts = '<option value="">— เลือก LoRA —</option>';
        avail.forEach((name) => {
            const sel = (name === lo.name) ? ' selected' : '';
            opts += '<option value="' + name.replace(/"/g, '&quot;') + '"' + sel + '>' + name + '</option>';
        });
        if (lo.name && avail.indexOf(lo.name) === -1) {
            opts += '<option value="' + lo.name.replace(/"/g, '&quot;') + '" selected>' + lo.name + ' (ไม่พบในเครื่อง)</option>';
        }
        html += '<div class="psai-lora-row">'
             +    '<select class="psai-select" data-lora-idx="' + i + '" data-lora-field="name">' + opts + '</select>'
             +    '<input type="range" min="0" max="2" step="0.05" value="' + lo.strength + '" data-lora-idx="' + i + '" data-lora-field="strength" style="width:90px;">'
             +    '<span class="psai-lora-strength" data-lora-strength-label="' + i + '">' + lo.strength.toFixed(2) + '</span>'
             +    '<button class="psai-btn" data-lora-remove="' + i + '" style="padding:4px 8px;font-size:10px;color:var(--danger);border-color:var(--border);">×</button>'
             +  '</div>';
    });
    holder.innerHTML = html;
    holder.querySelectorAll('[data-lora-field="name"]').forEach((el) => {
        const e = /** @type {HTMLSelectElement} */ (el);
        e.addEventListener('change', () => {
            const i = parseInt(e.dataset.loraIdx || '0', 10);
            _psaiSettings.loras[i].name = e.value;
            saveSettings();
        });
    });
    holder.querySelectorAll('[data-lora-field="strength"]').forEach((el) => {
        const e = /** @type {HTMLInputElement} */ (el);
        e.addEventListener('input', () => {
            const i = parseInt(e.dataset.loraIdx || '0', 10);
            const v = parseFloat(e.value);
            _psaiSettings.loras[i].strength = v;
            const lbl = /** @type {HTMLElement | null} */ (holder.querySelector('[data-lora-strength-label="' + i + '"]'));
            if (lbl) lbl.textContent = v.toFixed(2);
        });
        e.addEventListener('change', () => saveSettings());
    });
    holder.querySelectorAll('[data-lora-remove]').forEach((el) => {
        const e = /** @type {HTMLButtonElement} */ (el);
        e.addEventListener('click', () => removeLoraSlot(parseInt(e.dataset.loraRemove || '0', 10)));
    });
}

// ── Result + History render ────────────────────────────────────────────
function renderResult() {
    if (!_psaiPanel) return;
    const pane = /** @type {HTMLElement | null} */    (_psaiPanel.querySelector('#psai-result-pane'));
    const dl   = /** @type {HTMLButtonElement | null} */ (_psaiPanel.querySelector('#psai-download-btn'));
    const item = _psaiState.history[0];
    if (!pane) return;
    if (!item) {
        pane.innerHTML = '<div class="psai-result-empty">ผลลัพธ์จะแสดงที่นี่<br><span style="opacity:0.6;font-size:10px;">หลังกด Generate</span></div>';
        if (dl) dl.disabled = true;
        return;
    }
    pane.innerHTML = '<img src="' + item.blobUrl + '" alt="result">';
    if (dl) dl.disabled = false;
}

function renderHistory() {
    if (!_psaiPanel) return;
    const grid = /** @type {HTMLElement | null} */ (_psaiPanel.querySelector('#psai-history-grid'));
    if (!grid) return;
    let html = '';
    _psaiState.history.forEach((it, i) => {
        html += '<div class="psai-history-item" data-hist-idx="' + i + '" title="' +
                (it.prompt || '').replace(/"/g, '&quot;').slice(0, 80) +
                '"><img src="' + it.blobUrl + '" alt=""></div>';
    });
    grid.innerHTML = html;
    grid.querySelectorAll('[data-hist-idx]').forEach((el) => {
        const e = /** @type {HTMLElement} */ (el);
        e.addEventListener('click', () => {
            const i = parseInt(e.dataset.histIdx || '0', 10);
            const item = _psaiState.history[i];
            if (!item) return;
            const pane = _psaiPanel ? /** @type {HTMLElement | null} */ (_psaiPanel.querySelector('#psai-result-pane')) : null;
            if (pane) pane.innerHTML = '<img src="' + item.blobUrl + '" alt="result">';
        });
    });
}

// ── Mode UI ────────────────────────────────────────────────────────────
function updateModeUI() {
    if (!_psaiPanel) return;
    _psaiPanel.querySelectorAll('.psai-mode-card').forEach((c) => {
        const e = /** @type {HTMLElement} */ (c);
        e.classList.toggle('active', e.dataset.mode === _psaiSettings.mode);
    });
}

// ── Settings modal ─────────────────────────────────────────────────────
function openSettingsModal() {
    const existing = document.getElementById('psai-settings-modal');
    if (existing) existing.remove();
    const bd = document.createElement('div');
    bd.id = 'psai-settings-modal';
    bd.style.cssText = 'position:fixed;inset:0;z-index:9400;background:rgba(0,0,0,0.55);display:flex;align-items:center;justify-content:center;padding:20px;';
    bd.innerHTML = ''
      + '<div style="background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-md,8px);max-width:480px;width:100%;padding:18px 20px;box-shadow:0 12px 40px rgba(0,0,0,.45);">'
      +   '<div style="font-family:var(--font-main);font-size:15px;font-weight:800;color:var(--text-primary);margin-bottom:4px;">PS AI Studio · Settings</div>'
      +   '<div style="font-family:var(--font-mono);font-size:10px;color:var(--text-dim);margin-bottom:14px;">ComfyUI connection + model discovery</div>'
      +   '<label style="font-family:var(--font-mono);font-size:10.5px;color:var(--text-secondary);display:block;">ComfyUI URL'
      +     '<input type="text" id="psai-set-url" class="psai-input" style="margin-top:4px;font-family:var(--font-mono);font-size:11.5px;" value="' + _psaiSettings.url.replace(/"/g, '&quot;') + '">'
      +   '</label>'
      +   '<div style="font-family:var(--font-mono);font-size:9.5px;color:var(--text-dim);margin-top:5px;line-height:1.5;">default <code>http://127.0.0.1:8188</code> — ต้องเปิด CORS ใน ComfyUI Desktop Settings → Server Config → Enable CORS Header = <code>*</code></div>'
      +   '<div id="psai-set-status" style="margin-top:14px;padding:9px 12px;border-radius:var(--radius-sm,4px);background:var(--bg-card2);border:1px solid var(--border);font-family:var(--font-mono);font-size:10.5px;color:var(--text-secondary);min-height:16px;">—</div>'
      +   '<div style="display:flex;gap:8px;margin-top:14px;">'
      +     '<button class="psai-btn" id="psai-set-test" style="flex:1;justify-content:center;">Test connection</button>'
      +     '<button class="psai-btn" id="psai-set-loras" style="flex:1;justify-content:center;">Refresh LoRAs</button>'
      +   '</div>'
      +   '<div style="display:flex;gap:8px;margin-top:14px;">'
      +     '<button class="psai-btn" id="psai-set-cancel" style="flex:1;justify-content:center;">Cancel</button>'
      +     '<button class="psai-btn psai-btn-primary" id="psai-set-save" style="flex:1;justify-content:center;">Save</button>'
      +   '</div>'
      + '</div>';
    document.body.appendChild(bd);

    const urlIn  = /** @type {HTMLInputElement} */ (bd.querySelector('#psai-set-url'));
    const status = /** @type {HTMLElement} */ (bd.querySelector('#psai-set-status'));
    /** @param {string} msg @param {string} [color] */
    function setStatus(msg, color) { status.textContent = msg; status.style.color = color || 'var(--text-secondary)'; }

    /** @type {HTMLButtonElement} */ (bd.querySelector('#psai-set-test')).addEventListener('click', async () => {
        _psaiSettings.url = urlIn.value.trim() || _PSAI_DEFAULT_URL;
        setStatus('Testing…');
        const r = await testConnection();
        if (r.ok) {
            const vram = _psaiState.vramTotal
                ? ' · VRAM ' + ((_psaiState.vramFree || 0)/1e9).toFixed(1) + '/' + (_psaiState.vramTotal/1e9).toFixed(1) + 'GB'
                : '';
            setStatus('OK · ' + (_psaiState.comfyVersion || 'connected') + vram, 'var(--accent)');
        } else {
            setStatus('Failed — ' + r.error, 'var(--danger)');
        }
    });
    /** @type {HTMLButtonElement} */ (bd.querySelector('#psai-set-loras')).addEventListener('click', async () => {
        _psaiSettings.url = urlIn.value.trim() || _PSAI_DEFAULT_URL;
        setStatus('Fetching /object_info…');
        try {
            const list = await fetchLoras();
            setStatus('Found ' + list.length + ' LoRA file(s) in models/loras/', 'var(--accent)');
            renderLoraStack();
        } catch (err) {
            const e = /** @type {any} */ (err);
            setStatus('Failed — ' + ((e && e.message) || e), 'var(--danger)');
        }
    });
    /** @type {HTMLButtonElement} */ (bd.querySelector('#psai-set-cancel')).addEventListener('click', () => bd.remove());
    /** @type {HTMLButtonElement} */ (bd.querySelector('#psai-set-save')).addEventListener('click', () => {
        _psaiSettings.url = urlIn.value.trim() || _PSAI_DEFAULT_URL;
        saveSettings();
        bd.remove();
        testConnection();
    });
    bd.addEventListener('click', (e) => { if (e.target === bd) bd.remove(); });
}

// ── UI panel render (full Flux Kontext UI from monolith) ───────────────
/** @param {HTMLElement} rootEl */
function renderPanel(rootEl) {
    rootEl.innerHTML = ''
      + '<style>'
      +   '.psai-root{height:100%;display:flex;flex-direction:column;box-sizing:border-box;background:var(--bg-main);}'
      +   '.psai-header{flex-shrink:0;padding:12px 20px;border-bottom:1px solid var(--border);background:var(--bg-card);display:flex;align-items:center;gap:14px;}'
      +   '.psai-title{font-family:var(--font-main);font-size:15px;font-weight:800;color:var(--text-primary);line-height:1.2;letter-spacing:-0.01em;}'
      +   '.psai-subtitle{font-family:var(--font-mono);font-size:10px;color:var(--text-dim);margin-top:2px;}'
      +   '.psai-conn{display:flex;align-items:center;gap:8px;padding:5px 11px;border-radius:999px;background:var(--bg-card2);border:1px solid var(--border);font-family:var(--font-mono);font-size:10px;color:var(--text-secondary);}'
      +   '.psai-conn-dot{width:7px;height:7px;border-radius:50%;background:var(--text-dim);transition:background .2s;}'
      +   '.psai-body{flex:1;min-height:0;display:flex;}'
      +   '.psai-form-col{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0;overflow-y:auto;border-right:1px solid var(--border);}'
      +   '.psai-result-col{width:42%;min-width:380px;display:flex;flex-direction:column;min-height:0;background:var(--bg-card);}'
      +   '.psai-section{padding:14px 20px;border-bottom:1px solid var(--border);}'
      +   '.psai-section-title{font-family:var(--font-mono);font-size:9.5px;font-weight:800;color:var(--text-dim);letter-spacing:.12em;margin-bottom:10px;}'
      +   '.psai-row{display:flex;gap:8px;align-items:center;}'
      +   '.psai-input,.psai-textarea,.psai-select{font-family:var(--font-main);font-size:13px;color:var(--text-primary);background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-sm,4px);padding:7px 10px;outline:none;transition:border-color .15s;width:100%;box-sizing:border-box;}'
      +   '.psai-input:focus,.psai-textarea:focus,.psai-select:focus{border-color:var(--accent);}'
      +   '.psai-textarea{font-family:var(--font-main);min-height:80px;resize:vertical;line-height:1.45;}'
      +   '.psai-btn{display:inline-flex;align-items:center;gap:6px;font-family:var(--font-mono);font-size:11px;font-weight:700;padding:7px 13px;border:1px solid var(--border);border-radius:var(--radius-sm,4px);background:var(--bg-card);color:var(--text-primary);cursor:pointer;transition:all .15s;}'
      +   '.psai-btn:hover{border-color:var(--accent);color:var(--accent);}'
      +   '.psai-btn-primary{background:var(--accent);color:#fff;border-color:var(--accent);}'
      +   '.psai-btn-primary:hover{filter:brightness(1.1);color:#fff;}'
      +   '.psai-btn-primary:disabled{opacity:.5;cursor:not-allowed;}'
      +   '.psai-btn-danger{color:var(--danger);border-color:var(--danger);}'
      +   '.psai-mode-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;}'
      +   '.psai-mode-card{padding:10px 12px;border:1px solid var(--border);border-radius:var(--radius-sm,4px);background:var(--bg-card);cursor:pointer;transition:all .15s;}'
      +   '.psai-mode-card:hover{border-color:var(--accent);}'
      +   '.psai-mode-card.active{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 8%,var(--bg-card));}'
      +   '.psai-mode-name{font-family:var(--font-mono);font-size:11px;font-weight:800;color:var(--text-primary);margin-bottom:3px;text-transform:uppercase;letter-spacing:.08em;}'
      +   '.psai-mode-desc{font-family:var(--font-main);font-size:10.5px;color:var(--text-dim);line-height:1.4;}'
      +   '.psai-drop{border:2px dashed var(--border);border-radius:var(--radius-md,8px);padding:20px;text-align:center;cursor:pointer;transition:all .15s;}'
      +   '.psai-drop:hover,.psai-drop.dragover{border-color:var(--accent);background:color-mix(in srgb,var(--accent) 5%,var(--bg-card));}'
      +   '.psai-drop-prev{max-width:100%;max-height:280px;border-radius:var(--radius-sm,4px);}'
      +   '.psai-lora-row{display:grid;grid-template-columns:1fr auto 110px auto;gap:6px;align-items:center;padding:5px 0;}'
      +   '.psai-lora-name{font-family:var(--font-mono);font-size:10.5px;color:var(--text-secondary);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}'
      +   '.psai-lora-strength{font-family:var(--font-mono);font-size:10px;color:var(--text-secondary);min-width:34px;text-align:right;font-variant-numeric:tabular-nums;}'
      +   '.psai-toast{position:absolute;bottom:14px;left:50%;transform:translate(-50%,140%);padding:9px 16px;background:var(--bg-card);border:1px solid var(--border);border-radius:var(--radius-pill,999px);font-family:var(--font-mono);font-size:11px;color:var(--text-primary);box-shadow:0 6px 20px rgba(0,0,0,0.35);transition:transform .25s ease;pointer-events:none;z-index:50;max-width:80%;text-align:center;}'
      +   '.psai-toast-show{transform:translate(-50%,0);}'
      +   '.psai-toast[data-type="error"]{border-color:var(--danger);color:var(--danger);}'
      +   '.psai-toast[data-type="success"]{border-color:var(--accent);color:var(--accent);}'
      +   '.psai-toast[data-type="warn"]{border-color:#f59e0b;color:#f59e0b;}'
      +   '.psai-progress-wrap{padding:8px 14px;background:var(--bg-card2);border:1px solid var(--border);border-radius:var(--radius-sm,4px);margin-top:10px;}'
      +   '.psai-progress-track{height:5px;background:var(--bg-main);border-radius:3px;overflow:hidden;margin-top:5px;}'
      +   '.psai-progress-bar{height:100%;background:var(--accent);width:0%;transition:width .2s;}'
      +   '.psai-progress-text{font-family:var(--font-mono);font-size:10px;color:var(--text-secondary);font-variant-numeric:tabular-nums;}'
      +   '.psai-history-grid{display:grid;grid-template-columns:repeat(3,1fr);gap:6px;padding:10px 14px;}'
      +   '.psai-history-item{aspect-ratio:1;background:var(--bg-card2);border:1px solid var(--border);border-radius:var(--radius-sm,4px);overflow:hidden;cursor:pointer;}'
      +   '.psai-history-item img{width:100%;height:100%;object-fit:cover;}'
      +   '.psai-result-pane{flex:1;min-height:0;display:flex;align-items:center;justify-content:center;padding:18px;background:var(--bg-card2);overflow:hidden;}'
      +   '.psai-result-pane img{max-width:100%;max-height:100%;object-fit:contain;border-radius:var(--radius-sm,4px);box-shadow:0 4px 18px rgba(0,0,0,0.18);}'
      +   '.psai-result-empty{font-family:var(--font-mono);font-size:11px;color:var(--text-dim);text-align:center;}'
      +   '.psai-result-actions{padding:10px 14px;border-bottom:1px solid var(--border);display:flex;justify-content:space-between;align-items:center;gap:8px;}'
      + '</style>'
      + '<div class="psai-root">'
      +   '<div class="psai-header">'
      +     '<div style="flex:1;min-width:0;">'
      +       '<div class="psai-title">PS AI Studio</div>'
      +       '<div class="psai-subtitle">Prompt-driven AI photo edit · ComfyUI + Flux Kontext · privacy 100%</div>'
      +     '</div>'
      +     '<div class="psai-conn" id="psai-conn-badge">'
      +       '<span class="psai-conn-dot" id="psai-conn-dot"></span>'
      +       '<span id="psai-conn-label">Checking…</span>'
      +     '</div>'
      +     '<button class="psai-btn" id="psai-settings-btn" title="ตั้งค่า ComfyUI">'
      +       '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>'
      +       'Settings'
      +     '</button>'
      +   '</div>'
      +   '<div class="psai-body">'
      +     '<div class="psai-form-col">'
      +       '<div class="psai-section">'
      +         '<div class="psai-section-title">INPUT IMAGE</div>'
      +         '<div class="psai-drop" id="psai-drop">'
      +           '<input type="file" id="psai-file" accept="image/*" style="display:none;">'
      +           '<div id="psai-drop-empty">'
      +             '<div style="font-family:var(--font-main);font-size:12.5px;color:var(--text-secondary);margin-bottom:4px;">ลากรูปมาวาง หรือคลิกเพื่อเลือก</div>'
      +             '<div style="font-family:var(--font-mono);font-size:9.5px;color:var(--text-dim);">JPG · PNG · WebP — รูปจะอยู่บนเครื่องเท่านั้น</div>'
      +           '</div>'
      +           '<img id="psai-drop-prev" class="psai-drop-prev" style="display:none;">'
      +         '</div>'
      +       '</div>'
      +       '<div class="psai-section">'
      +         '<div class="psai-section-title">EDIT MODE</div>'
      +         '<div class="psai-mode-grid">'
      +           '<div class="psai-mode-card" data-mode="quick">'
      +             '<div class="psai-mode-name">Quick</div>'
      +             '<div class="psai-mode-desc">Prompt อย่างเดียว · เร็ว ~1 นาที</div>'
      +           '</div>'
      +           '<div class="psai-mode-card" data-mode="smart">'
      +             '<div class="psai-mode-name">Smart</div>'
      +             '<div class="psai-mode-desc">Auto-protect jewelry · ~2 นาที</div>'
      +           '</div>'
      +           '<div class="psai-mode-card" data-mode="lock" title="Phase 2 — soon">'
      +             '<div class="psai-mode-name">Lock pendant</div>'
      +             '<div class="psai-mode-desc">Phase 2 · พระเครื่อง pixel-perfect</div>'
      +           '</div>'
      +         '</div>'
      +       '</div>'
      +       '<div class="psai-section">'
      +         '<div class="psai-section-title">PROMPT</div>'
      +         '<textarea class="psai-textarea" id="psai-prompt" placeholder="เช่น: make her hair longer, while preserving the necklace and clothing details. high quality, detailed,"></textarea>'
      +       '</div>'
      +       '<div class="psai-section">'
      +         '<div class="psai-section-title" style="display:flex;justify-content:space-between;align-items:center;">'
      +           '<span>LORA STACK</span>'
      +           '<button class="psai-btn" id="psai-lora-add-btn" style="padding:3px 9px;font-size:10px;">+ Add</button>'
      +         '</div>'
      +         '<div id="psai-lora-list"></div>'
      +       '</div>'
      +       '<div class="psai-section">'
      +         '<div class="psai-section-title">ADVANCED</div>'
      +         '<div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;">'
      +           '<label style="font-family:var(--font-mono);font-size:10px;color:var(--text-secondary);">Steps <input type="number" id="psai-steps" min="1" max="50" class="psai-input" style="margin-top:3px;"></label>'
      +           '<label style="font-family:var(--font-mono);font-size:10px;color:var(--text-secondary);">Guidance <input type="number" id="psai-guidance" min="0" max="10" step="0.1" class="psai-input" style="margin-top:3px;"></label>'
      +           '<label style="font-family:var(--font-mono);font-size:10px;color:var(--text-secondary);">CFG <input type="number" id="psai-cfg" min="0" max="10" step="0.1" class="psai-input" style="margin-top:3px;"></label>'
      +           '<label style="font-family:var(--font-mono);font-size:10px;color:var(--text-secondary);">Denoise <input type="number" id="psai-denoise" min="0" max="1" step="0.05" class="psai-input" style="margin-top:3px;"></label>'
      +           '<label style="font-family:var(--font-mono);font-size:10px;color:var(--text-secondary);grid-column:span 2;">Seed (-1 = random) <input type="number" id="psai-seed" class="psai-input" style="margin-top:3px;"></label>'
      +         '</div>'
      +       '</div>'
      +       '<div class="psai-section" style="border-bottom:none;">'
      +         '<div class="psai-row" style="gap:10px;">'
      +           '<button class="psai-btn psai-btn-primary" id="psai-generate-btn" style="flex:1;justify-content:center;padding:11px;font-size:12px;">Generate</button>'
      +           '<button class="psai-btn psai-btn-danger" id="psai-cancel-btn" style="display:none;padding:11px 14px;">Cancel</button>'
      +         '</div>'
      +         '<div class="psai-progress-wrap" id="psai-progress-wrap" style="display:none;">'
      +           '<div class="psai-progress-text" id="psai-progress-text">Working…</div>'
      +           '<div class="psai-progress-track"><div class="psai-progress-bar" id="psai-progress-bar"></div></div>'
      +         '</div>'
      +       '</div>'
      +     '</div>'
      +     '<div class="psai-result-col">'
      +       '<div class="psai-result-actions">'
      +         '<div class="psai-section-title" style="margin:0;">RESULT</div>'
      +         '<div>'
      +           '<button class="psai-btn" id="psai-download-btn" disabled style="padding:5px 10px;font-size:10px;">Download</button>'
      +         '</div>'
      +       '</div>'
      +       '<div class="psai-result-pane" id="psai-result-pane">'
      +         '<div class="psai-result-empty">ผลลัพธ์จะแสดงที่นี่<br><span style="opacity:0.6;font-size:10px;">หลังกด Generate</span></div>'
      +       '</div>'
      +       '<div style="border-top:1px solid var(--border);">'
      +         '<div class="psai-section-title" style="padding:10px 14px 0;">HISTORY (in-memory · ไม่บันทึก)</div>'
      +         '<div class="psai-history-grid" id="psai-history-grid"></div>'
      +       '</div>'
      +     '</div>'
      +   '</div>'
      +   '<div class="psai-toast" id="psai-toast"></div>'
      + '</div>';
}

function hydrateForm() {
    if (!_psaiPanel) return;
    /** @type {Array<'steps' | 'guidance' | 'cfg' | 'denoise' | 'seed'>} */
    const keys = ['steps', 'guidance', 'cfg', 'denoise', 'seed'];
    keys.forEach((k) => {
        const el = /** @type {HTMLInputElement | null} */ (_psaiPanel && _psaiPanel.querySelector('#psai-' + k));
        if (el) el.value = String(_psaiSettings[k]);
    });
    updateModeUI();
}

// ── Wire DOM events ────────────────────────────────────────────────────
function wireEvents() {
    if (!_psaiPanel) return;
    const p = _psaiPanel;
    /** @param {string} sel */
    const $ = (sel) => /** @type {any} */ (p.querySelector(sel));

    // File drop
    const drop = $('#psai-drop');
    const fin  = $('#psai-file');
    if (drop && fin) {
        drop.addEventListener('click', () => fin.click());
        drop.addEventListener('dragover',  /** @param {DragEvent} e */ (e) => { e.preventDefault(); drop.classList.add('dragover'); });
        drop.addEventListener('dragleave', () => drop.classList.remove('dragover'));
        drop.addEventListener('drop', /** @param {DragEvent} e */ (e) => {
            e.preventDefault(); drop.classList.remove('dragover');
            const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
            if (f) acceptFile(f);
        });
        fin.addEventListener('change', () => {
            const f = fin.files && fin.files[0];
            if (f) acceptFile(f);
        });
    }

    // Mode cards
    p.querySelectorAll('.psai-mode-card').forEach((card) => {
        const c = /** @type {HTMLElement} */ (card);
        c.addEventListener('click', () => {
            const m = c.dataset.mode || 'smart';
            if (m === 'lock') {
                toast('Lock pendant — Phase 2 ยังไม่พร้อม ใช้ Smart แทน', 'warn');
                return;
            }
            _psaiSettings.mode = m;
            saveSettings();
            updateModeUI();
        });
    });

    // Advanced inputs
    /** @type {Array<'steps' | 'guidance' | 'cfg' | 'denoise' | 'seed'>} */
    const advKeys = ['steps', 'guidance', 'cfg', 'denoise', 'seed'];
    advKeys.forEach((k) => {
        const el = /** @type {HTMLInputElement | null} */ ($('#psai-' + k));
        if (!el) return;
        el.addEventListener('change', () => {
            const v = parseFloat(el.value);
            if (!isNaN(v)) _psaiSettings[k] = v;
            saveSettings();
        });
    });

    // Generate / Cancel / Download
    const genBtn = $('#psai-generate-btn');
    const cnlBtn = $('#psai-cancel-btn');
    const dlBtn  = $('#psai-download-btn');
    if (genBtn) genBtn.addEventListener('click', generate);
    if (cnlBtn) cnlBtn.addEventListener('click', cancelGeneration);
    if (dlBtn)  dlBtn.addEventListener('click', () => downloadResult(0));

    // LoRA add
    const loraAdd = $('#psai-lora-add-btn');
    if (loraAdd) loraAdd.addEventListener('click', addLoraSlot);

    // Settings
    const settingsBtn = $('#psai-settings-btn');
    if (settingsBtn) settingsBtn.addEventListener('click', openSettingsModal);
}

// ── Module lifecycle ───────────────────────────────────────────────────
/**
 * Module entry — Architecture conv. Hard Rule §1.
 * Renders full Flux Kontext panel + wires events. Probes connection on init.
 * @param {HTMLElement} rootEl
 * @param {{ bus?: any, lsSave?: any, lsGet?: any }} [_ctx]
 */
export function init(rootEl, _ctx) {
    loadSettings();
    if (!_psaiState.clientId) _psaiState.clientId = uuid();
    _psaiPanel = rootEl;
    renderPanel(rootEl);
    wireEvents();
    hydrateForm();
    renderLoraStack();
    renderHistory();
    renderResult();
    updateConnBadge();

    // Probe connection + fetch LoRAs in background
    testConnection().then((res) => {
        if (res.ok) {
            fetchLoras().then(() => renderLoraStack()).catch(() => {});
        }
    });
    bus.emit('psai:init', { rootEl, env: canConnect() });

    return {
        id:       'psai',
        version:  '0.3-session3k-heavy-port',
        ready:    true,
        settings: { ..._psaiSettings },
        env:      canConnect(),
    };
}

/** Module teardown — closes WebSocket, revokes object URLs, clears panel ref. */
export function destroy() {
    if (_psaiState.ws) {
        try { _psaiState.ws.close(); } catch (_e) {}
        _psaiState.ws = null;
        _psaiState.wsReady = false;
    }
    if (_psaiState.inputUrl) {
        try { URL.revokeObjectURL(_psaiState.inputUrl); } catch (_e) {}
        _psaiState.inputUrl = null;
    }
    _psaiState.history.forEach((h) => {
        if (h.blobUrl) { try { URL.revokeObjectURL(h.blobUrl); } catch (_e) {} }
    });
    _psaiState.history = [];
    _psaiPanel = null;
    bus.emit('psai:destroy');
}

// ── Named exports for cross-module / legacy interop ────────────────────
export {
    _psaiSettings,
    _psaiState,
    saveSettings as _psaiSaveSettings,
    loadSettings as _psaiLoadSettings,
    loadPresets  as _psaiLoadPresets,
    savePresets  as _psaiSavePresets,
    uuid         as _psaiUuid,
    randSeed     as _psaiRandSeed,
    canConnect   as _psaiCanConnect,
    fetchWithTimeout as _psaiFetchWithTimeout,
    toast        as _psaiToast,
    updateConnBadge   as _psaiUpdateConnBadge,
    testConnection    as _psaiTestConnection,
    fetchLoras   as _psaiFetchLoras,
    uploadImage  as _psaiUploadImage,
    queuePrompt  as _psaiQueuePrompt,
    fetchView    as _psaiFetchView,
    fetchHistory as _psaiFetchHistory,
    interrupt    as _psaiInterrupt,
    openWS       as _psaiOpenWS,
    onWsMessage  as _psaiOnWsMessage,
    updateProgress as _psaiUpdateProgress,
    buildQuickWorkflow as _psaiBuildQuickWorkflow,
    buildSmartWorkflow as _psaiBuildSmartWorkflow,
    buildWorkflow      as _psaiBuildWorkflow,
    generate     as _psaiGenerate,
    onGenerationDone   as _psaiOnGenerationDone,
    onGenerationError  as _psaiOnGenerationError,
    setGenerateBtn     as _psaiSetGenerateBtn,
    cancelGeneration   as _psaiCancelGeneration,
    pushHistory  as _psaiPushHistory,
    downloadResult     as _psaiDownloadResult,
    renderResult as _psaiRenderResult,
    renderHistory      as _psaiRenderHistory,
    acceptFile   as _psaiAcceptFile,
    addLoraSlot  as _psaiAddLoraSlot,
    removeLoraSlot     as _psaiRemoveLoraSlot,
    renderLoraStack    as _psaiRenderLoraStack,
    updateModeUI as _psaiUpdateModeUI,
    openSettingsModal  as _psaiOpenSettingsModal,
    renderPanel  as _psaiRenderPanel,
    _PSAI_FETCH_TIMEOUT,
    _PSAI_UPLOAD_TIMEOUT,
    _PSAI_PROMPT_TIMEOUT,
};
