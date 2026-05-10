// PS Email Composer — lazy module (Session 3o full heavy-logic port, 2026-05-10)
//
// Status: FULL HEAVY PORT — 3 styles × 3 bodies (Approve/Order/Quotation) = 9
// real Outlook-fidelity HTML builders. Items rows form + plain-text fallbacks
// + workflow stepper dots + clear-all confirm. Replaces the K/V stub.
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

// Word HTML constants — palette + font stack
const _PSEC_BRAND      = '#014A99';
const _PSEC_BRAND_LT   = '#cfe1f5';   // overline text on dark bg
const _PSEC_BRAND_TINT = '#eaf1f8';   // light tint background
const _PSEC_TEXT       = '#1f2937';
const _PSEC_DIM        = '#6b7280';
const _PSEC_BORDER     = '#d8d8d8';
const _PSEC_FF         = "Tahoma,'Sans Serif',sans-serif";
const _PSEC_FONT       = "font-family:" + _PSEC_FF + ";font-size:11pt;color:" + _PSEC_TEXT + ";";

// Console (Exec) palette
const _PSEC_CONS_DARK     = '#0a1f3a';
const _PSEC_CONS_DIM_LT   = '#a3b3cc';   // light slate for hero subtitle
const _PSEC_CONS_DIVIDER  = '#e5e7eb';
const _PSEC_CONS_MONO     = "Consolas,'Courier New',Tahoma,monospace";

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

import { escapeHtml as he } from '../../core/escape.js';

// ── Notes + remark text helpers ────────────────────────────────────────

/**
 * Format a remark — preserves line breaks + smart-link URLs.
 * Bare URL → "คลิกที่นี่"; [custom](url) or [custom]url → custom label.
 * @param {string} s
 */
function fmtRemark(s) {
    if (!s) return '';
    const linkStyle = 'color:#0066cc;word-break:break-all;overflow-wrap:break-word;';
    const DEFAULT_LINK_LABEL = 'คลิกที่นี่';
    let html = he(s);
    /** @type {string[]} */
    const slots = [];
    html = html.replace(/\[([^\]\n]+)\]\s*\(?\s*(https?:\/\/[^\s)<]+)\s*\)?/g, function(_m, text, url) {
        const i = slots.length;
        slots.push('<a href="' + url + '" style="' + linkStyle + '">' + text + '</a>');
        return 'PSEC' + i + 'LINK';
    });
    html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="' + linkStyle + '">' + DEFAULT_LINK_LABEL + '</a>');
    html = html.replace(/PSEC(\d+)LINK/g, function(_m, i) { return slots[parseInt(i, 10)]; });
    return html.replace(/\n/g, '<br>');
}

/** @param {string} raw */
function notesToHtml(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) return '-';
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return '-';
    if (lines.length === 1) return he(lines[0]);
    return '<br>' + lines.map((l, i) => (i + 1) + '. ' + he(l)).join('<br>');
}

/** @param {string} raw */
function notesToText(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) return '-';
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 1) return lines[0] || '-';
    return '\n' + lines.map((l, i) => (i + 1) + '. ' + l).join('\n');
}

// ── Word HTML primitive helpers ────────────────────────────────────────

/** @param {string} html @param {number} [mb] @param {number} [fs] @param {string} [color] */
function pgraph(html, mb, fs, color) {
    if (mb == null) mb = 6;
    if (!fs) fs = 11;
    if (!color) color = _PSEC_TEXT;
    return '<p style="margin:0 0 ' + mb + 'pt 0;font-family:' + _PSEC_FF + ';font-size:' + fs + 'pt;color:' + color + ';line-height:1.5;">' + html + '</p>';
}

/** @param {number} [width] @param {string} [color] @param {number} [mt] @param {number} [mb] */
function accentRule(width, color, mt, mb) {
    if (!width) width = 48;
    if (!color) color = _PSEC_BRAND;
    if (!mt) mt = 0;
    if (!mb) mb = 0;
    return '<table cellpadding="0" cellspacing="0" border="0" style="width:' + width + 'pt;border-collapse:collapse;border-top:2pt solid ' + color + ';margin:' + mt + 'pt 0 ' + mb + 'pt 0;"><tr><td style="line-height:0;font-size:0;height:0;">&nbsp;</td></tr></table>';
}

// ══════════════════════════════════════════════════════════════════════
//  STYLE A — Console (Exec) — dark navy hero, mono ID, brand left rule
// ══════════════════════════════════════════════════════════════════════

/** @param {string} overline @param {string} headline @param {string} subline */
function exec_Hero(overline, headline, subline) {
    const dark = _PSEC_CONS_DARK;
    const dim  = _PSEC_CONS_DIM_LT;
    const pBase = 'mso-margin-top-alt:0;mso-line-height-rule:exactly;';
    return '<table cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="' + dark + '" style="width:100%;border-collapse:collapse;background:' + dark + ';background-color:' + dark + ';">' +
      '<tr bgcolor="' + dark + '" style="background:' + dark + ';">' +
        '<td bgcolor="' + dark + '" style="background:' + dark + ';background-color:' + dark + ';padding:16pt 20pt 16pt 20pt;border-left:3pt solid ' + _PSEC_BRAND + ';">' +
          '<p style="margin:0 0 8pt 0;mso-margin-bottom-alt:8pt;' + pBase + 'font-family:' + _PSEC_FF + ';font-size:8.5pt;font-weight:bold;color:' + dim + ';line-height:1.2;">' + he(overline) + '</p>' +
          '<p style="margin:0 0 4pt 0;mso-margin-bottom-alt:4pt;' + pBase + 'font-family:' + _PSEC_CONS_MONO + ';font-size:18pt;font-weight:bold;color:#ffffff;line-height:1.15;">' + he(headline) + '</p>' +
          '<p style="margin:0;mso-margin-bottom-alt:0;' + pBase + 'font-family:' + _PSEC_FF + ';font-size:10pt;color:' + dim + ';line-height:1.35;">' + he(subline) + '</p>' +
          // Phantom <o:p> absorber — colored to match dark bg
          '<p style="margin:0;mso-margin-bottom-alt:0;font-size:1pt;line-height:1pt;color:' + dark + ';">&nbsp;</p>' +
        '</td>' +
      '</tr>' +
    '</table>';
}

/** @param {string} text */
function exec_SectionLabel(text) {
    const bracket = '<span style="font-family:' + _PSEC_CONS_MONO + ';color:#9ca3af;font-weight:normal;">';
    return '<p style="margin:0 0 8pt 0;mso-margin-top-alt:0;mso-line-height-rule:exactly;font-family:' + _PSEC_FF + ';font-size:9pt;font-weight:bold;color:#1f2937;line-height:1.3;text-transform:uppercase;">' +
      bracket + '[&nbsp;</span>' + he(text) + bracket + '&nbsp;]</span>' +
    '</p>';
}

