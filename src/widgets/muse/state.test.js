import { describe, it, expect, beforeEach } from 'vitest';
import {
    PRESET_KEYS, PRESET_LETTERS,
    getActivePresetIdx, setActivePresetIdx,
    loadSlots, saveSlots,
    loadActiveSlots, saveActiveSlots,
    loadPasswordHashes, savePasswordHashes,
    getSlotCount, setSlotCount, deriveVisibleSlotCount,
    hashPassword, verifyPassword,
    reorderSlots, padSlots,
} from './state.js';

beforeEach(() => { localStorage.clear(); });

describe('preset registry', () => {
    it('has 6 presets A-F', () => {
        expect(PRESET_KEYS).toHaveLength(6);
        expect(PRESET_LETTERS).toEqual(['A','B','C','D','E','F']);
    });
});

describe('active preset idx', () => {
    it('defaults to 0', () => {
        expect(getActivePresetIdx()).toBe(0);
    });
    it('clamps invalid values to 0', () => {
        localStorage.setItem('ps_muse_preset_idx', '99');
        expect(getActivePresetIdx()).toBe(0);
        localStorage.setItem('ps_muse_preset_idx', '-1');
        expect(getActivePresetIdx()).toBe(0);
        localStorage.setItem('ps_muse_preset_idx', 'abc');
        expect(getActivePresetIdx()).toBe(0);
    });
    it('round-trips a valid index', () => {
        setActivePresetIdx(3);
        expect(getActivePresetIdx()).toBe(3);
    });
});

describe('slots round-trip', () => {
    it('empty preset returns []', () => {
        expect(loadSlots(2)).toEqual([]);
    });
    it('save + load round-trips slot data', () => {
        saveSlots(1, [
            { type: 'empty' },
            { type: 'image', thumb: 't', src: 's' },
            { type: 'tiktok', url: 'https://example.com' },
        ]);
        const out = loadSlots(1);
        expect(out).toHaveLength(3);
        expect(out[1]).toEqual({ type: 'image', thumb: 't', src: 's' });
    });
    it('out-of-range preset is a no-op', () => {
        saveSlots(99, [{ type: 'empty' }]);
        expect(loadSlots(99)).toEqual([]);
    });
});

describe('active slot array', () => {
    it('defaults to 0 for every preset', () => {
        expect(loadActiveSlots()).toHaveLength(6);
        expect(loadActiveSlots().every((n) => n === 0)).toBe(true);
    });
    it('pads to 6 if storage has fewer entries', () => {
        saveActiveSlots([2, 1]);
        const out = loadActiveSlots();
        expect(out).toHaveLength(6);
        expect(out[0]).toBe(2);
        expect(out[1]).toBe(1);
        expect(out[5]).toBe(0);
    });
});

describe('password hashes', () => {
    it('defaults to 6 nulls', () => {
        expect(loadPasswordHashes()).toEqual([null, null, null, null, null, null]);
    });
    it('round-trips', () => {
        savePasswordHashes(['abc', null, 'def', null, null, null]);
        expect(loadPasswordHashes()[0]).toBe('abc');
        expect(loadPasswordHashes()[2]).toBe('def');
    });
});

describe('slot count', () => {
    it('defaults to 0 (auto)', () => {
        expect(getSlotCount()).toBe(0);
    });
    it('accepts 4..10', () => {
        setSlotCount(6);
        expect(getSlotCount()).toBe(6);
    });
    it('rejects out-of-range', () => {
        setSlotCount(11);
        expect(getSlotCount()).toBe(0);
        setSlotCount(2);
        expect(getSlotCount()).toBe(0);
    });
});

describe('deriveVisibleSlotCount', () => {
    it('returns fixed count when set', () => {
        setSlotCount(5);
        expect(deriveVisibleSlotCount([{ type: 'empty' }, { type: 'empty' }])).toBe(5);
    });
    it('auto mode → clamp to slots.length but at least 4 and at most 10', () => {
        expect(deriveVisibleSlotCount([])).toBe(7); // empty → default 7
        expect(deriveVisibleSlotCount([{ type: 'empty' }, { type: 'empty' }])).toBe(4); // 2 → clamp up to 4
        const big = new Array(15).fill({ type: 'empty' });
        expect(deriveVisibleSlotCount(big)).toBe(10);
    });
});

describe('password hashing', () => {
    it('returns 64 hex chars for SHA-256', async () => {
        const h = await hashPassword('hunter2');
        expect(h).toMatch(/^[0-9a-f]{64}$/);
    });
    it('same input → same hash', async () => {
        const a = await hashPassword('abc');
        const b = await hashPassword('abc');
        expect(a).toBe(b);
    });
    it('different input → different hash', async () => {
        const a = await hashPassword('abc');
        const b = await hashPassword('abd');
        expect(a).not.toBe(b);
    });
    it('verify against null hash is always true (no password set)', async () => {
        expect(await verifyPassword('anything', null)).toBe(true);
    });
    it('verify with matching pw → true; mismatch → false', async () => {
        const h = await hashPassword('correct');
        expect(await verifyPassword('correct', h)).toBe(true);
        expect(await verifyPassword('wrong', h)).toBe(false);
    });
});

describe('reorderSlots', () => {
    const s = [
        { type: /** @type {const} */ ('empty') },
        { type: /** @type {const} */ ('image'), thumb: 'a', src: 'a' },
        { type: /** @type {const} */ ('image'), thumb: 'b', src: 'b' },
        { type: /** @type {const} */ ('image'), thumb: 'c', src: 'c' },
    ];
    it('returns a new array, does not mutate', () => {
        const out = reorderSlots(s, 0, 2);
        expect(out).not.toBe(s);
    });
    it('moves an item forward', () => {
        const out = reorderSlots(s, 1, 3);
        expect(out.map((x) => /** @type {any} */ (x).thumb || '·')).toEqual(['·', 'b', 'c', 'a']);
    });
    it('moves an item backward', () => {
        const out = reorderSlots(s, 3, 1);
        expect(out.map((x) => /** @type {any} */ (x).thumb || '·')).toEqual(['·', 'c', 'a', 'b']);
    });
    it('no-op for same index', () => {
        expect(reorderSlots(s, 1, 1)).toEqual(s);
    });
    it('no-op for out-of-range', () => {
        expect(reorderSlots(s, -1, 1)).toEqual(s);
        expect(reorderSlots(s, 1, 99)).toEqual(s);
    });
});

describe('padSlots', () => {
    it('pads with empty slots', () => {
        const out = padSlots([{ type: 'image', thumb: 'a', src: 'a' }], 4);
        expect(out).toHaveLength(4);
        expect(out[0].type).toBe('image');
        expect(out[1].type).toBe('empty');
    });
    it('truncates when given fewer slots than count', () => {
        const out = padSlots([
            { type: 'empty' }, { type: 'empty' }, { type: 'empty' }, { type: 'empty' }, { type: 'empty' },
        ], 3);
        expect(out).toHaveLength(3);
    });
});
