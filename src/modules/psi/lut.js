// PSI display-adjustment LUT — pure helpers shared between the main
// thread and the LUT Worker so test coverage applies to both paths.
//
// `buildLut(black, white, gamma)` returns a 256-entry Uint8ClampedArray
// mapping input intensity to output intensity. The math matches the
// monolith: black-point clamps darks to 0, white-point clamps brights
// to 255, and gamma re-shapes the midtones — input(0..1) → input^(1/γ).

/**
 * Build the display-adjustment lookup table.
 *
 * @param {number} black  Black point [0, 254]
 * @param {number} white  White point [black+1, 255]
 * @param {number} gamma  Gamma curve [0.01, 9.99] (>1 lifts midtones)
 * @returns {Uint8ClampedArray}
 */
export function buildLut(black, white, gamma) {
    const lo = Math.max(0, Math.min(254, isFinite(black) ? black : 0));
    const hi = Math.max(lo + 1, Math.min(255, isFinite(white) ? white : 255));
    const g  = Math.max(0.01, Math.min(9.99, isFinite(gamma) ? gamma : 1));
    const range = hi - lo;
    const lut = new Uint8ClampedArray(256);
    for (let i = 0; i < 256; i++) {
        let v = (i - lo) / range;
        if (v < 0) v = 0;
        else if (v > 1) v = 1;
        v = Math.pow(v, 1 / g);
        lut[i] = Math.round(v * 255);
    }
    return lut;
}

/**
 * Map a channel selection ('all' / 'r' / 'g' / 'b') to a bitmask the
 * Worker uses to decide which channels to remap.
 *   bit 0 = red, bit 1 = green, bit 2 = blue
 *
 * @param {'all' | 'r' | 'g' | 'b' | string | undefined | null} ch
 * @returns {number}
 */
export function channelMask(ch) {
    if (ch === 'r') return 1;
    if (ch === 'g') return 2;
    if (ch === 'b') return 4;
    return 7; // 'all' (or anything unknown — fail open)
}