/** @param {string} label @param {string} value */
function exec_KVRow(label, value) {
    const pZero = 'margin:0;mso-margin-top-alt:0;mso-margin-bottom-alt:0;mso-line-height-rule:exactly;';
    return '<tr>' +
        '<td style="padding:7pt 14pt 7pt 0;width:130pt;vertical-align:top;border-bottom:1px solid ' + _PSEC_CONS_DIVIDER + ';">' +
          '<p style="' + pZero + 'font-family:' + _PSEC_FF + ';font-size:9.5pt;color:#4b5563;font-weight:bold;line-height:1.4;">' + he(label) + '</p>' +
        '</td>' +
        '<td style="padding:7pt 0;vertical-align:top;border-bottom:1px solid ' + _PSEC_CONS_DIVIDER + ';">' +
          '<p style="' + pZero + 'font-family:' + _PSEC_FF + ';font-size:11pt;color:#1f2937;font-weight:600;line-height:1.4;">' + he(value || '—') + '</p>' +
        '</td>' +
    '</tr>';
}

const _PSEC_EXEC_TOP_SPACER_ROW = '<tr><td colspan="2" style="padding:0;height:4pt;line-height:4pt;font-size:1pt;border:0;">&nbsp;</td></tr>';

/** @param {string} raw */
function exec_NotesBlock(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) return '';
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return '';
    const pZero = 'margin:0;mso-margin-top-alt:0;mso-margin-bottom-alt:0;mso-line-height-rule:exactly;';
    if (lines.length === 1) {
        return '<p style="' + pZero + 'font-family:' + _PSEC_FF + ';font-size:11pt;color:#1f2937;line-height:1.5;">' + he(lines[0]) + '</p>';
    }
    const rows = lines.map((l, i) => {
        const padBottom = (i === lines.length - 1) ? 0 : 5;
        return '<tr>' +
            '<td style="padding:0 8pt ' + padBottom + 'pt 0;width:24pt;vertical-align:top;">' +
              '<p style="' + pZero + 'font-family:' + _PSEC_CONS_MONO + ';font-size:11pt;font-weight:bold;color:' + _PSEC_BRAND + ';line-height:1.5;text-align:right;">' + (i + 1) + '.</p>' +
            '</td>' +
            '<td style="padding:0 0 ' + padBottom + 'pt 0;vertical-align:top;">' +
              '<p style="' + pZero + 'font-family:' + _PSEC_FF + ';font-size:11pt;color:#1f2937;line-height:1.5;word-wrap:break-word;overflow-wrap:break-word;">' + he(l) + '</p>' +
            '</td>' +
        '</tr>';
    }).join('');
    return '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">' + rows + '</table>';
}

/** @param {string} tplId @param {Record<string, any>} form */
function exec_Approve(tplId, form) {
    const isBid = tplId === 'approve-bid';
    const verb = approveVerb(tplId);
    const overline = 'SCIED · APPROVE CONFIG · ' + verb;
    const headline = form.eqList || verb;
    const submitInfo = isBid && (form.submitDate || form.submitTime)
        ? 'กำหนดยื่น ' + (form.submitDate || '') + (form.submitTime ? '  ·  ' + form.submitTime : '')
        : '';
    const subline = [form.agency || '', submitInfo].filter(Boolean).join('  ·  ') || '—';
    const submitSuffix = isBid && (form.submitDate || form.submitTime)
        ? ' (กำหนดยื่น ' + he(form.submitDate || '') + (form.submitTime ? ' – ' + he(form.submitTime) : '') + ')'
        : '';

    const rows =
        exec_KVRow('หน่วยงาน', form.agency || '') +
        exec_KVRow('EQ List', form.eqList || '') +
        exec_KVRow('รายการหลัก', form.mainItems || '');

    let notesBlock = '';
    if ((form.notes || '').trim()) {
        notesBlock =
            spacer(14) +
            exec_SectionLabel('หมายเหตุ') +
            exec_NotesBlock(form.notes);
    }

    return '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;font-family:' + _PSEC_FF + ';">' +
      '<tr><td style="padding:0;">' +
        exec_Hero(overline, headline, subline) +
        spacer(14) +
        pgraph('Dear All,', 6) +
        pgraph('รบกวนตรวจเช็คเพื่อ <b><span style="color:' + _PSEC_BRAND + ';">Approve Configuration</span></b> สำหรับ' + he(verb) + he(submitSuffix), 12) +
        '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;border-top:1px solid ' + _PSEC_CONS_DIVIDER + ';">' + _PSEC_EXEC_TOP_SPACER_ROW + rows + '</table>' +
        notesBlock +
        spacer(14) +
        hairline(_PSEC_CONS_DIVIDER, 0, 0) +
        spacer(10) +
        pgraph(he(resolveClosing(tplId, form)), 0) +
      '</td></tr>' +
    '</table>';
}

