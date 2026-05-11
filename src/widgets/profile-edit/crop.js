// Pure crop math for the V4 profile photo editor.
//
// Source image is laid out at scale `z` (1.0 = source pixels at 1:1) and
// shifted by (tx, ty) inside a fixed-size square viewport. The viewport
// always shows a square crop. `computeCropRect` produces the rectangle
// in *source* coordinates that the viewport currently shows; that's
// what we feed to canvas.drawImage() when rendering the saved JPEG.
//
// Coordinate convention:
//   - viewport is `vpSize × vpSize` CSS pixels with origin at top-left
//   - tx/ty are translation of the source image inside the viewport
//     (positive shifts the image right/down)
//   - z scales the source: an `srcW × srcH` image rendered fills
//     `srcW*z × srcH*z` in viewport space
//
// Invariants checked by tests:
//   1. computeCropRect width === height (square crop guarantee)
//   2. min zoom clamps so the image cannot leave a gap at any edge
//   3. center-on-zoom: zooming in preserves the centre of the viewport

/**
 * @param {{ srcW: number, srcH: number, vpSize: number }} args
 * @returns {number} smallest zoom that still fully covers the viewport
 */
export function minZoom(args) {
    const { srcW, srcH, vpSize } = args;
    if (srcW <= 0 || srcH <= 0 || vpSize <= 0) return 1;
    return Math.max(vpSize / srcW, vpSize / srcH);
}

/**
 * @param {{ z: number, tx: number, ty: number, srcW: number, srcH: number, vpSize: number }} state
 * @returns {{ tx: number, ty: number }} clamped translation so the image still covers the viewport
 */
export function clampPan(state) {
    const { z, srcW, srcH, vpSize } = state;
    const w = srcW * z;
    const h = srcH * z;
    // Image cannot reveal a gap. tx ranges from (vpSize - w) up to 0.
    const minTx = Math.min(0, vpSize - w);
    const maxTx = Math.max(0, vpSize - w);
    const minTy = Math.min(0, vpSize - h);
    const maxTy = Math.max(0, vpSize - h);
    return {
        tx: Math.max(minTx, Math.min(maxTx, state.tx)),
        ty: Math.max(minTy, Math.min(maxTy, state.ty)),
    };
}

/**
 * Compute the sub-rect of the source image currently inside the viewport.
 * @param {{ z: number, tx: number, ty: number, srcW: number, srcH: number, vpSize: number }} state
 * @returns {{ sx: number, sy: number, sSize: number }} sub-rect in source pixels (square)
 */
export function computeCropRect(state) {
    const { z, tx, ty, vpSize } = state;
    // Viewport (0,0)..(vpSize,vpSize) in viewport coords corresponds to
    //   (-tx/z, -ty/z) .. ((vpSize-tx)/z, (vpSize-ty)/z) in source coords
    // `+ 0` normalises -0 → +0 so equality checks on zero behave as expected
    const sx = (-tx / z) + 0;
    const sy = (-ty / z) + 0;
    const sSize = vpSize / z;
    return { sx, sy, sSize };
}

/**
 * Re-centre the image inside the viewport — used as initial placement
 * and after zoom (so zoom feels like it's around the centre, not the
 * top-left). Output is unclamped; caller may pass through clampPan.
 * @param {{ z: number, srcW: number, srcH: number, vpSize: number }} state
 * @returns {{ tx: number, ty: number }}
 */
export function centerPan(state) {
    const { z, srcW, srcH, vpSize } = state;
    return {
        tx: (vpSize - srcW * z) / 2,
        ty: (vpSize - srcH * z) / 2,
    };
}

/**
 * Returns the new (tx, ty) that keeps the viewport centre fixed in
 * source coordinates while zooming from z0 → z1.
 * @param {{ z0: number, z1: number, tx: number, ty: number, vpSize: number }} args
 * @returns {{ tx: number, ty: number }}
 */
export function zoomAboutCenter(args) {
    const { z0, z1, tx, ty, vpSize } = args;
    const cx = vpSize / 2;
    const cy = vpSize / 2;
    // Pre-zoom source point under centre: ((cx-tx)/z0, (cy-ty)/z0)
    // Want post-zoom centre to map back to that same source point:
    //   tx' = cx - sx*z1 = cx - ((cx-tx)/z0) * z1
    return {
        tx: cx - ((cx - tx) / z0) * z1,
        ty: cy - ((cy - ty) / z0) * z1,
    };
}
