// Yahoo predefined screener — proxied via pslink-r2 worker /yahoo-screener.
//
// Phase 2d port. Replaces the monolith FMP-derived scanner that returned
// "obscure stocks only" (per project_market_scanner_yahoo_migration memory).
// Yahoo's predefined buckets give widely-recognised symbols across day
// gainers / losers / most actives — the buckets traders actually scan.
//
// 5-minute localStorage cache so re-entry to the Watchlist tab paints
// instantly without refetching. Worker also edge-caches 60s server-side
// so multi-device boots share the burst.

import { lsGet, lsGetJson, lsSave } from '../../core/storage.js';

/** @typedef {{ symbol: string, name: string, price: number | null, change: number | null, changePct: number | null, vol: number | null }} ScanRow */
/** @typedef {'day_gainers' | 'day_losers' | 'most_actives'} ScannerType */

const CACHE_KEY = 'ps_v2_scanner_cache';
const CACHE_TTL_MS = 5 * 60_000;

/** @returns {{ url: string, token: string } | null} */
export function getWorkerConfig() {
    const url = String(lsGet('ps_r2_worker_url', '') || '').trim();
    const token = String(lsGet('ps_r2_auth_token', '') || '').trim();
    if (!url || !token) return null;
    return { url: url.replace(/\/$/, ''), token };
}

/**
 * Yahoo screener payload nests each numeric field as `{raw, fmt}` (when
 * `formatted=true`). Pull `.raw` for compute, leave fmt for display.
 * Fall back tolerantly so a partial response still renders.
 *
 * @param {any} body
 * @returns {ScanRow[]}
 */
export function parseScreener(body) {
    /** @type {ScanRow[]} */
    const out = [];
    const finance = body && body.finance;
    if (!finance || !Array.isArray(finance.result) || !finance.result.length) return out;
    const quotes = finance.result[0] && finance.result[0].quotes;
    if (!Array.isArray(quotes)) return out;
    for (const q of quotes) {
        if (!q || typeof q.symbol !== 'string') continue;
        out.push({
            symbol:    q.symbol,
            name:      String(q.shortName || q.longName || ''),
            price:     pickRaw(q.regularMarketPrice),
            change:    pickRaw(q.regularMarketChange),
            changePct: pickRaw(q.regularMarketChangePercent),
            vol:       pickRaw(q.regularMarketVolume),
        });
    }
    return out;
}

/** @param {any} v */
function pickRaw(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    if (typeof v === 'object' && typeof v.raw === 'number') return v.raw;
    return null;
}

/**
 * Fetch a screener bucket through the R2 worker. Returns the parsed rows.
 * Throws on missing worker config / 401 / network failure so caller can
 * route the error to the status row.
 *
 * @param {ScannerType} type
 * @param {{ count?: number, signal?: AbortSignal }} [opts]
 * @returns {Promise<ScanRow[]>}
 */
export async function fetchScreener(type, opts) {
    const cfg = getWorkerConfig();
    if (!cfg) throw new Error('R2 worker not configured (ps_r2_worker_url + ps_r2_auth_token)');
    const count = (opts && opts.count) || 25;
    const url = `${cfg.url}/yahoo-screener?type=${encodeURIComponent(type)}&count=${count}`;
    const res = await fetch(url, {
        headers: { Authorization: 'Bearer ' + cfg.token },
        signal: (opts && opts.signal) || undefined,
    });
    if (res.status === 404) throw new Error('Worker /yahoo-screener route not deployed yet — run `cd pslink-r2-worker && npx wrangler deploy`');
    if (res.status === 401) throw new Error('R2 worker token rejected (401)');
    if (!res.ok) throw new Error(`R2 worker ${res.status}`);
    const body = await res.json();
    return parseScreener(body);
}

// ── Cache ──────────────────────────────────────────────────────────────

/** @typedef {{ ts: number, buckets: Record<string, ScanRow[]> }} ScannerCache */