/** @param {Record<string, any>} form */
function exec_Order(form) {
    const items = (form.localItems || []).filter(/** @param {any} it */ (it) => it && (it.name || it.qty || it.remark));
    const overline = 'SCIED · PURCHASE ORDER · ฝ่ายจัดซื้อ';
    const headline = form.eqList || 'PURCHASE ORDER';
    const subline = [form.agency || '', form.orderDate ? 'ใบสั่งซื้อ ' + form.orderDate : '', form.expireDate ? 'หมดสัญญา ' + form.expireDate : '']
        .filter(Boolean).join('  ·  ') || '—';

    const headRows =
        (form.eqList ? exec_KVRow('เลขที่ใบเสนอราคา', form.eqList) : '') +
        (form.mainItemsOversea ? exec_KVRow('รายการหลัก (Oversea)', form.mainItemsOversea) : '') +
        (form.agency ? exec_KVRow('หน่วยงาน', form.agency) : '') +
        (form.orderDate ? exec_KVRow('ใบสั่งซื้อวันที่', form.orderDate) : '') +
        (form.expireDate ? exec_KVRow('หมดสัญญาวันที่', form.expireDate) : '');

    const headBlock = headRows
        ? '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;border-top:1px solid ' + _PSEC_CONS_DIVIDER + ';">' + _PSEC_EXEC_TOP_SPACER_ROW + headRows + '</table>'
        : '';

    let itemsBlock = '';
    if (items.length > 0) {
        const cellPZero = 'margin:0;mso-margin-top-alt:0;mso-margin-bottom-alt:0;mso-line-height-rule:exactly;';
        const headerTd = 'background:#f3f5f8;background-color:#f3f5f8;border-top:1pt solid #1f2937;border-bottom:1pt solid #1f2937;padding:7pt 8pt;';
        const headerP = '<p style="' + cellPZero + 'font-family:' + _PSEC_CONS_MONO + ';font-size:9pt;font-weight:bold;color:#1f2937;line-height:1.3;';
        const wrapCss = 'word-wrap:break-word;word-break:break-all;overflow-wrap:break-word;';
        const rows = items.map(/** @param {any} it @param {number} i */ (it, i) => {
            return '<tr>' +
                '<td style="border-bottom:1px solid ' + _PSEC_CONS_DIVIDER + ';padding:6pt 8pt;text-align:center;vertical-align:top;' + wrapCss + '">' +
                  '<p style="' + cellPZero + 'font-family:' + _PSEC_CONS_MONO + ';font-size:10pt;color:' + _PSEC_DIM + ';line-height:1.3;text-align:center;">' + (i + 1) + '</p>' +
                '</td>' +
                '<td style="border-bottom:1px solid ' + _PSEC_CONS_DIVIDER + ';padding:6pt 8pt;vertical-align:top;' + wrapCss + '">' +
                  '<p style="' + cellPZero + 'font-family:' + _PSEC_FF + ';font-size:11pt;color:' + _PSEC_TEXT + ';line-height:1.35;' + wrapCss + '">' + he(it.name || '') + '</p>' +
                '</td>' +
                '<td style="border-bottom:1px solid ' + _PSEC_CONS_DIVIDER + ';padding:6pt 8pt;text-align:center;vertical-align:top;' + wrapCss + '">' +
                  '<p style="' + cellPZero + 'font-family:' + _PSEC_CONS_MONO + ';font-size:11pt;color:' + _PSEC_TEXT + ';font-weight:bold;line-height:1.35;text-align:center;">' + he(it.qty || '') + '</p>' +
                '</td>' +
                '<td style="border-bottom:1px solid ' + _PSEC_CONS_DIVIDER + ';padding:6pt 8pt;vertical-align:top;' + wrapCss + '">' +
                  '<p style="' + cellPZero + 'font-family:' + _PSEC_FF + ';font-size:10.5pt;color:' + _PSEC_TEXT + ';line-height:1.4;' + wrapCss + '">' + fmtRemark(it.remark || '') + '</p>' +
                '</td>' +
            '</tr>';
        }).join('');
        itemsBlock =
            spacer(14) +
            exec_SectionLabel('รายการสินค้า LOCAL') +
            '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;table-layout:fixed;border-collapse:collapse;">' +
              '<tr>' +
                '<th bgcolor="#f3f5f8" align="center" width="7%" style="' + headerTd + 'text-align:center;width:7%;">' + headerP + 'text-align:center;">#</p></th>' +
                '<th bgcolor="#f3f5f8" align="left" width="33%" style="' + headerTd + 'text-align:left;width:33%;">' + headerP + '">ITEM</p></th>' +
                '<th bgcolor="#f3f5f8" align="center" width="10%" style="' + headerTd + 'text-align:center;width:10%;">' + headerP + 'text-align:center;">QTY</p></th>' +
                '<th bgcolor="#f3f5f8" align="left" width="50%" style="' + headerTd + 'text-align:left;width:50%;">' + headerP + '">REMARK / LINK</p></th>' +
              '</tr>' +
              rows +
            '</table>' +
            spacer(6) +
            '<p style="margin:0;font-family:' + _PSEC_FF + ';font-size:9.5pt;color:' + _PSEC_DIM + ';font-style:italic;line-height:1.4;">** Link ของสินค้าที่แนบมาอาจไม่ใช่ราคาที่ต่ำที่สุด หากมีผู้จัดจำหน่ายรายอื่นที่ราคาต่ำกว่าให้ซื้อผู้จัดจำหน่ายรายนั้น</p>';
    }

    let notesBlock = '';
    if ((form.notes || '').trim()) {
        notesBlock =
            spacer(12) +
            exec_SectionLabel('หมายเหตุ') +
            exec_NotesBlock(form.notes);
    }

    return '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;font-family:' + _PSEC_FF + ';">' +
      '<tr><td style="padding:0;">' +
        exec_Hero(overline, headline, subline) +
        spacer(14) +
        pgraph('เรียน ฝ่ายจัดซื้อ', 4) +
        pgraph('รบกวนสั่งของตามรายละเอียดดังนี้', 10) +
        headBlock +
        notesBlock +
        itemsBlock +
        spacer(12) +
        hairline(_PSEC_CONS_DIVIDER, 0, 0) +
        spacer(10) +
        pgraph(he(resolveClosing('order', form)), 0) +
      '</td></tr>' +
    '</table>';
}

// ══════════════════════════════════════════════════════════════════════
//  STYLE B — Branded Banner
// ══════════════════════════════════════════════════════════════════════

/** @param {string} overline @param {string} headline @param {string} subline */
function banner_BuildBanner(overline, headline, subline) {
    const pBase = 'mso-margin-top-alt:0;mso-line-height-rule:exactly;font-family:' + _PSEC_FF + ';';
    return '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;background-color:' + _PSEC_BRAND + ';">' +
        '<tr><td bgcolor="' + _PSEC_BRAND + '" align="left" style="background:' + _PSEC_BRAND + ';background-color:' + _PSEC_BRAND + ';padding:14pt 18pt 14pt 18pt;">' +
          '<p style="margin:0 0 4pt 0;mso-margin-bottom-alt:4pt;' + pBase + 'font-size:8.5pt;font-weight:bold;color:' + _PSEC_BRAND_LT + ';line-height:1.2;">' + he(overline) + '</p>' +
          '<p style="margin:0 0 4pt 0;mso-margin-bottom-alt:4pt;' + pBase + 'font-size:14pt;font-weight:bold;color:#ffffff;line-height:1.2;">' + he(headline) + '</p>' +
          '<p style="margin:0;mso-margin-bottom-alt:0;' + pBase + 'font-size:10pt;color:' + _PSEC_BRAND_LT + ';line-height:1.3;">' + he(subline) + '</p>' +
        '</td></tr>' +
      '</table>';
}

/** @param {string} label @param {string} value */
function banner_KVRow(label, value) {
    const pZero = 'margin:0;mso-margin-top-alt:0;mso-margin-bottom-alt:0;mso-line-height-rule:exactly;';
    return '<tr>' +
        '<td style="padding:6pt 14pt 6pt 0;width:130pt;vertical-align:top;border-bottom:1px solid ' + _PSEC_BORDER + ';">' +
          '<p style="' + pZero + 'font-family:' + _PSEC_FF + ';font-size:9.5pt;color:#4b5563;font-weight:bold;line-height:1.4;">' + he(label) + '</p>' +
        '</td>' +
        '<td style="padding:6pt 0;vertical-align:top;border-bottom:1px solid ' + _PSEC_BORDER + ';">' +
          '<p style="' + pZero + 'font-family:' + _PSEC_FF + ';font-size:11pt;color:' + _PSEC_TEXT + ';font-weight:600;line-height:1.4;">' + he(value || '—') + '</p>' +
        '</td>' +
    '</tr>';
}

/** @param {string} text */
function banner_SectionLabel(text) {
    return '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;margin:0 0 8pt 0;">' +
      '<tr>' +
        '<td bgcolor="' + _PSEC_BRAND + '" style="width:3pt;background:' + _PSEC_BRAND + ';background-color:' + _PSEC_BRAND + ';line-height:1pt;font-size:1pt;">&nbsp;</td>' +
        '<td style="padding:0 0 0 8pt;vertical-align:middle;">' +
          '<p style="margin:0;mso-margin-top-alt:0;mso-margin-bottom-alt:0;mso-line-height-rule:exactly;font-family:' + _PSEC_FF + ';font-size:11pt;font-weight:bold;color:' + _PSEC_BRAND + ';line-height:1.3;">' + he(text) + '</p>' +
        '</td>' +
      '</tr>' +
    '</table>';
}

