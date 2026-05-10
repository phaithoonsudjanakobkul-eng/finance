// Dashboard tab — profile card + financial summary from records.
//
// Heavy logic ported (Step 6 sub-session): profile card (avatar / name from
// localStorage), current-month payday + balance + saving rate readout, 6-month
// income vs expense mini-bar-chart computed from ps_records (no Chart.js — raw
// SVG so no CDN dep). Cards listen on `records:saved` / `records:loaded` so
// switching to Records tab, editing, then coming back updates Dashboard
// without a manual refresh.
//
// DEFERRED (depend on tabs/widgets that aren't ported yet):
// - LOW alerts (needs watchlist data + alert state)
// - Pinned watchlist (needs watchlist module)
// - Muse playlist (Muse widget per CLAUDE.md stays in shell — separate port)
// - News teaser (needs News module)

import { bus } from '../../core/bus.js';
import { lsGetJson } from '../../core/storage.js';

/** @typedef {{name: string, val: number, amount: number, isPaid: boolean}} Item */
/** @typedef {{id: string, payday: number, fixed: Item[], dynamic: Item[]}} MonthRecord */

const _MONEY_FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** @type {HTMLElement | null} */
let _panel = null;
/** @type {(() => void) | null} */
let _busOff = null;

// ── Reads ──────────────────────────────────────────────────────────────

function loadProfile() {
    const p = /** @type {any} */ (lsGetJson('ps_profile', null));
    return p && typeof p === 'object' ? p : null;
}

/** @returns {MonthRecord[]} */
function loadRecords() {
    const r = /** @type {any} */ (lsGetJson('ps_records', []));
    return Array.isArray(r) ? r : [];
}

function todayMonth() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/**
 * @param {string} m e.g. "2026-05"
 * @param {number} delta integer offset in months
 */
