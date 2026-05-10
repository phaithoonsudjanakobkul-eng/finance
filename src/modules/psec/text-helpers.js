// PSEC text-formatting helpers — pure functions extracted for tests.
//
// `fmtRemark` is the link-aware paragraph formatter:
//   - bare URLs become `<a>คลิกที่นี่</a>`
//   - `[label](url)` or `[label]url` renders the user-chosen label
//   - newlines become `<br>`
//
// `notesToHtml` / `notesToText` produce the auto-numbered "หมายเหตุ"
// list shown in approve emails. Empty input → "-" (Word-friendly dash
// placeholder, prevents the K/V row from collapsing).

import { escapeHtml as he } from '../../core/escape.js';

const LINK_STYLE = 'color:#0066cc;word-break:break-all;overflow-wrap:break-word;';
const DEFAULT_LINK_LABEL = 'คลิกที่นี่';

/**
 * Escape + link-detect a remark paragraph. Slots out custom-labeled
 * markdown-style links first so the bare-URL fallback regex doesn't
 * eat them, then re-inserts them. Always returns escaped HTML — never
 * trust user input downstream.
 *
 * @param {string} s
 * @returns {string}
 */
export function fmtRemark(s) {
    if (s == null) return '';
    let html = he(s);
    /** @type {string[]} */
    const slots = [];
    // [label](url) or [label] url → user-labeled link slot
    html = html.replace(/\[([^\]\n]+)\]\s*\(?\s*(https?:\/\/[^\s)<]+)\s*\)?/g, function(_m, text, url) {
        const i = slots.length;
        slots.push('<a href="' + url + '" style="' + LINK_STYLE + '">' + text + '</a>');
        return 'PSEC' + i + 'LINK';
    });
    // Bare URL → "คลิกที่นี่"
    html = html.replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" style="' + LINK_STYLE + '">' + DEFAULT_LINK_LABEL + '</a>');
    // Restore the labeled-link slots
    html = html.replace(/PSEC(\d+)LINK/g, function(_m, i) { return slots[parseInt(i, 10)]; });
    return html.replace(/\n/g, '<br>');
}

/**
 * Render an auto-numbered HTML list from a multi-line raw string.
 * 0 lines → "-". 1 line → that line escaped (no list chrome).
 * 2+ lines → "<br>1. <line><br>2. <line>…". Mirrors the monolith's
 * approve-email layout where short notes stay inline and longer
 * notes break onto their own list.
 *
 * @param {string} raw
 * @returns {string}
 */
export function notesToHtml(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) return '-';
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) return '-';
    if (lines.length === 1) return he(lines[0]);
    return '<br>' + lines.map((l, i) => (i + 1) + '. ' + he(l)).join('<br>');
}

/**
 * Plain-text twin of notesToHtml — used for the .txt fallback / debug
 * preview. Same numbering rules but no escaping (text context).
 *
 * @param {string} raw
 * @returns {string}
 */
export function notesToText(raw) {
    const trimmed = (raw || '').trim();
    if (!trimmed) return '-';
    const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (lines.length <= 1) return lines[0] || '-';
    return '\n' + lines.map((l, i) => (i + 1) + '. ' + l).join('\n');
}
