// PS Quotation — lazy module (Session 3h UI port — file slots + counter + stages, 2026-05-09)
//
// Status: PARTIAL PORT (file slot pickers, counter display, stage buttons,
// output mode toggle, period status). Real xlsx patching pipeline, Stage 1-3
// flows (Apply numbering / Generate .eml / Prepare PDF), Collabora Path E
// live editor, encrypted template IDB + Gist sync, _psqScanFor keyword cell
// scan, BAHTTEXT JS port all stay in monolith index.html until Session 3i+
// port. PSQ depends on SheetJS (CDN) for xlsx I/O.
//
// Ported in 3h:
//   - Storage keys (12 PSQ_* constants — kept from skeleton)
//   - Counter helpers (peek + next quotation number, period reset rule — kept)
//   - State container (main/comp1/comp2 slots + outputMode — kept)
//   - File slot picker (FSA-style file input per slot)
//   - Counter display (Comp1 BE+1 / Comp2 calendar period preview)
//   - Stage buttons stubs (Apply / Distribute / Prepare PDF)
//   - Output mode toggle (xlsx / pdf)
//   - Workers config display (Collabora / WOPI / PDF cloud-vs-hybrid)
//
// CRITICAL invariants from project_ps_quotation_spec memory + CLAUDE.md:
//   - Comp1: BT{BE+1}{MM}-{counter}, counter starts at 350
//   - Comp2: QMVV{MM}{YY}-{counter}, counter starts at 700
//   - Counter resets on (year, month) period change
//   - BE year = calendar BE+1 always
//   - Anti-bid-rigging: date + validity vary per file (deferred — in builder pipeline)
//   - Cell mapping uses _psqScanFor keyword-scan, NOT hardcoded addresses
//   - Templates Comp1/Comp2 stored encrypted in Gist + IDB (slot-based names)
//
// Workers (per CLAUDE.md):
//   - Collabora: pslink-collabora.fly.dev — ALWAYS cloud (Tailscale clipboard bug)
//   - WOPI: pslink-wopi.fly.dev — ALWAYS cloud
//   - PDF: cloud OR Tailscale-local (Hybrid mode probe 1.5s timeout)
// F4/F6/F7 hardening (Collabora origin guard, WOPI 401 re-auth, PDF 60s timeout)
// applies via monolith bridge until full Path E port lands.

import { lsSave, lsGet, lsGetJson } from '../../core/storage.js';
import { bus } from '../../core/bus.js';

// ── Storage keys ───────────────────────────────────────────────────────
export const PSQ_STATE_KEY            = 'ps_psq_state';
export const PSQ_EMAIL_TPL_KEY        = 'ps_psq_email_templates';
export const PSQ_CUSTOMERS_KEY        = 'ps_psq_customers';
export const PSQ_TEMPLATE_META_KEY    = 'ps_psq_template_meta';
export const PSQ_PDF_WORKER_URL_KEY   = 'ps_pdf_worker_url';
export const PSQ_PDF_AUTH_TOKEN_KEY   = 'ps_pdf_auth_token';
export const PSQ_WOPI_URL_KEY         = 'ps_psq_wopi_url';
export const PSQ_WOPI_TOKEN_KEY       = 'ps_psq_wopi_token';
export const PSQ_COLLABORA_URL_KEY    = 'ps_psq_collabora_url';
export const PSQ_LOCAL_BASE_KEY       = 'ps_psq_local_base';
export const PSQ_LOCAL_BASE_OVERRIDE  = 'ps_psq_local_base_override';

// ── Counter starting points ────────────────────────────────────────────
export const PSQ_COMP1_COUNTER_START = 350;
export const PSQ_COMP2_COUNTER_START = 700;

/** @type {{
 *   main:  { buffer: ArrayBuffer | null, wb: any, name?: string } | null,
 *   comp1: { buffer: ArrayBuffer | null, wb: any, name?: string } | null,
 *   comp2: { buffer: ArrayBuffer | null, wb: any, name?: string } | null,
 *   outputMode: 'excel' | 'pdf',
 * }} */
