// Watchlist drag-to-reorder — pure math extracted for unit tests.
//
// `reorderList` takes the current symbol order + the dragged symbol +
// the row the user dropped on (+ whether the cursor was above or below
// the row midpoint) and returns a fresh array with the dragged symbol
// re-inserted at the right slot. Returns a clone of the input on any
// invalid argument so the caller can blindly assign without checks.

/**
 * Move `srcSym` to a new position relative to `targetSym`. `position`:
 *   'before' = drop above the target (insert at target's index)
 *   'after'  = drop below the target (insert at target's index + 1)
 * Self-drops, missing entries, and identical positions return a clone
 * of the original list (no-op).
 *
 * @param {string[]} list
 * @param {string} srcSym
 * @param {string} targetSym
 * @param {'before' | 'after'} position
 * @returns {string[]}
 */
export function reorderList(list, srcSym, targetSym, position) {
    if (!Array.isArray(list)) return [];
    if (typeof srcSym !== 'string' || typeof targetSym !== 'string') return list.slice();
    if (srcSym === targetSym) return list.slice();
    const srcIdx = list.indexOf(srcSym);
    const tgtIdx = list.indexOf(targetSym);
    if (srcIdx < 0 || tgtIdx < 0) return list.slice();
    const arr = list.slice();
    arr.splice(srcIdx, 1); // removing srcSym shifts later indices left by 1
    let insertIdx = arr.indexOf(targetSym);
    if (insertIdx < 0) return list.slice();
    if (position === 'after') insertIdx += 1;
    arr.splice(insertIdx, 0, srcSym);
    return arr;
}

/**
 * Decide whether to drop above or below a hovered row based on the
 * cursor's Y position relative to the row's vertical midpoint. Pure so
 * a Playwright-style coord-driven test can pin the threshold logic.
 *
 * @param {{ top: number, height: number }} rect
 * @param {number} clientY
 * @returns {'before' | 'after'}
 */
export function dropPositionFromY(rect, clientY) {
    const mid = rect.top + (rect.height / 2);
    return clientY < mid ? 'before' : 'after';
}

/**
 * Append `srcSym` to the end of the list (used when the user drops on
 * empty space below the last row). Removes any existing copy first so
 * the symbol can't appear twice. Returns a clone unchanged when the
 * symbol isn't in the list.
 *
 * @param {string[]} list
 * @param {string} srcSym
 * @returns {string[]}
 */
export function moveToEnd(list, srcSym) {
    if (!Array.isArray(list)) return [];
    const i = list.indexOf(srcSym);
    if (i < 0) return list.slice();
    const arr = list.slice();
    arr.splice(i, 1);
    arr.push(srcSym);
    return arr;
}
