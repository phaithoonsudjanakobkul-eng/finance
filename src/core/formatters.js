// Shared Intl.NumberFormat instances. CLAUDE.md Rule 5 calls these out
// explicitly: cache `Intl.*` formatters at module scope, never instantiate
// in hot paths. Construction is 0.05–0.5ms each and allocates — in tight
// loops (per-tick price formatting, per-row sparkline cells) the cost
// adds up to seconds of jank on a busy watchlist.
//
// Caching at module scope means the formatter is built once when the
// module is first imported (lazy on first use of any tab/module that
// reads it), then reused for every call. Putting them here also stops
// 4+ tab modules from each holding their own identical copy.

/** Whole-baht income/expense values — no decimals. */
export const MONEY_FMT = new Intl.NumberFormat('en-US', {
    maximumFractionDigits: 0,
});

/** Stock prices — always exactly 2 decimals so columns align. */
export const PRICE_FMT = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
});

/** Δ$ / Δ% / momentum changes — always shows leading + or -. */
export const DELTA_FMT = new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: 'always',
});

/** Volume — compact notation (1.5M, 500K) so the column stays narrow. */
export const VOL_FMT = new Intl.NumberFormat('en-US', {
    notation: 'compact',
    maximumFractionDigits: 1,
});
