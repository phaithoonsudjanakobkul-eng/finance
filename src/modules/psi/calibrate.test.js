import { describe, it, expect } from 'vitest';
import { distancePx, computePpm, canvasPointFromClick } from './calibrate.js';

describe('distancePx', () => {
    it('returns 0 for identical points', () => {
        expect(distancePx({ x: 5, y: 5 }, { x: 5, y: 5 })).toBe(0);
    });

    it('horizontal line', () => {
        expect(distancePx({ x: 0, y: 10 }, { x: 100, y: 10 })).toBe(100);
    });

    it('3-4-5 right triangle', () => {
        expect(distancePx({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5);
    });

    it('order-independent', () => {
        const a = { x: 7, y: 11 }, b = { x: 23, y: 47 };
        expect(distancePx(a, b)).toBeCloseTo(distancePx(b, a), 6);
    });
});

describe('computePpm', () => {
    it('returns line length / micron distance', () => {
        // 100px line @ 50µm → 2 px/µm
        const ppm = computePpm({ x: 0, y: 0 }, { x: 100, y: 0 }, 50);
        expect(ppm).toBe(2);
    });

    it('returns null for zero/negative micron distance', () => {
        expect(computePpm({ x: 0, y: 0 }, { x: 10, y: 0 }, 0)).toBeNull();
        expect(computePpm({ x: 0, y: 0 }, { x: 10, y: 0 }, -5)).toBeNull();
    });

    it('returns null for non-finite distance (NaN entry)', () => {
        expect(computePpm({ x: 0, y: 0 }, { x: 10, y: 0 }, NaN)).toBeNull();
        expect(computePpm({ x: 0, y: 0 }, { x: 10, y: 0 }, Infinity)).toBeNull();
    });

    it('returns null when line has zero length (same point)', () => {
        expect(computePpm({ x: 5, y: 5 }, { x: 5, y: 5 }, 100)).toBeNull();
    });

    it('returns null for missing endpoints', () => {
        expect(computePpm(/** @type {any} */ (null), { x: 1, y: 1 }, 10)).toBeNull();
        expect(computePpm({ x: 1, y: 1 }, /** @type {any} */ (null), 10)).toBeNull();
    });

    it('returns null for non-number micron distance', () => {
        expect(computePpm({ x: 0, y: 0 }, { x: 10, y: 0 }, /** @type {any} */ ('100'))).toBeNull();
    });
});

describe('canvasPointFromClick', () => {
    it('translates client coords to canvas-pixel coords (1:1 scale)', () => {
        const canvas = /** @type {any} */ ({
            width: 200, height: 100,
            getBoundingClientRect: () => ({ left: 50, top: 30, width: 200, height: 100 }),
        });
        const pt = canvasPointFromClick(canvas, { clientX: 60, clientY: 40 });
        expect(pt.x).toBe(10);
        expect(pt.y).toBe(10);
    });

    it('compensates for CSS-scaled canvas (rect smaller than intrinsic)', () => {
        // Canvas is 800x400 intrinsic but CSS-scaled to 400x200
        const canvas = /** @type {any} */ ({
            width: 800, height: 400,
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 400, height: 200 }),
        });
        // Click at CSS (200, 100) = mid-canvas
        const pt = canvasPointFromClick(canvas, { clientX: 200, clientY: 100 });
        expect(pt.x).toBe(400);
        expect(pt.y).toBe(200);
    });

    it('handles zero rect size without throwing (defensive)', () => {
        const canvas = /** @type {any} */ ({
            width: 100, height: 100,
            getBoundingClientRect: () => ({ left: 0, top: 0, width: 0, height: 0 }),
        });
        const pt = canvasPointFromClick(canvas, { clientX: 50, clientY: 50 });
        expect(isFinite(pt.x)).toBe(true);
        expect(isFinite(pt.y)).toBe(true);
    });
});
