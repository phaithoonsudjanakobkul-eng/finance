// News tab — aggregated news from watchlist symbols.
//
// Phase 1 port (Step 6 sub-session): fetches Finnhub /company-news for the
// top N symbols in ps_watchlist over the last 7 days, dedupes by URL, sorts
// by timestamp desc, renders a simple list. Click a row to open the article
// in a new tab. No live polling, no Yahoo fallback, no modal reader, no
// per-row sentiment — those are deferred.
//
// Rate limit: Finnhub free tier is 60 calls/min. Fetching top 10 watchlist
// symbols stays well under that budget. Concurrent via Promise.all because
// requests are independent.
//
// DEFERRED:
// - Yahoo /v1/finance/news fallback through pslink-r2 worker
// - Live polling (_startNewsLivePolling) — needs visibility-aware backoff
// - Modal reader for full article body
// - Per-symbol filter chip bar
// - Sentiment badge (Finnhub /news-sentiment endpoint)

import { bus } from '../../core/bus.js';
import { lsGet, lsSave, lsGetJson } from '../../core/storage.js';

const TOP_N = 10;
const LOOKBACK_DAYS = 7;
const AUTO_INTERVAL_MS = 90_000;
const AUTO_LS_KEY = 'ps_v2_news_auto';

/** @typedef {{ id?: number, headline?: string, summary?: string, source?: string, url?: string, datetime?: number, image?: string, related?: string, _sym?: string }} NewsItem */

/** @type {HTMLElement | null} */
let _panel = null;
/** @type {AbortController | null} */
let _ctrl = null;
/** @type {NewsItem[]} */
let _items = [];
/** @type {string} */
let _symFilter = '';
/** @type {(() => void) | null} */
let _modalOff = null;
/** @type {number} */
let _autoTimer = 0;
/** @type {(() => void) | null} */
let _visOff = null;

// ── Helpers ────────────────────────────────────────────────────────────

/** @returns {string[]} */
function loadSymbols() {
    const raw = /** @type {any} */ (lsGetJson('ps_watchlist', []));
    if (!Array.isArray(raw)) return [];
    return raw.filter((/** @type {any} */ s) => typeof s === 'string' && s.length).slice(0, TOP_N);
}