export const _psqState = {
    main:       null,
    comp1:      null,
    comp2:      null,
    outputMode: 'excel',
};

/** @type {{ comp1: { period: string, counter: number, history: any[] }, comp2: { period: string, counter: number, history: any[] } }} */
let _psqLog = {
    comp1: { period: '', counter: PSQ_COMP1_COUNTER_START, history: [] },
    comp2: { period: '', counter: PSQ_COMP2_COUNTER_START, history: [] },
};

/** @type {HTMLElement | null} */
let _psqPanel = null;

export function loadPsqLog() {
    const parsed = lsGetJson(PSQ_STATE_KEY, /** @type {any} */ (null));
    if (parsed && typeof parsed === 'object') {
        if (parsed.comp1) _psqLog.comp1 = { ..._psqLog.comp1, ...parsed.comp1 };
        if (parsed.comp2) _psqLog.comp2 = { ..._psqLog.comp2, ...parsed.comp2 };
    }
    return _psqLog;
}
export function savePsqLog() {
    lsSave(PSQ_STATE_KEY, JSON.stringify(_psqLog));
    bus.emit('psq:state-saved', { log: _psqLog });
}
export function getPsqLog() { return _psqLog; }

/** @param {'comp1' | 'comp2'} which @param {Date} [now] */
export function periodKey(which, now) {
    const d = now || new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    if (which === 'comp1') {
        const be = d.getFullYear() + 543 + 1;
        return `${be}-${m}`;
    }
    return `${d.getFullYear()}-${m}`;
}

/** @param {'comp1' | 'comp2'} which @param {string} period @param {number} counter */
function _formatQuotationNumber(which, period, counter) {
    if (which === 'comp1') {
        const be = period.split('-')[0];
        const m  = period.split('-')[1];
        return `BT${String(be).slice(-2)}${m}-${counter}`;
    }
    const yyyy = period.split('-')[0];
    const m    = period.split('-')[1];
    return `QMVV${m}${String(yyyy).slice(-2)}-${counter}`;
}

/** @param {'comp1' | 'comp2'} which */
export function peekQuotationNumber(which) {
    const period = periodKey(which);
    const slot = _psqLog[which];
    const baseline = (which === 'comp1') ? PSQ_COMP1_COUNTER_START : PSQ_COMP2_COUNTER_START;
    const counter  = (slot.period !== period) ? baseline : slot.counter;
    return _formatQuotationNumber(which, period, counter);
}

/** @param {'comp1' | 'comp2'} which */
export function nextQuotationNumber(which) {
    const period = periodKey(which);
    const slot = _psqLog[which];
    if (slot.period !== period) {
        slot.period  = period;
        slot.counter = (which === 'comp1') ? PSQ_COMP1_COUNTER_START : PSQ_COMP2_COUNTER_START;
    }
    const counter = slot.counter++;
    return _formatQuotationNumber(which, period, counter);
}

/** @param {string} s */
function he(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── File slot handling ─────────────────────────────────────────────────
/** @param {'main' | 'comp1' | 'comp2'} slot @param {File} file */
async function loadFileToSlot(slot, file) {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
        setStatus(`${slot}: ไฟล์ต้องเป็น .xlsx`, 'err');
        return;
    }
    const buffer = await file.arrayBuffer();
    _psqState[slot] = { buffer, wb: null, name: file.name };
    setStatus(`Loaded ${slot} = ${file.name} (${(buffer.byteLength/1024).toFixed(1)} KB)`, 'ok');
    renderSlots();
    bus.emit('psq:slot-loaded', { slot, name: file.name });
}

/** @param {'main' | 'comp1' | 'comp2'} slot */
function clearSlot(slot) {
    _psqState[slot] = null;
    renderSlots();
}