/** @param {string} raw */
function banner_NotesBlock(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) return '';
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return '';
    const pZero = 'margin:0;mso-margin-top-alt:0;mso-margin-bottom-alt:0;mso-line-height-rule:exactly;';
    if (lines.length === 1) {
        return '<p style="' + pZero + 'font-family:' + _PSEC_FF + ';font-size:11pt;color:' + _PSEC_TEXT + ';line-height:1.5;">' + he(lines[0]) + '</p>';
    }
    const rows = lines.map((l, i) => {
        const padBottom = (i === lines.length - 1) ? 0 : 5;
        return '<tr>' +
            '<td style="padding:0 8pt ' + padBottom + 'pt 0;width:24pt;vertical-align:top;">' +
              '<p style="' + pZero + 'font-family:' + _PSEC_FF + ';font-size:11pt;font-weight:bold;color:' + _PSEC_BRAND + ';line-height:1.5;text-align:right;">' + (i + 1) + '.</p>' +
            '</td>' +
            '<td style="padding:0 0 ' + padBottom + 'pt 0;vertical-align:top;">' +
              '<p style="' + pZero + 'font-family:' + _PSEC_FF + ';font-size:11pt;color:' + _PSEC_TEXT + ';line-height:1.5;word-wrap:break-word;overflow-wrap:break-word;">' + he(l) + '</p>' +
            '</td>' +
        '</tr>';
    }).join('');
    return '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">' + rows + '</table>';
}

const _PSEC_BANNER_TOP_SPACER_ROW = '<tr><td colspan="2" style="padding:0;height:4pt;line-height:4pt;font-size:1pt;border:0;">&nbsp;</td></tr>';

/** @param {string} tplId @param {Record<string, any>} form */
function banner_Approve(tplId, form) {
    const isBid = tplId === 'approve-bid';
    const verb = approveVerb(tplId);
    const overline = 'SCIED · APPROVE CONFIGURATION · ' + verb;
    const headline = form.eqList || verb;
    const submitInfo = isBid && (form.submitDate || form.submitTime)
        ? 'กำหนดยื่น ' + (form.submitDate || '') + (form.submitTime ? ' (' + form.submitTime + ')' : '')
        : '';
    const subline = (form.agency || '—') + (submitInfo ? ' · ' + submitInfo : '');

    const rows =
        banner_KVRow('หน่วยงาน', form.agency || '') +
        banner_KVRow('EQ List', form.eqList || '') +
        banner_KVRow('รายการสินค้าหลัก', form.mainItems || '');

    let notesBlock = '';
    if ((form.notes || '').trim()) {
        notesBlock =
            spacer(14) +
            banner_SectionLabel('หมายเหตุ') +
            banner_NotesBlock(form.notes);
    }

    return '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;font-family:' + _PSEC_FF + ';">' +
      '<tr><td style="padding:0;">' +
        banner_BuildBanner(overline, headline, subline) +
        spacer(12) +
        pgraph('Dear All,', 6) +
        pgraph('รบกวนตรวจเช็คเพื่อ Approve Configuration สำหรับ' + he(verb), 12) +
        '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;border-top:1px solid ' + _PSEC_BORDER + ';">' + _PSEC_BANNER_TOP_SPACER_ROW + rows + '</table>' +
        notesBlock +
        spacer(14) +
        hairline(_PSEC_BORDER, 0, 0) +
        spacer(10) +
        pgraph(he(resolveClosing(tplId, form)), 0) +
      '</td></tr>' +
    '</table>';
}

/** @param {Record<string, any>} form */
function banner_Order(form) {
    const items = (form.localItems || []).filter(/** @param {any} it */ (it) => it && (it.name || it.qty || it.remark));
    const overline = 'SCIED · ORDER REQUEST · ฝ่ายจัดซื้อ';
    const headline = form.eqList || 'Purchase Order';
    const subline = [form.agency || '', form.orderDate ? 'ใบสั่งซื้อ ' + form.orderDate : '', form.expireDate ? 'หมดสัญญา ' + form.expireDate : '']
        .filter(Boolean).join(' · ') || '—';

    const headRows =
        (form.eqList ? banner_KVRow('เลขที่ใบเสนอราคา', form.eqList) : '') +
        (form.mainItemsOversea ? banner_KVRow('รายการหลัก (Oversea)', form.mainItemsOversea) : '') +
        (form.agency ? banner_KVRow('หน่วยงาน', form.agency) : '') +
        (form.orderDate ? banner_KVRow('ใบสั่งซื้อวันที่', form.orderDate) : '') +
        (form.expireDate ? banner_KVRow('หมดสัญญาวันที่', form.expireDate) : '');

    const headBlock = headRows
        ? '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;border-top:1px solid ' + _PSEC_BORDER + ';">' + _PSEC_BANNER_TOP_SPACER_ROW + headRows + '</table>'
        : '';

    let itemsBlock = '';
    if (items.length > 0) {
        const cellPZero = 'margin:0;mso-margin-top-alt:0;mso-margin-bottom-alt:0;mso-line-height-rule:exactly;';
        const wrapCss = 'word-wrap:break-word;word-break:break-all;overflow-wrap:break-word;';
        const rows = items.map(/** @param {any} it @param {number} i */ (it, i) => {
            return '<tr>' +
                '<td style="border-bottom:1px solid ' + _PSEC_BORDER + ';padding:5pt 8pt;text-align:center;vertical-align:top;' + wrapCss + '">' +
                  '<p style="' + cellPZero + 'font-family:' + _PSEC_FF + ';font-size:10.5pt;color:' + _PSEC_DIM + ';line-height:1.4;text-align:center;">' + (i + 1) + '</p>' +
                '</td>' +
                '<td style="border-bottom:1px solid ' + _PSEC_BORDER + ';padding:5pt 8pt;vertical-align:top;' + wrapCss + '">' +
                  '<p style="' + cellPZero + 'font-family:' + _PSEC_FF + ';font-size:11pt;color:' + _PSEC_TEXT + ';line-height:1.4;' + wrapCss + '">' + he(it.name || '') + '</p>' +
                '</td>' +
                '<td style="border-bottom:1px solid ' + _PSEC_BORDER + ';padding:5pt 8pt;text-align:center;vertical-align:top;' + wrapCss + '">' +
                  '<p style="' + cellPZero + 'font-family:' + _PSEC_FF + ';font-size:11pt;color:' + _PSEC_TEXT + ';font-weight:600;line-height:1.4;text-align:center;">' + he(it.qty || '') + '</p>' +
                '</td>' +
                '<td style="border-bottom:1px solid ' + _PSEC_BORDER + ';padding:5pt 8pt;vertical-align:top;' + wrapCss + '">' +
                  '<p style="' + cellPZero + 'font-family:' + _PSEC_FF + ';font-size:10.5pt;color:' + _PSEC_TEXT + ';line-height:1.4;' + wrapCss + '">' + fmtRemark(it.remark || '') + '</p>' +
                '</td>' +
            '</tr>';
        }).join('');
        const headerTd = 'background:' + _PSEC_BRAND + ';background-color:' + _PSEC_BRAND + ';padding:6pt 8pt;';
        const headerP = '<p style="' + cellPZero + 'font-family:' + _PSEC_FF + ';font-size:10pt;font-weight:bold;color:#ffffff;line-height:1.3;';
        itemsBlock =
            banner_SectionLabel('รายการสินค้า LOCAL') +
            '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;table-layout:fixed;border-collapse:collapse;">' +
              '<tr>' +
                '<th bgcolor="' + _PSEC_BRAND + '" align="center" width="7%" style="' + headerTd + 'text-align:center;width:7%;">' + headerP + 'text-align:center;">#</p></th>' +
                '<th bgcolor="' + _PSEC_BRAND + '" align="left" width="33%" style="' + headerTd + 'text-align:left;width:33%;">' + headerP + '">Item</p></th>' +
                '<th bgcolor="' + _PSEC_BRAND + '" align="center" width="10%" style="' + headerTd + 'text-align:center;width:10%;">' + headerP + 'text-align:center;">Qty</p></th>' +
                '<th bgcolor="' + _PSEC_BRAND + '" align="left" width="50%" style="' + headerTd + 'text-align:left;width:50%;">' + headerP + '">Remark / Link</p></th>' +
              '</tr>' +
              rows +
            '</table>' +
            spacer(6) +
            '<p style="margin:0;font-family:' + _PSEC_FF + ';font-size:9.5pt;color:' + _PSEC_DIM + ';font-style:italic;line-height:1.4;">** Link ของสินค้าที่แนบมาอาจไม่ใช่ราคาที่ต่ำที่สุด หากมีผู้จัดจำหน่ายรายอื่นที่ราคาต่ำกว่าให้ซื้อผู้จัดจำหน่ายรายนั้น</p>';
    }

    let notesBlock = '';
    if ((form.notes || '').trim()) {
        notesBlock =
            spacer(12) +
            banner_SectionLabel('หมายเหตุ') +
            banner_NotesBlock(form.notes);
    }

    return '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;font-family:' + _PSEC_FF + ';">' +
      '<tr><td style="padding:0;">' +
        banner_BuildBanner(overline, headline, subline) +
        spacer(12) +
        pgraph('เรียน ฝ่ายจัดซื้อ', 4) +
        pgraph('รบกวนสั่งของตามรายละเอียดดังนี้', 10) +
        headBlock +
        (headBlock ? spacer(12) : '') +
        notesBlock +
        itemsBlock +
        spacer(12) +
        hairline(_PSEC_BORDER, 0, 0) +
        spacer(10) +
        pgraph(he(resolveClosing('order', form)), 0) +
      '</td></tr>' +
    '</table>';
}

