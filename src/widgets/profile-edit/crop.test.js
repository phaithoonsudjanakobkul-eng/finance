import { describe, it, expect } from 'vitest';
import { minZoom, clampPan, computeCropRect, centerPan, zoomAboutCenter } from './crop.js';

describe('minZoom', () => {
    it('square 400 source in 200 vp → 0.5', () => {
        expect(minZoom({ srcW: 400, srcH: 400, vpSize: 200 })).toBe(0.5);
    });
    it('wide source: short side dictates min zoom', () => {
        // 600x300 in 200 vp — short side is 300, vp/short = 200/300 ≈ 0.667
        expect(minZoom({ srcW: 600, srcH: 300, vpSize: 200 })).toBeCloseTo(2 / 3, 5);
    });
    it('tall source: short side dictates min zoom', () => {
        expect(minZoom({ srcW: 300, srcH: 600, vpSize: 200 })).toBeCloseTo(2 / 3, 5);
    });
    it('degenerate input returns 1', () => {
        expect(minZoom({ srcW: 0, srcH: 100, vpSize: 200 })).toBe(1);
    });
});

describe('clampPan', () => {
    it('keeps in-range translation unchanged', () => {
        const r = clampPan({ z: 1, tx: -10, ty: -10, srcW: 400, srcH: 400, vpSize: 200 });
        expect(r.tx).toBe(-10);
        expect(r.ty).toBe(-10);
    });
    it('rejects negative translation that would reveal right edge', () => {
        // image 400 at z=1, vp 200. tx must be in [200-400, 0] = [-200, 0]
        const r = clampPan({ z: 1, tx: -250, ty: -10, srcW: 400, srcH: 400, vpSize: 200 });
        expect(r.tx).toBe(-200);
    });
    it('rejects positive translation that would reveal left edge', () => {
        const r = clampPan({ z: 1, tx: 50, ty: 0, srcW: 400, srcH: 400, vpSize: 200 });
        expect(r.tx).toBe(0);
    });
});

describe('computeCropRect', () => {
    it('default-centred image → crop is the central square', () => {
        // 400 source, 200 vp, z=0.5 → image fills the viewport exactly.
        // tx, ty = 0 (already covering). Crop = source 0,0 → 400.
        const r = computeCropRect({ z: 0.5, tx: 0, ty: 0, srcW: 400, srcH: 400, vpSize: 200 });
        expect(r.sx).toBe(0);
        expect(r.sy).toBe(0);
        expect(r.sSize).toBe(400);
    });
    it('panned image → crop shifts on the source', () => {
        const r = computeCropRect({ z: 1, tx: -50, ty: -25, srcW: 400, srcH: 400, vpSize: 200 });
        expect(r.sx).toBe(50);
        expect(r.sy).toBe(25);
        expect(r.sSize).toBe(200);
    });
    it('zoomed-in image → crop is smaller portion of source', () => {
        // z=2, vp=200 → crop side = 100
        const r = computeCropRect({ z: 2, tx: 0, ty: 0, srcW: 400, srcH: 400, vpSize: 200 });
        expect(r.sSize).toBe(100);
    });
});

describe('centerPan', () => {
    it('centred for 400 source at z=0.5 in vp=200 → (0,0)', () => {
        const r = centerPan({ z: 0.5, srcW: 400, srcH: 400, vpSize: 200 });
        expect(r.tx).toBe(0);
        expect(r.ty).toBe(0);
    });
    it('centred for 400 source at z=1 in vp=200 → (-100, -100)', () => {
        const r = centerPan({ z: 1, srcW: 400, srcH: 400, vpSize: 200 });
        expect(r.tx).toBe(-100);
        expect(r.ty).toBe(-100);
    });
});

describe('zoomAboutCenter', () => {
    it('zoom 1x → 2x while keeping centre point fixed', () => {
        // Image initially fills vp at z=0.5, tx=0, ty=0. Centre point at vp
        // coords (100,100) maps to source (200, 200). After z=2 the source
        // point (200,200) should still be at (100,100).
        const r = zoomAboutCenter({ z0: 0.5, z1: 2, tx: 0, ty: 0, vpSize: 200 });
        // Verify: tx + sx*z1 = vp centre → sx = 200, so tx = 100 - 200*2 = -300
        expect(r.tx).toBe(-300);
        expect(r.ty).toBe(-300);
    });
    it('1x → 1x is identity', () => {
        const r = zoomAboutCenter({ z0: 1, z1: 1, tx: -20, ty: -30, vpSize: 200 });
        expect(r.tx).toBeCloseTo(-20, 5);
        expect(r.ty).toBeCloseTo(-30, 5);
    });
});