// ── Stage stubs ────────────────────────────────────────────────────────
function stage1Apply() {
    if (!_psqState.main) {
        setStatus('Stage 1: ยังไม่มี main file', 'err');
        return;
    }
    const c1Num = peekQuotationNumber('comp1');
    const c2Num = peekQuotationNumber('comp2');
    setStatus(`Stage 1 (stub): would patch numbering Comp1=${c1Num}, Comp2=${c2Num} — real xlsx patcher in Session 3i+`, '');
}

function stage2Distribute() {
    if (!_psqState.main) {
        setStatus('Stage 2: ยังไม่มี main file', 'err');
        return;
    }
    setStatus('Stage 2 (stub): would generate .eml + Gmail authuser deep-link — real flow in Session 3i+', '');
}

function stage3PrepareAll() {
    if (!_psqState.main) {
        setStatus('Stage 3: ยังไม่มี main file', 'err');
        return;
    }
    const mode = _psqState.outputMode;
    setStatus(`Stage 3 (stub): would prepare ${mode === 'pdf' ? 'PDF (Fly.io worker)' : 'xlsx'} — real flow in Session 3i+`, '');
}

function stage4OpenEditor() {
    if (!_psqState.main) {
        setStatus('Path E: ยังไม่มี main file', 'err');
        return;
    }
    setStatus('Path E (stub): would open Collabora iframe live editor — real flow in Session 3i+', '');
}