/** @returns {ScannerCache} */
export function loadCache() {
    /** @type {any} */
    const raw = lsGetJson(CACHE_KEY, null);
    if (!raw || typeof raw !== 'object' || typeof raw.ts !== 'number' || !raw.buckets) return { ts: 0, buckets: {} };
    return raw;
}

/** @param {ScannerCache} cache */
function saveCache(cache) {
    try { lsSave(CACHE_KEY, JSON.stringify(cache)); }
    catch (e) { /* swallow */ }
}

/**
 * @param {ScannerCache} cache
 * @param {ScannerType} type
 * @param {ScanRow[]} rows
 * @returns {ScannerCache}
 */
export function updateCache(cache, type, rows) {
    const next = { ts: Date.now(), buckets: { ...cache.buckets, [type]: rows } };
    saveCache(next);
    return next;
}

/**
 * Whether the cache slice for a given type is stale (>= TTL old).
 * @param {ScannerCache} cache
 * @param {ScannerType} type
 */
export function isStale(cache, type) {
    if (!cache.buckets[type]) return true;
    return (Date.now() - cache.ts) > CACHE_TTL_MS;
}

// ── Render ─────────────────────────────────────────────────────────────

const _PRICE_FMT = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const _PCT_FMT   = new Intl.NumberFormat('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2, signDisplay: 'always' });
const _VOL_FMT   = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 });

import { escapeHtml as he, escapeAttr as ha } from '../../core/escape.js';

/** @param {ScanRow[]} rows @returns {string} */
export function renderRowsHtml(rows) {
    if (!rows.length) {
        return `<div style="padding:14px;text-align:center;color:var(--dim, #888);font-size:12px;">No results</div>`;
    }
    return `<table style="width:100%;border-collapse:collapse;font-family:'Inter','IBM Plex Sans Thai',system-ui,sans-serif;font-size:12px;font-variant-numeric:tabular-nums;">
        <thead>
            <tr style="background:var(--bg, #0d0d0d);">
                <th style="text-align:left;padding:6px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;">Sym</th>
                <th style="text-align:left;padding:6px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;">Name</th>
                <th style="text-align:right;padding:6px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;">Last</th>
                <th style="text-align:right;padding:6px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;">Δ %</th>
                <th style="text-align:right;padding:6px 10px;font-size:9px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;">Vol</th>
                <th style="width:48px;"></th>
            </tr>
        </thead>
        <tbody>${rows.map((r) => {
            const dpRaw = r.changePct;
            const dpColor = dpRaw == null ? 'var(--dim, #888)' : (dpRaw >= 0 ? 'var(--wl-up, #10b981)' : 'var(--wl-dn, #ef4444)');
            const last = (typeof r.price === 'number') ? _PRICE_FMT.format(r.price) : '—';
            const dp = (typeof r.changePct === 'number') ? _PCT_FMT.format(r.changePct) + '%' : '—';
            const vol = (typeof r.vol === 'number') ? _VOL_FMT.format(r.vol) : '—';
            return `<tr style="border-top:1px solid var(--border, #2a2a2a);">
                <td style="padding:6px 10px;font-family:var(--mono, monospace);font-weight:700;">${he(r.symbol)}</td>
                <td style="padding:6px 10px;color:var(--dim, #888);max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${he(r.name)}</td>
                <td style="padding:6px 10px;text-align:right;font-family:var(--mono, monospace);">${last}</td>
                <td style="padding:6px 10px;text-align:right;font-family:var(--mono, monospace);color:${dpColor};">${dp}</td>
                <td style="padding:6px 10px;text-align:right;font-family:var(--mono, monospace);color:var(--dim, #888);">${vol}</td>
                <td style="padding:4px 6px;text-align:right;"><button data-scanner-add="${ha(r.symbol)}" title="Add to watchlist" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--accent, #089981);padding:3px 9px;border-radius:6px;cursor:pointer;font-size:10px;font-family:var(--mono, monospace);font-weight:700;">+ ADD</button></td>
            </tr>`;
        }).join('')}</tbody>
    </table>`;
}
