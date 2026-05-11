import { describe, it, expect } from 'vitest';
import {
    panGeom, clampPan, resolveSplit, syncFracFromPx, syncPxFromFrac,
    coverDims, clampZoom,
} from './pan-zoom.js';

describe('panGeom — at zoom 1', () => {
    it('square-in-square slot — no overflow on either axis → both max = 0 → pan locked', () => {
        const g = panGeom({ srcW: 200, srcH: 200, slotW: 200, slotH: 200, zoom: 1 });
        expect(g.totalMaxX).toBe(0);
        expect(g.totalMaxY).toBe(0);
    });
    it('landscape source in portrait slot — X overflow, Y locked', () => {
        // cover scales the source so the slot is fully covered; here
        // 400x200 in 200x400 slot would NOT cover — so caller would pass
        // srcW=400, srcH=400 to represent the cover-fit. Geometry only
        // cares about the displayed dims.
        const g = panGeom({ srcW: 400, srcH: 400, slotW: 200, slotH: 400, zoom: 1 });
        expect(g.opMaxX).toBe(100); // (400-200)/2 = 100
        expect(g.opMaxY).toBe(0);
    });
    it('zoom multiplies the natural overflow', () => {
        const g = panGeom({ srcW: 400, srcH: 400, slotW: 200, slotH: 400, zoom: 2 });
        // natural X overflow 200, * zoom 2 = 400, /2 = 200
        expect(g.opMaxX).toBe(200);
    });
});

describe('panGeom — at zoom > 1', () => {
    it('square-in-square at zoom 2 → txMax = slotW/2 each axis', () => {
        const g = panGeom({ srcW: 200, srcH: 200, slotW: 200, slotH: 200, zoom: 2 });
        expect(g.txMaxX).toBe(100); // (2-1)*200/2
        expect(g.txMaxY).toBe(100);
        expect(g.totalMaxX).toBe(100);
    });
    it('totalMax adds opMax + txMax', () => {
        const g = panGeom({ srcW: 400, srcH: 400, slotW: 200, slotH: 400, zoom: 2 });
        expect(g.totalMaxX).toBe(g.opMaxX + g.txMaxX);
    });
});

describe('clampPan', () => {
    it('keeps in-range pan unchanged', () => {
        const r = clampPan({ srcW: 400, srcH: 400, slotW: 200, slotH: 400, zoom: 2, panX: 100, panY: 0 });
        expect(r.panX).toBe(100);
    });
    it('clamps over-pan to ±totalMax', () => {
        const r = clampPan({ srcW: 400, srcH: 400, slotW: 200, slotH: 400, zoom: 2, panX: 10_000, panY: -10_000 });
        const g = panGeom({ srcW: 400, srcH: 400, slotW: 200, slotH: 400, zoom: 2 });
        expect(r.panX).toBe(g.totalMaxX);
        expect(r.panY).toBe(-g.totalMaxY);
    });
});

describe('resolveSplit', () => {
    it('pan inside opMax → all in object-position, 0 transform', () => {
        const r = resolveSplit({ srcW: 400, srcH: 400, slotW: 200, slotH: 400, zoom: 1, panX: 50, panY: 0 });
        expect(r.txX).toBe(0);
        expect(r.txY).toBe(0);
        // opXPct deviates from 50% by ((50/1)/(400-200))*100 = 25 → 25%
        expect(r.opXPct).toBe(25);
    });
    it('pan exceeds opMax → remainder spills to translate', () => {
        // opMaxX at zoom 2 = 200; pan 250 → opX=200, txX=50
        const r = resolveSplit({ srcW: 400, srcH: 400, slotW: 200, slotH: 400, zoom: 2, panX: 250, panY: 0 });
        expect(r.txX).toBe(50);
    });
    it('square-in-square no overflow → opPct stays 50% center', () => {
        const r = resolveSplit({ srcW: 200, srcH: 200, slotW: 200, slotH: 200, zoom: 1, panX: 0, panY: 0 });
        expect(r.opXPct).toBe(50);
        expect(r.opYPct).toBe(50);
    });
});

describe('frac ↔ px round-trip', () => {
    it('syncFracFromPx then syncPxFromFrac is identity', () => {
        const seed = { srcW: 400, srcH: 600, slotW: 200, slotH: 400, zoom: 2.5, panX: 87, panY: -42 };
        const frac = syncFracFromPx(seed);
        const back = syncPxFromFrac({ ...seed, panFracX: frac.panFracX, panFracY: frac.panFracY });
        expect(back.panX).toBeCloseTo(87, 5);
        expect(back.panY).toBeCloseTo(-42, 5);
    });
    it('fraction is invariant under slot scaling (when slot aspect is constant)', () => {
        // Same panX expressed via fraction translates correctly to the new
        // slot dims. slot aspect 9:16 → if slotW doubles, slotH doubles.
        const srcA = { zoom: 2, slotW: 100, slotH: 178 };
        const px   = { panX: 30, panY: 0 };
        const frac = syncFracFromPx({ srcW: 100, srcH: 178, ...srcA, ...px });
        // On a 2x device, slot is 200x356
        const srcB = { zoom: 2, slotW: 200, slotH: 356 };
        const back = syncPxFromFrac({ srcW: 200, srcH: 356, ...srcB, ...frac });
        expect(back.panX).toBeCloseTo(60, 5); // pan doubles with slot width
    });
});

describe('coverDims', () => {
    it('landscape source in portrait slot covers via height-fit', () => {
        const r = coverDims({ naturalW: 1000, naturalH: 500, slotW: 200, slotH: 400 });
        // Larger scale is slotH/naturalH = 0.8 → srcH = 400, srcW = 800
        expect(r.srcW).toBe(800);
        expect(r.srcH).toBe(400);
    });
    it('portrait source in landscape slot covers via width-fit', () => {
        const r = coverDims({ naturalW: 300, naturalH: 600, slotW: 600, slotH: 300 });
        // Larger scale = slotW/naturalW = 2 → srcW = 600, srcH = 1200
        expect(r.srcW).toBe(600);
        expect(r.srcH).toBe(1200);
    });
    it('degenerate inputs return slot dims', () => {
        const r = coverDims({ naturalW: 0, naturalH: 100, slotW: 200, slotH: 200 });
        expect(r.srcW).toBe(200);
        expect(r.srcH).toBe(200);
    });
});

describe('clampZoom', () => {
    it('1 below → 1, 4 above → 4', () => {
        expect(clampZoom(0.5)).toBe(1);
        expect(clampZoom(10)).toBe(4);
    });
    it('in-range passes through', () => {
        expect(clampZoom(2.5)).toBe(2.5);
    });
    it('NaN → 1', () => {
        expect(clampZoom(NaN)).toBe(1);
    });
});
