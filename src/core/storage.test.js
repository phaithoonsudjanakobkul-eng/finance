import { describe, it, expect, beforeEach, vi } from 'vitest';
import { lsSave, lsGet, lsGetJson, lsSaveJson, lsRemove } from './storage.js';

beforeEach(() => {
    localStorage.clear();
});

describe('lsSave', () => {
    it('persists string values', () => {
        const ok = lsSave('k', 'hello');
        expect(ok).toBe(true);
        expect(localStorage.getItem('k')).toBe('hello');
    });

    it('returns false on QuotaExceededError without throwing', () => {
        const spy = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
            const e = /** @type {any} */ (new Error('quota'));
            e.name = 'QuotaExceededError';
            throw e;
        });
        const ok = lsSave('k', 'v');
        expect(ok).toBe(false);
        spy.mockRestore();
    });

    it('rethrows non-quota errors', () => {
        const spy = vi.spyOn(localStorage, 'setItem').mockImplementationOnce(() => {
            throw new Error('disk corrupt');
        });
        expect(() => lsSave('k', 'v')).toThrow('disk corrupt');
        spy.mockRestore();
    });
});

describe('lsGet', () => {
    it('returns the stored value when present', () => {
        localStorage.setItem('k', 'v');
        expect(lsGet('k', 'fallback')).toBe('v');
    });

    it('returns fallback when missing', () => {
        expect(lsGet('absent', 'fallback')).toBe('fallback');
    });

    it('returns fallback when localStorage throws', () => {
        const spy = vi.spyOn(localStorage, 'getItem').mockImplementationOnce(() => {
            throw new Error('access denied');
        });
        expect(lsGet('k', 'fb')).toBe('fb');
        spy.mockRestore();
    });
});

describe('lsGetJson', () => {
    it('parses valid JSON', () => {
        localStorage.setItem('k', JSON.stringify({ a: 1, b: [2, 3] }));
        expect(lsGetJson('k', null)).toEqual({ a: 1, b: [2, 3] });
    });

    it('returns fallback on missing key', () => {
        expect(lsGetJson('absent', { def: true })).toEqual({ def: true });
    });

    it('returns fallback on malformed JSON (no throw)', () => {
        localStorage.setItem('k', 'not json {{');
        expect(lsGetJson('k', [])).toEqual([]);
    });
});

describe('lsSaveJson', () => {
    it('round-trips with lsGetJson', () => {
        const obj = { sym: 'AAPL', prices: [1, 2, 3] };
        lsSaveJson('k', obj);
        expect(lsGetJson('k', null)).toEqual(obj);
    });

    it('returns false when JSON.stringify throws (circular)', () => {
        /** @type {any} */
        const cyclic = {};
        cyclic.self = cyclic;
        expect(lsSaveJson('k', cyclic)).toBe(false);
    });
});

describe('lsRemove', () => {
    it('clears the key', () => {
        localStorage.setItem('k', 'v');
        lsRemove('k');
        expect(localStorage.getItem('k')).toBeNull();
    });

    it('is silent when removeItem throws', () => {
        const spy = vi.spyOn(localStorage, 'removeItem').mockImplementationOnce(() => {
            throw new Error('fail');
        });
        expect(() => lsRemove('k')).not.toThrow();
        spy.mockRestore();
    });
});
