import { describe, it, expect } from 'vitest';
import { reorderList, dropPositionFromY, moveToEnd } from './reorder.js';

describe('reorderList', () => {
    const base = ['A', 'B', 'C', 'D', 'E'];

    it('moves a symbol earlier — drop "before" target', () => {
        // Move D before B → A D B C E
        expect(reorderList(base, 'D', 'B', 'before')).toEqual(['A', 'D', 'B', 'C', 'E']);
    });

    it('moves a symbol earlier — drop "after" target', () => {
        // Move D after B → A B D C E
        expect(reorderList(base, 'D', 'B', 'after')).toEqual(['A', 'B', 'D', 'C', 'E']);
    });

    it('moves a symbol later — drop "before" target', () => {
        // Move A before D → B C A D E
        expect(reorderList(base, 'A', 'D', 'before')).toEqual(['B', 'C', 'A', 'D', 'E']);
    });

    it('moves a symbol later — drop "after" target', () => {
        // Move A after D → B C D A E
        expect(reorderList(base, 'A', 'D', 'after')).toEqual(['B', 'C', 'D', 'A', 'E']);
    });

    it('drop on first row, position before → moves to head', () => {
        expect(reorderList(base, 'C', 'A', 'before')).toEqual(['C', 'A', 'B', 'D', 'E']);
    });

    it('drop on last row, position after → moves to tail', () => {
        expect(reorderList(base, 'B', 'E', 'after')).toEqual(['A', 'C', 'D', 'E', 'B']);
    });

    it('self-drop is a no-op (returns clone)', () => {
        const out = reorderList(base, 'C', 'C', 'before');
        expect(out).toEqual(base);
        expect(out).not.toBe(base); // it's a clone
    });

    it('drop adjacent ("after" predecessor) is effectively a no-op', () => {
        // C after B → A B C D E (unchanged because C was already right after B)
        expect(reorderList(base, 'C', 'B', 'after')).toEqual(base);
    });

    it('returns clone unchanged when src is missing', () => {
        const out = reorderList(base, 'XX', 'B', 'before');
        expect(out).toEqual(base);
        expect(out).not.toBe(base);
    });

    it('returns clone unchanged when target is missing', () => {
        expect(reorderList(base, 'A', 'XX', 'before')).toEqual(base);
    });

    it('does not mutate the input array', () => {
        const snapshot = base.slice();
        reorderList(base, 'D', 'B', 'before');
        expect(base).toEqual(snapshot);
    });

    it('handles empty list', () => {
        expect(reorderList([], 'A', 'B', 'before')).toEqual([]);
    });

    it('handles single-element list', () => {
        expect(reorderList(['X'], 'X', 'X', 'before')).toEqual(['X']);
    });

    it('returns clone on non-string args (defensive)', () => {
        expect(reorderList(base, /** @type {any} */ (null), 'A', 'before')).toEqual(base);
        expect(reorderList(base, 'A', /** @type {any} */ (undefined), 'before')).toEqual(base);
    });

    it('returns [] on non-array input', () => {
        expect(reorderList(/** @type {any} */ (null), 'A', 'B', 'before')).toEqual([]);
    });
});

describe('dropPositionFromY', () => {
    const rect = { top: 100, height: 40 }; // midpoint = 120

    it('returns "before" when cursor is above the midpoint', () => {
        expect(dropPositionFromY(rect, 100)).toBe('before');
        expect(dropPositionFromY(rect, 119)).toBe('before');
    });

    it('returns "after" when cursor is at or below the midpoint', () => {
        expect(dropPositionFromY(rect, 120)).toBe('after');
        expect(dropPositionFromY(rect, 140)).toBe('after');
    });

    it('handles zero-height rect (degenerate, should not throw)', () => {
        const out = dropPositionFromY({ top: 50, height: 0 }, 50);
        expect(out === 'before' || out === 'after').toBe(true);
    });
});

describe('moveToEnd', () => {
    const base = ['A', 'B', 'C', 'D'];

    it('moves an interior symbol to the end', () => {
        expect(moveToEnd(base, 'B')).toEqual(['A', 'C', 'D', 'B']);
    });

    it('moving the last symbol is a clone (effectively no-op)', () => {
        const out = moveToEnd(base, 'D');
        expect(out).toEqual(base);
        expect(out).not.toBe(base);
    });

    it('does not duplicate when symbol exists', () => {
        const out = moveToEnd(base, 'A');
        expect(out.filter((s) => s === 'A')).toHaveLength(1);
    });

    it('returns clone unchanged when symbol missing', () => {
        expect(moveToEnd(base, 'ZZ')).toEqual(base);
    });

    it('returns [] on non-array input', () => {
        expect(moveToEnd(/** @type {any} */ (null), 'A')).toEqual([]);
    });

    it('does not mutate input', () => {
        const snapshot = base.slice();
        moveToEnd(base, 'B');
        expect(base).toEqual(snapshot);
    });
});
