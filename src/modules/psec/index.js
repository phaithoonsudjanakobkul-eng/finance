// PS Email Composer — lazy module (Session 3e UI port — chip bars + form + preview, 2026-05-09)
//
// Status: PARTIAL PORT (template + style chip bars, form renderer for text +
// textarea fields, simple HTML builder, preview iframe, clipboard copy with
// execCommand fallback, Word HTML quirk helpers). Items rows + real
// exec/banner/editorial builders + clear-all modal + workflow stepper
// dots stay in monolith index.html until Session 3f+ port.
//
// Ported in 3e:
//   - Template registry (5 templates) + approveVerb + resolveClosing (kept from skeleton)
//   - Field defs (text + textarea types — items deferred)
//   - 3 style metadata (exec/banner/editorial labels + descriptions)
//   - State load/save
//   - Word HTML quirk helpers: spacer, hairline, wrapHtmlDoc (with </body> hazard guard)
//   - renderPanel(rootEl) — chip bars + form pane + preview pane + copy button
//   - Live preview rebuild on every form change
//   - copyRich() — execCommand('copy') with custom event handler (Outlook fidelity)
//
// CRITICAL Word HTML quirks (from CLAUDE.md PSEC section, do NOT regress):
//   - <font color> stripped → use <span style="color:..."> instead
//   - margin on <table> ignored → use spacer(pt) for vertical gaps
//   - border-top on empty table collapses → use hairline() row
//   - phantom <o:p> after last <p> in cell → append color-matched absorber
//   - K/V row spacing → wrap in <p style="margin:0;mso-margin-top-alt:0;..."
//   - Long URL wrap → table-layout:fixed + word-break:break-all
//
// Clipboard fix: Chromium ClipboardItem sanitizes inline styles aggressively.
// Workaround = offscreen contenteditable + execCommand('copy') with custom
// copy event handler. Falls back to ClipboardItem if execCommand fails.
//
// </body>/</html> literal hazard: live-server splits on first </body> in raw
// text. Use _LT = '<' then concat — _LT + '/body>' instead of '</body>'.

import { lsSave, lsGetJson } from '../../core/storage.js';
import { bus } from '../../core/bus.js';

const _PSEC_LS = 'ps_psec_state';

// ── Template registry (kept from 3b skeleton) ──────────────────────────
/** @typedef {{
 *   label: string, shortLabel: string, step: number | null,
 *   fields: string[], defaultClosing: string,
 * }} PsecTemplate */

/** @type {Record<string, PsecTemplate>} */
export const _psecTemplates = {
    'quotation-customer': {
        label: 'ใบเสนอราคา (ลูกค้า)',
        shortLabel: 'ส่งใบเสนอราคา',
        step: null,
        fields: ['recipient', 'cc', 'subjectMatter', 'details', 'closing'],
        defaultClosing: 'ขอแสดงความนับถือ',
    },
    'approve-budget': {
        label: 'Approve Configuration — ตั้งงบประมาณ',
        shortLabel: 'Approve ตั้งงบประมาณ',
        step: 1,
        fields: ['agency', 'eqList', 'mainItems', 'notes', 'closing'],
        defaultClosing: 'Thanks,',
    },
    'approve-bid': {
        label: 'Approve Configuration — ยื่นซอง',
        shortLabel: 'Approve ยื่นซอง',
        step: 2,
        fields: ['agency', 'eqList', 'mainItems', 'submitDate', 'submitTime', 'notes', 'closing'],
        defaultClosing: 'Thanks,',
    },
    'approve-order': {
        label: 'Approve Configuration — สั่งของ',
        shortLabel: 'Approve สั่งของ',
        step: 3,
        fields: ['agency', 'eqList', 'mainItems', 'notes', 'closing'],
        defaultClosing: 'Thanks,',
    },
    'order': {
        label: 'สั่งของ (วาง TOP ของ FW: ฝ่ายจัดซื้อ)',
        shortLabel: 'FW ฝ่ายจัดซื้อ',
        step: 4,
        fields: ['eqList', 'mainItemsOversea', 'agency', 'orderDate', 'expireDate', 'notes', 'localItems', 'closing'],
        defaultClosing: 'ขอบคุณครับ',
    },
};

