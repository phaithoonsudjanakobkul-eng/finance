// Pure helpers for the Records tab — month math + financial sums.
// Extracted so the calc paths can be unit-tested in isolation; the
// records tab module re-imports from here.

/** @typedef {{name: string, val: number, amount: number, isPaid: boolean}} Item */
/** @typedef {{id: string, payday: number, fixed: Item[], dynamic: Item[]}} MonthRecord */

/** @returns {string} current calendar month as "YYYY-MM" */
export function todayMonth() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/**
 * Shift a "YYYY-MM" string by a delta number of months. Handles year
 * rollover (Dec + 1 → Jan next year).
 *
 * @param {string} m e.g. "2026-05"
 * @param {number} delta integer offset in months (can be negative)
 * @returns {string}
 */
export function shiftMonth(m, delta) {
    const [y, mo] = m.split('-').map(Number);
    const d = new Date(y, mo - 1 + delta, 1);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
}

/**
 * Sum the financial value of an item array. Prefers `.val` when it's a
 * finite number; falls back to coerced `.amount` otherwise. Tolerant
 * of malformed entries — a non-numeric/missing item contributes 0.
 *
 * @param {any} arr
 * @returns {number}
 */
export function sumArr(arr) {
    if (!Array.isArray(arr)) return 0;
    let s = 0;
    for (const it of arr) {
        if (!it) continue;
        const v = (typeof it.val === 'number' && !isNaN(it.val)) ? it.val : (Number(it.amount) || 0);
        if (isFinite(v)) s += v;
    }
    return s;
}

/**
 * Compute month summary {payday, expenses, balance, rate} from a list
 * of records. Used by Records tab AND Dashboard 6-month chart.
 *
 * @param {string} m
 * @param {MonthRecord[]} records
 * @returns {{ id: string, payday: number, expenses: number, balance: number, rate: number }}
 */
export function readMonth(m, records) {
    const rec = (Array.isArray(records) ? records : []).find((x) => x && x.id === m);
    if (!rec) return { id: m, payday: 0, expenses: 0, balance: 0, rate: 0 };
    const expenses = sumArr(rec.fixed) + sumArr(rec.dynamic);
    const payday = (typeof rec.payday === 'number' && isFinite(rec.payday)) ? rec.payday : 0;
    const balance = payday - expenses;
    const rate = payday > 0 ? Math.round((balance / payday) * 100) : 0;
    return { id: m, payday, expenses, balance, rate };
}

/**
 * Find the most recent prior non-empty month before `m`, scanning back
 * up to `maxLookback` months. Used by "Clone last" — copies the first
 * month with at least one fixed or dynamic entry. Returns null if none.
 *
 * @param {string} m current month
 * @param {MonthRecord[]} records
 * @param {number} [maxLookback]
 * @returns {MonthRecord | null}
 */
export function findLastNonEmpty(m, records, maxLookback) {
    const back = maxLookback || 24;
    if (!Array.isArray(records)) return null;
    for (let i = 1; i <= back; i++) {
        const id = shiftMonth(m, -i);
        const r = records.find((x) => x && x.id === id);
        if (!r) continue;
        const hasFixed   = Array.isArray(r.fixed)   && r.fixed.length > 0;
        const hasDynamic = Array.isArray(r.dynamic) && r.dynamic.length > 0;
        if (hasFixed || hasDynamic) return r;
    }
    return null;
}
