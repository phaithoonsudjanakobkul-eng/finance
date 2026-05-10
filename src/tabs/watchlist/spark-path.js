// Pure SVG sparkline path builder. Extracted from watchlist/index.js so
// the geometry can be unit-tested in isolation — no DOM, no localStorage,
// no Intl. The full watchlist tab still imports buildSparkPath from here.
//
// Returns the SVG path 'd' attribute + a sign hint (1, 0, -1) describing
// whether the last bar closed above, equal to, or below the first bar —
// used to color the polyline green/red/dim.

/**
 * @param {number[]} prices  bar closes (oldest → newest)
 * @param {number}   W       svg viewport width  (px)
 * @param {number}   H       svg viewport height (px)
 * @returns {{ d: string, sign: number }}
 */
export function buildSparkPath(prices, W, H) {
    if (!Array.isArray(prices) || prices.length < 2) return { d: '', sign: 0 };
    let mn = Infinity, mx = -Infinity;
    for (const p of prices) {
        if (p < mn) mn = p;
        if (p > mx) mx = p;
    }
    const range = mx - mn || 1;
    const step = (W - 2) / (prices.length - 1);
    let d = '';
    for (let i = 0; i < prices.length; i++) {
        const x = 1 + i * step;
        const y = (H - 2) - ((prices[i] - mn) / range) * (H - 2);
        d += (i === 0 ? 'M' : 'L') + x.toFixed(1) + ',' + y.toFixed(1);
    }
    const sign = Math.sign(prices[prices.length - 1] - prices[0]);
    return { d, sign };
}