// Field definitions (port from monolith; items type renders placeholder for now)
/** @type {Record<string, { label: string, type: 'text' | 'textarea' | 'items', placeholder?: string }>} */
const _psecFieldDefs = {
    recipient:        { label: 'เรียน (ชื่อลูกค้า)',           type: 'text',     placeholder: 'เช่น คุณสมชาย / นพ.อรรถพล' },
    cc:               { label: 'สำเนาถึง (optional)',          type: 'text',     placeholder: 'เว้นว่างถ้าไม่มี' },
    subjectMatter:    { label: 'เรื่อง / รายการ (optional)',   type: 'text',     placeholder: 'เช่น กล้องจุลทรรศน์ CX23' },
    details:          { label: 'รายละเอียด (optional)',         type: 'textarea', placeholder: 'Enter 1 ครั้ง = บรรทัดใหม่ · Enter 2 ครั้ง = ย่อหน้าใหม่' },
    agency:           { label: 'หน่วยงาน',                     type: 'text',     placeholder: 'เช่น คณะวิทยาศาสตร์ ม.นเรศวร' },
    eqList:           { label: 'เลขที่ใบเสนอราคา / EQ List',    type: 'text',     placeholder: 'PS260107-0041Rev.02' },
    mainItems:        { label: 'รายการสินค้าหลัก',              type: 'text',     placeholder: 'CX23T, SZ61TR, EP50' },
    mainItemsOversea: { label: 'รายการสินค้าหลัก (Oversea)',    type: 'text',     placeholder: 'CX43' },
    submitDate:       { label: 'กำหนดยื่น (วันที่)',            type: 'text',     placeholder: '18/03/69' },
    submitTime:       { label: 'กำหนดยื่น (เวลา)',              type: 'text',     placeholder: '13.00–16.00' },
    orderDate:        { label: 'ใบสั่งซื้อวันที่',              type: 'text',     placeholder: '21/01/2569' },
    expireDate:       { label: 'หมดสัญญาวันที่',                type: 'text',     placeholder: '21/04/2569' },
    notes:            { label: 'หมายเหตุ',                     type: 'textarea', placeholder: '1 บรรทัดต่อ 1 ข้อ — เว้นว่างถ้าไม่มี (จะแสดง "-")' },
    localItems:       { label: 'รายการสินค้า LOCAL',            type: 'items' },
    closing:          { label: 'ประโยคปิดท้าย',                type: 'text',     placeholder: 'Thanks, / ขอบคุณครับ / ขอแสดงความนับถือ' },
};

// 3 style metadata
/** @type {Record<string, { label: string, desc: string }>} */
const _PSEC_STYLES = {
    exec:      { label: 'Console',    desc: 'Dark navy hero · mono ID badge · executive style' },
    banner:    { label: 'Branded',    desc: 'Full-width brand banner · approachable' },
    editorial: { label: 'Spec',       desc: 'Brand stripe + heavy black rules · spec-sheet style' },
};

// Word HTML constants
const _PSEC_BORDER = '#d8d8d8';
const _PSEC_BRAND  = '#014A99';
const _PSEC_TEXT   = '#1f2937';
const _PSEC_FF     = "Tahoma,'Sans Serif',sans-serif";

// State
/** @type {{ templates: Record<string, any>, lastTemplate: string, lastStyle: string }} */
let _psecState = { templates: {}, lastTemplate: 'quotation-customer', lastStyle: 'exec' };
let _psecActiveTpl   = 'quotation-customer';
let _psecActiveStyle = 'exec';
/** @type {HTMLElement | null} */
let _psecPanel = null;

export function loadState() {
    const parsed = lsGetJson(_PSEC_LS, /** @type {any} */ (null));
    if (parsed && typeof parsed === 'object') _psecState = Object.assign(_psecState, parsed);
    if (_psecState.lastTemplate && _psecTemplates[_psecState.lastTemplate]) _psecActiveTpl = _psecState.lastTemplate;
    if (_psecState.lastStyle && _PSEC_STYLES[_psecState.lastStyle]) _psecActiveStyle = _psecState.lastStyle;
    return _psecState;
}
export function saveState() {
    _psecState.lastTemplate = _psecActiveTpl;
    _psecState.lastStyle    = _psecActiveStyle;
    lsSave(_PSEC_LS, JSON.stringify(_psecState));
    bus.emit('psec:state-saved', { lastTemplate: _psecActiveTpl, lastStyle: _psecActiveStyle });
}
export function getState() { return _psecState; }
/** @param {string} tplId @returns {Record<string, any>} */
function getForm(tplId) {
    if (!_psecState.templates[tplId]) _psecState.templates[tplId] = {};
    return _psecState.templates[tplId];
}