// ── UI render ──────────────────────────────────────────────────────────
/** @param {HTMLElement} rootEl */
function renderPanel(rootEl) {
    rootEl.innerHTML = `
        <div class="psq-panel" style="font-family:var(--sans, system-ui, sans-serif);color:var(--fg, #f5f5f7);">
            <style>
                .psq-panel label { display:block; font-size:10px; color:var(--dim, #888); text-transform:uppercase; letter-spacing:.08em; margin:6px 0 4px; font-weight:700; }
                .psq-panel .grid-3 { display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-bottom:14px; }
                @media (max-width: 720px) { .psq-panel .grid-3 { grid-template-columns:1fr; } }
                .psq-panel .slot { background:var(--bg, #0d0d0d); border:1px solid var(--border, #2a2a2a); border-radius:8px; padding:12px; }
                .psq-panel .slot-title { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--accent, #089981); font-weight:700; margin-bottom:6px; }
                .psq-panel .slot-name { font-size:12px; font-family:var(--mono); color:var(--fg, #f5f5f7); margin-bottom:8px; word-break:break-all; min-height:18px; }
                .psq-panel .slot-name.empty { color:var(--dim, #888); font-style:italic; }
                .psq-panel .slot-actions { display:flex; gap:6px; }
                .psq-panel .slot-actions button { font-size:11px; padding:6px 10px; border-radius:6px; border:1px solid var(--border, #2a2a2a); background:var(--card, #1a1a1a); color:var(--fg, #f5f5f7); cursor:pointer; font-family:inherit; }
                .psq-panel .slot-actions button:hover { border-color:var(--accent, #089981); }
                .psq-panel .slot-actions button.x { color:#f43f5e; }
                .psq-panel .counter-strip { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:12px 14px; background:rgba(8, 153, 129, 0.06); border:1px solid var(--accent, #089981); border-radius:8px; margin-bottom:14px; }
                .psq-panel .counter-cell .lbl { font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim, #888); margin-bottom:2px; font-weight:700; }
                .psq-panel .counter-cell .val { font-size:18px; font-family:var(--mono); color:var(--accent, #089981); font-weight:700; }
                .psq-panel .counter-cell .meta { font-size:10px; color:var(--dim, #888); margin-top:2px; }
                .psq-panel .toggle-row { display:flex; align-items:center; gap:12px; margin-bottom:14px; }
                .psq-panel .toggle-row label { margin:0; }
                .psq-panel .chip-bar { display:flex; flex-wrap:wrap; gap:6px; }
                .psq-panel .chip { font-size:11px; font-weight:600; padding:6px 12px; border:1px solid var(--border, #2a2a2a); border-radius:999px; background:transparent; color:var(--fg, #f5f5f7); cursor:pointer; transition:all .15s; }
                .psq-panel .chip.active { background:var(--accent, #089981); border-color:var(--accent, #089981); color:#000; }
                .psq-panel .stages { display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-top:14px; }
                @media (max-width: 640px) { .psq-panel .stages { grid-template-columns:1fr; } }
                .psq-panel .stage-btn { background:var(--card, #1a1a1a); color:var(--fg, #f5f5f7); border:1px solid var(--border, #2a2a2a); padding:14px 16px; border-radius:8px; cursor:pointer; font-family:inherit; font-size:13px; text-align:left; }
                .psq-panel .stage-btn:hover { border-color:var(--accent, #089981); }
                .psq-panel .stage-btn .num { font-family:var(--mono); font-size:11px; color:var(--accent, #089981); font-weight:700; margin-right:6px; }
                .psq-panel .stage-btn .desc { display:block; font-size:11px; color:var(--dim, #888); margin-top:4px; }
                .psq-panel .workers { background:var(--bg, #0d0d0d); border:1px solid var(--border, #2a2a2a); border-radius:8px; padding:10px 14px; margin-top:14px; font-size:11px; line-height:1.6; }
                .psq-panel .workers strong { color:var(--accent, #089981); }
                .psq-panel #psq-status { display:block; padding:10px 14px; font-size:12px; color:var(--dim, #888); margin-top:10px; min-height:18px; }
                .psq-panel #psq-status[data-type="ok"] { color:var(--accent, #089981); }
                .psq-panel #psq-status[data-type="err"] { color:#f43f5e; }
                .psq-panel .stub-note { background:rgba(245, 158, 11, 0.08); border-left:3px solid #f59e0b; padding:10px 14px; font-size:12px; color:var(--dim, #888); margin-top:12px; border-radius:4px; }
            </style>

            <div class="counter-strip">
                <div class="counter-cell">
                    <div class="lbl">Comp1 — Next #</div>
                    <div class="val" id="psq-c1-num"></div>
                    <div class="meta" id="psq-c1-meta"></div>
                </div>
                <div class="counter-cell">
                    <div class="lbl">Comp2 — Next #</div>
                    <div class="val" id="psq-c2-num"></div>
                    <div class="meta" id="psq-c2-meta"></div>
                </div>
            </div>

            <label>File slots</label>
            <div class="grid-3">
                <div class="slot" data-slot="main">
                    <div class="slot-title">Main</div>
                    <div class="slot-name empty" id="psq-name-main">— no file —</div>
                    <div class="slot-actions">
                        <button data-pick="main">Choose</button>
                        <button class="x" data-clear="main">Clear</button>
                    </div>
                    <input type="file" data-input="main" accept=".xlsx,.xls" style="display:none;" />
                </div>
                <div class="slot" data-slot="comp1">
                    <div class="slot-title">Comp1 — British Trading</div>
                    <div class="slot-name empty" id="psq-name-comp1">— no template —</div>
                    <div class="slot-actions">
                        <button data-pick="comp1">Choose</button>
                        <button class="x" data-clear="comp1">Clear</button>
                    </div>
                    <input type="file" data-input="comp1" accept=".xlsx,.xls" style="display:none;" />
                </div>
                <div class="slot" data-slot="comp2">
                    <div class="slot-title">Comp2 — QMVV</div>
                    <div class="slot-name empty" id="psq-name-comp2">— no template —</div>
                    <div class="slot-actions">
                        <button data-pick="comp2">Choose</button>
                        <button class="x" data-clear="comp2">Clear</button>
                    </div>
                    <input type="file" data-input="comp2" accept=".xlsx,.xls" style="display:none;" />
                </div>
            </div>

            <div class="toggle-row">
                <label style="margin:0;">Output Mode</label>
                <div class="chip-bar" id="psq-output-bar"></div>
            </div>

            <div class="stages">
                <button class="stage-btn" id="psq-stage-1">
                    <span class="num">Stage 1</span>Apply numbering
                    <span class="desc">Patch Comp1/Comp2 quotation numbers + dates (anti-bid-rigging variation)</span>
                </button>
                <button class="stage-btn" id="psq-stage-2">
                    <span class="num">Stage 2</span>Generate .eml + Gmail link
                    <span class="desc">Build .eml file (Outlook) + Gmail authuser deep-link with attachments</span>
                </button>
                <button class="stage-btn" id="psq-stage-3">
                    <span class="num">Stage 3</span>Prepare ALL (xlsx / PDF)
                    <span class="desc">Recalc + render — uses Fly.io PDF worker (cloud or Tailscale local)</span>
                </button>
                <button class="stage-btn" id="psq-stage-4">
                    <span class="num">Path E</span>Open Collabora editor
                    <span class="desc">Live in-browser xlsx editing — Cloud Collabora always (Tailscale clipboard bug)</span>
                </button>
            </div>

            <div class="workers">
                <strong>Backends:</strong>
                Collabora <code>${he(lsGet(PSQ_COLLABORA_URL_KEY, 'pslink-collabora.fly.dev'))}</code> ·
                WOPI <code>${he(lsGet(PSQ_WOPI_URL_KEY, 'pslink-wopi.fly.dev'))}</code> ·
                PDF <code>${he(lsGet(PSQ_PDF_WORKER_URL_KEY, 'pslink-pdf-worker.fly.dev'))}</code>
                ${lsGet(PSQ_LOCAL_BASE_OVERRIDE, '') ? '<br><strong>Hybrid override (this device):</strong> ' + he(lsGet(PSQ_LOCAL_BASE_OVERRIDE, '')) : ''}
            </div>

            <div id="psq-status"></div>

            <div class="stub-note">
                <strong>Session 3h port</strong> — file slots + counter (Comp1 BE+1 / Comp2 calendar period) + stage buttons + output mode toggle + workers config display live; Stage 1-4 actions are stubs (status messages only, no xlsx patching). Real xlsx pipeline + .eml builder + PDF worker call + Collabora iframe ship in Session 3i+.
            </div>
        </div>
    `;
}

