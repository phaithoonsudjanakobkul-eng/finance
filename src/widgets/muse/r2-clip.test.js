import { describe, it, expect } from 'vitest';
import { blobShortHash, clipKey } from './r2-clip.js';

describe('blobShortHash', () => {
    it('returns 24 hex chars', async () => {
        const h = await blobShortHash(new Blob([new Uint8Array([1, 2, 3, 4, 5])]));
        expect(h).toMatch(/^[0-9a-f]{24}$/);
    });
    it('same content → same hash', async () => {
        const a = await blobShortHash(new Blob([new TextEncoder().encode('hello')]));
        const b = await blobShortHash(new Blob([new TextEncoder().encode('hello')]));
        expect(a).toBe(b);
    });
    it('different content → different hash', async () => {
        const a = await blobShortHash(new Blob([new TextEncoder().encode('alpha')]));
        const b = await blobShortHash(new Blob([new TextEncoder().encode('beta')]));
        expect(a).not.toBe(b);
    });
});

describe('clipKey', () => {
    it('prefixes muse/{first-hex-char}/...', () => {
        expect(clipKey('abc123def456')).toBe('muse/a/abc123def456.enc.webm');
        expect(clipKey('0fa1b2c3'))   .toBe('muse/0/0fa1b2c3.enc.webm');
    });
    it('handles empty hash defensively', () => {
        expect(clipKey('')).toBe('muse/0/.enc.webm');
    });
});
