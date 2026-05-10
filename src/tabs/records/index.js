// Records tab — monthly income/expense tracker.
//
// Heavy logic ported from monolith (Step 6 sub-session): month picker
// (prev/next + native month input), financial bar (income / expenses / balance
// + saving rate), fixed + variable expense lists with add/remove/toggle-paid
// rows, saveAndCalc pipeline (DOM → records[] → localStorage), loadMonth
// (records[] → DOM repaint), localStorage shape `ps_records` matches monolith
// so existing user data round-trips. Auto-saves on every change (debounced
// via rAF).
//
// DEFERRED to later sub-sessions: 6-month Chart.js trend, clone-previous-month,
// past-month edit lock, clear-month modal. Those are isolated features that
// can land in their own ports without changing this file's spine.

import { bus } from '../../core/bus.js';
import { lsSave, lsGetJson } from '../../core/storage.js';

/** @typedef {{name: string, val: number, amount: number, isPaid: boolean}} Item */
/** @typedef {{id: string, payday: number, fixed: Item[], dynamic: Item[]}} MonthRecord */

const _MONEY_FMT = new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 });

/** @type {HTMLElement | null} */
let _panel = null;
/** @type {string} */
let _curMonth = '';
/** @type {MonthRecord[]} */
let _records = [];
/** @type {number} */
let _saveRaf = 0;

// ── Storage ────────────────────────────────────────────────────────────

function loadRecordsFromLs() {
    const raw = /** @type {any} */ (lsGetJson('ps_records', []));
    _records = Array.isArray(raw) ? raw : [];
}

function persistRecords() {
    try {
        lsSave('ps_records', JSON.stringify(_records));
        lsSave('ps_data_dirty', '1');
    } catch (e) { /* swallow — quota fail handled in lsSave */ }
}

/**
 * @param {string} m
 * @returns {MonthRecord}
 */
function ensureMonth(m) {
    let r = _records.find((x) => x && x.id === m);
    if (!r) {
        r = { id: m, payday: 0, fixed: [], dynamic: [] };
        _records.push(r);
    }
    if (!Array.isArray(r.fixed))   r.fixed = [];
    if (!Array.isArray(r.dynamic)) r.dynamic = [];
    if (typeof r.payday !== 'number') r.payday = 0;
    return r;
}

// ── Month helpers ──────────────────────────────────────────────────────

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

// ── Sums ──────────────────────────────────────────────────────────────

/**
 * @param {Item[]} arr
 */
function sumArr(arr) {
    let s = 0;
    for (const it of arr) {
        const v = (typeof it.val === 'number' && !isNaN(it.val)) ? it.val : (Number(it.amount) || 0);
        s += v;
    }
    return s;
}

// ── DOM ────────────────────────────────────────────────────────────────

function renderPanel(/** @type {HTMLElement} */ rootEl) {
    rootEl.innerHTML = `
        <div id="rec-root" style="display:flex;flex-direction:column;gap:14px;padding:16px;font-family:var(--sans, system-ui);color:var(--fg, #f5f5f7);">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;">Records</span>
                <span style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);">tab/records</span>
                <div style="margin-left:auto;display:flex;align-items:center;gap:6px;">
                    <button id="rec-prev" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:6px 10px;border-radius:6px;cursor:pointer;">‹</button>
                    <input id="rec-month" type="month" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:6px 10px;border-radius:6px;font-family:var(--mono, monospace);">
                    <button id="rec-next" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:6px 10px;border-radius:6px;cursor:pointer;">›</button>
                </div>
            </div>

            <div id="financial-bar-grid" style="display:grid;grid-template-columns:repeat(3, 1fr);gap:10px;">
                <div class="rec-cell" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;">
                    <div class="dash-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:6px;">Income</div>
                    <div style="display:flex;align-items:baseline;gap:6px;">
                        <span style="font-size:11px;color:var(--dim, #888);">฿</span>
                        <input id="rec-payday" type="number" inputmode="decimal" placeholder="0" style="flex:1;background:transparent;border:0;color:var(--fg, #f5f5f7);font-family:var(--font-data, var(--mono, monospace));font-size:22px;font-weight:700;letter-spacing:-0.01em;outline:none;font-variant-numeric:tabular-nums;">
                    </div>
                </div>
                <div class="rec-cell" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;">
                    <div class="dash-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:6px;">Expenses</div>
                    <div id="sum-total-exp" style="font-family:var(--font-data, var(--mono, monospace));font-size:22px;font-weight:700;letter-spacing:-0.01em;font-variant-numeric:tabular-nums;">0</div>
                    <div style="font-size:11px;color:var(--dim, #888);margin-top:2px;font-family:var(--mono, monospace);">
                        <span>fixed </span><span id="sum-fixed">0</span>
                        <span style="margin:0 4px;">·</span>
                        <span>variable </span><span id="sum-dynamic">0</span>
                    </div>
                </div>
                <div class="rec-cell" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;">
                    <div class="dash-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:6px;">Balance</div>
                    <div id="record-balance-val" style="font-family:var(--font-data, var(--mono, monospace));font-size:22px;font-weight:700;letter-spacing:-0.01em;font-variant-numeric:tabular-nums;">0</div>
                    <div style="font-size:11px;color:var(--dim, #888);margin-top:2px;font-family:var(--mono, monospace);">
                        saving rate <span id="current-saving-rate">0%</span>
                    </div>
                </div>
            </div>

            <div id="rec-lists-grid" style="display:grid;grid-template-columns:repeat(2, 1fr);gap:10px;">
                <div class="rec-list-card" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;">
                    <div id="rec-header-fixed" style="display:flex;align-items:center;justify-content:space-between;">
                        <div class="sec-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);">Fixed expenses</div>
                        <button data-add="fixed" class="rec-add-btn" style="background:var(--accent, #089981);color:#000;border:0;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">+ add</button>
                    </div>
                    <div id="fixed-list" data-list="fixed" style="display:flex;flex-direction:column;gap:6px;"></div>
                </div>
                <div class="rec-list-card" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:8px;">
                    <div id="rec-header-dynamic" style="display:flex;align-items:center;justify-content:space-between;">
                        <div class="sec-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);">Variable expenses</div>
                        <button data-add="dynamic" class="rec-add-btn" style="background:var(--accent, #089981);color:#000;border:0;padding:4px 10px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">+ add</button>
                    </div>
                    <div id="dynamic-list" data-list="dynamic" style="display:flex;flex-direction:column;gap:6px;"></div>
                </div>
            </div>

            <div id="rec-status" style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);">Idle</div>
        </div>
    `;
}

