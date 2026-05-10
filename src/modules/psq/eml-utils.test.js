import { describe, it, expect } from 'vitest';
import { bufToBase64, wrapBase64, emlEncodeWord, emlMessageId } from './eml-utils.js';

describe('bufToBase64', () => {
    it('encodes a small ArrayBuffer to base64', () => {
        const enc = new TextEncoder();
        const buf = enc.encode('hello').buffer;
        expect(bufToBase64(buf)).toBe('aGVsbG8=');
    });

    it('round-trips through atob (binary integrity)', () => {
        const buf = new Uint8Array([0, 1, 127, 128, 254, 255]).buffer;
        const b64 = bufToBase64(buf);
        const decoded = atob(b64);
        const out = new Uint8Array(decoded.length);
        for (let i = 0; i < decoded.length; i++) out[i] = decoded.charCodeAt(i);
        expect(Array.from(out)).toEqual([0, 1, 127, 128, 254, 255]);
    });

    it('handles >100KB buffer (the chunking bug fix path)', () => {
        // 200 KB of 0x42 — triggers the 32 KB chunking loop multiple times
        const big = new Uint8Array(200 * 1024).fill(0x42).buffer;
        const b64 = bufToBase64(big);
        // Decoded length matches original
        expect(atob(b64).length).toBe(200 * 1024);
    });

    it('handles empty buffer', () => {
        expect(bufToBase64(new ArrayBuffer(0))).toBe('');
    });
});

describe('wrapBase64', () => {
    it('wraps to 76-char lines with CRLF', () => {
        const long = 'A'.repeat(100);
        const wrapped = wrapBase64(long);
        const lines = wrapped.split('\r\n');
        expect(lines[0]).toHaveLength(76);
        expect(lines[1]).toHaveLength(24);
    });

    it('returns a single line for short input', () => {
        const wrapped = wrapBase64('short');
        expect(wrapped).toBe('short');
        expect(wrapped.includes('\r\n')).toBe(false);
    });

    it('handles exact multiples of 76', () => {
        const exact = 'A'.repeat(152);
        const wrapped = wrapBase64(exact);
        const lines = wrapped.split('\r\n');
        expect(lines).toHaveLength(2);
        expect(lines[0]).toHaveLength(76);
        expect(lines[1]).toHaveLength(76);
    });

    it('returns empty string for empty input', () => {
        expect(wrapBase64('')).toBe('');
    });
});

describe('emlEncodeWord', () => {
    it('passes ASCII through unchanged', () => {
        expect(emlEncodeWord('Hello World')).toBe('Hello World');
    });

    it('passes ASCII punctuation unchanged', () => {
        expect(emlEncodeWord('foo@bar.com (subject)')).toBe('foo@bar.com (subject)');
    });

    it('encodes Thai as RFC 2047 base64 word', () => {
        const out = emlEncodeWord('สวัสดี');
        expect(out.startsWith('=?utf-8?B?')).toBe(true);
        expect(out.endsWith('?=')).toBe(true);
        // Decoded portion round-trips
        const inner = out.slice('=?utf-8?B?'.length, -2);
        expect(decodeURIComponent(escape(atob(inner)))).toBe('สวัสดี');
    });

    it('encodes mixed ASCII + non-ASCII', () => {
        const out = emlEncodeWord('PSLink — Comp1');
        expect(out.startsWith('=?utf-8?B?')).toBe(true);
    });

    it('encodes em-dash (the character that pushed monolith to RFC 2047)', () => {
        const out = emlEncodeWord('Quote — final');
        expect(out.startsWith('=?utf-8?B?')).toBe(true);
        expect(out.endsWith('?=')).toBe(true);
    });
});

describe('emlMessageId', () => {
    it('produces RFC-shape angle-bracketed id with @hostname', () => {
        const id = emlMessageId('example.com');
        expect(/^<[a-z0-9]+\.[a-z0-9]+@example\.com>$/.test(id)).toBe(true);
    });

    it('falls back to pslink.local when hostname empty', () => {
        const id = emlMessageId('');
        expect(id.endsWith('@pslink.local>')).toBe(true);
    });

    it('produces unique ids on rapid calls', () => {
        const a = emlMessageId('host');
        const b = emlMessageId('host');
        expect(a).not.toBe(b);
    });
});
