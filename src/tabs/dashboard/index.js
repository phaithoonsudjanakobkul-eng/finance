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
import { todayMonth, shiftMonth, readMonth } from '../records/helpers.js';
import { PRICE_FMT as _PRICE_FMT, DELTA_FMT as _DELTA_FMT } from '../../core/formatters.js';

/** @typedef {import('../records/helpers.js').Item} Item */
/** @typedef {import('../records/helpers.js').MonthRecord} MonthRecord */
/** @typedef {{ c?: number, dp?: number, name?: string }} WlEntry */

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

// Month-math + sum helpers DRY-imported from ../records/helpers.js — see
// the records helper tests for coverage of year-rollover + NaN tolerance.

// ── Render ─────────────────────────────────────────────────────────────

function renderPanel(/** @type {HTMLElement} */ rootEl) {
    rootEl.innerHTML = `
        <div id="dash-root" style="display:flex;flex-direction:column;gap:14px;padding:16px;color:var(--fg, #f5f5f7);">
            <div style="display:flex;align-items:center;gap:10px;">
                <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;">Dashboard</span>
                <span style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);">tab/dashboard</span>
            </div>

            <div id="dash-row1" class="cine-profile-row" style="display:grid;grid-template-columns:minmax(320px, 1.4fr) repeat(2, minmax(0, 1fr));gap:12px;">
                <div id="dash-profile" class="dash-card" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:18px;display:flex;align-items:flex-start;gap:16px;min-width:0;">
                    <div id="dash-avatar" style="width:96px;height:96px;border-radius:50%;background:var(--bg, #0d0d0d);border:1px solid var(--border, #2a2a2a);display:flex;align-items:center;justify-content:center;font-family:var(--font-display, var(--mono, monospace));font-size:36px;font-weight:700;color:var(--accent, #089981);overflow:hidden;flex-shrink:0;">P</div>
                    <div style="min-width:0;flex:1;display:flex;flex-direction:column;gap:6px;">
                        <div>
                            <div id="dash-profile-name" class="profile-name dash-value" style="font-family:var(--font-display, var(--sans, system-ui));font-size:22px;font-weight:700;letter-spacing:-0.01em;line-height:1.15;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">—</div>
                            <div id="dash-profile-role" class="dash-sub" style="font-size:12px;color:var(--text-secondary, #aaa);margin-top:2px;font-family:var(--sans, system-ui);">—</div>
                            <div id="dash-profile-company" class="dash-sub" style="font-size:11px;color:var(--dim, #888);margin-top:1px;font-family:var(--mono, monospace);"></div>
                        </div>
                        <div id="dash-profile-contact" style="display:flex;flex-direction:column;gap:3px;margin-top:4px;font-size:11px;font-family:var(--mono, monospace);color:var(--text-secondary, #aaa);"></div>
                    </div>
                </div>
                <div id="cine-payday-card" class="dash-card cine-payday-card" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px 18px;display:flex;flex-direction:column;justify-content:space-between;min-height:128px;">
                    <div class="dash-label cine-aux-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--accent, #089981);font-weight:700;">Next Payday</div>
                    <div style="display:flex;align-items:baseline;gap:8px;">
                        <span id="dash-payday-days" class="cine-payday-num dash-value" style="font-family:var(--font-display, var(--mono, monospace));font-size:48px;font-weight:700;letter-spacing:-0.03em;line-height:1;font-variant-numeric:tabular-nums;color:var(--text-primary, #f5f5f7);">—</span>
                        <span class="cine-aux-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:var(--text-secondary, #aaa);font-weight:700;">days</span>
                    </div>
                    <div id="dash-payday-sublabel" class="cine-payday-sublabel" style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);text-transform:uppercase;letter-spacing:0.06em;">set payday in profile</div>
                </div>
                <div id="cine-month-card" class="dash-card cine-month-card" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px 18px;display:flex;flex-direction:column;justify-content:space-between;min-height:128px;">
                    <div class="dash-label cine-aux-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.1em;color:var(--accent, #089981);font-weight:700;">This Month</div>
                    <div style="display:flex;align-items:baseline;gap:8px;">
                        <span id="dash-month-day" class="cine-month-num dash-value" style="font-family:var(--font-display, var(--mono, monospace));font-size:48px;font-weight:700;letter-spacing:-0.03em;line-height:1;font-variant-numeric:tabular-nums;color:var(--text-primary, #f5f5f7);">—</span>
                        <span id="dash-month-of" class="cine-aux-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.12em;color:var(--text-secondary, #aaa);font-weight:700;">of 31</span>
                    </div>
                    <div id="dash-month-name" class="cine-month-sublabel" style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);text-transform:uppercase;letter-spacing:0.06em;">—</div>
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

            <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;">
                <div id="dash-pinned" class="dash-card" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;">
                    <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px;">
                        <div class="dash-label sec-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);">Pinned</div>
                        <a href="#tab=watchlist" style="font-size:11px;color:var(--dim, #888);text-decoration:none;font-family:var(--mono, monospace);">edit ↗</a>
                    </div>
                    <div id="dash-pinned-rows" style="display:flex;flex-direction:column;gap:6px;font-family:var(--mono, monospace);font-size:13px;font-variant-numeric:tabular-nums;"></div>
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
    const nameEl    = _panel.querySelector('#dash-profile-name');
    const roleEl    = _panel.querySelector('#dash-profile-role');
    const companyEl = _panel.querySelector('#dash-profile-company');
    const contactEl = _panel.querySelector('#dash-profile-contact');
    const avEl      = /** @type {HTMLElement} */ (_panel.querySelector('#dash-avatar'));
    const name    = (p && (p.displayName || p.name || p.fullName)) || '';
    const role    = (p && (p.role || p.position || p.title)) || '';
    const company = (p && (p.company || p.organization || p.org)) || '';
    const email   = (p && p.email)   || '';
    const phone   = (p && p.phone)   || '';
    const address = (p && p.address) || '';
    if (nameEl)    nameEl.textContent    = name || '—';
    if (roleEl)    roleEl.textContent    = role || (name ? '' : 'No profile saved');
    if (companyEl) companyEl.textContent = company || '';
    if (contactEl) {
        /** @type {string[]} */
        const lines = [];
        if (phone)   lines.push('☎  ' + phone);
        if (email)   lines.push('✉  ' + email);
        if (address) lines.push('⌂  ' + address);
        contactEl.innerHTML = lines.map((l) => {
            const span = document.createElement('span');
            span.textContent = l;
            return span.outerHTML;
        }).join('');
    }
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

// ── Hero numeric cards (Payday + Month) ──────────────────────────────
//
// Pure helpers — exported for unit testing. Pass an explicit "today"
// to keep tests deterministic; callers in the live render pass new Date().

/**
 * Days-in-month for a given year + month (1-12). Handles Feb leap.
 * @param {number} year @param {number} month1 @returns {number}
 */
export function _daysInMonth(year, month1) {
    return new Date(year, month1, 0).getDate();
}

/**
 * Days until the next payday-of-month. If today's date ≤ paydayDay, the
 * payday is later this month; otherwise it's that day next month.
 * Returns 0 on payday itself.
 * @param {number} paydayDay 1-31 — clamped to month length
 * @param {Date} [today]
 * @returns {{ days: number, when: string }}
 */
export function _nextPayday(paydayDay, today) {
    const now = today || new Date();
    const y = now.getFullYear();
    const m = now.getMonth(); // 0-11
    const d = now.getDate();
    let pyear = y, pmonth = m;
    if (d > paydayDay) {
        pmonth += 1;
        if (pmonth > 11) { pmonth = 0; pyear += 1; }
    }
    const targetDay = Math.min(paydayDay, _daysInMonth(pyear, pmonth + 1));
    const target = new Date(pyear, pmonth, targetDay);
    const startOfToday = new Date(y, m, d);
    const days = Math.round((target.getTime() - startOfToday.getTime()) / 86_400_000);
    /** @type {Intl.DateTimeFormatOptions} */
    const opts = { day: '2-digit', month: 'short' };
    const when = target.toLocaleDateString('en-US', opts);
    return { days, when };
}

function renderHeroNumbers() {
    if (!_panel) return;
    const p = loadProfile();
    const paydayDay = (p && Number(p.payday)) || 0;
    const now = new Date();
    const dayEl   = _panel.querySelector('#dash-month-day');
    const ofEl    = _panel.querySelector('#dash-month-of');
    const nameEl  = _panel.querySelector('#dash-month-name');
    const daysEl  = _panel.querySelector('#dash-payday-days');
    const subEl   = _panel.querySelector('#dash-payday-sublabel');
    const dim = _daysInMonth(now.getFullYear(), now.getMonth() + 1);
    if (dayEl)  dayEl.textContent = String(now.getDate());
    if (ofEl)   ofEl.textContent = 'OF ' + dim;
    if (nameEl) nameEl.textContent = now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    if (paydayDay >= 1 && paydayDay <= 31) {
        const r = _nextPayday(paydayDay, now);
        if (daysEl) daysEl.textContent = String(r.days);
        if (subEl)  subEl.textContent = r.when.toUpperCase();
    } else {
        if (daysEl) daysEl.textContent = '—';
        if (subEl)  subEl.textContent = 'SET PAYDAY IN PROFILE';
    }
}

// renderMonthCards removed (V3) — Balance + MoM Change cards are gone
// from the dashboard hero. The financial bar lives on the Records tab;
// dashboard's job is now profile-led (Profile / Payday / Month).

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

function renderPinned() {
    if (!_panel) return;
    const host = /** @type {HTMLElement | null} */ (_panel.querySelector('#dash-pinned-rows'));
    if (!host) return;
    /** @type {string[]} */
    const pinned = /** @type {any} */ (lsGetJson('ps_pinned_wl', [])) || [];
    if (!Array.isArray(pinned) || !pinned.length) {
        host.innerHTML = `<div style="color:var(--dim, #888);font-size:12px;font-family:var(--sans, system-ui);">No symbols pinned. Open Watchlist and tap ☆ on a row.</div>`;
        return;
    }
    /** @type {Record<string, WlEntry>} */
    const cache = /** @type {any} */ (lsGetJson('ps_wl_cache', {})) || {};
    host.innerHTML = pinned.slice(0, 8).map((sym) => {
        const c = cache[sym] || {};
        const last = (typeof c.c === 'number') ? _PRICE_FMT.format(c.c) : '—';
        const dp = (typeof c.dp === 'number') ? _DELTA_FMT.format(c.dp) + '%' : '—';
        const dpColor = (typeof c.dp === 'number') ? (c.dp >= 0 ? 'var(--wl-up, #10b981)' : 'var(--wl-dn, #ef4444)') : 'var(--dim, #888)';
        return `<div style="display:grid;grid-template-columns:60px 1fr 90px 70px;gap:6px;align-items:center;">
            <span style="font-weight:700;letter-spacing:0.02em;">${sym}</span>
            <span style="color:var(--dim, #888);font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;">${c.name || ''}</span>
            <span style="text-align:right;">${last}</span>
            <span style="text-align:right;color:${dpColor};">${dp}</span>
        </div>`;
    }).join('');
}

function refreshAll() {
    renderProfile();
    renderHeroNumbers();
    renderTrend();
    renderPinned();
}

// ── Lifecycle ──────────────────────────────────────────────────────────

export function init(/** @type {HTMLElement} */ rootEl) {
    _panel = rootEl;
    renderPanel(rootEl);
    refreshAll();
    const offSaved   = bus.on('records:saved',           () => refreshAll());
    const offLoaded  = bus.on('records:loaded',          () => refreshAll());
    const offPinned  = bus.on('watchlist:pinned',        () => renderPinned());
    const offWlRef   = bus.on('watchlist:refreshed',     () => renderPinned());
    const offAvatar  = bus.on('profile:avatar-changed',  () => renderProfile());
    _busOff = () => {
        offSaved  && offSaved();
        offLoaded && offLoaded();
        offPinned && offPinned();
        offWlRef  && offWlRef();
        offAvatar && offAvatar();
    };
    bus.emit('tab:dashboard:init', { rootEl });
    return { id: 'dashboard', version: '0.2-step6-dashboard', ready: true, kind: 'tab' };
}

export function destroy() {
    if (_busOff) { try { _busOff(); } catch (e) { /* swallow */ } }
    _busOff = null;
    _panel = null;
    bus.emit('tab:dashboard:destroy');
}