function renderCounter() {
    if (!_psqPanel) return;
    const c1 = _psqPanel.querySelector('#psq-c1-num');
    const c2 = _psqPanel.querySelector('#psq-c2-num');
    const c1Meta = _psqPanel.querySelector('#psq-c1-meta');
    const c2Meta = _psqPanel.querySelector('#psq-c2-meta');
    if (c1)     c1.textContent     = peekQuotationNumber('comp1');
    if (c2)     c2.textContent     = peekQuotationNumber('comp2');
    if (c1Meta) c1Meta.textContent = `period ${periodKey('comp1')} · counter at ${_psqLog.comp1.counter}`;
    if (c2Meta) c2Meta.textContent = `period ${periodKey('comp2')} · counter at ${_psqLog.comp2.counter}`;
}

function renderSlots() {
    if (!_psqPanel) return;
    /** @type {('main' | 'comp1' | 'comp2')[]} */
    const slots = ['main', 'comp1', 'comp2'];
    for (const slot of slots) {
        const nameEl = _psqPanel.querySelector(`#psq-name-${slot}`);
        if (!nameEl) continue;
        const data = _psqState[slot];
        if (data && data.name) {
            nameEl.textContent = data.name;
            nameEl.classList.remove('empty');
        } else {
            nameEl.textContent = (slot === 'main') ? '— no file —' : '— no template —';
            nameEl.classList.add('empty');
        }
    }
}

function renderOutputBar() {
    if (!_psqPanel) return;
    const bar = _psqPanel.querySelector('#psq-output-bar');
    if (!bar) return;
    const modes = [
        { id: 'excel', label: 'XLSX' },
        { id: 'pdf',   label: 'PDF'  },
    ];
    bar.innerHTML = modes.map((m) => {
        const active = m.id === _psqState.outputMode ? ' active' : '';
        return `<button class="chip${active}" data-output="${m.id}">${he(m.label)}</button>`;
    }).join('');
}

