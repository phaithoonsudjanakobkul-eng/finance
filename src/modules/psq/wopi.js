// PSQ Path E (Collabora live xlsx editor) — WOPI URL helpers.
//
// Pure string-building + origin-parsing helpers for the eventual Path E
// integration. Splitting these out now means the URL contract is
// testable BEFORE the iframe-mount UI lands, so the UI port can rely
// on stable inputs instead of redebugging URL construction in a live
// browser.
//
// Reference monolith implementation: index.html ~17703 (PSQ_COLLABORA_BASE
// build) + ~18167 (viewerUrl assembly). Cool build hash `4610258811` is
// pinned upstream of the deployed Collabora image — bumping the deploy
// requires updating COOL_ASSET_HASH below.

/**
 * Static asset-version hash for Collabora's browser entry point.
 * Pinned to whatever the deployed pslink-collabora image ships.
 * Bump in lock-step with `flyctl deploy --remote-only` if the next
 * Collabora release rebuilds the static path.
 */
export const COOL_ASSET_HASH = '4610258811';

/**
 * Strip a single trailing slash off a base URL so callers can pass
 * `https://x.example/` or `https://x.example` interchangeably without
 * accidentally producing `//wopi/files`.
 *
 * @param {string} url
 * @returns {string}
 */
export function trimTrailingSlash(url) {
    if (typeof url !== 'string') return '';
    return url.replace(/\/+$/, '');
}

/**
 * Build the WOPI src URL — the URL Collabora's container fetches the
 * file from. fileId is encoded so user-controlled IDs (e.g. uuid + '+')
 * survive the hop without breaking routing.
 *
 * @param {string} wopiBase
 * @param {string} fileId
 * @returns {string}
 */
export function buildWopiSrc(wopiBase, fileId) {
    const base = trimTrailingSlash(wopiBase);
    if (!base || !fileId) return '';
    return `${base}/wopi/files/${encodeURIComponent(String(fileId))}`;
}

/**
 * Build the Collabora viewer URL. Includes the build-pinned cool.html
 * path + `WOPISrc=`/`access_token=` query params + the two flags the
 * monolith sets verbatim (no close button, no revision sidebar — PSQ
 * runs Collabora as an embedded editor, not a standalone view).
 *
 * @param {string} collaboraBase
 * @param {string} wopiSrc — the URL Collabora reaches the file at
 * @param {string} accessToken
 * @param {{ closeButton?: boolean, revisionHistory?: boolean }} [opts]
 * @returns {string}
 */
export function buildCollaboraViewerUrl(collaboraBase, wopiSrc, accessToken, opts) {
    const base = trimTrailingSlash(collaboraBase);
    if (!base || !wopiSrc || !accessToken) return '';
    const closeBtn = opts && opts.closeButton ? 1 : 0;
    const revHist  = opts && opts.revisionHistory ? 1 : 0;
    const qs = [
        `WOPISrc=${encodeURIComponent(wopiSrc)}`,
        `access_token=${encodeURIComponent(accessToken)}`,
        `closebutton=${closeBtn}`,
        `revisionhistory=${revHist}`,
    ].join('&');
    return `${base}/browser/${COOL_ASSET_HASH}/cool.html?${qs}`;
}

/**
 * Extract the canonical origin (scheme + host + port) of a base URL,
 * for postMessage-event filtering. Returns null on a malformed URL so
 * the caller can fail closed instead of comparing against an empty
 * string and accepting any origin.
 *
 * @param {string} url
 * @returns {string | null}
 */
export function parseOrigin(url) {
    if (typeof url !== 'string' || !url) return null;
    try {
        return new URL(url).origin;
    } catch (_e) {
        return null;
    }
}

/**
 * Validate a postMessage event came from the expected Collabora origin.
 * Returns true ONLY when the event's `origin` exactly equals the parsed
 * origin of `expectedBase`. Mismatched origin / missing data → false so
 * the caller can drop the event silently.
 *
 * @param {{ origin?: string, data?: any } | null | undefined} event
 * @param {string} expectedBase
 * @returns {boolean}
 */
export function isOriginAllowed(event, expectedBase) {
    if (!event || typeof event !== 'object') return false;
    const expected = parseOrigin(expectedBase);
    if (!expected) return false;
    return event.origin === expected;
}

/**
 * Parse a Collabora postMessage payload. Collabora wraps app messages
 * in a JSON envelope `{ MessageId, SendTime, Values }` per the protocol
 * spec. Returns the parsed object on success, or null when the payload
 * is malformed / not a Collabora message (e.g. dev-tools pings).
 *
 * @param {any} data — the raw `event.data`
 * @returns {{ MessageId: string, SendTime?: number, Values?: any } | null}
 */
export function parseCollaboraMessage(data) {
    let obj = data;
    if (typeof data === 'string') {
        try { obj = JSON.parse(data); }
        catch (_e) { return null; }
    }
    if (!obj || typeof obj !== 'object') return null;
    if (typeof obj.MessageId !== 'string' || !obj.MessageId) return null;
    return obj;
}
