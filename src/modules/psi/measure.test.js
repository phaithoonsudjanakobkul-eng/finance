import { describe, it, expect } from 'vitest';
import { angleDeg, polygonAreaPx, polygonCentroid } from './measure.js';

describe('angleDeg', () => {
    it('returns 90 for a perpendicular L', () => {
        // a=(1,0), b=(0,0), c=(0,1) — rays along +x and +y
        const v = angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 });
        expect(v).toBeCloseTo(90, 6);
    });

    it('returns 180 for a straight line through the vertex', () => {
        const v = angleDeg({ x: -5, y: 0 }, { x: 0, y: 0 }, { x: 5, y: 0 });
        expect(v).toBeCloseTo(180, 6);
    });

    it('returns 0 for two rays in the same direction', () => {
        const v = angleDeg({ x: 5, y: 0 }, { x: 0, y: 0 }, { x: 10, y: 0 });
        expect(v).toBeCloseTo(0, 6);
    });

    it('returns 45 for a 45-degree corner', () => {
        const v = angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: 1, y: 1 });
        expect(v).toBeCloseTo(45, 6);
    });

    it('returns 135 for an obtuse angle', () => {
        const v = angleDeg({ x: 1, y: 0 }, { x: 0, y: 0 }, { x: -1, y: 1 });
        expect(v).toBeCloseTo(135, 6);
    });

    it('is order-independent for the two outer points', () => {
        const a = { x: 3, y: 0 }, b = { x: 0, y: 0 }, c = { x: 0, y: 7 };
        expect(angleDeg(a, b, c)).toBeCloseTo(/** @type {number} */ (angleDeg(c, b, a)), 6);
    });

    it('clamps near-collinear floating drift (no NaN)', () => {
        // Points engineered to push acos input slightly past 1.0 via FP error
        const a = { x: 1, y: 0 }, b = { x: 0, y: 0 }, c = { x: 1e15, y: 0 };
        const v = angleDeg(a, b, c);
        expect(v).not.toBeNaN();
        expect(v).toBeCloseTo(0, 4);
    });

    it('returns null when vertex coincides with point a', () => {
        expect(angleDeg({ x: 5, y: 5 }, { x: 5, y: 5 }, { x: 1, y: 1 })).toBeNull();
    });

    it('returns null when vertex coincides with point c', () => {
        expect(angleDeg({ x: 1, y: 1 }, { x: 5, y: 5 }, { x: 5, y: 5 })).toBeNull();
    });

    it('returns null for missing endpoints', () => {
        expect(angleDeg(/** @type {any} */ (null), { x: 0, y: 0 }, { x: 1, y: 1 })).toBeNull();
        expect(angleDeg({ x: 1, y: 1 }, /** @type {any} */ (null), { x: 0, y: 0 })).toBeNull();
        expect(angleDeg({ x: 0, y: 0 }, { x: 1, y: 1 }, /** @type {any} */ (null))).toBeNull();
    });
});

describe('polygonAreaPx', () => {
    it('unit square (CCW) → 1', () => {
        const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
        expect(polygonAreaPx(pts)).toBeCloseTo(1, 6);
    });

    it('unit square (CW) → 1 (winding order does not change area)', () => {
        const pts = [{ x: 0, y: 0 }, { x: 0, y: 1 }, { x: 1, y: 1 }, { x: 1, y: 0 }];
        expect(polygonAreaPx(pts)).toBeCloseTo(1, 6);
    });

    it('100×100 rectangle → 10000', () => {
        const pts = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }, { x: 0, y: 100 }];
        expect(polygonAreaPx(pts)).toBe(10000);
    });

    it('3-4-5 right triangle → 6', () => {
        const pts = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 4 }];
        expect(polygonAreaPx(pts)).toBe(6);
    });

    it('returns 0 for degenerate inputs (< 3 points)', () => {
        expect(polygonAreaPx([])).toBe(0);
        expect(polygonAreaPx([{ x: 1, y: 1 }])).toBe(0);
        expect(polygonAreaPx([{ x: 1, y: 1 }, { x: 2, y: 2 }])).toBe(0);
    });

    it('returns 0 for collinear points', () => {
        const pts = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }];
        expect(polygonAreaPx(pts)).toBe(0);
    });

    it('handles concave polygons (square with triangular bite)', () => {
        // 10×10 square with a triangular bite carved into the top edge.
        // Bite vertices: (10,10) → (5,5) → (0,10) — base 10 along y=10, height 5
        // down to y=5 → bite area = ½·10·5 = 25 → total = 100 − 25 = 75.
        const pts = [
            { x: 0,  y: 0  },
            { x: 10, y: 0  },
            { x: 10, y: 10 },
            { x: 5,  y: 5  },
            { x: 0,  y: 10 },
        ];
        expect(polygonAreaPx(pts)).toBeCloseTo(75, 6);
    });
});

describe('polygonCentroid', () => {
    it('unit square centroid is (0.5, 0.5)', () => {
        const pts = [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: 1, y: 1 }, { x: 0, y: 1 }];
        const c = polygonCentroid(pts);
        expect(c).not.toBeNull();
        if (c) {
            expect(c.x).toBeCloseTo(0.5, 6);
            expect(c.y).toBeCloseTo(0.5, 6);
        }
    });

    it('right triangle centroid is at 1/3 of the way', () => {
        // 3-4-5 triangle: centroid = (1, 4/3)
        const pts = [{ x: 0, y: 0 }, { x: 3, y: 0 }, { x: 0, y: 4 }];
        const c = polygonCentroid(pts);
        expect(c).not.toBeNull();
        if (c) {
            expect(c.x).toBeCloseTo(1, 6);
            expect(c.y).toBeCloseTo(4 / 3, 6);
        }
    });

    it('falls back to point average for collinear points (degenerate)', () => {
        const pts = [{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 10, y: 0 }];
        const c = polygonCentroid(pts);
        expect(c).not.toBeNull();
        if (c) {
            expect(c.x).toBeCloseTo(5, 6);
            expect(c.y).toBe(0);
        }
    });

    it('returns null for empty input', () => {
        expect(polygonCentroid([])).toBeNull();
    });

    it('< 3 points → simple average', () => {
        const c = polygonCentroid([{ x: 0, y: 0 }, { x: 4, y: 6 }]);
        expect(c).not.toBeNull();
        if (c) {
            expect(c.x).toBe(2);
            expect(c.y).toBe(3);
        }
    });
});
