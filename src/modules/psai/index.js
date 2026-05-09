// PS AI Studio — lazy module (Session 3d full UI port — settings + status + test, 2026-05-09)
//
// Status: PARTIAL PORT (settings + connection probe + status badge + test
// flow + toast). Full image input, prompt UI, workflow builder, run loop,
// WebSocket progress, and history panel still in monolith index.html.
//
// Ported in 3d:
//   - Module-scoped _psaiPanel ref (was global) — encapsulation
//   - toast() — UI feedback router
//   - updateStatusBadge() — connection status indicator
//   - testConnection() — async ComfyUI /system_stats probe with full env guard
//   - fetchLoras / uploadImage / queuePrompt / fetchView / fetchHistory / interrupt — HTTP API
//   - renderPanel(rootEl) — full settings panel with URL input + Test button + status + toast
//   - wireEvents() — click handlers + URL change → re-test + persist
//
// CRITICAL invariants from project_ps_ai_studio memory (DO NOT regress):
//   1. CFG = 1.0 ALWAYS (Flux is guidance-distilled)
//   2. LoRA balance: morph ≥ 2× preserve strength
//   3. Prompt structure: short preserve list (1-2 items max)
//   4. 3D limitation: reflections don't update consistently

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
    /** @type {Array<any>} */
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
/** @param {string} msg @param {'info' | 'error' | 'success'} [type] */
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

// ── Status badge (connection state UI) ─────────────────────────────────
function updateStatusBadge() {
    if (!_psaiPanel) return;
    const dot   = /** @type {HTMLElement | null} */ (_psaiPanel.querySelector('#psai-conn-dot'));
    const label = /** @type {HTMLElement | null} */ (_psaiPanel.querySelector('#psai-conn-label'));
    if (!dot || !label) return;
    if (_psaiState.connected) {
        dot.style.background = 'var(--accent, #089981)';
        const vramStr = _psaiState.vramFree != null && _psaiState.vramTotal != null
            ? ' · VRAM ' + (_psaiState.vramFree/1e9).toFixed(1) + '/' + (_psaiState.vramTotal/1e9).toFixed(1) + 'GB free'
            : '';
        label.textContent = 'Connected · ' + (_psaiState.comfyVersion || 'ComfyUI') + vramStr;
        return;
    }
    if (_psaiState.envBlocked === 'mixed-content') {
        dot.style.background = '#f59e0b';
        label.textContent = 'PSLink อยู่บน HTTPS — เข้า ComfyUI (HTTP localhost) ไม่ได้ · ใช้ npm run dev';
        return;
    }
    if (_psaiState.envBlocked === 'timeout') {
        dot.style.background = '#f59e0b';
        label.textContent = 'ComfyUI ไม่ตอบ (timeout) · ตรวจว่าเปิด ComfyUI Desktop';
        return;
    }
    dot.style.background = 'var(--text-dim, #888)';
    label.textContent = 'Not connected · เปิด ComfyUI Desktop ก่อนใช้งาน';
}

// ── ComfyUI HTTP API ───────────────────────────────────────────────────
async function testConnection() {
    const conn = canConnect();
    if (!conn.ok) {
        _psaiState.connected = false;
        _psaiState.envBlocked = /** @type {any} */ (conn.reason);
        updateStatusBadge();
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
        updateStatusBadge();
        return { ok: true, data };
    } catch (err) {
        const e = /** @type {any} */ (err);
        _psaiState.connected = false;
        const isAbort = e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''));
        _psaiState.envBlocked = isAbort ? 'timeout' : 'unreachable';
        updateStatusBadge();
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

// ── UI panel render ────────────────────────────────────────────────────
/**
 * Render the PSAI settings + connection panel into `rootEl`.
 * Replaces rootEl's contents with PSAI markup; safe to re-call.
 * @param {HTMLElement} rootEl
 */
