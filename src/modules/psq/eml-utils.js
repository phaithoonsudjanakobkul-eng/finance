// Pure helpers for the PSQ Stage 2 .eml builder. Extracted from
// modules/psq/index.js so they can be unit-tested in isolation.
//
// All functions here are pure — no DOM, no localStorage, no I/O.

/** Convert ArrayBuffer to base64 in 32 KB chunks. Avoids "argument list
 *  too long" that hits when btoa(String.fromCharCode.apply(null, bytes))
 *  is called on >100 KB Uint8Arrays in some Chromium builds.
 *  @param {ArrayBuffer} buf
 *  @returns {string} base64 string (unwrapped) */
export function bufToBase64(buf) {
    const bytes = new Uint8Array(buf);
    let bin = '';
    const CHUNK = 0x8000; // 32 KB
    for (let i = 0; i < bytes.length; i += CHUNK) {
        bin += String.fromCharCode.apply(null, /** @type {any} */ (bytes.subarray(i, i + CHUNK)));
    }
    return btoa(bin);
}

/** Wrap base64 to 76-char lines per RFC 2822/MIME convention.
 *  @param {string} s64
 *  @returns {string} CRLF-separated wrapped base64 */
export function wrapBase64(s64) {
    const out = [];
    for (let i = 0; i < s64.length; i += 76) out.push(s64.slice(i, i + 76));
    return out.join('\r\n');
}

/** RFC 2047 encoded-word for non-ASCII subjects and filenames. ASCII-only
 *  strings pass through unchanged so headers stay human-readable when
 *  there's no Thai content.
 *  @param {string} s
 *  @returns {string} */
export function emlEncodeWord(s) {
    if (!/[^\x20-\x7E]/.test(s)) return s;
    return '=?utf-8?B?' + btoa(unescape(encodeURIComponent(s))) + '?=';
}

/** Best-effort Message-ID. Not strict RFC — a draft .eml dropped into
 *  Outlook usually rewrites this anyway, so timestamp+random is enough
 *  for uniqueness within a session.
 *  @param {string} hostname
 *  @returns {string} */
export function emlMessageId(hostname) {
    const ts = Date.now().toString(36);
    const rnd = Math.random().toString(36).slice(2, 10);
    return `<${ts}.${rnd}@${hostname || 'pslink.local'}>`;
}
