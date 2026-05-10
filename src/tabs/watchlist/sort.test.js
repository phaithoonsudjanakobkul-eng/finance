import { describe, it, expect } from 'vitest';
import { sortSymbols, nextSort, parseSortPref, formatSortPref } from './sort.js';

const cache = {
    AAPL:  { name: 'Apple Inc.',          c: 195.0, d:  2.0, dp:  1.04, v: 50_000_000 },
    MSFT:  { name: 'Microsoft Corp.',     c: 415.0, d: -1.5, dp: -0.36, v: 30_000_000 },
    NVDA:  { name: 'NVIDIA Corporation',  c: 880.0, d: 12.5, dp:  1.44, v: 80_000_000 },
    NOQUOTE: {}, // missing all fields — should sort to the bottom in asc / top in desc
};

const empty = new Set(/** @type {string[]} */ ([]));

describe('sortSymbols', () => {
    const syms = ['MSFT', 'AAPL', 'NVDA', 'NOQUOTE'];

    it('symbol asc (alphabetical)', () => {
        const out = sortSymbols(syms, cache, { field: 'sym', dir: 'asc' }, empty);
        expect(out).toEqual(['AAPL', 'MSFT', 'NOQUOTE', 'NVDA']);
    });

    it('symbol desc (reverse alphabetical)', () => {
        const out = sortSymbols(syms, cache, { field: 'sym', dir: 'desc' }, empty);
        expect(out).toEqual(['NVDA', 'NOQUOTE', 'MSFT', 'AAPL']);
    });

    it('name asc falls back to symbol when name missing', () => {
        const out = sortSymbols(syms, cache, { field: 'name', dir: 'asc' }, empty);
        // Apple, Microsoft, NOQUOTE (no name → falls back to symbol "NOQUOTE"), NVIDIA
        expect(out).toEqual(['AAPL', 'MSFT', 'NOQUOTE', 'NVDA']);
    });

    it('last price desc (biggest first)', () => {
        const out = sortSymbols(syms, cache, { field: 'c', dir: 'desc' }, empty);
        // NVDA 880 > MSFT 415 > AAPL 195 > NOQUOTE (-Infinity → bottom in desc since sign flips)
        expect(out).toEqual(['NVDA', 'MSFT', 'AAPL', 'NOQUOTE']);
    });

    it('last price asc — NOQUOTE sorts to top (-Infinity)', () => {
        const out = sortSymbols(syms, cache, { field: 'c', dir: 'asc' }, empty);
        expect(out).toEqual(['NOQUOTE', 'AAPL', 'MSFT', 'NVDA']);
    });

    it('Δ% asc — most-negative first', () => {
        const out = sortSymbols(syms, cache, { field: 'dp', dir: 'asc' }, empty);
        // NOQUOTE (-Inf) → MSFT -0.36 → AAPL 1.04 → NVDA 1.44
        expect(out).toEqual(['NOQUOTE', 'MSFT', 'AAPL', 'NVDA']);
    });

    it('volume desc — heaviest first', () => {
        const out = sortSymbols(syms, cache, { field: 'v', dir: 'desc' }, empty);
        expect(out).toEqual(['NVDA', 'AAPL', 'MSFT', 'NOQUOTE']);
    });

    it('pinned symbols float to the top regardless of sort field', () => {
        const pinned = new Set(['MSFT']);
        const out = sortSymbols(syms, cache, { field: 'c', dir: 'desc' }, pinned);
        // MSFT pinned → first; rest sorts by `c desc` → NVDA, AAPL, NOQUOTE
        expect(out).toEqual(['MSFT', 'NVDA', 'AAPL', 'NOQUOTE']);
    });

    it('multiple pinned still ordered by sort within the pinned group', () => {
        const pinned = new Set(['NVDA', 'AAPL']);
        const out = sortSymbols(syms, cache, { field: 'c', dir: 'asc' }, pinned);
        // Pinned sorted by c asc within the group: AAPL 195, NVDA 880
        // Unpinned: NOQUOTE -Inf, MSFT 415 → NOQUOTE then MSFT (asc)
        expect(out).toEqual(['AAPL', 'NVDA', 'NOQUOTE', 'MSFT']);
    });

    it('does not mutate the input array', () => {
        const original = ['MSFT', 'AAPL', 'NVDA'];
        const snapshot = original.slice();
        sortSymbols(original, cache, { field: 'sym', dir: 'asc' }, empty);
        expect(original).toEqual(snapshot);
    });

    it('handles empty input', () => {
        expect(sortSymbols([], cache, { field: 'sym', dir: 'asc' }, empty)).toEqual([]);
    });

    it('handles missing cache entry (treats fields as missing)', () => {
        const out = sortSymbols(['XXX'], {}, { field: 'c', dir: 'desc' }, empty);
        expect(out).toEqual(['XXX']);
    });

    it('treats NaN price as missing (-Infinity fallback)', () => {
        const cacheWithNaN = { A: { c: NaN }, B: { c: 100 }, C: { c: 50 } };
        const out = sortSymbols(['A', 'B', 'C'], cacheWithNaN, { field: 'c', dir: 'desc' }, empty);
        expect(out).toEqual(['B', 'C', 'A']);
    });

    it('ties fall back to symbol-asc for stable ordering', () => {
        const ties = { Z: { c: 100 }, A: { c: 100 }, M: { c: 100 } };
        const out = sortSymbols(['Z', 'A', 'M'], ties, { field: 'c', dir: 'desc' }, empty);
        expect(out).toEqual(['A', 'M', 'Z']);
    });
});

