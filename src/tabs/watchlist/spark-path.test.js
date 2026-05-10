import { describe, it, expect } from 'vitest';
import { buildSparkPath } from './spark-path.js';

describe('buildSparkPath edge cases', () => {
    it('returns empty path + sign 0 for empty array', () => {
        expect(buildSparkPath([], 80, 26)).toEqual({ d: '', sign: 0 });
    });

    it('returns empty path + sign 0 for single point', () => {
        expect(buildSparkPath([100], 80, 26)).toEqual({ d: '', sign: 0 });
    });

    it('returns empty path + sign 0 for non-array input', () => {
        expect(buildSparkPath(/** @type {any} */ (null), 80, 26)).toEqual({ d: '', sign: 0 });
        expect(buildSparkPath(/** @type {any} */ (undefined), 80, 26)).toEqual({ d: '', sign: 0 });
    });
});

describe('buildSparkPath geometry', () => {
    it('starts with M command + ends with L commands', () => {
        const { d } = buildSparkPath([1, 2, 3], 80, 26);
        expect(d.startsWith('M')).toBe(true);
        // 3 points → 1 M + 2 L
        expect((d.match(/L/g) || []).length).toBe(2);
        expect((d.match(/M/g) || []).length).toBe(1);
    });

    it('places first point at x=1 (1px left padding)', () => {
        const { d } = buildSparkPath([10, 20], 100, 50);
        // First command: M1.0,...
        expect(d.startsWith('M1.0,')).toBe(true);
    });

    it('places last point at x = W-1 (1px right padding)', () => {
        const { d } = buildSparkPath([10, 20], 100, 50);
        // Step = (W-2)/(n-1) = 98/1 = 98 → last x = 1 + 98 = 99 = W-1
        expect(d).toContain('L99.0,');
    });

    it('places lowest price at y = H-2 (bottom)', () => {
        const { d } = buildSparkPath([10, 20], 100, 50);
        // 10 is min → y = (50-2) - 0 = 48
        expect(d).toContain('M1.0,48.0');
    });

    it('places highest price at y = 0 (top)', () => {
        const { d } = buildSparkPath([10, 20], 100, 50);
        // 20 is max → y = 48 - 1*48 = 0
        expect(d).toContain('L99.0,0.0');
    });

    it('handles flat line without divide-by-zero (range fallback to 1)', () => {
        const { d } = buildSparkPath([5, 5, 5], 100, 50);
        // All prices same → range=0 → fallback divisor 1 → all y same
        // Each point: y = (50-2) - 0 = 48
        const ys = (d.match(/[ML]\d+\.\d,(\d+\.\d)/g) || []).map((m) => parseFloat(m.split(',')[1]));
        expect(ys.every((y) => Math.abs(y - 48) < 0.01)).toBe(true);
    });
});

describe('buildSparkPath sign hint', () => {
    it('returns sign=1 when last > first (uptrend)', () => {
        expect(buildSparkPath([100, 110], 80, 26).sign).toBe(1);
    });

    it('returns sign=-1 when last < first (downtrend)', () => {
        expect(buildSparkPath([110, 100], 80, 26).sign).toBe(-1);
    });

    it('returns sign=0 when last == first (flat)', () => {
        expect(buildSparkPath([100, 100], 80, 26).sign).toBe(0);
    });

    it('compares only first vs last, ignores middle', () => {
        // Big spike middle, ends below start → still downtrend
        expect(buildSparkPath([100, 200, 90], 80, 26).sign).toBe(-1);
    });
});

describe('buildSparkPath scaling', () => {
    it('400-bar input produces 400 vertices, none NaN', () => {
        const prices = Array.from({ length: 400 }, (_, i) => 100 + Math.sin(i / 10) * 5);
        const { d } = buildSparkPath(prices, 360, 120);
        const moves = d.match(/[ML]\d+\.\d+,\d+\.\d+/g) || [];
        expect(moves.length).toBe(400);
        expect(d.includes('NaN')).toBe(false);
    });

    it('scales x linearly with index', () => {
        const { d } = buildSparkPath([0, 50, 100], 100, 50);
        // 3 points → step = (100-2)/2 = 49 → x = 1, 50, 99
        expect(d).toContain('M1.0,');
        expect(d).toContain('L50.0,');
        expect(d).toContain('L99.0,');
    });
});
