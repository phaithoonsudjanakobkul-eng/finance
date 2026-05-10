// News tab cache + dedup helpers — pure functions extracted for tests.
//
// Cache shape on localStorage: `{ ts: <epoch ms>, items: NewsItem[] }`
// loadCache validates the shape and returns null when the entry is
// missing or malformed so the caller can fall through to a fresh fetch
// without try/catch noise.
//
// dedupeArticles merges per-symbol fetch results: same URL across
// symbols collapses to a single entry, then everything sorts newest
// first by `datetime`. URL-empty items are dropped (Finnhub's free tier
// occasionally returns rows with blank urls).

import { lsSave, lsGetJson } from '../../core/storage.js';

export const NEWS_CACHE_LS_KEY = 'ps_v2_news_cache';
export const NEWS_CACHE_TTL_MS = 5 * 60_000;

/**
 * @typedef {{
 *   url?: string,
 *   datetime?: number,
 *   headline?: string,
 *   source?: string,
 *   image?: string,
 *   summary?: string,
 *   related?: string,
 * }} NewsItem
 */

/** @typedef {{ ts: number, items: NewsItem[] }} NewsCache */

/**
 * Load cached news. Returns null when the entry is missing or doesn't
 * match the expected shape.
 * @returns {NewsCache | null}
 */
export function loadCache() {
    const raw = /** @type {any} */ (lsGetJson(NEWS_CACHE_LS_KEY, null));
    if (!raw || typeof raw !== 'object') return null;
    if (!Array.isArray(raw.items)) return null;
    if (typeof raw.ts !== 'number' || !isFinite(raw.ts)) return null;
    return /** @type {NewsCache} */ (raw);
}

/**
 * Persist a freshly merged list. `now` is injectable so tests don't
 * have to mock Date.now.
 * @param {NewsItem[]} items
 * @param {number} [now]
 */
export function saveCache(items, now) {
    const ts = typeof now === 'number' ? now : Date.now();
    lsSave(NEWS_CACHE_LS_KEY, JSON.stringify({ ts, items }));
}

/**
 * Whether the cached entry has aged past the TTL. Returns true for a
 * null cache so the caller treats "no data" as "needs refresh."
 * @param {NewsCache | null} cache
 * @param {number} [ttlMs]
 * @param {number} [now]
 */
export function isStale(cache, ttlMs, now) {
    if (!cache) return true;
    const limit = typeof ttlMs === 'number' ? ttlMs : NEWS_CACHE_TTL_MS;
    const t = typeof now === 'number' ? now : Date.now();
    return (t - cache.ts) > limit;
}

/**
 * Merge per-symbol fetch results into one deduplicated, newest-first
 * list. Same URL across symbols collapses to a single entry; rows with
 * empty url are dropped.
 *
 * @param {NewsItem[][]} arrays
 * @returns {NewsItem[]}
 */
export function dedupeArticles(arrays) {
    /** @type {Map<string, NewsItem>} */
    const byUrl = new Map();
    for (const arr of arrays) {
        if (!Array.isArray(arr)) continue;
        for (const it of arr) {
            if (!it || typeof it !== 'object') continue;
            const u = typeof it.url === 'string' ? it.url : '';
            if (!u) continue;
            if (!byUrl.has(u)) byUrl.set(u, it);
        }
    }
    return Array.from(byUrl.values()).sort((a, b) => (Number(b.datetime) || 0) - (Number(a.datetime) || 0));
}