/** @param {string} msg @param {'ok' | 'err' | ''} [type] */
function setStatus(msg, type) {
    if (!_psqPanel) return;
    const el = /** @type {HTMLElement | null} */ (_psqPanel.querySelector('#psq-status'));
    if (!el) return;
    el.textContent = msg;
    el.dataset.type = type || '';
    if (msg && type === 'ok') setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; el.dataset.type = ''; } }, 5000);
}

function wireEvents() {
    if (!_psqPanel) return;
    const panel = _psqPanel;

    panel.addEventListener('click', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);

        // File slot pick → trigger hidden input
        const pickBtn = t.closest('[data-pick]');
        if (pickBtn) {
            const slot = /** @type {HTMLElement} */ (pickBtn).dataset.pick;
            const input = /** @type {HTMLInputElement | null} */ (panel.querySelector(`input[data-input="${slot}"]`));
            input?.click();
            return;
        }
        // File slot clear
        const clearBtn = t.closest('[data-clear]');
        if (clearBtn) {
            const slot = /** @type {HTMLElement} */ (clearBtn).dataset.clear;
            if (slot === 'main' || slot === 'comp1' || slot === 'comp2') clearSlot(slot);
            return;
        }
        // Output mode chip
        const outBtn = t.closest('[data-output]');
        if (outBtn) {
            const m = /** @type {HTMLElement} */ (outBtn).dataset.output;
            if (m === 'excel' || m === 'pdf') {
                _psqState.outputMode = m;
                renderOutputBar();
            }
            return;
        }
    });

    // File inputs (one per slot)
    panel.querySelectorAll('input[data-input]').forEach((el) => {
        const input = /** @type {HTMLInputElement} */ (el);
        input.addEventListener('change', () => {
            const slot = input.dataset.input;
            const file = input.files && input.files[0];
            if (!file) return;
            if (slot === 'main' || slot === 'comp1' || slot === 'comp2') loadFileToSlot(slot, file);
        });
    });

    // Stage buttons
    panel.querySelector('#psq-stage-1')?.addEventListener('click', () => stage1Apply());
    panel.querySelector('#psq-stage-2')?.addEventListener('click', () => stage2Distribute());
    panel.querySelector('#psq-stage-3')?.addEventListener('click', () => stage3PrepareAll());
    panel.querySelector('#psq-stage-4')?.addEventListener('click', () => stage4OpenEditor());
}

// ── Module lifecycle ───────────────────────────────────────────────────
/**
 * @param {HTMLElement} rootEl
 * @param {{ bus?: any, lsSave?: any, lsGet?: any }} [_ctx]
 */
export function init(rootEl, _ctx) {
    loadPsqLog();
    _psqPanel = rootEl;
    renderPanel(rootEl);
    renderCounter();
    renderSlots();
    renderOutputBar();
    wireEvents();
    bus.emit('psq:init', { rootEl, log: _psqLog });
    return {
        id:           'psq',
        version:      '0.2-session3h-ui-port',
        ready:        true,
        comp1Counter: _psqLog.comp1.counter,
        comp1Period:  _psqLog.comp1.period,
        comp2Counter: _psqLog.comp2.counter,
        comp2Period:  _psqLog.comp2.period,
        outputMode:   _psqState.outputMode,
        nextComp1Preview: peekQuotationNumber('comp1'),
        nextComp2Preview: peekQuotationNumber('comp2'),
    };
}

export function destroy() {
    if (_psqState.main)  { _psqState.main.buffer  = null; _psqState.main.wb  = null; }
    if (_psqState.comp1) { _psqState.comp1.buffer = null; _psqState.comp1.wb = null; }
    if (_psqState.comp2) { _psqState.comp2.buffer = null; _psqState.comp2.wb = null; }
    _psqPanel = null;
    bus.emit('psq:destroy');
}
