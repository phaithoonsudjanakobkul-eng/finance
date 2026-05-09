// PS Quotation — lazy module (Session 3c skeleton, 2026-05-09)
//
// Status: PARTIAL PORT (skeleton + state container + storage keys + counter helpers).
// Full xlsx patching pipeline, template management, Path E (Collabora editor),
// PDF render flow, .eml builders, and UI rendering all stay in monolith
// index.html until Session 3d+ port. PSQ is the second-largest non-PSF module
// (~4.2k lines) and depends on SheetJS (XLSX library).
//
// CRITICAL invariants from project_ps_quotation_spec memory + CLAUDE.md:
//   - Comp1 numbering: BT{BE+1}{MM}-{counter}, counter starts at 350
//   - Comp2 numbering: QMVV{MM}{YY}-{counter}, counter starts at 700
//   - Counter resets on (year, month) period change
//   - Comp1 period key: ${BE+1}-${MM}, Comp2: ${YYYY}-${MM}
//   - BE year = calendar BE+1 always (NOT Thai fiscal Oct convention)
//   - Anti-bid-rigging: date + validity vary deterministically per file
//   - Cell mapping uses _psqScanFor keyword-scan, NOT hardcoded addresses
//   - Templates Comp1/Comp2 stored encrypted in Gist + IDB (slot-based names)
//
// Workers (cloud-only Collabora + WOPI, hybrid PDF):
//   - Collabora: pslink-collabora.fly.dev — ALWAYS cloud (Tailscale clipboard bug)
//   - WOPI: pslink-wopi.fly.dev — ALWAYS cloud
//   - PDF: cloud OR Tailscale-local (Hybrid mode probe 1.5s timeout)
// F4 (Collabora postMessage origin guard) + F6 (WOPI 401 re-auth) live in
// monolith and apply to all three.
//
// CDN dep: SheetJS (XLSX) — currently CDN, will be `npm i xlsx` in Session 3d.

import { lsSave, lsGetJson } from '../../core/storage.js';
import { bus } from '../../core/bus.js';

// ── Storage keys (preserve ps_* convention per Architecture Hard Rule §5) ──
export const PSQ_STATE_KEY            = 'ps_psq_state';
export const PSQ_EMAIL_TPL_KEY        = 'ps_psq_email_templates';
export const PSQ_CUSTOMERS_KEY        = 'ps_psq_customers';
export const PSQ_TEMPLATE_META_KEY    = 'ps_psq_template_meta';
export const PSQ_PDF_WORKER_URL_KEY   = 'ps_pdf_worker_url';
export const PSQ_PDF_AUTH_TOKEN_KEY   = 'ps_pdf_auth_token';
export const PSQ_WOPI_URL_KEY         = 'ps_psq_wopi_url';
export const PSQ_WOPI_TOKEN_KEY       = 'ps_psq_wopi_token';
export const PSQ_COLLABORA_URL_KEY    = 'ps_psq_collabora_url';
export const PSQ_LOCAL_BASE_KEY       = 'ps_psq_local_base';          // synced via Gist
export const PSQ_LOCAL_BASE_OVERRIDE  = 'ps_psq_local_base_override'; // per-device, NOT synced

// ── Counter starting points (anti-bid-rigging baseline) ──
export const PSQ_COMP1_COUNTER_START = 350;  // BT{BE+1}{MM}-350+
export const PSQ_COMP2_COUNTER_START = 700;  // QMVV{MM}{YY}-700+

/**
 * In-flight workbook state per slot. Bytes hydrate from FSA picker / Gist
 * template fetch. wb cleared after edit so re-parse from buffer picks up changes.
 * @type {{
 *   main:  { buffer: ArrayBuffer | null, wb: any, bytes?: Uint8Array } | null,
 *   comp1: { buffer: ArrayBuffer | null, wb: any, bytes?: Uint8Array } | null,
 *   comp2: { buffer: ArrayBuffer | null, wb: any, bytes?: Uint8Array } | null,
 *   outputMode: 'excel' | 'pdf',
 * }}
 */
export const _psqState = {
    main:       null,
    comp1:      null,
    comp2:      null,
    outputMode: 'excel',
};

/** Gist-synced counter log + period state (port of monolith _psqLog). */
/** @type {{ comp1: { period: string, counter: number, history: any[] }, comp2: { period: string, counter: number, history: any[] } }} */
let _psqLog = {
    comp1: { period: '', counter: PSQ_COMP1_COUNTER_START, history: [] },
    comp2: { period: '', counter: PSQ_COMP2_COUNTER_START, history: [] },
};