function renderPanel(rootEl) {
    rootEl.innerHTML = `
        <div class="psai-panel" style="font-family:var(--sans, system-ui, sans-serif);color:var(--fg, #f5f5f7);">
            <style>
                .psai-panel input[type="text"], .psai-panel input[type="number"], .psai-panel select {
                    background: var(--bg, #0d0d0d); color: var(--fg, #f5f5f7);
                    border: 1px solid var(--border, #2a2a2a); border-radius: 8px;
                    padding: 8px 10px; font-size: 13px; outline: none; width: 100%;
                    font-family: inherit;
                }
                .psai-panel input:focus, .psai-panel select:focus {
                    border-color: var(--accent, #089981);
                }
                .psai-panel label {
                    display: block; font-size: 11px; color: var(--dim, #888);
                    text-transform: uppercase; letter-spacing: .08em; margin-bottom: 4px;
                }
                .psai-panel .row { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 12px; }
                .psai-panel .full { grid-column: 1 / -1; }
                .psai-panel .conn-status { display: flex; align-items: center; gap: 8px; padding: 10px 14px; background: var(--card, #1a1a1a); border: 1px solid var(--border, #2a2a2a); border-radius: 8px; margin-bottom: 16px; }
                .psai-panel #psai-conn-dot { width: 10px; height: 10px; border-radius: 50%; background: var(--dim, #888); flex-shrink: 0; transition: background .15s; }
                .psai-panel #psai-conn-label { font-size: 12px; color: var(--dim, #888); }
                .psai-panel button {
                    background: var(--accent, #089981); color: #000; border: 0;
                    padding: 10px 18px; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer;
                    font-family: inherit; transition: opacity .15s;
                }
                .psai-panel button:hover { opacity: .85; }
                .psai-panel button[disabled] { opacity: .5; cursor: not-allowed; }
                .psai-panel .invariants { background: rgba(8, 153, 129, 0.08); border-left: 3px solid var(--accent, #089981); padding: 10px 14px; font-size: 12px; color: var(--dim, #888); margin-top: 16px; border-radius: 4px; }
                .psai-panel .invariants strong { color: var(--accent, #089981); }
                .psai-panel #psai-toast { position: fixed; bottom: 24px; left: 50%; transform: translateX(-50%) translateY(20px); background: var(--card, #1a1a1a); color: var(--fg, #f5f5f7); padding: 12px 20px; border-radius: 8px; font-size: 13px; opacity: 0; pointer-events: none; transition: opacity .2s, transform .2s; z-index: 100; border: 1px solid var(--border, #2a2a2a); }
                .psai-panel #psai-toast.psai-toast-show { opacity: 1; transform: translateX(-50%) translateY(0); }
                .psai-panel #psai-toast[data-type="error"] { border-color: #f43f5e; color: #f43f5e; }
            </style>

            <div class="conn-status">
                <div id="psai-conn-dot"></div>
                <div id="psai-conn-label">Not connected · เปิด ComfyUI Desktop ก่อนใช้งาน</div>
            </div>

            <div class="row">
                <div class="full">
                    <label for="psai-url">ComfyUI URL</label>
                    <input id="psai-url" type="text" value="${escapeHtml(_psaiSettings.url)}" placeholder="http://127.0.0.1:8188" />
                </div>
            </div>

            <div class="row">
                <div>
                    <label for="psai-mode">Mode</label>
                    <select id="psai-mode">
                        <option value="quick" ${_psaiSettings.mode === 'quick' ? 'selected' : ''}>Quick</option>
                        <option value="smart" ${_psaiSettings.mode === 'smart' ? 'selected' : ''}>Smart</option>
                        <option value="lock"  ${_psaiSettings.mode === 'lock'  ? 'selected' : ''}>Lock (Phase 2)</option>
                    </select>
                </div>
                <div>
                    <label for="psai-steps">Steps</label>
                    <input id="psai-steps" type="number" min="1" max="100" value="${_psaiSettings.steps}" />
                </div>
                <div>
                    <label for="psai-cfg">CFG (Flux = 1.0 always)</label>
                    <input id="psai-cfg" type="number" min="1" max="1" step="0.1" value="${_psaiSettings.cfg}" disabled />
                </div>
                <div>
                    <label for="psai-guidance">FluxGuidance (2.0–3.0 recommended)</label>
                    <input id="psai-guidance" type="number" min="0.1" max="10" step="0.1" value="${_psaiSettings.guidance}" />
                </div>
                <div>
                    <label for="psai-denoise">Denoise</label>
                    <input id="psai-denoise" type="number" min="0" max="1" step="0.05" value="${_psaiSettings.denoise}" />
                </div>
                <div>
                    <label for="psai-seed">Seed (-1 = random)</label>
                    <input id="psai-seed" type="number" value="${_psaiSettings.seed}" />
                </div>
            </div>

            <div class="row">
                <div class="full" style="display:flex;gap:8px;">
                    <button id="psai-test-btn">Test Connection</button>
                    <button id="psai-save-btn" style="background:var(--card, #1a1a1a);color:var(--fg, #f5f5f7);border:1px solid var(--border, #2a2a2a);">Save Settings</button>
                </div>
            </div>

            <div class="invariants">
                <strong>Flux Kontext invariants</strong> — CFG locked at 1.0 (guidance-distilled). LoRA balance: morph ≥ 2× preserve. Short preserve list (1-2 items). 3D reflections don't update consistently.
            </div>

            <div id="psai-toast" data-type="info"></div>
        </div>
    `;
}

