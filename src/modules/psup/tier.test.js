import { describe, it, expect } from 'vitest';
import { attenuateTier } from './tier.js';
import { TIER_PRESETS } from './index.js';

describe('attenuateTier', () => {
    const balanced = TIER_PRESETS.balanced;

    it('mul=1.0 returns the preset values verbatim', () => {
        const out = attenuateTier(balanced, 1.0);
        expect(out).toEqual(balanced);
    });

    it('mul=0 zeroes additive params + collapses multiplicative to 1.0', () => {
        const out = attenuateTier(balanced, 0);
        expect(out.hf1).toBe(0);
        expect(out.hf2).toBe(0);
        expect(out.grain).toBe(0);
        expect(out.sharpen).toBe(0);
        expect(out.contrast).toBe(1);
        expect(out.sat).toBe(1);
    });

    it('mul=0.5 halves additive params + halves the multiplicative offset', () => {
        const out = attenuateTier(balanced, 0.5);
        expect(out.hf1).toBeCloseTo(balanced.hf1 * 0.5, 6);
        expect(out.sharpen).toBeCloseTo(balanced.sharpen * 0.5, 6);
        // contrast: 1.04 → 1 + 0.04*0.5 = 1.02
        expect(out.contrast).toBeCloseTo(1 + (balanced.contrast - 1) * 0.5, 6);
        expect(out.sat).toBeCloseTo(1 + (balanced.sat - 1) * 0.5, 6);
    });

    it('mul=0.4 (BHI DAT2) attenuates contrast 1.04 → 1.016', () => {
        const out = attenuateTier(balanced, 0.4);
        expect(out.contrast).toBeCloseTo(1.016, 4);
        expect(out.sharpen).toBeCloseTo(balanced.sharpen * 0.4, 6);
    });

    it('Fast preset (all-zero additive) stays zero regardless of mul', () => {
        const out = attenuateTier(TIER_PRESETS.fast, 0.5);
        expect(out.hf1).toBe(0);
        expect(out.grain).toBe(0);
        expect(out.contrast).toBe(1);
        expect(out.sat).toBe(1);
    });

    it('Maximum preset attenuates correctly at mul=0.4', () => {
        const max = TIER_PRESETS.maximum;
        const out = attenuateTier(max, 0.4);
        expect(out.hf1).toBeCloseTo(max.hf1 * 0.4, 6);
        expect(out.grain).toBeCloseTo(max.grain * 0.4, 6);
        expect(out.contrast).toBeCloseTo(1 + (max.contrast - 1) * 0.4, 6);
    });

    it('non-finite mul falls back to 1.0 (defensive — bad data ≠ over-process)', () => {
        const a = attenuateTier(balanced, /** @type {any} */ ('oops'));
        const b = attenuateTier(balanced, NaN);
        const c = attenuateTier(balanced, Infinity);
        expect(a).toEqual(balanced);
        expect(b).toEqual(balanced);
        expect(c).toEqual(balanced);
    });

    it('negative mul falls back to 1.0', () => {
        expect(attenuateTier(balanced, -0.5)).toEqual(balanced);
    });

    it('mul > 1.0 amplifies (allowed for power users)', () => {
        const out = attenuateTier(balanced, 2.0);
        expect(out.hf1).toBeCloseTo(balanced.hf1 * 2, 6);
        expect(out.contrast).toBeCloseTo(1 + (balanced.contrast - 1) * 2, 6);
    });

    it('does not mutate the input preset', () => {
        const snapshot = { ...balanced };
        attenuateTier(balanced, 0.4);
        expect(balanced).toEqual(snapshot);
    });
});
