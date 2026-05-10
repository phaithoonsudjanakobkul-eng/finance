import { describe, it, expect } from 'vitest';
import { angleDeg } from './measure.js';

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
