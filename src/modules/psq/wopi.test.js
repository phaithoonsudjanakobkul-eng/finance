import { describe, it, expect } from 'vitest';
import {
    COOL_ASSET_HASH,
    trimTrailingSlash,
    buildWopiSrc,
    buildCollaboraViewerUrl,
    parseOrigin,
    isOriginAllowed,
    parseCollaboraMessage,
} from './wopi.js';

describe('trimTrailingSlash', () => {
    it('strips a single trailing slash', () => {
        expect(trimTrailingSlash('https://x.example/')).toBe('https://x.example');
    });

    it('strips multiple trailing slashes', () => {
        expect(trimTrailingSlash('https://x.example///')).toBe('https://x.example');
    });

    it('passes through urls without trailing slash unchanged', () => {
        expect(trimTrailingSlash('https://x.example')).toBe('https://x.example');
    });

    it('returns empty string for non-string input', () => {
        expect(trimTrailingSlash(/** @type {any} */ (null))).toBe('');
        expect(trimTrailingSlash(/** @type {any} */ (undefined))).toBe('');
        expect(trimTrailingSlash(/** @type {any} */ (42))).toBe('');
    });
});

describe('buildWopiSrc', () => {
    it('joins base + /wopi/files/<encoded id>', () => {
        expect(buildWopiSrc('https://wopi.example', 'abc123')).toBe('https://wopi.example/wopi/files/abc123');
    });

    it('strips trailing slash from base', () => {
        expect(buildWopiSrc('https://wopi.example/', 'abc')).toBe('https://wopi.example/wopi/files/abc');
    });

    it('encodes file IDs with reserved characters', () => {
        expect(buildWopiSrc('https://wopi.example', 'a/b+c')).toBe('https://wopi.example/wopi/files/a%2Fb%2Bc');
    });

    it('returns empty string when base is missing', () => {
        expect(buildWopiSrc('', 'abc')).toBe('');
    });

    it('returns empty string when fileId is missing', () => {
        expect(buildWopiSrc('https://wopi.example', '')).toBe('');
    });
});

describe('buildCollaboraViewerUrl', () => {
    const COLLAB = 'https://collabora.example';
    const WOPI_SRC = 'https://wopi.example/wopi/files/abc';
    const TOKEN = 'tok-123';

    it('produces a fully-qualified viewer URL with the cool asset hash', () => {
        const url = buildCollaboraViewerUrl(COLLAB, WOPI_SRC, TOKEN);
        expect(url).toContain(`/browser/${COOL_ASSET_HASH}/cool.html?`);
        expect(url.startsWith(COLLAB)).toBe(true);
    });

    it('encodes WOPISrc + access_token query params', () => {
        const url = buildCollaboraViewerUrl(COLLAB, WOPI_SRC, TOKEN);
        expect(url).toContain('WOPISrc=' + encodeURIComponent(WOPI_SRC));
        expect(url).toContain('access_token=' + TOKEN);
    });

    it('defaults closebutton + revisionhistory to 0 (matches monolith)', () => {
        const url = buildCollaboraViewerUrl(COLLAB, WOPI_SRC, TOKEN);
        expect(url).toContain('closebutton=0');
        expect(url).toContain('revisionhistory=0');
    });

    it('opts.closeButton=true flips closebutton to 1', () => {
        const url = buildCollaboraViewerUrl(COLLAB, WOPI_SRC, TOKEN, { closeButton: true });
        expect(url).toContain('closebutton=1');
    });

    it('opts.revisionHistory=true flips revisionhistory to 1', () => {
        const url = buildCollaboraViewerUrl(COLLAB, WOPI_SRC, TOKEN, { revisionHistory: true });
        expect(url).toContain('revisionhistory=1');
    });

    it('encodes token with reserved characters', () => {
        const url = buildCollaboraViewerUrl(COLLAB, WOPI_SRC, 'tok+with/special');
        expect(url).toContain('access_token=tok%2Bwith%2Fspecial');
    });

    it('returns empty string when any required arg is missing', () => {
        expect(buildCollaboraViewerUrl('', WOPI_SRC, TOKEN)).toBe('');
        expect(buildCollaboraViewerUrl(COLLAB, '', TOKEN)).toBe('');
        expect(buildCollaboraViewerUrl(COLLAB, WOPI_SRC, '')).toBe('');
    });
});