// ══════════════════════════════════════════════════════════════════════
//  STYLE C — Spec (Editorial) — brand stripe + bold ID + heavy black rules
// ══════════════════════════════════════════════════════════════════════

function edit_TopStripe() {
    return '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;">' +
      '<tr><td bgcolor="' + _PSEC_BRAND + '" style="height:4pt;line-height:1pt;font-size:1pt;background:' + _PSEC_BRAND + ';background-color:' + _PSEC_BRAND + ';">&nbsp;</td></tr>' +
    '</table>';
}

/** @param {string} overline @param {string} heading @param {string} subtitle */
function edit_Header(overline, heading, subtitle) {
    const pBase = 'mso-margin-top-alt:0;mso-line-height-rule:exactly;font-family:' + _PSEC_FF + ';';
    return edit_TopStripe() +
        spacer(14) +
        '<p style="margin:0 0 8pt 0;mso-margin-bottom-alt:8pt;' + pBase + 'font-size:9pt;font-weight:bold;color:' + _PSEC_BRAND + ';line-height:1.3;text-transform:uppercase;">' + he(overline) + '</p>' +
        '<p style="margin:0 0 6pt 0;mso-margin-bottom-alt:6pt;' + pBase + 'font-size:22pt;font-weight:bold;color:#000000;line-height:1.1;">' + he(heading) + '</p>' +
        (subtitle ? '<p style="margin:0;mso-margin-bottom-alt:0;' + pBase + 'font-size:10pt;color:#4b5563;line-height:1.4;">' + he(subtitle) + '</p>' : '') +
        spacer(14) +
        hairline('#000000', 0, 0) +
        spacer(12);
}

/** @param {string} text */
function edit_SectionLabel(text) {
    const bracket = '<span style="font-family:' + _PSEC_CONS_MONO + ';color:#9ca3af;font-weight:normal;">';
    return '<p style="margin:0 0 8pt 0;mso-margin-top-alt:0;mso-line-height-rule:exactly;font-family:' + _PSEC_FF + ';font-size:9pt;font-weight:bold;color:#000000;line-height:1.3;text-transform:uppercase;">' +
      bracket + '[&nbsp;</span>' + he(text) + bracket + '&nbsp;]</span>' +
    '</p>';
}

/** @param {string} label @param {string} value */
function edit_KVRow(label, value) {
    const pZero = 'margin:0;mso-margin-top-alt:0;mso-margin-bottom-alt:0;mso-line-height-rule:exactly;';
    return '<tr>' +
        '<td style="padding:6pt 14pt 6pt 0;width:140pt;vertical-align:top;border-bottom:1px solid #d1d5db;">' +
          '<p style="' + pZero + 'font-family:' + _PSEC_FF + ';font-size:9.5pt;color:#4b5563;font-weight:bold;line-height:1.4;text-transform:uppercase;">' + he(label) + '</p>' +
        '</td>' +
        '<td style="padding:6pt 0;vertical-align:top;border-bottom:1px solid #d1d5db;">' +
          '<p style="' + pZero + 'font-family:' + _PSEC_FF + ';font-size:11pt;color:#000000;font-weight:600;line-height:1.4;">' + he(value || '—') + '</p>' +
        '</td>' +
    '</tr>';
}

/** @param {string} raw */
function edit_NotesBlock(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) return '';
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return '';
    const pZero = 'margin:0;mso-margin-top-alt:0;mso-margin-bottom-alt:0;mso-line-height-rule:exactly;';
    if (lines.length === 1) {
        return '<p style="' + pZero + 'font-family:' + _PSEC_FF + ';font-size:11pt;color:#000000;line-height:1.5;">' + he(lines[0]) + '</p>';
    }
    const rows = lines.map((l, i) => {
        const padBottom = (i === lines.length - 1) ? 0 : 5;
        return '<tr>' +
            '<td style="padding:0 8pt ' + padBottom + 'pt 0;width:24pt;vertical-align:top;">' +
              '<p style="' + pZero + 'font-family:' + _PSEC_FF + ';font-size:11pt;font-weight:bold;color:#000000;line-height:1.5;text-align:right;">' + (i + 1) + '.</p>' +
            '</td>' +
            '<td style="padding:0 0 ' + padBottom + 'pt 0;vertical-align:top;">' +
              '<p style="' + pZero + 'font-family:' + _PSEC_FF + ';font-size:11pt;color:#000000;line-height:1.5;word-wrap:break-word;overflow-wrap:break-word;">' + he(l) + '</p>' +
            '</td>' +
        '</tr>';
    }).join('');
    return '<table cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">' + rows + '</table>';
}

const _PSEC_EDIT_TOP_SPACER_ROW = '<tr><td colspan="2" style="padding:0;height:4pt;line-height:4pt;font-size:1pt;border:0;">&nbsp;</td></tr>';