function shiftMonth(m, delta) {
    const [y, mo] = m.split('-').map(Number);
    const d = new Date(y, mo - 1 + delta, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/** @param {Item[]} arr */
function sumArr(arr) {
    let s = 0;
    for (const it of arr || []) {
        const v = (typeof it.val === 'number' && !isNaN(it.val)) ? it.val : (Number(it.amount) || 0);
        s += v;
    }
    return s;
}

/**
 * @param {string} m
 * @param {MonthRecord[]} records
 */
function readMonth(m, records) {
    const rec = records.find((x) => x && x.id === m);
    if (!rec) return { id: m, payday: 0, expenses: 0, balance: 0, rate: 0 };
    const expenses = sumArr(rec.fixed) + sumArr(rec.dynamic);
    const balance = (rec.payday || 0) - expenses;
    const rate = rec.payday > 0 ? Math.round((balance / rec.payday) * 100) : 0;
    return { id: m, payday: rec.payday || 0, expenses, balance, rate };
}

// ── Render ─────────────────────────────────────────────────────────────

function renderPanel(/** @type {HTMLElement} */ rootEl) {
    rootEl.innerHTML = `
        <div id="dash-root" style="display:flex;flex-direction:column;gap:14px;padding:16px;color:var(--fg, #f5f5f7);">
            <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;">Dashboard</span>
                <span style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);">tab/dashboard</span>
            </div>

            <div id="dash-row1" style="display:grid;grid-template-columns:minmax(280px, 1fr) repeat(3, minmax(0, 1fr));gap:12px;">
                <div id="dash-profile" class="dash-card" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;display:flex;align-items:center;gap:12px;">
                    <div id="dash-avatar" style="width:56px;height:56px;border-radius:50%;background:var(--bg, #0d0d0d);border:1px solid var(--border, #2a2a2a);display:flex;align-items:center;justify-content:center;font-family:var(--font-display, var(--mono, monospace));font-size:20px;font-weight:700;color:var(--accent, #089981);overflow:hidden;flex-shrink:0;">P</div>
                    <div style="min-width:0;">
                        <div class="dash-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:4px;">Profile</div>
                        <div id="dash-profile-name" class="profile-name" style="font-family:var(--font-display, var(--sans, system-ui));font-size:18px;font-weight:700;letter-spacing:-0.01em;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">—</div>
                        <div id="dash-profile-sub" class="dash-sub" style="font-size:11px;color:var(--dim, #888);margin-top:2px;font-family:var(--mono, monospace);">No profile saved</div>
                    </div>
                </div>
                <div id="dash-month" class="dash-card" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;">
                    <div class="dash-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:4px;">Month</div>
                    <div id="dash-month-label" class="dash-value" style="font-family:var(--font-display, var(--mono, monospace));font-size:20px;font-weight:700;letter-spacing:-0.01em;font-variant-numeric:tabular-nums;">—</div>
                    <div id="dash-payday" class="dash-sub" style="font-size:12px;color:var(--dim, #888);margin-top:2px;font-family:var(--mono, monospace);">income —</div>
                </div>
                <div id="dash-balance" class="dash-card" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;">
                    <div class="dash-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:4px;">Balance</div>
                    <div id="dash-balance-val" class="dash-value" style="font-family:var(--font-display, var(--mono, monospace));font-size:20px;font-weight:700;letter-spacing:-0.01em;font-variant-numeric:tabular-nums;">—</div>
                    <div id="dash-rate" class="dash-sub" style="font-size:12px;color:var(--dim, #888);margin-top:2px;font-family:var(--mono, monospace);">saving rate —</div>
                </div>
                <div id="dash-mom" class="dash-card" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;">
                    <div class="dash-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:4px;">MoM Change</div>
                    <div id="dash-mom-val" class="dash-value" style="font-family:var(--font-display, var(--mono, monospace));font-size:20px;font-weight:700;letter-spacing:-0.01em;font-variant-numeric:tabular-nums;">—</div>
                    <div class="dash-sub" style="font-size:12px;color:var(--dim, #888);margin-top:2px;font-family:var(--mono, monospace);">vs prior month balance</div>
                </div>
            </div>

            <div class="dash-chart-card" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;">
                <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                    <div class="sec-label dash-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);">6-month trend</div>
                    <div style="display:flex;gap:10px;font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);">
                        <span><span style="display:inline-block;width:10px;height:10px;background:var(--accent, #089981);border-radius:2px;vertical-align:middle;margin-right:4px;"></span>income</span>
                        <span><span style="display:inline-block;width:10px;height:10px;background:#888;border-radius:2px;vertical-align:middle;margin-right:4px;"></span>expense</span>
                    </div>
                </div>
                <svg id="dash-trend" viewBox="0 0 600 200" preserveAspectRatio="none" style="width:100%;height:200px;background:var(--bg, #0d0d0d);border-radius:8px;border:1px solid var(--border, #2a2a2a);"></svg>
            </div>

            <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:12px;">
                <div class="dash-card" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;opacity:0.7;">
                    <div class="dash-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:4px;">LOW Alerts</div>
                    <div class="dash-sub" style="font-size:12px;color:var(--dim, #888);">Pending watchlist port</div>
                </div>
                <div class="dash-card" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;opacity:0.7;">
                    <div class="dash-label sec-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:4px;">Pinned</div>
                    <div class="dash-sub" style="font-size:12px;color:var(--dim, #888);">Pending watchlist port</div>
                </div>
                <div class="dash-card" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;opacity:0.7;">
                    <div class="dash-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:4px;">Muse</div>
                    <div class="dash-sub" style="font-size:12px;color:var(--dim, #888);">Stays in shell — port pending</div>
                </div>
            </div>
        </div>
    `;
}

function renderProfile() {
    if (!_panel) return;
    const p = loadProfile();
    const nameEl = _panel.querySelector('#dash-profile-name');
    const subEl  = _panel.querySelector('#dash-profile-sub');
    const avEl   = /** @type {HTMLElement} */ (_panel.querySelector('#dash-avatar'));
    const name = (p && (p.displayName || p.name || p.fullName)) || '';
    const role = (p && (p.role || p.position || p.title)) || '';
    if (nameEl) nameEl.textContent = name || '—';
    if (subEl)  subEl.textContent = role || (name ? 'Profile loaded' : 'No profile saved');
    if (avEl) {
        const avatar = /** @type {string} */ (typeof window !== 'undefined' && window.localStorage && window.localStorage.getItem('ps_avatar')) || '';
        if (avatar && avatar.length > 64) {
            avEl.textContent = '';
            avEl.style.background = `center/cover url("${avatar}")`;
        } else {
            const initial = (name && name[0]) ? name[0].toUpperCase() : 'P';
            avEl.textContent = initial;
            avEl.style.background = 'var(--bg, #0d0d0d)';
        }
    }
}

function renderMonthCards() {
    if (!_panel) return;
    const records = loadRecords();
    const m = todayMonth();
    const cur = readMonth(m, records);
    const prev = readMonth(shiftMonth(m, -1), records);
    setText('#dash-month-label', m);
    setText('#dash-payday',      cur.payday ? `income ฿${_MONEY_FMT.format(cur.payday)}` : 'income —');
    setText('#dash-balance-val', cur.payday ? `฿${_MONEY_FMT.format(cur.balance)}` : '—');
    setText('#dash-rate',        cur.payday ? `saving rate ${cur.rate}%` : 'saving rate —');
    if (prev.payday) {
        const diff = cur.balance - prev.balance;
        const sign = diff >= 0 ? '+' : '−';
        setText('#dash-mom-val', `${sign}฿${_MONEY_FMT.format(Math.abs(diff))}`);
    } else {
        setText('#dash-mom-val', '—');
    }
}

function renderTrend() {
    if (!_panel) return;
    const svg = /** @type {SVGSVGElement | null} */ (_panel.querySelector('#dash-trend'));
    if (!svg) return;
    const records = loadRecords();
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(shiftMonth(todayMonth(), -i));
    const data = months.map((m) => readMonth(m, records));
    const W = 600, H = 200, PAD_X = 30, PAD_Y = 24, GROUP = (W - PAD_X * 2) / data.length;
    const peak = Math.max(1, ...data.map((d) => Math.max(d.payday, d.expenses)));
    const yScale = (H - PAD_Y * 2) / peak;
    const bars = data.map((d, i) => {
        const cx = PAD_X + GROUP * i + GROUP / 2;
        const incH = d.payday   * yScale;
        const expH = d.expenses * yScale;
        const incY = H - PAD_Y - incH;
        const expY = H - PAD_Y - expH;
        const incX = cx - 11;
        const expX = cx + 1;
        return `
            <rect x="${incX}" y="${incY}" width="10" height="${incH}" fill="var(--accent, #089981)" rx="1"/>
            <rect x="${expX}" y="${expY}" width="10" height="${expH}" fill="#888" rx="1"/>
            <text x="${cx}" y="${H - 6}" text-anchor="middle" font-family="var(--mono, monospace)" font-size="10" fill="var(--dim, #888)">${d.id.slice(5)}</text>
        `;
    }).join('');
    const gridY = [0.25, 0.5, 0.75, 1.0].map((p) => {
        const y = H - PAD_Y - (peak * p) * yScale;
        return `<line x1="${PAD_X}" y1="${y}" x2="${W - PAD_X}" y2="${y}" stroke="var(--border, #2a2a2a)" stroke-dasharray="2 4"/>`;
    }).join('');
    svg.innerHTML = gridY + bars;
}

function setText(/** @type {string} */ sel, /** @type {string} */ s) {
    if (!_panel) return;
    const el = _panel.querySelector(sel);
    if (el) el.textContent = s;
}

function refreshAll() {
    renderProfile();
    renderMonthCards();
    renderTrend();
}

// ── Lifecycle ──────────────────────────────────────────────────────────

export function init(/** @type {HTMLElement} */ rootEl) {
    _panel = rootEl;
    renderPanel(rootEl);
    refreshAll();
    const offSaved  = bus.on('records:saved',  () => refreshAll());
    const offLoaded = bus.on('records:loaded', () => refreshAll());
    _busOff = () => { offSaved && offSaved(); offLoaded && offLoaded(); };
    bus.emit('tab:dashboard:init', { rootEl });
    return { id: 'dashboard', version: '0.2-step6-dashboard', ready: true, kind: 'tab' };
}

export function destroy() {
    if (_busOff) { try { _busOff(); } catch (e) { /* swallow */ } }
    _busOff = null;
    _panel = null;
    bus.emit('tab:dashboard:destroy');
}
