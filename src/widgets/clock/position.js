// Pure positioning math for the V12 floating clock widget.
//
// All inputs/outputs are CSS pixels relative to the viewport. Helpers:
//   clampToViewport  — keep the clock fully inside the viewport
//   edgeDistance     — how close to which edge (for stow trigger)
//   stowFabFor       — corner FAB position derived from current edge
//
// No DOM access; pure functions = trivially unit-testable.

/**
 * Clamp a (x, y) point so a box of (w, h) starting at (x, y) stays
 * entirely within (0, 0, vw, vh).
 *
 * @param {{ x: number, y: number, w: number, h: number, vw: number, vh: number }} s
 * @returns {{ x: number, y: number }}
 */
export function clampToViewport(s) {
    const { w, h, vw, vh } = s;
    const maxX = Math.max(0, vw - w);
    const maxY = Math.max(0, vh - h);
    return {
        x: Math.max(0, Math.min(maxX, s.x)),
        y: Math.max(0, Math.min(maxY, s.y)),
    };
}

/**
 * Returns the nearest edge name + distance to it.
 *
 * @param {{ x: number, y: number, w: number, h: number, vw: number, vh: number }} s
 * @returns {{ edge: 'left' | 'right' | 'top' | 'bottom', distance: number }}
 */
export function edgeDistance(s) {
    const { x, y, w, h, vw, vh } = s;
    const dLeft   = x;
    const dRight  = vw - (x + w);
    const dTop    = y;
    const dBottom = vh - (y + h);
    /** @type {Array<{ edge: 'left' | 'right' | 'top' | 'bottom', distance: number }>} */
    const all = [
        { edge: 'left',   distance: dLeft   },
        { edge: 'right',  distance: dRight  },
        { edge: 'top',    distance: dTop    },
        { edge: 'bottom', distance: dBottom },
    ];
    all.sort((a, b) => a.distance - b.distance);
    return all[0];
}

/**
 * Decide whether the current pos is "stow-eligible" — close enough to
 * any edge that holding briefly should trigger a stow into the FAB.
 *
 * @param {{ x: number, y: number, w: number, h: number, vw: number, vh: number, threshold?: number }} s
 * @returns {boolean}
 */
export function shouldStow(s) {
    const t = s.threshold == null ? 24 : s.threshold;
    return edgeDistance(s).distance <= t;
}

/**
 * Corner FAB position for the given edge — one of the four corners
 * (nearest the edge the user dragged to). 16 px inset from the corner.
 *
 * @param {{ edge: 'left' | 'right' | 'top' | 'bottom', vw: number, vh: number, fabSize?: number, inset?: number }} s
 * @returns {{ x: number, y: number }}
 */
export function stowFabFor(s) {
    const fab = s.fabSize == null ? 44 : s.fabSize;
    const inset = s.inset == null ? 16 : s.inset;
    // Stow into the corner most-naturally associated with the chosen
    // edge. For top/bottom we pick the right side; for left/right we
    // pick the bottom — gives the FAB a consistent landing spot on
    // typical desktop layouts (nav top-left, content middle, FAB
    // bottom-right).
    if (s.edge === 'left')   return { x: inset,                  y: s.vh - fab - inset };
    if (s.edge === 'right')  return { x: s.vw - fab - inset,     y: s.vh - fab - inset };
    if (s.edge === 'top')    return { x: s.vw - fab - inset,     y: inset };
    return { x: s.vw - fab - inset, y: s.vh - fab - inset };
}