describe('parseOrigin', () => {
    it('extracts scheme + host + port', () => {
        expect(parseOrigin('https://x.example/path?q=1')).toBe('https://x.example');
        expect(parseOrigin('http://x.example:8080/path')).toBe('http://x.example:8080');
    });

    it('returns null for malformed urls', () => {
        expect(parseOrigin('not-a-url')).toBeNull();
        expect(parseOrigin('')).toBeNull();
    });

    it('returns null for non-string input', () => {
        expect(parseOrigin(/** @type {any} */ (null))).toBeNull();
        expect(parseOrigin(/** @type {any} */ (undefined))).toBeNull();
    });
});

describe('isOriginAllowed', () => {
    const EXPECTED = 'https://collabora.example';

    it('returns true when origin matches', () => {
        const ev = { origin: 'https://collabora.example', data: 'hi' };
        expect(isOriginAllowed(ev, EXPECTED)).toBe(true);
    });

    it('returns true even when expectedBase has a trailing slash + path', () => {
        const ev = { origin: 'https://collabora.example', data: 'hi' };
        expect(isOriginAllowed(ev, 'https://collabora.example/browser/abc/cool.html')).toBe(true);
    });

    it('returns false on origin mismatch', () => {
        const ev = { origin: 'https://attacker.example', data: 'hi' };
        expect(isOriginAllowed(ev, EXPECTED)).toBe(false);
    });

    it('returns false when scheme differs', () => {
        const ev = { origin: 'http://collabora.example', data: 'hi' };
        expect(isOriginAllowed(ev, EXPECTED)).toBe(false);
    });

    it('returns false on missing event', () => {
        expect(isOriginAllowed(null, EXPECTED)).toBe(false);
        expect(isOriginAllowed(undefined, EXPECTED)).toBe(false);
    });

    it('returns false on malformed expectedBase (fail closed)', () => {
        const ev = { origin: 'https://x.example', data: 'hi' };
        expect(isOriginAllowed(ev, 'not-a-url')).toBe(false);
    });

    it('returns false when origin is missing on event', () => {
        expect(isOriginAllowed({ data: 'hi' }, EXPECTED)).toBe(false);
    });
});

describe('parseCollaboraMessage', () => {
    it('parses a JSON-string envelope into the typed object', () => {
        const out = parseCollaboraMessage(JSON.stringify({ MessageId: 'App_LoadingStatus', SendTime: 1, Values: { Status: 'ready' } }));
        expect(out).not.toBeNull();
        expect(out?.MessageId).toBe('App_LoadingStatus');
    });

    it('passes a plain object through', () => {
        const obj = { MessageId: 'Doc_ModifiedStatus', Values: { Modified: true } };
        expect(parseCollaboraMessage(obj)).toBe(obj);
    });

    it('returns null for malformed JSON', () => {
        expect(parseCollaboraMessage('{not-json')).toBeNull();
    });

    it('returns null when MessageId is missing', () => {
        expect(parseCollaboraMessage({})).toBeNull();
        expect(parseCollaboraMessage({ Values: {} })).toBeNull();
    });

    it('returns null when MessageId is non-string', () => {
        expect(parseCollaboraMessage({ MessageId: 42 })).toBeNull();
    });

    it('returns null for non-object payloads (number / boolean / null)', () => {
        expect(parseCollaboraMessage(42)).toBeNull();
        expect(parseCollaboraMessage(true)).toBeNull();
        expect(parseCollaboraMessage(null)).toBeNull();
    });

    it('returns null for empty MessageId string', () => {
        expect(parseCollaboraMessage({ MessageId: '' })).toBeNull();
    });
});
