// PSF DOCX run helpers — pure functions extracted for tests.
//
// `runContent(text)` builds the inner XML for a `<w:r>` (run) element:
// it emits `<w:t xml:space="preserve">` for text segments and a `<w:tab/>`
// element wherever the source string contains a literal tab character.
// Without xml:space="preserve" Word collapses leading/trailing whitespace,
// so every run carries the directive.
//
// Note: `escapeHtml` is a strict superset of XML escape — it also encodes
// the apostrophe to `&#39;`, which is a valid XML numeric character ref.
// Using one helper across HTML + XML keeps the contract single-sourced.

import { escapeHtml } from '../../core/escape.js';

/**
 * Emit the inner XML of a single Word `<w:r>` run for the given text.
 * Tabs become `<w:tab/>`; text segments become escaped `<w:t>` elements.
 * Returns empty string for empty / null input so callers can append
 * unconditionally.
 *
 * @param {string} text
 * @returns {string}
 */
export function runContent(text) {
    if (!text) return '';
    if (text.indexOf('\t') === -1) {
        return '<w:t xml:space="preserve">' + escapeHtml(text) + '</w:t>';
    }
    return text.split('\t').map((p, i) => {
        const tab = i > 0 ? '<w:tab/>' : '';
        const t = p ? '<w:t xml:space="preserve">' + escapeHtml(p) + '</w:t>' : '';
        return tab + t;
    }).join('');
}
