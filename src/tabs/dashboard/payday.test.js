// Unit tests for V3 dashboard hero numeric helpers.
// _daysInMonth handles leap-year February; _nextPayday picks the right
// month and clamps day-of-month when the payday-day exceeds the next
// month's length (e.g. payday 31 in February).

import { describe, it, expect } from 'vitest';
import { _daysInMonth, _nextPayday } from './index.js';

describe('_daysInMonth', () => {
    it('returns 31 for January', () => {
        expect(_daysInMonth(2026, 1)).toBe(31);
    });
    it('returns 28 for non-leap February 2026', () => {
        expect(_daysInMonth(2026, 2)).toBe(28);
    });
    it('returns 29 for leap February 2024', () => {
        expect(_daysInMonth(2024, 2)).toBe(29);
    });
    it('returns 30 for April', () => {
        expect(_daysInMonth(2026, 4)).toBe(30);
    });
    it('returns 31 for December', () => {
        expect(_daysInMonth(2026, 12)).toBe(31);
    });
});

describe('_nextPayday', () => {
    it('today is before payday — payday is later this month', () => {
        const today = new Date(2026, 4, 10); // May 10
        const r = _nextPayday(25, today);
        expect(r.days).toBe(15);
    });

    it('today is the payday — 0 days', () => {
        const today = new Date(2026, 4, 25); // May 25
        const r = _nextPayday(25, today);
        expect(r.days).toBe(0);
    });

    it('today is after payday — rolls to next month', () => {
        const today = new Date(2026, 4, 27); // May 27 → next is June 25
        const r = _nextPayday(25, today);
        expect(r.days).toBe(29);
    });

    it('December roll into next-year January', () => {
        const today = new Date(2026, 11, 30); // Dec 30 → Jan 25 2027
        const r = _nextPayday(25, today);
        expect(r.days).toBe(26);
    });

    it('clamps to month length when payday > current month length (Feb 31 → Feb 28)', () => {
        // Feb 1 2026 (non-leap), payday-day 31 → clamp to Feb 28 → 27 days
        const today = new Date(2026, 1, 1);
        const r = _nextPayday(31, today);
        expect(r.days).toBe(27);
    });

    it('exposes a human-readable "when" string', () => {
        const today = new Date(2026, 4, 10);
        const r = _nextPayday(25, today);
        expect(typeof r.when).toBe('string');
        expect(r.when.length).toBeGreaterThan(0);
    });
});
