import { describe, it, expect, beforeEach } from 'vitest';
import {
    NEWS_CACHE_LS_KEY,
    NEWS_CACHE_TTL_MS,
    loadCache,
    saveCache,
    isStale,
    dedupeArticles,
} from './cache.js';

beforeEach(() => {
    localStorage.clear();
});

describe('loadCache', () => {
    it('returns null when the key is absent', () => {
        expect(loadCache()).toBeNull();
    });

    it('returns null when value is malformed JSON', () => {
        localStorage.setItem(NEWS_CACHE_LS_KEY, '{not-json');
        expect(loadCache()).toBeNull();
    });

    it('returns null when items is not an array', () => {
        localStorage.setItem(NEWS_CACHE_LS_KEY, JSON.stringify({ ts: 0, items: 'oops' }));
        expect(loadCache()).toBeNull();
    });

    it('returns null when ts is not a finite number', () => {
        localStorage.setItem(NEWS_CACHE_LS_KEY, JSON.stringify({ ts: 'now', items: [] }));
        expect(loadCache()).toBeNull();
        localStorage.setItem(NEWS_CACHE_LS_KEY, JSON.stringify({ ts: NaN, items: [] }));
        expect(loadCache()).toBeNull();
    });

    it('returns the parsed object when shape is valid', () => {
        const cache = { ts: 1700000000000, items: [{ url: 'https://x' }] };
        localStorage.setItem(NEWS_CACHE_LS_KEY, JSON.stringify(cache));
        expect(loadCache()).toEqual(cache);
    });
});

describe('saveCache', () => {
    it('writes a JSON envelope with ts + items', () => {
        const items = [{ url: 'https://a' }, { url: 'https://b' }];
        saveCache(items, 12345);
        const raw = localStorage.getItem(NEWS_CACHE_LS_KEY);
        expect(JSON.parse(raw || '{}')).toEqual({ ts: 12345, items });
    });

    it('uses Date.now() when ts argument is omitted', () => {
        const before = Date.now();
        saveCache([]);
        const after = Date.now();
        const stored = JSON.parse(localStorage.getItem(NEWS_CACHE_LS_KEY) || '{}');
        expect(stored.ts).toBeGreaterThanOrEqual(before);
        expect(stored.ts).toBeLessThanOrEqual(after);
    });
});

describe('isStale', () => {
    it('treats null cache as stale (force refresh)', () => {
        expect(isStale(null)).toBe(true);
    });

    it('returns false when within TTL', () => {
        const now = 1_000_000;
        const cache = { ts: now - 10_000, items: [] }; // 10s old
        expect(isStale(cache, NEWS_CACHE_TTL_MS, now)).toBe(false);
    });

    it('returns true when past TTL', () => {
        const now = 1_000_000;
        const cache = { ts: now - (NEWS_CACHE_TTL_MS + 1), items: [] };
        expect(isStale(cache, NEWS_CACHE_TTL_MS, now)).toBe(true);
    });

    it('falls back to Date.now() when now omitted', () => {
        const cache = { ts: Date.now() - 1000, items: [] };
        expect(isStale(cache)).toBe(false);
    });

    it('respects an injected ttlMs override', () => {
        const cache = { ts: 1000, items: [] };
        // Past 100ms TTL when now=2000 (1s elapsed)
        expect(isStale(cache, 100, 2000)).toBe(true);
        // Within 60s TTL
        expect(isStale(cache, 60_000, 2000)).toBe(false);
    });
});

describe('dedupeArticles', () => {
    it('returns [] for empty input', () => {
        expect(dedupeArticles([])).toEqual([]);
        expect(dedupeArticles([[]])).toEqual([]);
    });

    it('drops items without a url', () => {
        const out = dedupeArticles([[{ url: '' }, { url: 'https://a' }]]);
        expect(out).toHaveLength(1);
        expect(out[0].url).toBe('https://a');
    });

    it('collapses duplicate urls across symbols (first wins)', () => {
        const aapl = [{ url: 'https://x', headline: 'AAPL article', datetime: 100 }];
        const msft = [{ url: 'https://x', headline: 'MSFT article', datetime: 200 }];
        const out = dedupeArticles([aapl, msft]);
        expect(out).toHaveLength(1);
        expect(out[0].headline).toBe('AAPL article'); // first occurrence wins
    });

    it('sorts newest-first by datetime', () => {
        const arr = [
            [{ url: 'https://1', datetime: 100 }],
            [{ url: 'https://2', datetime: 300 }],
            [{ url: 'https://3', datetime: 200 }],
        ];
        const out = dedupeArticles(arr);
        expect(out.map((i) => i.url)).toEqual(['https://2', 'https://3', 'https://1']);
    });

    it('treats missing/non-numeric datetime as 0 (sorts to bottom)', () => {
        const arr = [
            [{ url: 'https://1' }],
            [{ url: 'https://2', datetime: 100 }],
            [{ url: 'https://3', datetime: NaN }],
        ];
        const out = dedupeArticles(arr);
        expect(out[0].url).toBe('https://2');
    });

    it('skips non-array inputs and non-object items defensively', () => {
        // Forced bad input — make sure we don't crash
        const out = dedupeArticles(/** @type {any} */ ([null, undefined, [/** @type {any} */ (null), { url: 'https://a' }]]));
        expect(out).toHaveLength(1);
        expect(out[0].url).toBe('https://a');
    });

    it('combines mixed-arity arrays of different sources', () => {
        const sym1 = [{ url: 'https://a', datetime: 1 }, { url: 'https://b', datetime: 2 }];
        const sym2 = [{ url: 'https://b', datetime: 99 }, { url: 'https://c', datetime: 3 }];
        const sym3 = [];
        const out = dedupeArticles([sym1, sym2, sym3]);
        expect(out).toHaveLength(3);
        expect(out.map((i) => i.url).sort()).toEqual(['https://a', 'https://b', 'https://c']);
    });
});