export function loadPsqLog() {
    const parsed = lsGetJson(PSQ_STATE_KEY, /** @type {any} */ (null));
    if (parsed && typeof parsed === 'object') {
        if (parsed.comp1) _psqLog.comp1 = { ..._psqLog.comp1, ...parsed.comp1 };
        if (parsed.comp2) _psqLog.comp2 = { ..._psqLog.comp2, ...parsed.comp2 };
    }
    return _psqLog;
}

export function savePsqLog() {
    lsSave(PSQ_STATE_KEY, JSON.stringify(_psqLog));
    bus.emit('psq:state-saved', { log: _psqLog });
}

export function getPsqLog() { return _psqLog; }

/**
 * Current period key for a competitor. Comp1 uses BE+1, Comp2 uses calendar.
 * Period change triggers counter reset to baseline.
 * @param {'comp1' | 'comp2'} which
 * @param {Date} [now]
 */
export function periodKey(which, now) {
    const d = now || new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    if (which === 'comp1') {
        const be = d.getFullYear() + 543 + 1; // BE+1 always (per spec — NOT Thai fiscal Oct)
        return `${be}-${m}`;
    }
    // comp2
    return `${d.getFullYear()}-${m}`;
}

/**
 * Format a quotation number from period + counter — pure (no state mutation).
 * @param {'comp1' | 'comp2'} which
 * @param {string} period
 * @param {number} counter
 * @returns {string}
 */
function _formatQuotationNumber(which, period, counter) {
    if (which === 'comp1') {
        const be = period.split('-')[0];     // BE+1
        const m  = period.split('-')[1];     // MM
        return `BT${String(be).slice(-2)}${m}-${counter}`;
    }
    // comp2: QMVV{MM}{YY}-{counter}
    const yyyy = period.split('-')[0];
    const m    = period.split('-')[1];
    return `QMVV${m}${String(yyyy).slice(-2)}-${counter}`;
}

/**
 * Peek the next number WITHOUT incrementing — safe for UI preview, init, etc.
 * Auto-applies the period reset rule so callers see what would be issued NOW.
 * @param {'comp1' | 'comp2'} which
 * @returns {string}
 */
export function peekQuotationNumber(which) {
    const period = periodKey(which);
    const slot = _psqLog[which];
    const baseline = (which === 'comp1') ? PSQ_COMP1_COUNTER_START : PSQ_COMP2_COUNTER_START;
    const counter  = (slot.period !== period) ? baseline : slot.counter;
    return _formatQuotationNumber(which, period, counter);
}

/**
 * Increment + return next quotation number for the given competitor.
 * Auto-resets counter when the period rolls over.
 * @param {'comp1' | 'comp2'} which
 * @returns {string} formatted number (e.g. "BT257004-350" / "QMVV0426-700")
 */
export function nextQuotationNumber(which) {
    const period = periodKey(which);
    const slot = _psqLog[which];
    if (slot.period !== period) {
        slot.period  = period;
        slot.counter = (which === 'comp1') ? PSQ_COMP1_COUNTER_START : PSQ_COMP2_COUNTER_START;
    }
    const counter = slot.counter++;
    return _formatQuotationNumber(which, period, counter);
}

/**
 * Module entry — Architecture conv. Hard Rule §1.
 * Phase 3c proof: returns ready state + counters; full UI render deferred.
 * @param {HTMLElement} rootEl
 * @param {{ bus?: any, lsSave?: any, lsGet?: any }} [_ctx]
 */
export function init(rootEl, _ctx) {
    loadPsqLog();
    bus.emit('psq:init', { rootEl, log: _psqLog });
    return {
        id:           'psq',
        version:      '0.1-session3c-skeleton',
        ready:        true,
        comp1Counter: _psqLog.comp1.counter,
        comp1Period:  _psqLog.comp1.period,
        comp2Counter: _psqLog.comp2.counter,
        comp2Period:  _psqLog.comp2.period,
        outputMode:   _psqState.outputMode,
        nextComp1Preview: peekQuotationNumber('comp1'),
        nextComp2Preview: peekQuotationNumber('comp2'),
    };
}

/**
 * Module teardown — preserves counters + log (sticky), drops in-flight buffers.
 */
export function destroy() {
    if (_psqState.main)  { _psqState.main.buffer  = null; _psqState.main.wb  = null; }
    if (_psqState.comp1) { _psqState.comp1.buffer = null; _psqState.comp1.wb = null; }
    if (_psqState.comp2) { _psqState.comp2.buffer = null; _psqState.comp2.wb = null; }
    bus.emit('psq:destroy');
}