/**
 * @param {string} type 'fixed' | 'dynamic'
 * @param {Item} it
 */
function buildRow(type, it) {
    const row = document.createElement('div');
    row.className = 'rec-row';
    row.setAttribute('data-row-type', type);
    row.style.cssText = 'display:grid;grid-template-columns:auto 1fr auto auto;gap:6px;align-items:center;background:var(--bg, #0d0d0d);border:1px solid var(--border, #2a2a2a);border-radius:6px;padding:6px 8px;';
    const isPaid = !!it.isPaid;
    row.innerHTML = `
        <input type="checkbox" data-field="paid" ${isPaid ? 'checked' : ''} style="cursor:pointer;accent-color:var(--accent, #089981);">
        <input type="text" data-field="name" value="${escapeAttr(it.name || '')}" placeholder="name" style="background:transparent;border:0;color:var(--fg, #f5f5f7);outline:none;font-family:var(--sans, system-ui);font-size:13px;${isPaid ? 'text-decoration:line-through;opacity:.55;' : ''}">
        <input type="number" inputmode="decimal" data-field="val" value="${Number(it.val) || 0}" placeholder="0" style="width:110px;background:transparent;border:0;color:var(--fg, #f5f5f7);text-align:right;outline:none;font-family:var(--font-data, var(--mono, monospace));font-size:13px;font-variant-numeric:tabular-nums;${isPaid ? 'opacity:.55;' : ''}">
        <button data-act="del" title="Remove" style="background:transparent;border:0;color:var(--dim, #888);cursor:pointer;font-size:16px;line-height:1;padding:0 4px;">×</button>
    `;
    return row;
}

