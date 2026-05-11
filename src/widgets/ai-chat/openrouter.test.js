import { describe, it, expect } from 'vitest';
import { buildContext, buildMessages, parseResponse } from './openrouter.js';

describe('buildContext', () => {
    const cache = {
        AAPL: { name: 'Apple', c: 200, d: -1, dp: -0.5, v: 1000 },
        MSFT: { name: 'Microsoft', c: 400, d: 5, dp: 1.2, v: 500 },
        NVDA: { name: 'Nvidia', c: 900, d: 10, dp: 1.1, v: 2000 },
        TSLA: { name: 'Tesla', c: 180, d: 0, dp: 0, v: 1500 },
    };
    it('prefers pinned symbols first', () => {
        const out = buildContext({
            cache,
            watchlist: ['AAPL', 'MSFT', 'NVDA', 'TSLA'],
            pinned:    ['NVDA'],
            n: 2,
        });
        // NVDA should appear before AAPL
        expect(out.indexOf('"NVDA"')).toBeLessThan(out.indexOf('"AAPL"'));
    });
    it('caps the size at n', () => {
        const out = buildContext({
            cache,
            watchlist: ['AAPL', 'MSFT', 'NVDA', 'TSLA'],
            pinned:    [],
            n: 2,
        });
        // Only 2 sym fields present
        expect(out.match(/"sym":/g)).toHaveLength(2);
    });
    it('embeds last / chg / chgPct fields', () => {
        const out = buildContext({ cache, watchlist: ['AAPL'], pinned: [], n: 1 });
        expect(out).toContain('"last": 200');
        expect(out).toContain('"chgPct": -0.5');
    });
    it('handles missing fields gracefully', () => {
        const out = buildContext({ cache: { FOO: {} }, watchlist: ['FOO'], pinned: [], n: 1 });
        expect(out).toContain('"last": null');
        expect(out).toContain('"chg": null');
    });
});

describe('buildMessages', () => {
    it('prepends 2 system messages (instructions + context)', () => {
        const msgs = buildMessages([
            { role: 'user', content: 'hi' },
        ], 'CTX BLOCK');
        expect(msgs.length).toBe(3);
        expect(msgs[0].role).toBe('system');
        expect(msgs[1].role).toBe('system');
        expect(msgs[1].content).toBe('CTX BLOCK');
        expect(msgs[2].role).toBe('user');
    });
});

describe('parseResponse', () => {
    it('pulls the assistant content', () => {
        const out = parseResponse({ choices: [{ message: { content: 'hello' } }] });
        expect(out).toBe('hello');
    });
    it('returns empty string on malformed body', () => {
        expect(parseResponse(null)).toBe('');
        expect(parseResponse({})).toBe('');
        expect(parseResponse({ choices: [] })).toBe('');
    });
});