function todayIso() {
    return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(/** @type {number} */ n) {
    const d = new Date();
    d.setDate(d.getDate() - n);
    return d.toISOString().slice(0, 10);
}

function fmtTime(/** @type {number} */ ts) {
    if (!ts || !isFinite(ts)) return '—';
    const d = new Date(ts * 1000);
    const now = new Date();
    const sec = (now.getTime() - d.getTime()) / 1000;
    if (sec < 60)        return Math.max(1, Math.floor(sec)) + 's ago';
    if (sec < 3600)      return Math.floor(sec / 60) + 'm ago';
    if (sec < 86400)     return Math.floor(sec / 3600) + 'h ago';
    if (sec < 86400 * 7) return Math.floor(sec / 86400) + 'd ago';
    return d.toLocaleDateString();
}

function escapeHtml(/** @type {string} */ s) {
    return String(s == null ? '' : s).replace(/[&<>]/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
}
function escapeAttr(/** @type {string} */ s) {
    return String(s == null ? '' : s).replace(/[&"<>]/g, (c) => /** @type {Record<string, string>} */ ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]);
}

// ── Fetch ──────────────────────────────────────────────────────────────

/**
 * @param {string} symbol
 * @param {string} key
 * @param {AbortSignal} signal
 * @returns {Promise<NewsItem[]>}
 */
async function fetchSymbolNews(symbol, key, signal) {
    const from = isoDaysAgo(LOOKBACK_DAYS);
    const to = todayIso();
    const url = `https://finnhub.io/api/v1/company-news?symbol=${encodeURIComponent(symbol)}&from=${from}&to=${to}&token=${encodeURIComponent(key)}`;
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Finnhub ${res.status} for ${symbol}`);
    const body = await res.json();
    if (!Array.isArray(body)) return [];
    /** @type {NewsItem[]} */
    const out = [];
    for (const it of body) {
        if (it && it.url) out.push({ ...it, _sym: symbol });
    }
    return out;
}

// ── Render ─────────────────────────────────────────────────────────────

function renderPanel(/** @type {HTMLElement} */ rootEl) {
    rootEl.innerHTML = `
        <div id="news-root" style="display:flex;flex-direction:column;gap:12px;padding:16px;color:var(--fg, #f5f5f7);">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;">News</span>
                <span style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);">tab/news · Finnhub</span>
                <label style="margin-left:auto;display:flex;align-items:center;gap:6px;font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);cursor:pointer;user-select:none;">
                    <input id="news-auto" type="checkbox" style="cursor:pointer;accent-color:var(--accent, #089981);">
                    auto 90s
                </label>
                <button id="news-refresh" style="background:var(--accent, #089981);color:#000;border:0;padding:6px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">Refresh</button>
            </div>
            <div id="news-status" style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);">Idle</div>
            <div id="news-symfilter" style="display:flex;flex-wrap:wrap;gap:6px;"></div>
            <div id="news-list" style="display:flex;flex-direction:column;gap:8px;"></div>
        </div>
    `;
}

function setStatus(/** @type {string} */ s) {
    if (!_panel) return;
    const el = _panel.querySelector('#news-status');
    if (el) el.textContent = s;
}

function renderSymChips() {
    if (!_panel) return;
    const bar = /** @type {HTMLElement | null} */ (_panel.querySelector('#news-symfilter'));
    if (!bar) return;
    const syms = /** @type {string[]} */ (Array.from(new Set(_items.map((it) => it._sym || '').filter(Boolean)))).sort();
    if (!syms.length) { bar.innerHTML = ''; return; }
    /** @param {string} key @param {string} label */
    const chip = (key, label) => {
        const isActive = key === _symFilter;
        const style = isActive
            ? 'background:var(--accent, #089981);color:#000;'
            : 'background:var(--card, #1a1a1a);color:var(--fg, #f5f5f7);border:1px solid var(--border, #2a2a2a);';
        return `<button data-symfilter="${escapeAttr(key)}" style="${style}font-size:11px;padding:3px 9px;border-radius:6px;font-weight:600;cursor:pointer;font-family:var(--mono, monospace);">${escapeHtml(label)}</button>`;
    };
    bar.innerHTML = chip('', 'All') + ' ' + syms.map((s) => chip(s, s)).join(' ');
}

/** @param {NewsItem[]} items */
function renderItems(items) {
    if (!_panel) return;
    _items = items;
    renderSymChips();
    const list = /** @type {HTMLElement | null} */ (_panel.querySelector('#news-list'));
    if (!list) return;
    const visible = _symFilter ? items.filter((it) => it._sym === _symFilter) : items;
    if (!visible.length) {
        const msg = _symFilter
            ? `No articles for ${escapeHtml(_symFilter)}. Try a different symbol or All.`
            : 'No news returned. Try Refresh, or add symbols to your watchlist.';
        list.innerHTML = `<div style="padding:18px;text-align:center;color:var(--dim, #888);background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;">${msg}</div>`;
        return;
    }
    list.innerHTML = visible.map((it) => {
        const time = fmtTime(Number(it.datetime) || 0);
        const sym = escapeHtml(it._sym || '');
        const headline = escapeHtml(it.headline || '(no headline)');
        const source = escapeHtml(it.source || '');
        const summary = escapeHtml(it.summary || '');
        const img = it.image ? `<img src="${escapeAttr(it.image)}" alt="" style="width:96px;height:64px;object-fit:cover;border-radius:6px;background:var(--bg, #0d0d0d);flex-shrink:0;" loading="lazy">` : '';
        return `<div class="news-row" data-url="${escapeAttr(it.url || '')}" role="button" tabindex="0" style="display:flex;gap:12px;background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:12px;cursor:pointer;transition:border-color .15s;">
            ${img}
            <div style="flex:1;min-width:0;">
                <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;font-family:var(--mono, monospace);font-size:11px;color:var(--dim, #888);">
                    <span style="color:var(--accent, #089981);font-weight:700;letter-spacing:0.05em;">${sym}</span>
                    <span>·</span>
                    <span>${time}</span>
                    ${source ? `<span>·</span><span>${source}</span>` : ''}
                </div>
                <div style="font-size:14px;font-weight:600;line-height:1.35;letter-spacing:-0.01em;margin-bottom:4px;">${headline}</div>
                ${summary ? `<div style="font-size:12px;color:var(--dim, #888);line-height:1.4;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${summary}</div>` : ''}
            </div>
        </div>`;
    }).join('');
}

// ── Modal reader ───────────────────────────────────────────────────────

function closeModal() {
    if (!_modalOff) return;
    try { _modalOff(); } catch (e) { /* swallow */ }
    _modalOff = null;
}

/** @param {NewsItem} it */
function openModal(it) {
    closeModal();
    if (!_panel || typeof document === 'undefined') return;
    const backdrop = document.createElement('div');
    backdrop.className = 'news-modal-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.7);z-index:9000;display:flex;align-items:center;justify-content:center;padding:20px;';
    const modal = document.createElement('div');
    modal.style.cssText = 'background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:12px;max-width:680px;width:100%;max-height:85vh;overflow:auto;padding:0;color:var(--fg, #f5f5f7);';
    const time = fmtTime(Number(it.datetime) || 0);
    const sym = escapeHtml(it._sym || '');
    const headline = escapeHtml(it.headline || '(no headline)');
    const source = escapeHtml(it.source || '');
    const summary = escapeHtml(it.summary || '');
    const url = escapeAttr(it.url || '#');
    const img = it.image ? `<img src="${escapeAttr(it.image)}" alt="" style="width:100%;max-height:280px;object-fit:cover;display:block;border-radius:12px 12px 0 0;background:var(--bg, #0d0d0d);" loading="lazy">` : '';
    modal.innerHTML = `
        ${img}
        <div style="padding:18px 22px 22px;">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px;font-family:var(--mono, monospace);font-size:11px;color:var(--dim, #888);">
                <span style="color:var(--accent, #089981);font-weight:700;letter-spacing:0.05em;">${sym}</span>
                <span>·</span>
                <span>${time}</span>
                ${source ? `<span>·</span><span>${source}</span>` : ''}
            </div>
            <h2 style="font-size:20px;font-weight:700;line-height:1.3;letter-spacing:-0.01em;margin:0 0 12px 0;">${headline}</h2>
            ${summary ? `<p style="font-size:14px;color:var(--fg, #f5f5f7);line-height:1.55;margin:0 0 18px 0;">${summary}</p>` : '<p style="font-size:13px;color:var(--dim, #888);">No summary available — open the article for the full body.</p>'}
            <div style="display:flex;gap:8px;align-items:center;justify-content:flex-end;">
                <button class="news-modal-close" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px;">Close</button>
                <a href="${url}" target="_blank" rel="noopener noreferrer" style="background:var(--accent, #089981);color:#000;border:0;padding:8px 16px;border-radius:6px;font-size:13px;font-weight:700;text-decoration:none;display:inline-flex;align-items:center;gap:6px;">Open article ↗</a>
            </div>
        </div>
    `;
    backdrop.appendChild(modal);
    document.body.appendChild(backdrop);
    const onClick = (/** @type {Event} */ e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (t === backdrop || (t && t.classList && t.classList.contains('news-modal-close'))) {
            closeModal();
        }
    };
    const onKey = (/** @type {KeyboardEvent} */ e) => {
        if (e.key === 'Escape') closeModal();
    };
    backdrop.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    _modalOff = () => {
        backdrop.removeEventListener('click', onClick);
        document.removeEventListener('keydown', onKey);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
    };
}

// ── Pipeline ───────────────────────────────────────────────────────────

async function refresh() {
    if (_ctrl) _ctrl.abort();
    _ctrl = new AbortController();
    const symbols = loadSymbols();
    if (!symbols.length) {
        setStatus('No symbols in ps_watchlist · add via Watchlist tab');
        renderItems([]);
        return;
    }
    const key = lsGet('ps_finnhub_key', '');
    if (!key) {
        setStatus('Finnhub API key missing — set ps_finnhub_key via monolith Settings');
        renderItems([]);
        return;
    }
    setStatus(`Fetching ${symbols.length} symbol(s) from Finnhub…`);
    /** @type {NewsItem[][]} */
    let results;
    try {
        results = await Promise.all(symbols.map((s) => fetchSymbolNews(s, key, /** @type {AbortSignal} */ ((_ctrl && _ctrl.signal)))
            .catch((/** @type {any} */ e) => { console.warn('[news]', s, e && e.message); return /** @type {NewsItem[]} */ ([]); })));
    } catch (e) {
        const err = /** @type {any} */ (e);
        if (err && err.name === 'AbortError') { setStatus('Aborted'); return; }
        setStatus(`Error: ${(err && err.message) || err}`);
        return;
    }
    /** @type {Map<string, NewsItem>} */
    const byUrl = new Map();
    for (const arr of results) {
        for (const it of arr) {
            const u = it.url || '';
            if (u && !byUrl.has(u)) byUrl.set(u, it);
        }
    }
    const merged = Array.from(byUrl.values()).sort((a, b) => (Number(b.datetime) || 0) - (Number(a.datetime) || 0));
    setStatus(`${merged.length} unique article(s) across ${symbols.length} symbol(s) · top ${TOP_N} watchlist`);
    renderItems(merged.slice(0, 60));
    bus.emit('news:refreshed', { count: merged.length });
}

// ── Auto polling ───────────────────────────────────────────────────────

function isAutoOn() {
    return /** @type {string} */ (lsGet(AUTO_LS_KEY, '')) === '1';
}

function startAuto() {
    stopAuto();
    if (typeof document !== 'undefined' && document.hidden) return;
    _autoTimer = /** @type {any} */ (setInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        refresh();
    }, AUTO_INTERVAL_MS));
}

function stopAuto() {
    if (_autoTimer) clearInterval(_autoTimer);
    _autoTimer = 0;
}

/** @param {boolean} on */
function setAuto(on) {
    lsSave(AUTO_LS_KEY, on ? '1' : '0');
    if (on) {
        refresh();
        startAuto();
    } else {
        stopAuto();
    }
}

// ── Lifecycle ──────────────────────────────────────────────────────────

export function init(/** @type {HTMLElement} */ rootEl) {
    _panel = rootEl;
    renderPanel(rootEl);
    const autoBox = /** @type {HTMLInputElement | null} */ (rootEl.querySelector('#news-auto'));
    if (autoBox) autoBox.checked = isAutoOn();
    rootEl.addEventListener('change', (/** @type {Event} */ e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        if (t && t.id === 'news-auto') setAuto(t.checked);
    });
    rootEl.addEventListener('click', (/** @type {Event} */ e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (!t) return;
        if (t.id === 'news-refresh') { e.preventDefault(); refresh(); return; }
        const chipEl = t.closest && t.closest('button[data-symfilter]');
        if (chipEl) {
            _symFilter = chipEl.getAttribute('data-symfilter') || '';
            renderItems(_items);
            return;
        }
        const row = t.closest && t.closest('.news-row');
        if (row) {
            const url = row.getAttribute('data-url') || '';
            const it = _items.find((x) => x.url === url);
            if (it) openModal(it);
        }
    });
    rootEl.addEventListener('keydown', (/** @type {KeyboardEvent} */ e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const t = /** @type {HTMLElement} */ (e.target);
        if (t && t.classList && t.classList.contains('news-row')) {
            e.preventDefault();
            const url = t.getAttribute('data-url') || '';
            const it = _items.find((x) => x.url === url);
            if (it) openModal(it);
        }
    });
    const onVis = () => {
        if (!isAutoOn()) return;
        if (document.hidden) stopAuto();
        else startAuto();
    };
    document.addEventListener('visibilitychange', onVis);
    _visOff = () => document.removeEventListener('visibilitychange', onVis);
    refresh();
    if (isAutoOn()) startAuto();
    bus.emit('tab:news:init', { rootEl });
    return { id: 'news', version: '0.3-step6-news-auto', ready: true, kind: 'tab' };
}

export function destroy() {
    if (_ctrl) { try { _ctrl.abort(); } catch (e) { /* swallow */ } }
    _ctrl = null;
    stopAuto();
    if (_visOff) { try { _visOff(); } catch (e) { /* swallow */ } }
    _visOff = null;
    closeModal();
    _items = [];
    _panel = null;
    bus.emit('tab:news:destroy');
}