function escapeAttr(/** @type {string} */ s) {
    return String(s).replace(/[&"<>]/g, (c) => /** @type {Record<string,string>} */ ({ '&': '&amp;', '"': '&quot;', '<': '&lt;', '>': '&gt;' })[c]);
}

// ── Read DOM → arrays ──────────────────────────────────────────────────

/**
 * @param {string} type
 * @returns {Item[]}
 */
function readListItems(type) {
    if (!_panel) return [];
    const list = _panel.querySelector(`[data-list="${type}"]`);
    if (!list) return [];
    /** @type {Item[]} */
    const out = [];
    list.querySelectorAll('.rec-row').forEach((row) => {
        const r = /** @type {HTMLElement} */ (row);
        const name = /** @type {HTMLInputElement} */ (r.querySelector('[data-field="name"]'));
        const val  = /** @type {HTMLInputElement} */ (r.querySelector('[data-field="val"]'));
        const paid = /** @type {HTMLInputElement} */ (r.querySelector('[data-field="paid"]'));
        const v = Number(val && val.value) || 0;
        const item = { name: (name && name.value) || '', val: v, amount: v, isPaid: !!(paid && paid.checked) };
        out.push(item);
    });
    return out;
}

function readPayday() {
    if (!_panel) return 0;
    const el = /** @type {HTMLInputElement | null} */ (_panel.querySelector('#rec-payday'));
    return Number(el && el.value) || 0;
}

// ── saveAndCalc + loadMonth ────────────────────────────────────────────

function saveAndCalc() {
    if (!_panel || !_curMonth) return;
    const rec = ensureMonth(_curMonth);
    rec.payday  = readPayday();
    rec.fixed   = readListItems('fixed');
    rec.dynamic = readListItems('dynamic');
    persistRecords();
    redrawSums();
    bus.emit('records:saved', { month: _curMonth });
}

function redrawSums() {
    if (!_panel) return;
    const rec = ensureMonth(_curMonth);
    const sf = sumArr(rec.fixed);
    const sd = sumArr(rec.dynamic);
    const total = sf + sd;
    const balance = (rec.payday || 0) - total;
    const rate = rec.payday > 0 ? Math.round((balance / rec.payday) * 100) : 0;
    setText('#sum-fixed',         _MONEY_FMT.format(sf));
    setText('#sum-dynamic',       _MONEY_FMT.format(sd));
    setText('#sum-total-exp',     _MONEY_FMT.format(total));
    setText('#record-balance-val', _MONEY_FMT.format(balance));
    setText('#current-saving-rate', rate + '%');
    setText('#rec-status', `Saved · ${_curMonth} · ${rec.fixed.length + rec.dynamic.length} item(s)`);
}

function setText(/** @type {string} */ sel, /** @type {string} */ s) {
    if (!_panel) return;
    const el = _panel.querySelector(sel);
    if (el) el.textContent = s;
}

/**
 * @param {string} m
 */
function loadMonth(m) {
    if (!_panel) return;
    _curMonth = m;
    lsSave('ps_month', m);
    const monthInput = /** @type {HTMLInputElement} */ (_panel.querySelector('#rec-month'));
    if (monthInput) monthInput.value = m;
    const rec = ensureMonth(m);
    const paydayEl = /** @type {HTMLInputElement} */ (_panel.querySelector('#rec-payday'));
    if (paydayEl) paydayEl.value = rec.payday ? String(rec.payday) : '';
    const fixedList = /** @type {HTMLElement} */ (_panel.querySelector('[data-list="fixed"]'));
    const dynList   = /** @type {HTMLElement} */ (_panel.querySelector('[data-list="dynamic"]'));
    if (fixedList) {
        fixedList.innerHTML = '';
        rec.fixed.forEach((it) => fixedList.appendChild(buildRow('fixed', it)));
    }
    if (dynList) {
        dynList.innerHTML = '';
        rec.dynamic.forEach((it) => dynList.appendChild(buildRow('dynamic', it)));
    }
    redrawSums();
    bus.emit('records:loaded', { month: m });
}

function scheduleSave() {
    if (_saveRaf) cancelAnimationFrame(_saveRaf);
    _saveRaf = requestAnimationFrame(() => {
        _saveRaf = 0;
        saveAndCalc();
    });
}

// ── Wire events ────────────────────────────────────────────────────────

function wireEvents() {
    if (!_panel) return;
    _panel.addEventListener('click', (/** @type {Event} */ e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (!t) return;
        if (t.matches('[data-add]')) {
            const type = t.getAttribute('data-add') || 'fixed';
            const list = /** @type {HTMLElement} */ (_panel && _panel.querySelector(`[data-list="${type}"]`));
            if (!list) return;
            const row = buildRow(type, { name: '', val: 0, amount: 0, isPaid: false });
            list.appendChild(row);
            const nameInput = /** @type {HTMLInputElement} */ (row.querySelector('[data-field="name"]'));
            if (nameInput) nameInput.focus();
            scheduleSave();
            return;
        }
        if (t.matches('[data-act="del"]')) {
            const row = t.closest('.rec-row');
            if (row && row.parentNode) row.parentNode.removeChild(row);
            scheduleSave();
            return;
        }
        if (t.id === 'rec-prev') {
            loadMonth(shiftMonth(_curMonth, -1));
            return;
        }
        if (t.id === 'rec-next') {
            loadMonth(shiftMonth(_curMonth, +1));
            return;
        }
    });
    _panel.addEventListener('input', (/** @type {Event} */ e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        if (!t) return;
        if (t.id === 'rec-month' && t.value) {
            loadMonth(t.value);
            return;
        }
        if (t.matches('input[data-field], #rec-payday')) {
            scheduleSave();
        }
    });
    _panel.addEventListener('change', (/** @type {Event} */ e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        if (!t) return;
        if (t.matches('input[data-field="paid"]')) {
            const row = t.closest('.rec-row');
            if (row) {
                /** @type {NodeListOf<HTMLElement>} */
                const dim = row.querySelectorAll('[data-field="name"], [data-field="val"]');
                dim.forEach((el) => {
                    el.style.opacity = t.checked ? '0.55' : '';
                    if (el.matches('[data-field="name"]')) el.style.textDecoration = t.checked ? 'line-through' : '';
                });
            }
            scheduleSave();
        }
    });
}

// ── Lifecycle ──────────────────────────────────────────────────────────

export function init(/** @type {HTMLElement} */ rootEl) {
    _panel = rootEl;
    loadRecordsFromLs();
    renderPanel(rootEl);
    wireEvents();
    const startMonth = /** @type {string} */ (lsGetJson('ps_month', '')) || todayMonth();
    loadMonth(typeof startMonth === 'string' ? startMonth : todayMonth());
    bus.emit('tab:records:init', { rootEl });
    return { id: 'records', version: '0.2-step6-records', ready: true, kind: 'tab', month: _curMonth, recordCount: _records.length };
}

export function destroy() {
    if (_saveRaf) cancelAnimationFrame(_saveRaf);
    _saveRaf = 0;
    _panel = null;
    bus.emit('tab:records:destroy');
}
