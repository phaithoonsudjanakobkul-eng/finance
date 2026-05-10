// Watchlist sort — pure helpers extracted for unit tests.
//
// `sortSymbols` is the core function: takes the symbol list + the cache
// dump + a sort spec + the pinned-symbol set, returns a freshly sorted
// array. Pinned symbols always float to the top regardless of which
// column is being sorted (matches the monolith's behavior). Symbol /
// name use locale-compare; numeric fields fall back to -Infinity for
// missing data so untyped rows always sort to the bottom in asc and to
// the top in desc.

/** @typedef {'sym' | 'name' | 'c' | 'd' | 'dp' | 'v'} SortField */
/** @typedef {{ field: SortField, dir: 'asc' | 'desc' }} SortPref */

/** Sort fields where the numeric -Infinity fallback applies. */
const NUMERIC_FIELDS = new Set(['c', 'd', 'dp', 'v']);

/**
 * Sort the watchlist symbols by the chosen field/direction. Pinned
 * symbols always come first; ties fall back to symbol-asc so the order
 * is deterministic.
 *
 * @param {string[]} syms
 * @param {Record<string, any>} cache
 * @param {SortPref} sort
 * @param {Set<string>} pinned
 * @returns {string[]}
 */
export function sortSymbols(syms, cache, sort, pinned) {
    const f = sort.field;
    const sign = sort.dir === 'asc' ? 1 : -1;
    const arr = syms.slice();
    arr.sort((a, b) => {
        const pa = pinned.has(a), pb = pinned.has(b);
        if (pa !== pb) return pa ? -1 : 1;
        const ca = cache[a] || {};
        const cb = cache[b] || {};
        if (f === 'sym')  return a.localeCompare(b) * sign;
        if (f === 'name') return String(ca.name || a).localeCompare(String(cb.name || b)) * sign;
        if (NUMERIC_FIELDS.has(f)) {
            const va = typeof ca[f] === 'number' && isFinite(ca[f]) ? ca[f] : -Infinity;
            const vb = typeof cb[f] === 'number' && isFinite(cb[f]) ? cb[f] : -Infinity;
            if (va === vb) return a.localeCompare(b);
            return (va - vb) * sign;
        }
        // Unknown field — keep stable input order
        return 0;
    });
    return arr;
}

/**
 * Compute the next sort spec when a column header is clicked. Clicking
 * the same column flips direction; clicking a new column adopts a sane
 * default (asc for sym/name, desc for numeric so the biggest movers
 * appear first).
 *
 * @param {SortPref} current
 * @param {SortField} field
 * @returns {SortPref}
 */
export function nextSort(current, field) {
    if (current.field === field) {
        return { field, dir: current.dir === 'asc' ? 'desc' : 'asc' };
    }
    return {
        field,
        dir: (field === 'sym' || field === 'name') ? 'asc' : 'desc',
    };
}

/**
 * Parse the persisted sort preference. Returns null when the string is
 * blank or doesn't match the schema, so callers can fall back to a
 * default without try/catch noise.
 *
 * @param {string | null | undefined} raw
 * @returns {SortPref | null}
 */
export function parseSortPref(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    const m = raw.match(/^(sym|name|c|d|dp|v):(asc|desc)$/);
    if (!m) return null;
    return {
        field: /** @type {SortField} */ (m[1]),
        dir:   /** @type {'asc' | 'desc'} */ (m[2]),
    };
}

/**
 * Format a sort spec for localStorage persistence — inverse of
 * parseSortPref. The returned string is canonical so two equivalent
 * specs always produce the same key.
 *
 * @param {SortPref} sort
 * @returns {string}
 */
export function formatSortPref(sort) {
    return `${sort.field}:${sort.dir}`;
}
