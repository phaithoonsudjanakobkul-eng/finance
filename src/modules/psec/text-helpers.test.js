import { describe, it, expect } from 'vitest';
import { fmtRemark, notesToHtml, notesToText } from './text-helpers.js';

describe('fmtRemark', () => {
    it('returns empty string for null / undefined / empty', () => {
        expect(fmtRemark('')).toBe('');
        expect(fmtRemark(/** @type {any} */ (null))).toBe('');
        expect(fmtRemark(/** @type {any} */ (undefined))).toBe('');
    });

    it('passes through plain text + escapes HTML specials', () => {
        expect(fmtRemark('Hello world')).toBe('Hello world');
        expect(fmtRemark('A & B <c>')).toBe('A &amp; B &lt;c&gt;');
    });

    it('newlines become <br>', () => {
        expect(fmtRemark('line 1\nline 2')).toBe('line 1<br>line 2');
    });

    it('bare http URL gets the คลิกที่นี่ label', () => {
        const out = fmtRemark('See https://example.com for details');
        expect(out).toContain('href="https://example.com"');
        expect(out).toContain('>คลิกที่นี่</a>');
        expect(out).toContain('color:#0066cc');
    });

    it('bare https URL also wrapped (matches both http variants)', () => {
        const out = fmtRemark('Check http://x.example/path here');
        expect(out).toContain('href="http://x.example/path"');
        expect(out).toContain('>คลิกที่นี่</a>');
    });

    it('[label](url) markdown-style link renders the custom label', () => {
        const out = fmtRemark('See [our docs](https://example.com/docs) here');
        expect(out).toContain('href="https://example.com/docs"');
        expect(out).toContain('>our docs</a>');
        // Bare-URL fallback must NOT also tag the same URL
        expect(out).not.toContain('คลิกที่นี่');
    });

    it('[label] url (no parens) variant also works', () => {
        const out = fmtRemark('Visit [the page] https://example.com end');
        expect(out).toContain('href="https://example.com"');
        expect(out).toContain('>the page</a>');
    });

    it('multiple labeled links on the same line', () => {
        const out = fmtRemark('[A](https://a.example) and [B](https://b.example)');
        expect(out).toContain('href="https://a.example"');
        expect(out).toContain('>A</a>');
        expect(out).toContain('href="https://b.example"');
        expect(out).toContain('>B</a>');
    });

    it('mixed labeled + bare URL on the same line', () => {
        const out = fmtRemark('[Custom](https://a.example) plus https://b.example');
        expect(out).toContain('>Custom</a>');
        expect(out).toContain('>คลิกที่นี่</a>');
    });

    it('Thai content survives the escape + link pass', () => {
        const out = fmtRemark('ดูเพิ่ม [คลิกที่นี่](https://example.com) ขอบคุณค่ะ');
        expect(out).toContain('ดูเพิ่ม');
        expect(out).toContain('ขอบคุณค่ะ');
        expect(out).toContain('href="https://example.com"');
    });

    it('does not double-link an already-escaped string with no http', () => {
        // No URL → no <a> tags
        const out = fmtRemark('plain text without urls');
        expect(out).not.toContain('<a');
    });

    it('label with HTML specials is escaped before becoming link text', () => {
        const out = fmtRemark('[<script>](https://example.com)');
        expect(out).toContain('href="https://example.com"');
        // Brackets in label should be escaped
        expect(out).toContain('&lt;script&gt;');
        expect(out).not.toContain('<script>');
    });
});

describe('notesToHtml', () => {
    it('empty input → "-" placeholder', () => {
        expect(notesToHtml('')).toBe('-');
        expect(notesToHtml('   ')).toBe('-');
        expect(notesToHtml(/** @type {any} */ (null))).toBe('-');
    });

    it('single line returns the escaped line (no chrome)', () => {
        expect(notesToHtml('one note')).toBe('one note');
        expect(notesToHtml('A & B')).toBe('A &amp; B');
    });

    it('multiple lines numbered with <br> separators', () => {
        const out = notesToHtml('first\nsecond\nthird');
        expect(out).toBe('<br>1. first<br>2. second<br>3. third');
    });

    it('blank lines between entries are dropped (filter Boolean)', () => {
        const out = notesToHtml('first\n\n\nsecond');
        expect(out).toBe('<br>1. first<br>2. second');
    });

    it('leading + trailing whitespace per line is trimmed', () => {
        const out = notesToHtml('  first  \n  second  ');
        expect(out).toBe('<br>1. first<br>2. second');
    });

    it('Windows CRLF newlines work too', () => {
        expect(notesToHtml('a\r\nb\r\nc')).toBe('<br>1. a<br>2. b<br>3. c');
    });

    it('escapes HTML specials in each line', () => {
        const out = notesToHtml('<x>\n<y>');
        expect(out).toContain('&lt;x&gt;');
        expect(out).toContain('&lt;y&gt;');
        expect(out).not.toContain('<x>');
    });
});

describe('notesToText', () => {
    it('empty input → "-"', () => {
        expect(notesToText('')).toBe('-');
        expect(notesToText('   ')).toBe('-');
    });

    it('single line returned as-is (no escaping for text context)', () => {
        expect(notesToText('one note')).toBe('one note');
        expect(notesToText('A & B')).toBe('A & B');
    });

    it('multiple lines numbered with leading newline + numeric prefix', () => {
        expect(notesToText('first\nsecond')).toBe('\n1. first\n2. second');
    });

    it('drops blank lines', () => {
        expect(notesToText('first\n\nsecond')).toBe('\n1. first\n2. second');
    });

    it('CRLF newlines', () => {
        expect(notesToText('a\r\nb')).toBe('\n1. a\n2. b');
    });
});