/** @param {string} tplId @param {Record<string, any>} form */
function edit_Approve(tplId, form) {
    const isBid = tplId === 'approve-bid';
    const verb = approveVerb(tplId);
    const overline = 'SCIED · APPROVE CONFIGURATION · ' + verb;
    const heading = form.eqList || verb;
    const submitInfo = isBid && (form.submitDate || form.submitTime)
        ? 'กำหนดยื่น ' + (form.submitDate || '') + (form.submitTime ? '  ·  ' + form.submitTime : '')
        : '';
    const subtitle = [form.agency || '', submitInfo].filter(Boolean).join('  ·  ') || '—';

    const rows =
        edit_KVRow('หน่วยงาน', form.agency || '') +
        edit_KVRow('EQ LIST', form.eqList || '') +
        edit_KVRow('รายการสินค้าหลัก', form.mainItems || '');

    let notesBlock = '';
    if ((form.notes || '').trim()) {
        notesBlock =
            spacer(14) +
            edit_SectionLabel('หมายเหตุ') +
            edit_NotesBlock(form.notes);
    }

    return '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;font-family:' + _PSEC_FF + ';">' +
      '<tr><td style="padding:0;">' +
        edit_Header(overline, heading, subtitle) +
        pgraph('Dear All,', 6) +
        pgraph('รบกวนตรวจเช็คเพื่อ Approve Configuration สำหรับ' + he(verb), 12) +
        '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;border-top:1px solid #d1d5db;">' + _PSEC_EDIT_TOP_SPACER_ROW + rows + '</table>' +
        notesBlock +
        spacer(14) +
        hairline('#d1d5db', 0, 0) +
        spacer(10) +
        pgraph(he(resolveClosing(tplId, form)), 0) +
      '</td></tr>' +
    '</table>';
}

/** @param {Record<string, any>} form */
function edit_Order(form) {
    const items = (form.localItems || []).filter(/** @param {any} it */ (it) => it && (it.name || it.qty || it.remark));
    const overline = 'SCIED · PURCHASE ORDER · ฝ่ายจัดซื้อ';
    const heading = form.eqList || 'PURCHASE ORDER';
    const subtitle = [form.agency || '', form.orderDate ? 'ใบสั่งซื้อ ' + form.orderDate : '', form.expireDate ? 'หมดสัญญา ' + form.expireDate : '']
        .filter(Boolean).join('  ·  ') || '—';

    const headRows =
        (form.eqList ? edit_KVRow('เลขที่ใบเสนอราคา', form.eqList) : '') +
        (form.mainItemsOversea ? edit_KVRow('รายการหลัก (Oversea)', form.mainItemsOversea) : '') +
        (form.agency ? edit_KVRow('หน่วยงาน', form.agency) : '') +
        (form.orderDate ? edit_KVRow('ใบสั่งซื้อวันที่', form.orderDate) : '') +
        (form.expireDate ? edit_KVRow('หมดสัญญาวันที่', form.expireDate) : '');

    const headBlock = headRows
        ? '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;border-top:1px solid #d1d5db;">' + _PSEC_EDIT_TOP_SPACER_ROW + headRows + '</table>'
        : '';

    let itemsBlock = '';
    if (items.length > 0) {
        const cellPZero = 'margin:0;mso-margin-top-alt:0;mso-margin-bottom-alt:0;mso-line-height-rule:exactly;';
        const wrapCss = 'word-wrap:break-word;word-break:break-all;overflow-wrap:break-word;';
        const headerTd = 'border-top:2pt solid #000000;border-bottom:1pt solid #000000;padding:7pt 8pt;';
        const headerP = '<p style="' + cellPZero + 'font-family:' + _PSEC_FF + ';font-size:9.5pt;font-weight:bold;color:#000000;line-height:1.3;text-transform:uppercase;';
        const rows = items.map(/** @param {any} it @param {number} i */ (it, i) => {
            return '<tr>' +
                '<td style="border-bottom:1px solid #d1d5db;padding:6pt 8pt;text-align:center;vertical-align:top;' + wrapCss + '">' +
                  '<p style="' + cellPZero + 'font-family:' + _PSEC_FF + ';font-size:10.5pt;color:#4b5563;font-weight:bold;line-height:1.3;text-align:center;">' + (i + 1) + '</p>' +
                '</td>' +
                '<td style="border-bottom:1px solid #d1d5db;padding:6pt 8pt;vertical-align:top;' + wrapCss + '">' +
                  '<p style="' + cellPZero + 'font-family:' + _PSEC_FF + ';font-size:11pt;color:#000000;line-height:1.35;' + wrapCss + '">' + he(it.name || '') + '</p>' +
                '</td>' +
                '<td style="border-bottom:1px solid #d1d5db;padding:6pt 8pt;text-align:center;vertical-align:top;' + wrapCss + '">' +
                  '<p style="' + cellPZero + 'font-family:' + _PSEC_FF + ';font-size:11pt;color:#000000;font-weight:bold;line-height:1.35;text-align:center;">' + he(it.qty || '') + '</p>' +
                '</td>' +
                '<td style="border-bottom:1px solid #d1d5db;padding:6pt 8pt;vertical-align:top;' + wrapCss + '">' +
                  '<p style="' + cellPZero + 'font-family:' + _PSEC_FF + ';font-size:10.5pt;color:#000000;line-height:1.4;' + wrapCss + '">' + fmtRemark(it.remark || '') + '</p>' +
                '</td>' +
            '</tr>';
        }).join('');
        itemsBlock =
            spacer(14) +
            edit_SectionLabel('รายการสินค้า LOCAL') +
            '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;table-layout:fixed;border-collapse:collapse;">' +
              '<tr>' +
                '<th width="7%" style="' + headerTd + 'text-align:center;width:7%;">' + headerP + 'text-align:center;">#</p></th>' +
                '<th width="33%" style="' + headerTd + 'text-align:left;width:33%;">' + headerP + '">ITEM</p></th>' +
                '<th width="10%" style="' + headerTd + 'text-align:center;width:10%;">' + headerP + 'text-align:center;">QTY</p></th>' +
                '<th width="50%" style="' + headerTd + 'text-align:left;width:50%;">' + headerP + '">REMARK / LINK</p></th>' +
              '</tr>' +
              rows +
            '</table>' +
            spacer(6) +
            '<p style="margin:0;font-family:' + _PSEC_FF + ';font-size:9.5pt;color:#4b5563;font-style:italic;line-height:1.4;">** Link ของสินค้าที่แนบมาอาจไม่ใช่ราคาที่ต่ำที่สุด หากมีผู้จัดจำหน่ายรายอื่นที่ราคาต่ำกว่าให้ซื้อผู้จัดจำหน่ายรายนั้น</p>';
    }

    let notesBlock = '';
    if ((form.notes || '').trim()) {
        notesBlock =
            spacer(12) +
            edit_SectionLabel('หมายเหตุ') +
            edit_NotesBlock(form.notes);
    }

    return '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;font-family:' + _PSEC_FF + ';">' +
      '<tr><td style="padding:0;">' +
        edit_Header(overline, heading, subtitle) +
        pgraph('เรียน ฝ่ายจัดซื้อ', 4) +
        pgraph('รบกวนสั่งของตามรายละเอียดดังนี้', 10) +
        headBlock +
        notesBlock +
        itemsBlock +
        spacer(12) +
        hairline('#d1d5db', 0, 0) +
        spacer(10) +
        pgraph(he(resolveClosing('order', form)), 0) +
      '</td></tr>' +
    '</table>';
}

