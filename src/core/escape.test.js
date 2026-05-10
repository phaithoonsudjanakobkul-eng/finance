import { describe, it, expect } from 'vitest';
import { escapeHtml, escapeAttr } from './escape.js';

describe('escapeHtml', () => {
    it('passes through plain text unchanged', () => {
        expect(escapeHtml('Hello world')).toBe('Hello world');
        expect(escapeHtml('AAPL — Apple Inc.')).toBe('AAPL — Apple Inc.');
    });

    it('escapes ampersand', () => {
        expect(escapeHtml('AT&T')).toBe('AT&amp;T');
    });

    it('escapes angle brackets', () => {
        expect(escapeHtml('<script>alert(1)</script>')).toBe('&lt;script&gt;alert(1)&lt;/script&gt;');
    });

    it('escapes both quote types', () => {
        expect(escapeHtml('He said "hi" and \'bye\'')).toBe('He said &quot;hi&quot; and &#39;bye&#39;');
    });

    it('escapes ampersand FIRST so existing entities get re-escaped (lossless)', () => {
        // If `&` were last, "&amp;" would become "&amp;amp;" — wrong direction.
        // Replacing `&` first means a literal "&amp;" in input becomes "&amp;amp;"
        // which is the CORRECT output for the literal 5-char string user typed.
        expect(escapeHtml('&amp;')).toBe('&amp;amp;');
    });

    it('coerces non-string inputs', () => {
        expect(escapeHtml(42)).toBe('42');
        expect(escapeHtml(true)).toBe('true');
        expect(escapeHtml({ toString: () => 'OBJ' })).toBe('OBJ');
    });

    it('returns empty string for null / undefined', () => {
        expect(escapeHtml(null)).toBe('');
        expect(escapeHtml(undefined)).toBe('');
    });

    it('escapes Thai text without altering it (only the 5 specials)', () => {
        expect(escapeHtml('พี่เก่งคะ')).toBe('พี่เก่งคะ');
        expect(escapeHtml('พี่<test>เก่ง')).toBe('พี่&lt;test&gt;เก่ง');
    });

    it('handles a long mixed-content string in one pass', () => {
        const input = `Click <a href="x" onclick='alert("xss")'>here</a> & don't`;
        const out = escapeHtml(input);
        expect(out).not.toContain('<');
        expect(out).not.toContain('>');
        expect(out).not.toContain('"');
        expect(out).not.toContain("'");
        // Ampersand is allowed only inside escaped entities
        expect(out).toMatch(/^[^&]*(&(amp|lt|gt|quot|#39);[^&]*)+$/);
    });
});

describe('escapeAttr', () => {
    it('matches escapeHtml byte-for-byte today', () => {
        const samples = ['', 'plain', 'AT&T', '<x>', `'"`, 'พี่เก่ง'];
        for (const s of samples) expect(escapeAttr(s)).toBe(escapeHtml(s));
    });

    it('handles null / undefined identically', () => {
        expect(escapeAttr(null)).toBe('');
        expect(escapeAttr(undefined)).toBe('');
    });
});
