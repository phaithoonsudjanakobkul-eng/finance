import { describe, it, expect } from 'vitest';
import { runContent } from './run-helpers.js';

describe('runContent', () => {
    it('returns empty string for empty / null input', () => {
        expect(runContent('')).toBe('');
        expect(runContent(/** @type {any} */ (null))).toBe('');
        expect(runContent(/** @type {any} */ (undefined))).toBe('');
    });

    it('plain text wraps in <w:t xml:space="preserve">', () => {
        expect(runContent('hello')).toBe('<w:t xml:space="preserve">hello</w:t>');
    });

    it('preserves leading / trailing whitespace via xml:space="preserve"', () => {
        const out = runContent('  hello  ');
        expect(out).toContain('xml:space="preserve"');
        expect(out).toContain('  hello  ');
    });

    it('escapes XML-significant characters (& < >)', () => {
        expect(runContent('A & B')).toBe('<w:t xml:space="preserve">A &amp; B</w:t>');
        expect(runContent('<x>')).toBe('<w:t xml:space="preserve">&lt;x&gt;</w:t>');
    });

    it('escapes double-quote (also valid in XML attribute and text contexts)', () => {
        expect(runContent('"quoted"')).toContain('&quot;quoted&quot;');
    });

    it('escapes apostrophe via &#39; (valid XML numeric char ref)', () => {
        expect(runContent("don't")).toContain('don&#39;t');
    });

    it('preserves Thai content unchanged', () => {
        expect(runContent('ขอบคุณค่ะ')).toBe('<w:t xml:space="preserve">ขอบคุณค่ะ</w:t>');
    });

    it('emits <w:tab/> at each tab character', () => {
        const out = runContent('A\tB\tC');
        expect(out).toContain('<w:t xml:space="preserve">A</w:t>');
        expect(out).toContain('<w:tab/>');
        expect(out).toContain('<w:t xml:space="preserve">B</w:t>');
        expect(out).toContain('<w:t xml:space="preserve">C</w:t>');
        // Two tabs between three text segments
        expect(out.match(/<w:tab\/>/g)?.length).toBe(2);
    });

    it('leading tab → <w:tab/> followed by the text run', () => {
        const out = runContent('\thello');
        expect(out).toMatch(/^<w:tab\/><w:t xml:space="preserve">hello<\/w:t>$/);
    });

    it('trailing tab → text run followed by <w:tab/>', () => {
        const out = runContent('hello\t');
        // After split: ['hello', ''] — first segment emits <w:t>, second is empty (no tag), preceded by <w:tab/>
        expect(out).toContain('<w:t xml:space="preserve">hello</w:t>');
        expect(out).toContain('<w:tab/>');
    });

    it('consecutive tabs emit consecutive <w:tab/> with no empty <w:t> between', () => {
        const out = runContent('A\t\tB');
        expect(out).toContain('<w:t xml:space="preserve">A</w:t>');
        // Two tabs back-to-back
        const tabs = out.match(/<w:tab\/>/g) || [];
        expect(tabs.length).toBe(2);
        expect(out).toContain('<w:t xml:space="preserve">B</w:t>');
        // No empty <w:t></w:t> between the tabs
        expect(out).not.toContain('<w:t xml:space="preserve"></w:t>');
    });

    it('only tabs (no text) → only <w:tab/> elements', () => {
        const out = runContent('\t\t');
        const tabs = out.match(/<w:tab\/>/g) || [];
        expect(tabs.length).toBe(2);
        // No <w:t ...> text runs (use the opening tag with attribute, not bare "<w:t" which would also match "<w:tab/>")
        expect(out).not.toContain('<w:t xml:space');
    });

    it('mixed whitespace + escaping in same string', () => {
        const out = runContent(' a & b\tc < d ');
        expect(out).toContain('a &amp; b');
        expect(out).toContain('<w:tab/>');
        expect(out).toContain('c &lt; d');
    });
});