/** @param {string} s */
function escapeHtml(s) {
    return String(s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

/** Wire DOM events on the rendered panel. */
function wireEvents() {
    if (!_psaiPanel) return;
    const $ = /** @param {string} sel */ (sel) => /** @type {any} */ (_psaiPanel && _psaiPanel.querySelector(sel));

    const urlInput      = $('#psai-url');
    const modeSelect    = $('#psai-mode');
    const stepsInput    = $('#psai-steps');
    const guidanceInput = $('#psai-guidance');
    const denoiseInput  = $('#psai-denoise');
    const seedInput     = $('#psai-seed');
    const testBtn       = $('#psai-test-btn');
    const saveBtn       = $('#psai-save-btn');

    if (urlInput)      urlInput.addEventListener('input',   () => { _psaiSettings.url      = urlInput.value.trim(); });
    if (modeSelect)    modeSelect.addEventListener('change', () => { _psaiSettings.mode     = modeSelect.value; });
    if (stepsInput)    stepsInput.addEventListener('input',  () => { _psaiSettings.steps    = parseInt(stepsInput.value, 10) || 24; });
    if (guidanceInput) guidanceInput.addEventListener('input', () => { _psaiSettings.guidance = parseFloat(guidanceInput.value) || 2.5; });
    if (denoiseInput)  denoiseInput.addEventListener('input', () => { _psaiSettings.denoise  = parseFloat(denoiseInput.value)  || 1.0; });
    if (seedInput)     seedInput.addEventListener('input',    () => { _psaiSettings.seed     = parseInt(seedInput.value, 10); });

    if (testBtn) {
        testBtn.addEventListener('click', async () => {
            testBtn.setAttribute('disabled', 'true');
            testBtn.textContent = 'Testing...';
            const res = await testConnection();
            testBtn.removeAttribute('disabled');
            testBtn.textContent = 'Test Connection';
            toast(res.ok ? 'เชื่อมต่อสำเร็จ' : ('ผิดพลาด: ' + res.error), res.ok ? 'success' : 'error');
        });
    }
    if (saveBtn) {
        saveBtn.addEventListener('click', () => {
            saveSettings();
            toast('บันทึก settings แล้ว', 'success');
            bus.emit('psai:settings-saved', { settings: { ..._psaiSettings } });
        });
    }
}

// ── Module lifecycle ───────────────────────────────────────────────────
/**
 * Module entry — Architecture conv. Hard Rule §1.
 * Renders settings panel + wires events. Auto-tests connection on first init.
 * @param {HTMLElement} rootEl
 * @param {{ bus?: any, lsSave?: any, lsGet?: any }} [_ctx]
 */
export function init(rootEl, _ctx) {
    loadSettings();
    _psaiPanel = rootEl;
    renderPanel(rootEl);
    wireEvents();
    updateStatusBadge();
    // Fire test on init so badge reflects true state immediately
    testConnection().then((res) => {
        if (res.ok) toast('Connected to ComfyUI', 'success');
    });
    bus.emit('psai:init', { rootEl, env: canConnect() });
    return {
        id:       'psai',
        version:  '0.2-session3d-ui-port',
        ready:    true,
        settings: { ..._psaiSettings },
        env:      canConnect(),
    };
}

/**
 * Module teardown — closes WebSocket + revokes object URLs + clears panel ref.
 */
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
    _psaiPanel = null;
    bus.emit('psai:destroy');
}

// Named exports for cross-module use during cutover (legacy interop).
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
    updateStatusBadge as _psaiUpdateStatusBadge,
    testConnection    as _psaiTestConnection,
    fetchLoras   as _psaiFetchLoras,
    uploadImage  as _psaiUploadImage,
    queuePrompt  as _psaiQueuePrompt,
    fetchView    as _psaiFetchView,
    fetchHistory as _psaiFetchHistory,
    interrupt    as _psaiInterrupt,
    renderPanel  as _psaiRenderPanel,
    _PSAI_FETCH_TIMEOUT,
    _PSAI_UPLOAD_TIMEOUT,
    _PSAI_PROMPT_TIMEOUT,
};