/** @param {string} tplId */
export function approveVerb(tplId) {
    if (tplId === 'approve-bid')    return 'ยื่นซอง';
    if (tplId === 'approve-budget') return 'ตั้งงบประมาณ';
    return 'สั่งของ';
}
/** @param {string} tplId @param {{ closing?: string } | null} form */
export function resolveClosing(tplId, form) {
    const typed = (form && form.closing != null) ? String(form.closing).trim() : '';
    if (typed) return typed;
    const tpl = _psecTemplates[tplId];
    return (tpl && tpl.defaultClosing) || 'Thanks,';
}

// ── Word HTML quirk helpers (port from monolith) ───────────────────────
/** @param {number} pt */
export function spacer(pt) {
    return '<p style="margin:0;height:' + pt + 'pt;line-height:' + pt + 'pt;font-size:1pt;">&nbsp;</p>';
}
/** @param {string} [color] @param {number} [mt] @param {number} [mb] */
export function hairline(color, mt, mb) {
    const c = color || _PSEC_BORDER;
    const t = mt || 0;
    const b = mb || 0;
    return '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;margin:' + t + 'pt 0 ' + b + 'pt 0;">' +
      '<tr><td bgcolor="' + c + '" style="height:1pt;line-height:1pt;font-size:1pt;background:' + c + ';background-color:' + c + ';">&nbsp;</td></tr>' +
    '</table>';
}
/**
 * Wrap a body fragment in a Word-compatible HTML doc.
 * </body>/</html> literal hazard: live-server's HTML injector splits on first
 * </body> in raw text. Use _LT = '<' + concat to avoid the literal in source.
 * @param {string} bodyHtml
 */
export function wrapHtmlDoc(bodyHtml) {
    const _LT = '<';
    const head = '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:w="urn:schemas-microsoft-com:office:word"><head><meta charset="utf-8"></head><body>';
    return head + bodyHtml + _LT + '/body>' + _LT + '/html>';
}

