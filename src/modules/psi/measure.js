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

/**
 * Polygon area in pixels^2 via the shoelace formula. Always returns a
 * non-negative value regardless of winding order. Returns 0 for degenerate
 * inputs (< 3 points, missing pts) so the caller can short-circuit cleanly.
 *
 * @param {Array<{x: number, y: number}>} pts
 * @returns {number}
 */
export function polygonAreaPx(pts) {
    if (!Array.isArray(pts) || pts.length < 3) return 0;
    let s = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        s += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
    }
    return Math.abs(s) / 2;
}

/**
 * Polygon centroid (geometric center). Uses the standard formula weighted
 * by signed-area contributions of each edge so concave shapes get a
 * sensible inside point. Falls back to the average of points when the
 * polygon is degenerate (zero area / collinear).
 *
 * @param {Array<{x: number, y: number}>} pts
 * @returns {{x: number, y: number} | null}
 */
export function polygonCentroid(pts) {
    if (!Array.isArray(pts) || pts.length === 0) return null;
    if (pts.length < 3) {
        let sx = 0, sy = 0;
        for (const p of pts) { sx += p.x; sy += p.y; }
        return { x: sx / pts.length, y: sy / pts.length };
    }
    let cx = 0, cy = 0, a = 0;
    for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const cross = pts[j].x * pts[i].y - pts[i].x * pts[j].y;
        cx += (pts[j].x + pts[i].x) * cross;
        cy += (pts[j].y + pts[i].y) * cross;
        a  += cross;
    }
    if (a === 0) {
        // Degenerate / collinear — fall back to bbox center
        let sx = 0, sy = 0;
        for (const p of pts) { sx += p.x; sy += p.y; }
        return { x: sx / pts.length, y: sy / pts.length };
    }
    a *= 0.5;
    return { x: cx / (6 * a), y: cy / (6 * a) };
}