// ══════════════════════════════════════════════════════════════════════
//  QUOTATION (customer-facing) — body shared across all 3 styles
// ══════════════════════════════════════════════════════════════════════

function todayBE() {
    const months = ['มกราคม','กุมภาพันธ์','มีนาคม','เมษายน','พฤษภาคม','มิถุนายน','กรกฎาคม','สิงหาคม','กันยายน','ตุลาคม','พฤศจิกายน','ธันวาคม'];
    const d = new Date();
    return d.getDate() + ' ' + months[d.getMonth()] + ' ' + (d.getFullYear() + 543);
}

/**
 * Markdown-style: blank line = paragraph break (gap), single newline = line break (tight).
 * @param {string} raw
 */
function quotation_RenderDetails(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) return '';
    const paragraphs = trimmed.split(/\n\s*\n/);
    const html = paragraphs.map((para, i) => {
        const innerLines = para.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
        if (!innerLines.length) return '';
        const inner = innerLines.map(he).join('<br>');
        const mb = (i === paragraphs.length - 1) ? 12 : 6;
        return pgraph(inner, mb);
    }).filter(Boolean).join('');
    return html;
}

/** @param {Record<string, any>} form @param {{ accent?: string }} [opts] */
function quotation_Body(form, opts) {
    opts = opts || {};
    const accent = opts.accent || _PSEC_BRAND;
    const recipient = (form.recipient || '').trim() || '—';
    const cc = (form.cc || '').trim();
    const sm = (form.subjectMatter || '').trim();
    const ccLine = cc
        ? pgraph('<span style="color:' + _PSEC_DIM + ';">สำเนาถึง</span> ' + he(cc), 4)
        : '';
    const intro = 'ทางบริษัทฯ ขอนำส่ง<b><span style="color:' + accent + ';">ใบเสนอราคา</span></b>'
        + (sm ? ' ' + he(sm) : '')
        + ' พร้อมแนบเอกสารประกอบมาเพื่อการพิจารณาครับ';
    const detailsHtml = quotation_RenderDetails(form.details);
    const followup = 'หากมีข้อสงสัย หรือต้องการสอบถามข้อมูลเพิ่มเติม ยินดีให้บริการครับ';
    return pgraph('เรียน ' + he(recipient), cc ? 4 : 12) +
           ccLine +
           (cc ? spacer(8) : '') +
           pgraph(intro, 12) +
           detailsHtml +
           pgraph(followup, 0);
}

/** @param {Record<string, any>} form */
function exec_Quotation(form) {
    const sm = (form.subjectMatter || '').trim();
    const overline = 'SCIED · QUOTATION';
    const headline = 'ใบเสนอราคา';
    const subline = sm || todayBE();
    return '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;font-family:' + _PSEC_FF + ';">' +
      '<tr><td style="padding:0;">' +
        exec_Hero(overline, headline, subline) +
        spacer(14) +
        quotation_Body(form, { accent: _PSEC_BRAND }) +
        spacer(14) +
        hairline(_PSEC_CONS_DIVIDER, 0, 0) +
        spacer(10) +
        pgraph(he(resolveClosing('quotation-customer', form)), 0) +
      '</td></tr>' +
    '</table>';
}

/** @param {Record<string, any>} form */
function banner_Quotation(form) {
    const sm = (form.subjectMatter || '').trim();
    const overline = 'SCIED · QUOTATION';
    const headline = 'ใบเสนอราคา';
    const subline = sm || todayBE();
    return '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;font-family:' + _PSEC_FF + ';">' +
      '<tr><td style="padding:0;">' +
        banner_BuildBanner(overline, headline, subline) +
        spacer(12) +
        quotation_Body(form, { accent: _PSEC_BRAND }) +
        spacer(14) +
        hairline(_PSEC_BORDER, 0, 0) +
        spacer(10) +
        pgraph(he(resolveClosing('quotation-customer', form)), 0) +
      '</td></tr>' +
    '</table>';
}

/** @param {Record<string, any>} form */
function edit_Quotation(form) {
    const sm = (form.subjectMatter || '').trim();
    const overline = 'SCIED · QUOTATION';
    const heading = 'ใบเสนอราคา';
    const subtitle = sm || todayBE();
    return '<table cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border-collapse:collapse;font-family:' + _PSEC_FF + ';">' +
      '<tr><td style="padding:0;">' +
        edit_Header(overline, heading, subtitle) +
        quotation_Body(form, { accent: _PSEC_BRAND }) +
        spacer(14) +
        hairline('#d1d5db', 0, 0) +
        spacer(10) +
        pgraph(he(resolveClosing('quotation-customer', form)), 0) +
      '</td></tr>' +
    '</table>';
}

// ══════════════════════════════════════════════════════════════════════
//  Style registry + dispatchers
// ══════════════════════════════════════════════════════════════════════

/** @type {Record<string, {
 *   buildApprove:   (tplId: string, form: Record<string, any>) => string,
 *   buildOrder:     (form: Record<string, any>) => string,
 *   buildQuotation: (form: Record<string, any>) => string,
 * }>} */
const _PSEC_BUILDERS = {
    exec:      { buildApprove: exec_Approve,   buildOrder: exec_Order,   buildQuotation: exec_Quotation   },
    banner:    { buildApprove: banner_Approve, buildOrder: banner_Order, buildQuotation: banner_Quotation },
    editorial: { buildApprove: edit_Approve,   buildOrder: edit_Order,   buildQuotation: edit_Quotation   },
};

/** @param {string} tplId @param {Record<string, any>} form */
function buildApproveText(tplId, form) {
    const isBid = tplId === 'approve-bid';
    const verb = approveVerb(tplId);
    const submitSuffix = isBid && (form.submitDate || form.submitTime)
        ? ' (กำหนดยื่น ' + (form.submitDate || '') + (form.submitTime ? ' – ' + form.submitTime : '') + ')'
        : '';
    return [
        'Dear All,',
        '',
        'รบกวนตรวจเช็คเพื่อ Approve Configuration สำหรับ' + verb + submitSuffix,
        '',
        'หน่วยงาน: ' + (form.agency || ''),
        'เลขที่ใบเสนอราคา/EQ List: ' + (form.eqList || ''),
        'รายการสินค้าหลัก: ' + (form.mainItems || ''),
        '',
        'หมายเหตุ: ' + notesToText(form.notes),
        '',
        resolveClosing(tplId, form)
    ].join('\n');
}

/** @param {Record<string, any>} form */
function buildOrderText(form) {
    const items = (form.localItems || []).filter(/** @param {any} it */ (it) => it && (it.name || it.qty || it.remark));
    /** @type {string[]} */
    const lines = [
        'เรียน ฝ่ายจัดซื้อ',
        '',
        'รบกวนสั่งของตามรายละเอียดดังนี้',
        '',
        'เลขที่ใบเสนอราคา: ' + (form.eqList || ''),
        'รายการสินค้าหลัก (Oversea): ' + (form.mainItemsOversea || ''),
    ];
    if (form.agency) { lines.push(''); lines.push('หน่วยงาน: ' + form.agency); }
    lines.push('');
    lines.push('ใบสั่งซื้อวันที่: ' + (form.orderDate || ''));
    lines.push('หมดสัญญาวันที่: ' + (form.expireDate || ''));
    lines.push('');
    lines.push('หมายเหตุ: ' + notesToText(form.notes));
    if (items.length) {
        lines.push('');
        lines.push('รายการสินค้า LOCAL:');
        items.forEach(/** @param {any} it @param {number} i */ (it, i) => {
            lines.push((i + 1) + '. ' + (it.name || '') + '  [Qty: ' + (it.qty || '') + ']  ' + (it.remark || ''));
        });
        lines.push('');
        lines.push('** Link ของสินค้าที่แนบมาอาจไม่ใช่ราคาที่ต่ำที่สุด หากมีผู้จัดจำหน่ายรายอื่นที่ราคาต่ำกว่าให้ซื้อผู้จัดจำหน่ายรายนั้น');
    }
    lines.push('');
    lines.push(resolveClosing('order', form));
    return lines.join('\n');
}