/** @param {string} s — html-escape user-typed text */
function he(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Stub HTML builder ──────────────────────────────────────────────────
// Real exec/banner/editorial builders stay in monolith for Session 3f+ port.
// This stub produces a minimal but valid Word-paste HTML so the preview iframe
// shows something meaningful + clipboard copy stays useful.
/**
 * @param {string} tplId
 * @param {string} styleId
 * @param {Record<string, any>} form
 */
function buildEmailHtml(tplId, styleId, form) {
    const tpl = _psecTemplates[tplId];
    if (!tpl) return '<p>Unknown template</p>';
    const closing = resolveClosing(tplId, form);
    const fontStyle = "font-family:" + _PSEC_FF + ";font-size:11pt;color:" + _PSEC_TEXT + ";";
    let body = '<div style="' + fontStyle + 'padding:18pt;">';

    body += '<p style="margin:0 0 6pt 0;color:' + _PSEC_BRAND + ';font-weight:700;letter-spacing:.05em;">' + he((tpl.shortLabel || tpl.label).toUpperCase()) + '</p>';
    body += hairline(_PSEC_BRAND, 0, 12);

    // K/V table from filled fields (skip 'closing' — rendered separately at end)
    body += '<table cellpadding="0" cellspacing="0" border="0" style="width:100%;border-collapse:collapse;">';
    for (const fname of tpl.fields) {
        if (fname === 'closing' || fname === 'localItems') continue;
        const def = _psecFieldDefs[fname];
        if (!def) continue;
        const val = form[fname];
        if (val == null || String(val).trim() === '') continue;
        const valHtml = (def.type === 'textarea')
            ? he(String(val)).replace(/\n\s*\n/g, '</p><p style="margin:0 0 4pt 0;">').replace(/\n/g, '<br>')
            : he(String(val));
        body += '<tr>' +
            '<td style="padding:3pt 12pt 3pt 0;color:' + _PSEC_BRAND + ';font-weight:600;vertical-align:top;width:32%;">' + he(def.label) + '</td>' +
            '<td style="padding:3pt 0;vertical-align:top;"><p style="margin:0;mso-margin-top-alt:0;mso-margin-bottom-alt:0;">' + valHtml + '</p></td>' +
        '</tr>';
    }
    body += '</table>';

    body += spacer(12);
    body += hairline(_PSEC_BORDER, 0, 12);
    body += '<p style="margin:0;">' + he(closing) + '</p>';
    body += '<p style="margin:6pt 0 0 0;color:#888;font-size:9pt;">' +
            'Style: ' + he(styleId) + ' (stub — real exec/banner/editorial builders ship in Session 3f)' +
            '</p>';
    body += '</div>';
    return wrapHtmlDoc(body);
}

// ── Clipboard copy (execCommand fallback for Outlook fidelity) ─────────
/** @param {string} html */
async function copyRich(html) {
    // Method 1: offscreen contenteditable + execCommand('copy') with custom handler.
    // Chromium ClipboardItem sanitizes inline styles aggressively, breaking Outlook
    // paste fidelity. execCommand path lets us write raw HTML to clipboardData.
    const el = document.createElement('div');
    el.contentEditable = 'true';
    el.style.cssText = 'position:fixed;top:-9999px;left:-9999px;opacity:0;pointer-events:none;';
    el.innerHTML = html;
    document.body.appendChild(el);
    try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        if (sel) { sel.removeAllRanges(); sel.addRange(range); }
        /** @param {ClipboardEvent} e */
        const onCopy = (e) => {
            if (e.clipboardData) {
                e.clipboardData.setData('text/html',  html);
                e.clipboardData.setData('text/plain', el.innerText || '');
                e.preventDefault();
            }
        };
        document.addEventListener('copy', onCopy);
        const ok = document.execCommand('copy');
        document.removeEventListener('copy', onCopy);
        if (sel) sel.removeAllRanges();
        if (ok) return true;
    } catch (_e) {}
    finally { document.body.removeChild(el); }
    // Method 2: ClipboardItem fallback
    try {
        const w = /** @type {any} */ (window);
        if (w.ClipboardItem && navigator.clipboard) {
            const blob = new Blob([html], { type: 'text/html' });
            await navigator.clipboard.write([new w.ClipboardItem({ 'text/html': blob })]);
            return true;
        }
    } catch (_e) {}
    return false;
}

