import { describe, it, expect } from 'vitest';
import { buildLut, channelMask } from './lut.js';

describe('buildLut', () => {
    it('identity LUT (black=0, white=255, gamma=1) maps i → i', () => {
        const lut = buildLut(0, 255, 1);
        for (let i = 0; i < 256; i++) expect(lut[i]).toBe(i);
    });

    it('returns a 256-entry Uint8ClampedArray', () => {
        const lut = buildLut(0, 255, 1);
        expect(lut).toBeInstanceOf(Uint8ClampedArray);
        expect(lut.length).toBe(256);
    });

    it('clamps inputs below black to 0', () => {
        const lut = buildLut(50, 255, 1);
        expect(lut[0]).toBe(0);
        expect(lut[25]).toBe(0);
        expect(lut[49]).toBe(0);
    });

    it('clamps inputs above white to 255', () => {
        const lut = buildLut(0, 200, 1);
        expect(lut[200]).toBe(255);
        expect(lut[225]).toBe(255);
        expect(lut[255]).toBe(255);
    });

    it('linear stretch (black=50, white=200) midpoint maps near 127', () => {
        const lut = buildLut(50, 200, 1);
        // midpoint of [50, 200] is 125 → maps to ~0.5 in normalized → ~128
        expect(Math.abs(lut[125] - 128)).toBeLessThanOrEqual(2);
    });

    it('gamma > 1 lifts midtones (lut[64] > 64 for gamma 2.0)', () => {
        const lut = buildLut(0, 255, 2.0);
        expect(lut[64]).toBeGreaterThan(64);
        expect(lut[128]).toBeGreaterThan(128);
        // Endpoints unchanged
        expect(lut[0]).toBe(0);
        expect(lut[255]).toBe(255);
    });

    it('gamma < 1 lowers midtones (lut[128] < 128 for gamma 0.5)', () => {
        const lut = buildLut(0, 255, 0.5);
        expect(lut[128]).toBeLessThan(128);
    });

    it('clamps black/white to [0, 254] / [black+1, 255]', () => {
        // Pathological inputs: black > white should be clamped so range>0
        const lut = buildLut(300, -10, 1);
        expect(lut.length).toBe(256);
        // All entries should still be valid Uint8 values
        for (const v of lut) {
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(255);
        }
    });

    it('falls back to defaults on NaN inputs (no NaN entries in the table)', () => {
        const lut = buildLut(NaN, NaN, NaN);
        for (const v of lut) {
            expect(Number.isFinite(v)).toBe(true);
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThanOrEqual(255);
        }
    });
});

describe('channelMask', () => {
    it('returns 7 for "all"', () => {
        expect(channelMask('all')).toBe(7);
    });

    it('returns 1 for "r"', () => {
        expect(channelMask('r')).toBe(1);
    });

    it('returns 2 for "g"', () => {
        expect(channelMask('g')).toBe(2);
    });

    it('returns 4 for "b"', () => {
        expect(channelMask('b')).toBe(4);
    });

    it('falls back to 7 for unknown / null / undefined', () => {
        expect(channelMask(/** @type {any} */ (null))).toBe(7);
        expect(channelMask(undefined)).toBe(7);
        expect(channelMask('xyz')).toBe(7);
    });

    it('bitmask supports OR-checks for all channels independently', () => {
        const all = channelMask('all');
        expect((all & 1) !== 0).toBe(true);
        expect((all & 2) !== 0).toBe(true);
        expect((all & 4) !== 0).toBe(true);
        const onlyR = channelMask('r');
        expect((onlyR & 1) !== 0).toBe(true);
        expect((onlyR & 2) !== 0).toBe(false);
        expect((onlyR & 4) !== 0).toBe(false);
    });
});
