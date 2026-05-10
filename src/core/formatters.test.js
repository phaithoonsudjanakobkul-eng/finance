import { describe, it, expect } from 'vitest';
import { MONEY_FMT, PRICE_FMT, DELTA_FMT, VOL_FMT } from './formatters.js';

describe('MONEY_FMT', () => {
    it('rounds whole baht with thousand separators', () => {
        expect(MONEY_FMT.format(1234)).toBe('1,234');
        expect(MONEY_FMT.format(50000)).toBe('50,000');
        expect(MONEY_FMT.format(1500000)).toBe('1,500,000');
    });

    it('rounds away decimals', () => {
        expect(MONEY_FMT.format(1234.7)).toBe('1,235');
        expect(MONEY_FMT.format(1234.4)).toBe('1,234');
    });

    it('handles zero + negative', () => {
        expect(MONEY_FMT.format(0)).toBe('0');
        expect(MONEY_FMT.format(-500)).toBe('-500');
    });
});

describe('PRICE_FMT', () => {
    it('always shows exactly 2 decimals so columns align', () => {
        expect(PRICE_FMT.format(195)).toBe('195.00');
        expect(PRICE_FMT.format(195.5)).toBe('195.50');
        expect(PRICE_FMT.format(195.123)).toBe('195.12');
    });

    it('thousand separators on large prices', () => {
        expect(PRICE_FMT.format(1234.56)).toBe('1,234.56');
    });

    it('handles zero + negative', () => {
        expect(PRICE_FMT.format(0)).toBe('0.00');
        expect(PRICE_FMT.format(-12.5)).toBe('-12.50');
    });
});

describe('DELTA_FMT', () => {
    it('positive values get a leading +', () => {
        expect(DELTA_FMT.format(2.5)).toBe('+2.50');
        expect(DELTA_FMT.format(0.01)).toBe('+0.01');
    });

    it('negative values keep a leading -', () => {
        expect(DELTA_FMT.format(-2.5)).toBe('-2.50');
    });

    it('zero shows a + sign (signDisplay always)', () => {
        expect(DELTA_FMT.format(0)).toBe('+0.00');
    });

    it('always exactly 2 decimals (matches PRICE_FMT alignment)', () => {
        expect(DELTA_FMT.format(1)).toBe('+1.00');
        expect(DELTA_FMT.format(1.235)).toBe('+1.24');
    });
});

describe('VOL_FMT', () => {
    it('compacts millions to "M"', () => {
        expect(VOL_FMT.format(1_500_000)).toBe('1.5M');
        expect(VOL_FMT.format(50_000_000)).toBe('50M');
    });

    it('compacts thousands to "K"', () => {
        expect(VOL_FMT.format(1_500)).toBe('1.5K');
        expect(VOL_FMT.format(50_000)).toBe('50K');
    });

    it('compacts billions to "B"', () => {
        expect(VOL_FMT.format(2_500_000_000)).toBe('2.5B');
    });

    it('handles small / zero values', () => {
        expect(VOL_FMT.format(0)).toBe('0');
        expect(VOL_FMT.format(42)).toBe('42');
    });

    it('one decimal place max (no 1.55M-style noise)', () => {
        expect(VOL_FMT.format(1_234_567)).toBe('1.2M');
    });
});

describe('formatter caching contract', () => {
    it('exported instances are stable across imports (same reference)', async () => {
        // Re-import to confirm we get the same instance (not a fresh one)
        const a = await import('./formatters.js');
        const b = await import('./formatters.js');
        expect(a.MONEY_FMT).toBe(b.MONEY_FMT);
        expect(a.PRICE_FMT).toBe(b.PRICE_FMT);
        expect(a.DELTA_FMT).toBe(b.DELTA_FMT);
        expect(a.VOL_FMT).toBe(b.VOL_FMT);
    });
});
