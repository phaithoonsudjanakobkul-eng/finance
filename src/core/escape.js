// HTML / attribute escaping — shared so the 4+ tabs that interpolate
// user-controlled strings into innerHTML stop reimplementing the same
// 5-character map in slightly different orders.
//
// `escapeHtml` covers element-text contexts: `& < >` plus the two
// quote characters so the same helper is safe inside `title=""`-style
// attribute fragments too.
//
// `escapeAttr` is a strict alias of `escapeHtml`; kept as a separate
// export so call sites read intention-first ("we're building an
// attribute") at the cost of one extra alias.

const _ESCAPE_MAP = /** @type {Record<string, string>} */ ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
});

/**
 * Escape HTML-significant characters in a string. Tolerant of null /
 * undefined / non-string inputs — coerces to '' so callers don't need
 * defensive `?? ''` everywhere.
 *
 * @param {unknown} s
 * @returns {string}
 */
export function escapeHtml(s) {
    if (s == null) return '';
    return String(s).replace(/[&<>"']/g, (c) => _ESCAPE_MAP[c] || c);
}

/**
 * Escape characters significant inside a double-quoted attribute value.
 * Same character set as escapeHtml today; kept distinct so attribute-
 * specific escaping rules can diverge later (e.g. if we ever need to
 * preserve `<` inside a `srcdoc=""` value).
 *
 * @param {unknown} s
 * @returns {string}
 */
export function escapeAttr(s) {
    return escapeHtml(s);
}
