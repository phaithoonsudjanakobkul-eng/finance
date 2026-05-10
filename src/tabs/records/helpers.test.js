import { describe, it, expect } from 'vitest';
import { todayMonth, shiftMonth, sumArr, readMonth, findLastNonEmpty } from './helpers.js';

describe('todayMonth', () => {
    it('returns YYYY-MM shape for current month', () => {
        const s = todayMonth();
        expect(s).toMatch(/^\d{4}-\d{2}$/);
    });

    it('zero-pads single-digit month', () => {
        // Can't fully control system date, but verify the format always pads
        const s = todayMonth();
        const mm = s.split('-')[1];
        expect(mm.length).toBe(2);
    });
});

describe('shiftMonth', () => {
    it('+1 month within same year', () => {
        expect(shiftMonth('2026-05', 1)).toBe('2026-06');
    });

    it('-1 month within same year', () => {
        expect(shiftMonth('2026-05', -1)).toBe('2026-04');
    });

    it('rolls forward across year boundary (Dec → Jan)', () => {
        expect(shiftMonth('2026-12', 1)).toBe('2027-01');
    });

    it('rolls backward across year boundary (Jan → Dec)', () => {
        expect(shiftMonth('2026-01', -1)).toBe('2025-12');
    });

    it('handles large positive deltas', () => {
        expect(shiftMonth('2026-05', 13)).toBe('2027-06');
    });

    it('handles large negative deltas', () => {
        expect(shiftMonth('2026-05', -13)).toBe('2025-04');
    });

    it('zero delta returns same month', () => {
        expect(shiftMonth('2026-05', 0)).toBe('2026-05');
    });
});

describe('sumArr', () => {
    it('returns 0 for empty / non-array input', () => {
        expect(sumArr([])).toBe(0);
        expect(sumArr(/** @type {any} */ (null))).toBe(0);
        expect(sumArr(/** @type {any} */ (undefined))).toBe(0);
    });

    it('prefers .val over .amount when both present', () => {
        const items = [{ val: 100, amount: 999 }, { val: 50, amount: 999 }];
        expect(sumArr(items)).toBe(150);
    });

    it('falls back to .amount when .val missing', () => {
        const items = [{ amount: 100 }, { amount: 50 }];
        expect(sumArr(items)).toBe(150);
    });

    it('coerces .amount string to number', () => {
        const items = [{ amount: '100' }, { amount: '50' }];
        expect(sumArr(items)).toBe(150);
    });

    it('skips entries with NaN .val (uses .amount fallback)', () => {
        const items = [{ val: NaN, amount: 100 }];
        expect(sumArr(items)).toBe(100);
    });

    it('treats malformed entries as 0', () => {
        const items = [{ val: 100 }, null, undefined, {}];
        expect(sumArr(items)).toBe(100);
    });

    it('handles negative values (refunds)', () => {
        const items = [{ val: 100 }, { val: -30 }];
        expect(sumArr(items)).toBe(70);
    });
});

describe('readMonth', () => {
    it('returns zero summary when month not in records', () => {
        const r = readMonth('2026-05', []);
        expect(r).toEqual({ id: '2026-05', payday: 0, expenses: 0, balance: 0, rate: 0 });
    });

    it('computes payday/expenses/balance/rate', () => {
        const records = [
            { id: '2026-05', payday: 50000, fixed: [{ val: 10000 }], dynamic: [{ val: 5000 }] },
        ];
        const r = readMonth('2026-05', records);
        expect(r.payday).toBe(50000);
        expect(r.expenses).toBe(15000);
        expect(r.balance).toBe(35000);
        expect(r.rate).toBe(70); // (35000 / 50000) * 100
    });

    it('rate is 0 when payday is 0', () => {
        const records = [{ id: '2026-05', payday: 0, fixed: [{ val: 1000 }], dynamic: [] }];
        const r = readMonth('2026-05', records);
        expect(r.rate).toBe(0);
        expect(r.balance).toBe(-1000); // negative balance is fine
    });

    it('rounds rate to integer', () => {
        const records = [{ id: '2026-05', payday: 30000, fixed: [{ val: 10000 }], dynamic: [] }];
        const r = readMonth('2026-05', records);
        // (20000 / 30000) * 100 = 66.66… → rounded
        expect(r.rate).toBe(67);
    });

    it('non-array records returns zero summary', () => {
        const r = readMonth('2026-05', /** @type {any} */ (null));
        expect(r.payday).toBe(0);
    });

    it('non-numeric payday treated as 0', () => {
        const records = [{ id: '2026-05', payday: /** @type {any} */ ('oops'), fixed: [], dynamic: [] }];
        const r = readMonth('2026-05', records);
        expect(r.payday).toBe(0);
    });
});

describe('findLastNonEmpty', () => {
    it('returns null when no records present', () => {
        expect(findLastNonEmpty('2026-05', [])).toBeNull();
    });

    it('returns the most recent non-empty prior month', () => {
        const records = [
            { id: '2026-04', payday: 0, fixed: [], dynamic: [] }, // empty
            { id: '2026-03', payday: 50000, fixed: [{ val: 100 }], dynamic: [] }, // non-empty
        ];
        const r = findLastNonEmpty('2026-05', records);
        expect(r && r.id).toBe('2026-03');
    });

    it('skips empty months', () => {
        const records = [
            { id: '2026-04', payday: 0, fixed: [], dynamic: [] },
            { id: '2026-02', payday: 50000, fixed: [{ val: 1 }], dynamic: [] },
        ];
        const r = findLastNonEmpty('2026-05', records);
        expect(r && r.id).toBe('2026-02');
    });

    it('respects maxLookback', () => {
        const records = [{ id: '2025-01', payday: 1, fixed: [{ val: 1 }], dynamic: [] }];
        // Default 24 months back from 2026-05 = 2024-05; 2025-01 is 16 mo back
        expect(findLastNonEmpty('2026-05', records)).not.toBeNull();
        // With small lookback, won't find it
        expect(findLastNonEmpty('2026-05', records, 6)).toBeNull();
    });

    it('current month itself is not searched (only PRIOR months)', () => {
        const records = [{ id: '2026-05', payday: 50000, fixed: [{ val: 1 }], dynamic: [] }];
        expect(findLastNonEmpty('2026-05', records)).toBeNull();
    });
});
