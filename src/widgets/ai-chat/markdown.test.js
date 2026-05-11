import { describe, it, expect } from 'vitest';
import { renderMd } from './markdown.js';

describe('renderMd', () => {
    it('plain text becomes a single <p>', () => {
        expect(renderMd('hello world')).toBe('<p>hello world</p>');
    });
    it('escapes HTML so model-injected tags do not run', () => {
        expect(renderMd('<script>alert(1)</script>')).toContain('&lt;script&gt;');
    });
    it('bold + italic', () => {
        const out = renderMd('**hi** and *there*');
        expect(out).toContain('<strong>hi</strong>');
        expect(out).toContain('<em>there</em>');
    });
    it('inline code', () => {
        expect(renderMd('use `foo()` here')).toContain('<code>foo()</code>');
    });
    it('fenced code block', () => {
        const out = renderMd('see this:\n```\nconsole.log(1)\n```');
        expect(out).toContain('<pre><code>');
        expect(out).toContain('console.log(1)');
    });
    it('bulleted list', () => {
        const out = renderMd('- one\n- two\n- three');
        expect(out).toContain('<ul>');
        expect(out).toContain('<li>one</li>');
        expect(out).toContain('<li>three</li>');
    });
    it('numbered list', () => {
        const out = renderMd('1. first\n2. second');
        expect(out).toContain('<ol>');
        expect(out).toContain('<li>first</li>');
    });
    it('headings', () => {
        const out = renderMd('# h1\n## h2');
        expect(out).toContain('<h1>h1</h1>');
        expect(out).toContain('<h2>h2</h2>');
    });
    it('link only allowed for http/https', () => {
        const ok  = renderMd('[Anthropic](https://anthropic.com)');
        const bad = renderMd('[bad](javascript:alert(1))');
        expect(ok).toContain('<a href="https://anthropic.com"');
        expect(bad).not.toContain('href=');
        expect(bad).toContain('bad');
    });
    it('paragraph break on blank line', () => {
        const out = renderMd('first paragraph\n\nsecond paragraph');
        expect(out).toBe('<p>first paragraph</p><p>second paragraph</p>');
    });
});
