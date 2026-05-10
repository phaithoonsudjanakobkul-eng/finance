// PSI measurement math — pure helpers for the Stage 4 tools.
//
// `angleDeg(a, b, c)` returns the angle at vertex `b` between rays b->a
// and b->c, in degrees [0, 180]. Vector dot-product / magnitudes; clamps
// the cosine to [-1, 1] so floating-point drift doesn't push acos into
// NaN territory on near-collinear points.

/**
 * Angle at vertex `b` (formed by rays b->a and b->c), in degrees [0, 180].
 * Returns null when either ray has zero length (a===b or b===c) or any
 * point is missing — caller treats null as "invalid measurement".
 *
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @param {{x: number, y: number}} c
 * @returns {number | null}
 */
export function angleDeg(a, b, c) {
    if (!a || !b || !c) return null;
    const v1x = a.x - b.x, v1y = a.y - b.y;
    const v2x = c.x - b.x, v2y = c.y - b.y;
    const m1 = Math.sqrt(v1x * v1x + v1y * v1y);
    const m2 = Math.sqrt(v2x * v2x + v2y * v2y);
    if (!isFinite(m1) || !isFinite(m2) || m1 === 0 || m2 === 0) return null;
    const cos = Math.max(-1, Math.min(1, (v1x * v2x + v1y * v2y) / (m1 * m2)));
    return Math.acos(cos) * 180 / Math.PI;
}
