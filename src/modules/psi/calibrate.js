// PSI calibration math — pure helpers extracted for unit tests.
//
// The line tool collects two image-space points (already mapped from
// canvas coords by the caller). computePpm divides line length by the
// known real-world distance the user enters in microns.

/**
 * Distance between two points in pixels.
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @returns {number}
 */
export function distancePx(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Compute pixels-per-micron from a 2-point line + a known real distance.
 * Returns null when inputs are bogus so callers can surface an error
 * cleanly instead of writing NaN to localStorage.
 *
 * @param {{x: number, y: number}} a
 * @param {{x: number, y: number}} b
 * @param {number} micronDistance
 * @returns {number | null}
 */
export function computePpm(a, b, micronDistance) {
    if (!a || !b) return null;
    if (typeof micronDistance !== 'number' || !isFinite(micronDistance) || micronDistance <= 0) return null;
    const px = distancePx(a, b);
    if (!isFinite(px) || px <= 0) return null;
    return px / micronDistance;
}

/**
 * Convert a click event's clientX/clientY into the canvas's intrinsic
 * pixel coordinate system. Critical when the canvas is CSS-scaled to fit
 * its container — without this, a click at the right edge would be
 * interpreted as far-right in CSS pixels but might be mid-image in
 * canvas pixels.
 *
 * @param {HTMLCanvasElement} canvas
 * @param {{ clientX: number, clientY: number }} ev
 * @returns {{ x: number, y: number }}
 */
export function canvasPointFromClick(canvas, ev) {
    const rect = canvas.getBoundingClientRect();
    const xRatio = canvas.width  / (rect.width  || 1);
    const yRatio = canvas.height / (rect.height || 1);
    return {
        x: (ev.clientX - rect.left) * xRatio,
        y: (ev.clientY - rect.top)  * yRatio,
    };
}