/** @param {Record<string, any>} form */
function buildQuotationText(form) {
    /** @type {string[]} */
    const lines = [];
    lines.push('เรียน ' + (form.recipient || ''));
    if ((form.cc || '').trim()) lines.push('สำเนาถึง ' + form.cc);
    lines.push('');
    const sm = (form.subjectMatter || '').trim();
    lines.push('ทางบริษัทฯ ขอนำส่งใบเสนอราคา' + (sm ? ' ' + sm : '') + ' พร้อมแนบเอกสารประกอบมาเพื่อการพิจารณาครับ');
    const det = (form.details || '').trim();
    if (det) {
        lines.push('');
        det.split(/\r?\n/).forEach(/** @param {string} l */ (l) => lines.push(l.replace(/\s+$/, '')));
    }
    lines.push('');
    lines.push('หากมีข้อสงสัย หรือต้องการสอบถามข้อมูลเพิ่มเติม ยินดีให้บริการครับ');
    lines.push('');
    lines.push(resolveClosing('quotation-customer', form));
    return lines.join('\n');
}

/** @param {string} tplId @param {Record<string, any>} form */
export function buildSubject(tplId, form) {
    if (tplId === 'order') return ''; // user uses Outlook FW: prefix
    if (tplId === 'quotation-customer') {
        const sm = (form.subjectMatter || '').trim();
        return sm ? 'ใบเสนอราคา / ' + sm : 'ใบเสนอราคา';
    }
    const eq = form.eqList || '';
    const items = form.mainItems || '';
    const verb = approveVerb(tplId);
    return 'Approve Configuration (' + verb + ') ' + eq + (items ? ' / ' + items : '');
}

/** @param {string} tplId @param {Record<string, any>} form */
export function buildBodyText(tplId, form) {
    if (tplId === 'order') return buildOrderText(form);
    if (tplId === 'quotation-customer') return buildQuotationText(form);
    return buildApproveText(tplId, form);
}

/**
 * Build the Outlook-fidelity HTML email — dispatches via active style + template.
 * @param {string} tplId
 * @param {string} styleId
 * @param {Record<string, any>} form
 */
function buildEmailHtml(tplId, styleId, form) {
    const style = _PSEC_BUILDERS[styleId] || _PSEC_BUILDERS.exec;
    /** @type {string} */
    let body;
    if (tplId === 'order')                    body = style.buildOrder(form);
    else if (tplId === 'quotation-customer')  body = style.buildQuotation(form);
    else                                      body = style.buildApprove(tplId, form);
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
            return `<label>${he(def.label)} <span style="text-transform:none;font-weight:400;opacity:.7;">(name + qty + remark/link per row)</span></label>` +
                   `<div id="psec-items-list" data-field="localItems"></div>` +
                   `<button type="button" class="act ghost" id="psec-items-add" style="font-size:11px;padding:5px 12px;margin-top:4px;">+ Add row</button>`;
        }
        if (def.type === 'textarea') {
            return `<label for="psec-f-${fname}">${he(def.label)}</label>` +
                   `<textarea id="psec-f-${fname}" data-field="${fname}" rows="3" placeholder="${he(def.placeholder || '')}">${he(form[fname] || '')}</textarea>`;
        }
        return `<label for="psec-f-${fname}">${he(def.label)}</label>` +
               `<input id="psec-f-${fname}" data-field="${fname}" type="text" placeholder="${he(def.placeholder || '')}" value="${he(form[fname] || '')}" />`;
    }).join('');
    renderItems();
}

function renderItems() {
    if (!_psecPanel) return;
    const list = _psecPanel.querySelector('#psec-items-list');
    if (!list) return;
    const form = getForm(_psecActiveTpl);
    /** @type {Array<{ name?: string, qty?: string, remark?: string }>} */
    const items = form.localItems || [];
    if (items.length === 0) {
        list.innerHTML = '<div style="font-size:11px;color:var(--dim, #888);padding:6px 0;">ยังไม่มีรายการ — กด + Add row</div>';
        return;
    }
    list.innerHTML = items.map((it, i) => {
        return `<div class="psec-item-row" data-item-idx="${i}" style="display:grid;grid-template-columns:1fr 60px 1.2fr auto;gap:6px;align-items:center;margin-bottom:6px;">` +
            `<input data-item-key="name"   placeholder="ชื่อสินค้า" value="${he(it.name   || '')}" />` +
            `<input data-item-key="qty"    placeholder="qty"        value="${he(it.qty    || '')}" />` +
            `<input data-item-key="remark" placeholder="remark / [label]url" value="${he(it.remark || '')}" />` +
            `<button type="button" class="act ghost" data-item-del="${i}" style="font-size:10px;padding:4px 8px;color:#f43f5e;border-color:var(--border, #2a2a2a);">×</button>` +
        `</div>`;
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
        // Items: + Add row
        if (t.id === 'psec-items-add') {
            const form = getForm(_psecActiveTpl);
            if (!Array.isArray(form.localItems)) form.localItems = [];
            form.localItems.push({ name: '', qty: '', remark: '' });
            saveState();
            renderItems();
            refreshPreview();
            return;
        }
        // Items: × delete row
        const delBtn = t.closest('[data-item-del]');
        if (delBtn) {
            const idx = parseInt(/** @type {HTMLElement} */ (delBtn).dataset.itemDel || '-1', 10);
            const form = getForm(_psecActiveTpl);
            if (Array.isArray(form.localItems) && idx >= 0 && idx < form.localItems.length) {
                form.localItems.splice(idx, 1);
                saveState();
                renderItems();
                refreshPreview();
            }
            return;
        }
    });

    // Form input — live update form data + refresh preview (handles both
    // top-level fields via [data-field] and items rows via [data-item-key])
    panel.addEventListener('input', (e) => {
        const t = /** @type {HTMLInputElement | HTMLTextAreaElement} */ (e.target);
        // Items row input
        const itemKey = t.dataset && t.dataset.itemKey;
        if (itemKey) {
            const row = t.closest('[data-item-idx]');
            if (!row) return;
            const idx = parseInt(/** @type {HTMLElement} */ (row).dataset.itemIdx || '-1', 10);
            const form = getForm(_psecActiveTpl);
            if (!Array.isArray(form.localItems) || idx < 0 || idx >= form.localItems.length) return;
            form.localItems[idx][itemKey] = t.value;
            saveState();
            refreshPreview();
            return;
        }
        // Top-level field
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
        version:      '0.3-session3o-heavy-port',
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