describe('nextSort', () => {
    it('flips direction when clicking the same column', () => {
        expect(nextSort({ field: 'c', dir: 'asc'  }, 'c')).toEqual({ field: 'c', dir: 'desc' });
        expect(nextSort({ field: 'c', dir: 'desc' }, 'c')).toEqual({ field: 'c', dir: 'asc'  });
    });

    it('switches to a new column with desc default for numeric fields', () => {
        expect(nextSort({ field: 'sym', dir: 'asc' }, 'c')).toEqual({ field: 'c', dir: 'desc' });
        expect(nextSort({ field: 'sym', dir: 'asc' }, 'd')).toEqual({ field: 'd', dir: 'desc' });
        expect(nextSort({ field: 'sym', dir: 'asc' }, 'dp')).toEqual({ field: 'dp', dir: 'desc' });
        expect(nextSort({ field: 'sym', dir: 'asc' }, 'v')).toEqual({ field: 'v', dir: 'desc' });
    });

    it('switches to symbol/name with asc default', () => {
        expect(nextSort({ field: 'c', dir: 'desc' }, 'sym')).toEqual({ field: 'sym', dir: 'asc' });
        expect(nextSort({ field: 'c', dir: 'desc' }, 'name')).toEqual({ field: 'name', dir: 'asc' });
    });
});

describe('parseSortPref', () => {
    it('parses canonical strings', () => {
        expect(parseSortPref('sym:asc')).toEqual({ field: 'sym', dir: 'asc' });
        expect(parseSortPref('c:desc')).toEqual({ field: 'c', dir: 'desc' });
        expect(parseSortPref('dp:asc')).toEqual({ field: 'dp', dir: 'asc' });
    });

    it('returns null for blank / missing input', () => {
        expect(parseSortPref('')).toBeNull();
        expect(parseSortPref(null)).toBeNull();
        expect(parseSortPref(undefined)).toBeNull();
    });

    it('returns null for unknown fields or directions', () => {
        expect(parseSortPref('foo:asc')).toBeNull();
        expect(parseSortPref('sym:bar')).toBeNull();
        expect(parseSortPref('SYM:ASC')).toBeNull();
    });

    it('returns null for malformed strings', () => {
        expect(parseSortPref('sym')).toBeNull();
        expect(parseSortPref('sym:')).toBeNull();
        expect(parseSortPref(':asc')).toBeNull();
    });
});

describe('formatSortPref / parseSortPref round trip', () => {
    it('round-trips for every supported pair', () => {
        const fields = /** @type {const} */ (['sym', 'name', 'c', 'd', 'dp', 'v']);
        const dirs = /** @type {const} */ (['asc', 'desc']);
        for (const f of fields) {
            for (const d of dirs) {
                const spec = { field: f, dir: d };
                expect(parseSortPref(formatSortPref(spec))).toEqual(spec);
            }
        }
    });
});