// ── UI render ──────────────────────────────────────────────────────────
/** @param {HTMLElement} rootEl */
function renderPanel(rootEl) {
    rootEl.innerHTML = `
        <div class="psec-panel" style="font-family:var(--sans, system-ui, sans-serif);color:var(--fg, #f5f5f7);">
            <style>
                .psec-panel input[type="text"], .psec-panel textarea {
                    background: var(--bg, #0d0d0d); color: var(--fg, #f5f5f7);
                    border: 1px solid var(--border, #2a2a2a); border-radius: 6px;
                    padding: 8px 10px; font-size: 12px; outline: none; width: 100%;
                    font-family: inherit; resize: vertical;
                }
                .psec-panel input:focus, .psec-panel textarea:focus { border-color: var(--accent, #089981); }
                .psec-panel label { display: block; font-size: 10px; color: var(--dim, #888); text-transform: uppercase; letter-spacing: .08em; margin: 6px 0 4px; font-weight: 700; }
                .psec-panel .chip-bar { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 12px; }
                .psec-panel .chip { font-size: 11px; font-weight: 600; padding: 6px 12px; border: 1px solid var(--border, #2a2a2a); border-radius: 999px; background: transparent; color: var(--fg, #f5f5f7); cursor: pointer; transition: all .15s; }
                .psec-panel .chip.active { background: var(--accent, #089981); border-color: var(--accent, #089981); color: #000; }
                .psec-panel .chip:hover:not(.active) { border-color: var(--accent, #089981); }
                .psec-panel .chip .step { opacity: .7; margin-right: 6px; font-weight: 700; }
                .psec-panel .grid-2 { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; align-items: stretch; min-height: 360px; }
                @media (max-width: 800px) { .psec-panel .grid-2 { grid-template-columns: 1fr; } }
                .psec-panel .pane { background: var(--bg, #0d0d0d); border: 1px solid var(--border, #2a2a2a); border-radius: 8px; padding: 12px; max-height: 480px; overflow: auto; }
                .psec-panel .pane h3 { font-size: 11px; text-transform: uppercase; letter-spacing: .08em; color: var(--dim, #888); margin-bottom: 8px; }
                .psec-panel iframe { border: 0; width: 100%; height: 420px; background: #fff; border-radius: 6px; }
                .psec-panel .actions { display: flex; gap: 8px; margin-top: 12px; }
                .psec-panel button.act { background: var(--accent, #089981); color: #000; border: 0; padding: 10px 18px; border-radius: 8px; font-weight: 600; font-size: 13px; cursor: pointer; font-family: inherit; }
                .psec-panel button.act.ghost { background: var(--card, #1a1a1a); color: var(--fg, #f5f5f7); border: 1px solid var(--border, #2a2a2a); }
                .psec-panel button.act:hover { opacity: .85; }
                .psec-panel #psec-status { display: inline-flex; align-items: center; padding: 0 8px; font-size: 12px; color: var(--dim, #888); }
                .psec-panel #psec-status[data-type="ok"] { color: var(--accent, #089981); }
                .psec-panel #psec-status[data-type="err"] { color: #f43f5e; }
                .psec-panel .stub-note { background: rgba(245, 158, 11, 0.08); border-left: 3px solid #f59e0b; padding: 10px 14px; font-size: 12px; color: var(--dim, #888); margin-top: 12px; border-radius: 4px; }
            </style>

            <label>Style</label>
            <div class="chip-bar" id="psec-style-bar"></div>

            <label>Template</label>
            <div class="chip-bar" id="psec-tpl-bar"></div>

            <div class="grid-2">
                <div class="pane">
                    <h3>Form</h3>
                    <div id="psec-form-pane"></div>
                </div>
                <div class="pane">
                    <h3>Preview</h3>
                    <iframe id="psec-preview" sandbox="allow-same-origin"></iframe>
                </div>
            </div>

            <div class="actions">
                <button class="act"       id="psec-copy-btn">Copy to clipboard</button>
                <button class="act ghost" id="psec-clear-btn">Clear current</button>
                <span id="psec-status"></span>
            </div>

            <div class="stub-note">
                <strong>Session 3e port</strong> — chip bars + form + preview live; HTML uses a stub builder (key-value table). Real exec / banner / editorial builders + items rows + workflow stepper dots ship in Session 3f.
            </div>
        </div>
    `;
}

function renderStyleBar() {
    if (!_psecPanel) return;
    const bar = _psecPanel.querySelector('#psec-style-bar');
    if (!bar) return;
    bar.innerHTML = Object.keys(_PSEC_STYLES).map((id) => {
        const s = _PSEC_STYLES[id];
        const active = id === _psecActiveStyle ? ' active' : '';
        return `<button class="chip${active}" data-style="${id}" title="${he(s.desc)}">${he(s.label)}</button>`;
    }).join('');
}

function renderTplBar() {
    if (!_psecPanel) return;
    const bar = _psecPanel.querySelector('#psec-tpl-bar');
    if (!bar) return;
    bar.innerHTML = Object.keys(_psecTemplates).map((id) => {
        const t = _psecTemplates[id];
        const active = id === _psecActiveTpl ? ' active' : '';
        const stepStr = t.step != null ? `<span class="step">${t.step}</span>` : '';
        return `<button class="chip${active}" data-tpl="${id}" title="${he(t.label)}">${stepStr}${he(t.shortLabel || t.label)}</button>`;
    }).join('');
}

function renderForm() {
    if (!_psecPanel) return;
    const pane = _psecPanel.querySelector('#psec-form-pane');
    if (!pane) return;
    const tpl = _psecTemplates[_psecActiveTpl];
    if (!tpl) { pane.innerHTML = ''; return; }
    const form = getForm(_psecActiveTpl);
    pane.innerHTML = tpl.fields.map((fname) => {
        const def = _psecFieldDefs[fname];
        if (!def) return '';
        if (def.type === 'items') {
            return `<label>${he(def.label)} <span style="text-transform:none;font-weight:400;">(items rows ship in Session 3f)</span></label>`;
        }
        if (def.type === 'textarea') {
            return `<label for="psec-f-${fname}">${he(def.label)}</label>` +
                   `<textarea id="psec-f-${fname}" data-field="${fname}" rows="3" placeholder="${he(def.placeholder || '')}">${he(form[fname] || '')}</textarea>`;
        }
        return `<label for="psec-f-${fname}">${he(def.label)}</label>` +
               `<input id="psec-f-${fname}" data-field="${fname}" type="text" placeholder="${he(def.placeholder || '')}" value="${he(form[fname] || '')}" />`;
    }).join('');
}

