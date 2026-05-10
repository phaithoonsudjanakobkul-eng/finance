import { describe, it, expect, beforeEach } from 'vitest';
import {
    parseScreener,
    loadCache,
    updateCache,
    isStale,
    renderRowsHtml,
    getWorkerConfig,
} from './scanner.js';

beforeEach(() => {
    localStorage.clear();
});

describe('parseScreener', () => {
    it('returns [] for malformed body', () => {
        expect(parseScreener(null)).toEqual([]);
        expect(parseScreener({})).toEqual([]);
        expect(parseScreener({ finance: {} })).toEqual([]);
        expect(parseScreener({ finance: { result: [] } })).toEqual([]);
    });

    it('parses Yahoo formatted=true {raw, fmt} payload', () => {
        const body = {
            finance: {
                result: [{
                    id: 'day_gainers',
                    quotes: [
                        { symbol: 'AAPL', shortName: 'Apple Inc',
                          regularMarketPrice: { raw: 200.5, fmt: '200.50' },
                          regularMarketChange: { raw: 5.2, fmt: '5.20' },
                          regularMarketChangePercent: { raw: 2.6, fmt: '2.60%' },
                          regularMarketVolume: { raw: 50_000_000, fmt: '50M' } },
                    ],
                }],
            },
        };
        const rows = parseScreener(body);
        expect(rows).toHaveLength(1);
        expect(rows[0].symbol).toBe('AAPL');
        expect(rows[0].name).toBe('Apple Inc');
        expect(rows[0].price).toBe(200.5);
        expect(rows[0].change).toBe(5.2);
        expect(rows[0].changePct).toBe(2.6);
        expect(rows[0].vol).toBe(50_000_000);
    });

    it('falls back to longName when shortName missing', () => {
        const rows = parseScreener({ finance: { result: [{ quotes: [{ symbol: 'X', longName: 'Long Name X' }] }] } });
        expect(rows[0].name).toBe('Long Name X');
    });

    it('handles plain numeric fields (formatted=false fallback)', () => {
        const rows = parseScreener({ finance: { result: [{ quotes: [{ symbol: 'X',
            regularMarketPrice: 100,
            regularMarketChangePercent: -1.5 }] }] } });
        expect(rows[0].price).toBe(100);
        expect(rows[0].changePct).toBe(-1.5);
    });

    it('skips entries missing symbol', () => {
        const rows = parseScreener({ finance: { result: [{ quotes: [{ shortName: 'no sym' }, { symbol: 'GOOD' }] }] } });
        expect(rows).toHaveLength(1);
        expect(rows[0].symbol).toBe('GOOD');
    });

    it('returns null fields when nested raw is missing', () => {
        const rows = parseScreener({ finance: { result: [{ quotes: [{ symbol: 'X',
            regularMarketPrice: {} }] }] } });
        expect(rows[0].price).toBeNull();
    });
});

describe('cache lifecycle', () => {
    it('loadCache returns empty shape when storage absent', () => {
        const c = loadCache();
        expect(c.ts).toBe(0);
        expect(c.buckets).toEqual({});
    });

    it('updateCache writes + loadCache reads back', () => {
        let c = loadCache();
        const rows = [{ symbol: 'AAPL', name: 'Apple', price: 200, change: 5, changePct: 2.5, vol: 10_000_000 }];
        c = updateCache(c, 'day_gainers', rows);
        const back = loadCache();
        expect(back.buckets.day_gainers).toEqual(rows);
        expect(typeof back.ts).toBe('number');
    });

    it('isStale: true when bucket missing', () => {
        const c = { ts: Date.now(), buckets: {} };
        expect(isStale(c, 'day_gainers')).toBe(true);
    });

    it('isStale: true when ts older than 5 min', () => {
        const c = { ts: Date.now() - 10 * 60_000, buckets: { day_gainers: [] } };
        expect(isStale(c, 'day_gainers')).toBe(true);
    });

    it('isStale: false when recent + bucket populated', () => {
        const c = { ts: Date.now() - 60_000, buckets: { day_gainers: [{ symbol: 'X', name: '', price: 1, change: 0, changePct: 0, vol: 0 }] } };
        expect(isStale(c, 'day_gainers')).toBe(false);
    });

    it('updateCache merges into existing buckets', () => {
        let c = updateCache(loadCache(), 'day_gainers', [{ symbol: 'A', name: '', price: 1, change: 0, changePct: 0, vol: 0 }]);
        c = updateCache(c, 'day_losers',  [{ symbol: 'B', name: '', price: 2, change: 0, changePct: 0, vol: 0 }]);
        const back = loadCache();
        expect(back.buckets.day_gainers).toHaveLength(1);
        expect(back.buckets.day_losers).toHaveLength(1);
    });
});

describe('renderRowsHtml', () => {
    it('returns "No results" when input empty', () => {
        const html = renderRowsHtml([]);
        expect(html).toContain('No results');
    });

    it('renders symbol + ADD button per row', () => {
        const html = renderRowsHtml([{ symbol: 'AAPL', name: 'Apple', price: 200, change: 5, changePct: 2.6, vol: 50_000_000 }]);
        expect(html).toContain('AAPL');
        expect(html).toContain('Apple');
        expect(html).toContain('data-scanner-add="AAPL"');
        expect(html).toContain('+ ADD');
    });

    it('escapes HTML in symbol + name fields', () => {
        const html = renderRowsHtml([{ symbol: 'X<script>', name: '<b>name</b>', price: null, change: null, changePct: null, vol: null }]);
        expect(html).not.toContain('<script>');
        expect(html).toContain('&lt;script&gt;');
    });

    it('renders em-dash for null price/changePct/vol (graceful empty)', () => {
        const html = renderRowsHtml([{ symbol: 'X', name: '', price: null, change: null, changePct: null, vol: null }]);
        expect(html).toContain('—');
    });
});

describe('getWorkerConfig', () => {
    it('returns null when token missing', () => {
        localStorage.setItem('ps_r2_worker_url', 'https://x.example');
        expect(getWorkerConfig()).toBeNull();
    });

    it('returns null when url missing', () => {
        localStorage.setItem('ps_r2_auth_token', 'token');
        expect(getWorkerConfig()).toBeNull();
    });

    it('strips trailing slash from url', () => {
        localStorage.setItem('ps_r2_worker_url', 'https://x.example/');
        localStorage.setItem('ps_r2_auth_token', 'tok');
        const c = getWorkerConfig();
        expect(c).not.toBeNull();
        expect(c && c.url).toBe('https://x.example');
        expect(c && c.token).toBe('tok');
    });
});
