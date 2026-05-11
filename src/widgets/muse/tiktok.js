// TikTok URL parsing → embed iframe — V10.
//
// Known TikTok URL shapes (all extract the same numeric video ID):
//   https://www.tiktok.com/@user/video/1234567890
//   https://www.tiktok.com/embed/v2/1234567890
//   https://vt.tiktok.com/abc/   ← short link; can't extract ID, must surrender
//   https://m.tiktok.com/v/1234567890.html
//
// Returns null when no ID can be parsed (caller should reject the input).
//
// Per project_muse_tiktok_iframe_limit.md the iframe restarts on tab
// return — that's a platform limit, not something to work around. V10
// ships the embed as-is.

/**
 * @param {string} input — raw URL pasted by the user
 * @returns {string | null}
 */
export function extractTikTokId(input) {
    if (!input || typeof input !== 'string') return null;
    const s = input.trim();
    // /video/<id>
    let m = s.match(/\/video\/(\d{6,})/);
    if (m) return m[1];
    // /embed/v2/<id>
    m = s.match(/\/embed\/v2\/(\d{6,})/);
    if (m) return m[1];
    // /v/<id>.html
    m = s.match(/\/v\/(\d{6,})\.html/);
    if (m) return m[1];
    // bare digits
    m = s.match(/^(\d{8,})$/);
    if (m) return m[1];
    return null;
}

/**
 * @param {string} id @returns {string}
 */
export function embedUrl(id) {
    return `https://www.tiktok.com/embed/v2/${id}`;
}