function refreshPreview() {
    if (!_psecPanel) return;
    const iframe = /** @type {HTMLIFrameElement | null} */ (_psecPanel.querySelector('#psec-preview'));
    if (!iframe) return;
    const html = buildEmailHtml(_psecActiveTpl, _psecActiveStyle, getForm(_psecActiveTpl));
    iframe.srcdoc = html;
}

/** @param {string} msg @param {'ok' | 'err' | ''} [type] */
function setStatus(msg, type) {
    if (!_psecPanel) return;
    const el = /** @type {HTMLElement | null} */ (_psecPanel.querySelector('#psec-status'));
    if (!el) return;
    el.textContent = msg;
    el.dataset.type = type || '';
    if (msg) setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; el.dataset.type = ''; } }, 3500);
}

function wireEvents() {
    if (!_psecPanel) return;
    const panel = _psecPanel;

    panel.addEventListener('click', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        // Style chip
        const styleBtn = t.closest('[data-style]');
        if (styleBtn) {
            const sid = /** @type {HTMLElement} */ (styleBtn).dataset.style;
            if (sid && _PSEC_STYLES[sid]) {
                _psecActiveStyle = sid;
                saveState();
                renderStyleBar();
                refreshPreview();
            }
            return;
        }
        // Template chip
        const tplBtn = t.closest('[data-tpl]');
        if (tplBtn) {
            const tid = /** @type {HTMLElement} */ (tplBtn).dataset.tpl;
            if (tid && _psecTemplates[tid]) {
                _psecActiveTpl = tid;
                saveState();
                renderTplBar();
                renderForm();
                refreshPreview();
            }
            return;
        }
    });

    // Form input — live update form data + refresh preview
    panel.addEventListener('input', (e) => {
        const t = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (e.target);
        const field = t.dataset && t.dataset.field;
        if (!field) return;
        const form = getForm(_psecActiveTpl);
        form[field] = t.value;
        saveState();
        refreshPreview();
    });

    // Copy button
    const copyBtn = panel.querySelector('#psec-copy-btn');
    if (copyBtn) {
        copyBtn.addEventListener('click', async () => {
            const html = buildEmailHtml(_psecActiveTpl, _psecActiveStyle, getForm(_psecActiveTpl));
            const ok = await copyRich(html);
            setStatus(ok ? 'คัดลอกแล้ว · paste ลง Outlook ได้เลย' : 'คัดลอกไม่สำเร็จ', ok ? 'ok' : 'err');
        });
    }

    // Clear button (current template only — clear-all modal deferred to 3f)
    const clearBtn = panel.querySelector('#psec-clear-btn');
    if (clearBtn) {
        clearBtn.addEventListener('click', () => {
            _psecState.templates[_psecActiveTpl] = {};
            saveState();
            renderForm();
            refreshPreview();
            setStatus('ล้างข้อมูลแล้ว', 'ok');
        });
    }
}

// ── Module lifecycle ───────────────────────────────────────────────────
/**
 * @param {HTMLElement} rootEl
 * @param {{ bus?: any, lsSave?: any, lsGet?: any }} [_ctx]
 */
export function init(rootEl, _ctx) {
    loadState();
    _psecPanel = rootEl;
    renderPanel(rootEl);
    renderStyleBar();
    renderTplBar();
    renderForm();
    refreshPreview();
    wireEvents();
    bus.emit('psec:init', { rootEl, lastTemplate: _psecActiveTpl, lastStyle: _psecActiveStyle });
    return {
        id:           'psec',
        version:      '0.2-session3e-ui-port',
        ready:        true,
        templates:    Object.keys(_psecTemplates),
        styles:       Object.keys(_PSEC_STYLES),
        activeTpl:    _psecActiveTpl,
        activeStyle:  _psecActiveStyle,
    };
}

export function destroy() {
    _psecPanel = null;
    bus.emit('psec:destroy');
}
