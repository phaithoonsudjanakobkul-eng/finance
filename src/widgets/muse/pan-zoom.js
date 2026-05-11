// Pure pan/zoom geometry for Muse stills (V7).
//
// Same architecture as the monolith — object-position + transform split.
// Naive translate-only pan exposes the slot's black background at zoom=1
// (since the image already covers the slot, there's no zoom-induced
// overflow to translate into). object-position absorbs the natural-cover
// overflow first; whatever remains goes through translate3d.
//
// All math is pure. The DOM layer in widgets/muse/index.js wires events
// → calls these helpers → writes objectPosition + transform back to the
// IMG element.
//
// Memory: project_muse_pan_zoom.md captures the full architecture +
// DON'T re-explore list.

/** @typedef {{ srcW: number, srcH: number, slotW: number, slotH: number, zoom: number }} Geom */

/**
 * Compute geometry constants used by every other function.
 * srcW/srcH are the *displayed* source dims at scale 1 — i.e. the
 * naturally-covered image dims after `object-fit: cover`. Caller is
 * responsible for computing those (e.g. img.naturalWidth scaled to the
 * slot's cover fit).
 *
 * @param {Geom} g
 * @returns {{ opMaxX: number, opMaxY: number, txMaxX: number, txMaxY: number, totalMaxX: number, totalMaxY: number }}
 */
export function panGeom(g) {
    const { srcW, srcH, slotW, slotH, zoom } = g;
    // Natural-cover overflow before zoom (one side is 0 because cover fits one dim)
    const naturalDx = Math.max(0, srcW - slotW);
    const naturalDy = Math.max(0, srcH - slotH);
    // Multiplied by zoom because the natural overflow scales with zoom too
    const opMaxX = (naturalDx / 2) * zoom;
    const opMaxY = (naturalDy / 2) * zoom;
    // Zoom-induced overflow: the visible part of the source at zoom N covers
    // slotW * zoom horizontally, and slotW already shows the cover-fit. So
    // the *extra* room from zoom is (zoom - 1) * slotW / 2 per side.
    const txMaxX = ((zoom - 1) * slotW) / 2;
    const txMaxY = ((zoom - 1) * slotH) / 2;
    return {
        opMaxX, opMaxY, txMaxX, txMaxY,
        totalMaxX: opMaxX + txMaxX,
        totalMaxY: opMaxY + txMaxY,
    };
}

/**
 * @param {number} v @param {number} max @returns {number}
 */
function clamp(v, max) { return Math.max(-max, Math.min(max, v)); }

/**
 * Clamp a pan vector to the maximum allowed extent.
 * @param {Geom & { panX: number, panY: number }} s
 * @returns {{ panX: number, panY: number }}
 */
export function clampPan(s) {
    const m = panGeom(s);
    return {
        panX: clamp(s.panX, m.totalMaxX),
        panY: clamp(s.panY, m.totalMaxY),
    };
}

/**
 * Resolve the split (objectPosition % + translate px) for a given pan vector.
 * @param {Geom & { panX: number, panY: number }} s
 * @returns {{ opXPct: number, opYPct: number, txX: number, txY: number }}
 *
 * opXPct / opYPct are percentages (0..100) for `object-position`.
 * txX / txY are pixel deltas for `translate3d(...)`.
 */
export function resolveSplit(s) {
    const { panX, panY, zoom, slotW, slotH, srcW, srcH } = s;
    const m = panGeom(s);
    // Greedy: pour as much pan as possible into object-position first
    const opX = clamp(panX, m.opMaxX);
    const opY = clamp(panY, m.opMaxY);
    const txX = panX - opX;
    const txY = panY - opY;
    // Convert opX (px in image space at zoom 1) → percentage along the
    // overflow axis. Default 50% (center) when there's no overflow.
    const opXPct = (srcW > slotW) ? (50 - ((opX / zoom) / (srcW - slotW)) * 100) : 50;
    const opYPct = (srcH > slotH) ? (50 - ((opY / zoom) / (srcH - slotH)) * 100) : 50;
    return { opXPct, opYPct, txX, txY };
}

/**
 * Convert pixel pan → normalized fraction. Fraction range is ±0.5.
 * Stored in Gist so cross-device with different slot dims still aligns.
 * @param {Geom & { panX: number, panY: number }} s
 * @returns {{ panFracX: number, panFracY: number }}
 */
export function syncFracFromPx(s) {
    const denomX = s.zoom * s.slotW;
    const denomY = s.zoom * s.slotH;
    return {
        panFracX: denomX > 0 ? s.panX / denomX : 0,
        panFracY: denomY > 0 ? s.panY / denomY : 0,
    };
}

/**
 * Convert normalized fraction → pixel pan for the current device dims.
 * @param {Geom & { panFracX: number, panFracY: number }} s
 * @returns {{ panX: number, panY: number }}
 */
export function syncPxFromFrac(s) {
    return {
        panX: s.panFracX * s.zoom * s.slotW,
        panY: s.panFracY * s.zoom * s.slotH,
    };
}

/**
 * Given the IMG's natural dimensions and a slot, compute the displayed
 * dimensions after `object-fit: cover` at zoom 1. The longer (relative)
 * side of the source extends past the slot.
 *
 * @param {{ naturalW: number, naturalH: number, slotW: number, slotH: number }} s
 * @returns {{ srcW: number, srcH: number }}
 */
export function coverDims(s) {
    const { naturalW, naturalH, slotW, slotH } = s;
    if (naturalW <= 0 || naturalH <= 0 || slotW <= 0 || slotH <= 0) {
        return { srcW: slotW, srcH: slotH };
    }
    const scaleX = slotW / naturalW;
    const scaleY = slotH / naturalH;
    const scale = Math.max(scaleX, scaleY);
    return { srcW: naturalW * scale, srcH: naturalH * scale };
}

/**
 * Clamp zoom to the supported range [1, 4].
 * @param {number} z @returns {number}
 */
export function clampZoom(z) {
    if (!isFinite(z)) return 1;
    return Math.max(1, Math.min(4, z));
}
