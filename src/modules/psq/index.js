// PS Quotation — lazy module (Session 3q core heavy-logic port, 2026-05-10)
//
// Status: CORE HEAVY DONE — xlsx CDN loader + _psqScanFor keyword cell scanner +
// cell helpers + Stage 1 real parse (extract main quotation # + date from main
// xlsx → display Comp1/Comp2 next numbers w/ period reset) + Stage 3 real PDF
// worker call (cloud Fly.io w/ 60s timeout, auth, F7 ceiling).
//
// DEFERRED to Session 3r+ (PSQ Distribute + Editor Pro):
//   · Stage 2 full .eml builder + Outlook download + Gmail authuser deep-link
//   · Comp1/Comp2 template encrypted Gist+IDB storage (~200 line storage layer)
//   · Real Comp1/Comp2 quotation file generation (template patching pipeline)
//   · Path E Collabora live xlsx editor modal (~600 lines: WOPI bootstrap,
//     postMessage protocol, async save polling, asset library, text discovery)
//   · Customer DB + email templates + per-template upload/encrypt/Gist
//   · Hybrid local PDF probe (Tailscale Funnel 1.5s timeout)
//
// CRITICAL invariants from project_ps_quotation_spec memory + CLAUDE.md:
//   - Comp1: BT{BE+1}{MM}-{counter}, counter starts at 350
//   - Comp2: QMVV{MM}{YY}-{counter}, counter starts at 700
//   - Counter resets on (year, month) period change
//   - BE year = calendar BE+1 always
//   - Anti-bid-rigging: date + validity vary per file (in template builder, 3r)
//   - Cell mapping uses _psqScanFor keyword-scan, NOT hardcoded addresses
//   - Templates Comp1/Comp2 stored encrypted in Gist + IDB (3r)
//
// Workers (per CLAUDE.md):
//   - Collabora: pslink-collabora.fly.dev — ALWAYS cloud (Tailscale clipboard bug)
//   - WOPI: pslink-wopi.fly.dev — ALWAYS cloud
//   - PDF: cloud Fly.io (Hybrid local probe deferred to 3r)
// F7 (60s PDF timeout) preserved verbatim from monolith.

import { lsSave, lsGet, lsGetJson } from '../../core/storage.js';
import { bus } from '../../core/bus.js';
import { bufToBase64, wrapBase64, emlEncodeWord, emlMessageId } from './eml-utils.js';

// ── Storage keys ───────────────────────────────────────────────────────
export const PSQ_STATE_KEY            = 'ps_psq_state';
export const PSQ_EMAIL_TPL_KEY        = 'ps_psq_email_templates';
export const PSQ_CUSTOMERS_KEY        = 'ps_psq_customers';
export const PSQ_TEMPLATE_META_KEY    = 'ps_psq_template_meta';
export const PSQ_PDF_WORKER_URL_KEY   = 'ps_pdf_worker_url';
export const PSQ_PDF_AUTH_TOKEN_KEY   = 'ps_pdf_auth_token';
export const PSQ_WOPI_URL_KEY         = 'ps_psq_wopi_url';
export const PSQ_WOPI_TOKEN_KEY       = 'ps_psq_wopi_token';
export const PSQ_COLLABORA_URL_KEY    = 'ps_psq_collabora_url';
export const PSQ_LOCAL_BASE_KEY       = 'ps_psq_local_base';
export const PSQ_LOCAL_BASE_OVERRIDE  = 'ps_psq_local_base_override';

// ── Counter starting points ────────────────────────────────────────────
export const PSQ_COMP1_COUNTER_START = 350;
export const PSQ_COMP2_COUNTER_START = 700;

/** @type {{
 *   main:  { buffer: ArrayBuffer | null, wb: any, name?: string } | null,
 *   comp1: { buffer: ArrayBuffer | null, wb: any, name?: string } | null,
 *   comp2: { buffer: ArrayBuffer | null, wb: any, name?: string } | null,
 *   outputMode: 'excel' | 'pdf',
 * }} */
export const _psqState = {
    main:       null,
    comp1:      null,
    comp2:      null,
    outputMode: 'excel',
};

/** @type {{ comp1: { period: string, counter: number, history: any[] }, comp2: { period: string, counter: number, history: any[] } }} */
let _psqLog = {
    comp1: { period: '', counter: PSQ_COMP1_COUNTER_START, history: [] },
    comp2: { period: '', counter: PSQ_COMP2_COUNTER_START, history: [] },
};

/** @type {HTMLElement | null} */
let _psqPanel = null;

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

/** @param {'comp1' | 'comp2'} which @param {Date} [now] */
export function periodKey(which, now) {
    const d = now || new Date();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    if (which === 'comp1') {
        const be = d.getFullYear() + 543 + 1;
        return `${be}-${m}`;
    }
    return `${d.getFullYear()}-${m}`;
}

/** @param {'comp1' | 'comp2'} which @param {string} period @param {number} counter */
function _formatQuotationNumber(which, period, counter) {
    if (which === 'comp1') {
        const be = period.split('-')[0];
        const m  = period.split('-')[1];
        return `BT${String(be).slice(-2)}${m}-${counter}`;
    }
    const yyyy = period.split('-')[0];
    const m    = period.split('-')[1];
    return `QMVV${m}${String(yyyy).slice(-2)}-${counter}`;
}

/** @param {'comp1' | 'comp2'} which */
export function peekQuotationNumber(which) {
    const period = periodKey(which);
    const slot = _psqLog[which];
    const baseline = (which === 'comp1') ? PSQ_COMP1_COUNTER_START : PSQ_COMP2_COUNTER_START;
    const counter  = (slot.period !== period) ? baseline : slot.counter;
    return _formatQuotationNumber(which, period, counter);
}

/** @param {'comp1' | 'comp2'} which */
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

/** @param {string} s */
function he(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── File slot handling ─────────────────────────────────────────────────
/** @param {'main' | 'comp1' | 'comp2'} slot @param {File} file */
async function loadFileToSlot(slot, file) {
    if (!file) return;
    if (!/\.(xlsx|xls)$/i.test(file.name)) {
        setStatus(`${slot}: ไฟล์ต้องเป็น .xlsx`, 'err');
        return;
    }
    const buffer = await file.arrayBuffer();
    _psqState[slot] = { buffer, wb: null, name: file.name };
    setStatus(`Loaded ${slot} = ${file.name} (${(buffer.byteLength/1024).toFixed(1)} KB)`, 'ok');
    renderSlots();
    bus.emit('psq:slot-loaded', { slot, name: file.name });
}

/** @param {'main' | 'comp1' | 'comp2'} slot */
function clearSlot(slot) {
    _psqState[slot] = null;
    renderSlots();
}

// ══════════════════════════════════════════════════════════════════════
//  xlsx (SheetJS) — lazy CDN ESM loader
// ══════════════════════════════════════════════════════════════════════

/** @type {any} — XLSX module, populated after first lazy load */
let _xlsx = null;
let _xlsxLoading = false;

/**
 * Lazy-load SheetJS via CDN ESM. Function-cloaked import bypasses both Vite's
 * resolver (no runtime URL resolution) and TypeScript's module declarations.
 * Cached after first load.
 */
async function loadXlsx() {
    if (_xlsx) return _xlsx;
    if (_xlsxLoading) {
        while (_xlsxLoading) await new Promise((r) => setTimeout(r, 50));
        return _xlsx;
    }
    _xlsxLoading = true;
    try {
        /** @param {string} url */
        const cdnImport = (url) => /** @type {any} */ (
            // eslint-disable-next-line no-new-func
            new Function('u', 'return import(/* @vite-ignore */ u)')(url)
        );
        _xlsx = await cdnImport('https://cdn.jsdelivr.net/npm/xlsx@0.18.5/+esm');
        return _xlsx;
    } finally { _xlsxLoading = false; }
}

// ══════════════════════════════════════════════════════════════════════
//  Cell scanner + extractors (verbatim from monolith)
// ══════════════════════════════════════════════════════════════════════

/** @param {any} ws @param {number} r @param {number} c */
function _psqGetCellRaw(ws, r, c) {
    const addr = _xlsx.utils.encode_cell({ r, c });
    const cell = ws[addr];
    if (!cell) return '';
    if (cell.t === 's' || cell.t === 'str' || typeof cell.v === 'string') {
        return cell.v != null ? cell.v : (cell.w || '');
    }
    return cell.w || (cell.v != null ? String(cell.v) : '');
}

/**
 * Scan worksheet for the first cell matching ANY of the keywords. Returns
 * `{ r, c, text }` of first hit, or null. Cell mapping uses keyword-scan
 * NOT hardcoded addresses so templates can be re-formatted freely.
 * @param {any} ws @param {string[]} keywords @param {number} [rowFrom] @param {number} [rowTo]
 */
function _psqScanFor(ws, keywords, rowFrom, rowTo) {
    for (let r = (rowFrom || 0); r <= (rowTo || 50); r++) {
        for (let c = 0; c <= 7; c++) {
            const txt = String(_psqGetCellRaw(ws, r, c) || '').trim();
            if (!txt) continue;
            for (let k = 0; k < keywords.length; k++) {
                if (txt.indexOf(keywords[k]) !== -1) return { r, c, text: txt };
            }
        }
    }
    return null;
}

/** @param {string} str */
function _psqExtractLastNumber(str) {
    const s = String(str);
    const nums = s.match(/\d[\d,]*/g);
    if (!nums) return null;
    return parseInt(nums[nums.length - 1].replace(/,/g, ''), 10);
}

/**
 * Parse a Thai date string ("26 มีนาคม 2569" or "26/03/2026") → Date object.
 * Handles BE (พ.ศ. + bare BE year > 2400) and CE years. Returns null if no match.
 * @param {string} s
 */
function _psqParseDateString(s) {
    s = String(s || '').trim();
    if (!s) return null;
    /** @type {Record<string, number>} */
    const MON = {
        'มกราคม':0,'กุมภาพันธ์':1,'มีนาคม':2,'เมษายน':3,'พฤษภาคม':4,'มิถุนายน':5,
        'กรกฎาคม':6,'สิงหาคม':7,'กันยายน':8,'ตุลาคม':9,'พฤศจิกายน':10,'ธันวาคม':11,
        'ม.ค.':0,'ก.พ.':1,'มี.ค.':2,'เม.ย.':3,'พ.ค.':4,'มิ.ย.':5,
        'ก.ค.':6,'ส.ค.':7,'ก.ย.':8,'ต.ค.':9,'พ.ย.':10,'ธ.ค.':11
    };
    let m = s.match(/(\d{1,2})\s*(มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|ม\.ค\.|ก\.พ\.|มี\.ค\.|เม\.ย\.|พ\.ค\.|มิ\.ย\.|ก\.ค\.|ส\.ค\.|ก\.ย\.|ต\.ค\.|พ\.ย\.|ธ\.ค\.)\s*(?:พ\.ศ\.\s*)?(\d{4})/);
    if (m) {
        const day = parseInt(m[1], 10);
        const mon = MON[m[2]];
        let yr = parseInt(m[3], 10);
        if (yr > 2400) yr -= 543; // BE → CE
        return new Date(yr, mon, day);
    }
    m = s.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})/);
    if (m) {
        const day = parseInt(m[1], 10);
        const mon = parseInt(m[2], 10) - 1;
        let yr = parseInt(m[3], 10);
        if (yr < 100) yr += 2500;
        if (yr > 2400) yr -= 543;
        return new Date(yr, mon, day);
    }
    return null;
}

// ══════════════════════════════════════════════════════════════════════
//  Stage 1 — parse main xlsx + display Comp1/Comp2 next numbers
// ══════════════════════════════════════════════════════════════════════

/**
 * Lightweight parse of main quotation xlsx — extracts main quotation # +
 * date. Used by Stage 1 to confirm we read the right file before running
 * full template generation in Stage 3.
 * @param {any} wb
 */
function _psqParseMain(wb) {
    const ws = wb.Sheets[wb.SheetNames[0]];
    if (!ws) return null;

    // Date: try G7 first (canonical PS layout), fall back to "วันที่" scan
    let mainDate = null;
    const g7 = ws[_xlsx.utils.encode_cell({ r: 6, c: 6 })];
    if (g7 && g7.t === 'd' && g7.v instanceof Date) {
        mainDate = g7.v;
    } else if (g7 && typeof g7.v === 'number' && g7.v > 1) {
        const pd = _xlsx.SSF.parse_date_code(g7.v);
        mainDate = new Date(pd.y, pd.m - 1, pd.d);
    } else {
        const dateCell = _psqScanFor(ws, ['วันที่'], 0, 12);
        if (dateCell) {
            const adjAddr = _xlsx.utils.encode_cell({ r: dateCell.r, c: dateCell.c + 1 });
            const adj = ws[adjAddr];
            const raw = adj ? (adj.w || adj.v) : dateCell.text;
            mainDate = _psqParseDateString(String(raw || ''));
        }
    }

    // Quotation #: scan for "เลขที่" / "เลขที่ใบเสนอราคา" — value in next col
    let mainQuotNo = '';
    const noCell = _psqScanFor(ws, ['เลขที่ใบเสนอราคา', 'เลขที่']);
    if (noCell) {
        const adjAddr = _xlsx.utils.encode_cell({ r: noCell.r, c: noCell.c + 1 });
        const adj = ws[adjAddr];
        if (adj) mainQuotNo = String(adj.w || adj.v || '').trim();
    }

    return { mainDate, mainQuotNo };
}

async function stage1Apply() {
    if (!_psqState.main) {
        setStatus('Stage 1: ยังไม่มี main file', 'err');
        return;
    }
    setStatus('Loading SheetJS…', '');
    try {
        await loadXlsx();
        const buf = _psqState.main.buffer;
        if (!buf) { setStatus('main file buffer missing', 'err'); return; }
        const wb = _xlsx.read(new Uint8Array(buf), { type: 'array', cellText: false, cellDates: true });
        _psqState.main.wb = wb;
        const parsed = _psqParseMain(wb);
        const mainDate = parsed && parsed.mainDate
            ? parsed.mainDate.toLocaleDateString('th-TH-u-ca-buddhist')
            : '—';
        const mainNo = (parsed && parsed.mainQuotNo) || '—';

        // Reserve next numbers + persist the counter advance
        const c1Num = nextQuotationNumber('comp1');
        const c2Num = nextQuotationNumber('comp2');
        savePsqLog();
        renderCounter();

        setStatus(`Stage 1 done · main #${mainNo} · ${mainDate} · → Comp1=${c1Num}, Comp2=${c2Num}`, 'ok');
        bus.emit('psq:stage1', { mainNo, mainDate, c1Num, c2Num });
    } catch (err) {
        const e = /** @type {any} */ (err);
        setStatus('Stage 1 error: ' + ((e && e.message) || e), 'err');
        if (typeof console !== 'undefined') console.warn('[PSQ S1]', e);
    }
}

// ══════════════════════════════════════════════════════════════════════
//  Stage 2 — Build .eml file with comp1.xlsx + comp2.xlsx attachments
//  RFC 2822 + MIME multipart/mixed. User drops the .eml into Outlook to
//  get a draft with both attachments + subject + recipient line pre-filled.
// ══════════════════════════════════════════════════════════════════════

const _XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// .eml builder helpers (bufToBase64 / wrapBase64 / emlEncodeWord /
// emlMessageId) live in ./eml-utils.js so unit tests can import them
// without dragging the whole PSQ panel.

async function stage2Distribute() {
    if (!_psqState.comp1 && !_psqState.comp2) {
        setStatus('No comp1/comp2 attachments loaded — finish Stage 1 first', 'err');
        return;
    }
    try {
        setStatus('Building .eml…', '');
        const boundary = '----PSLINK-' + Math.random().toString(36).slice(2, 10) + '-' + Date.now().toString(36);
        const headers = [
            'MIME-Version: 1.0',
            'Date: ' + new Date().toUTCString(),
            'Message-ID: ' + emlMessageId(typeof location !== 'undefined' ? location.hostname : ''),
            'Subject: ' + emlEncodeWord('PSLink Quotation — Comp1 + Comp2'),
            'From: ' + emlEncodeWord('PSLink <noreply@pslink.local>'),
            'To: ',
            'X-Unsent: 1', // Outlook draft-mode hint — opens as draft, not sent message
            `Content-Type: multipart/mixed; boundary="${boundary}"`,
        ].join('\r\n');

        const bodyPart = [
            `--${boundary}`,
            'Content-Type: text/plain; charset=utf-8',
            'Content-Transfer-Encoding: 7bit',
            '',
            'เรียนผู้รับ,',
            '',
            'แนบใบเสนอราคา comp1.xlsx + comp2.xlsx มาด้วย',
            '',
            'ขอบคุณค่ะ',
            'ส่งจาก PSLink (Vite shell)',
            '',
        ].join('\r\n');

        /** @param {string} slotName @param {string} fname @param {ArrayBuffer} buf */
        const buildAttachmentPart = (slotName, fname, buf) => [
            `--${boundary}`,
            `Content-Type: ${_XLSX_MIME}; name="${emlEncodeWord(fname)}"`,
            'Content-Transfer-Encoding: base64',
            `Content-Disposition: attachment; filename="${emlEncodeWord(fname)}"`,
            '',
            wrapBase64(bufToBase64(buf)),
            '',
        ].join('\r\n');

        const parts = [headers, '', bodyPart];
        if (_psqState.comp1 && _psqState.comp1.buffer) {
            parts.push(buildAttachmentPart('comp1', _psqState.comp1.name || 'comp1.xlsx', _psqState.comp1.buffer));
        }
        if (_psqState.comp2 && _psqState.comp2.buffer) {
            parts.push(buildAttachmentPart('comp2', _psqState.comp2.name || 'comp2.xlsx', _psqState.comp2.buffer));
        }
        parts.push(`--${boundary}--`, '');

        const eml = parts.join('\r\n');
        const blob = new Blob([eml], { type: 'message/rfc822' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 16);
        a.download = `pslink-quotation-${stamp}.eml`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);

        const sizes = [];
        if (_psqState.comp1 && _psqState.comp1.buffer) sizes.push('comp1 ' + (_psqState.comp1.buffer.byteLength / 1024).toFixed(1) + 'KB');
        if (_psqState.comp2 && _psqState.comp2.buffer) sizes.push('comp2 ' + (_psqState.comp2.buffer.byteLength / 1024).toFixed(1) + 'KB');
        setStatus(`.eml downloaded · ${sizes.join(' · ')} · drop into Outlook`, 'ok');
    } catch (e) {
        const err = /** @type {any} */ (e);
        setStatus('Stage 2 error: ' + ((err && err.message) || err), 'err');
    }
}

// ══════════════════════════════════════════════════════════════════════
//  Stage 3 — Real PDF worker call (cloud Fly.io w/ 60s timeout)
// ══════════════════════════════════════════════════════════════════════

const _PSQ_PDF_TIMEOUT_MS = 60000;

/** @returns {{ url: string, token: string }} */
function _psqGetPdfWorkerConfig() {
    // Hybrid local probe deferred — for now always cloud
    const url = (lsGet(PSQ_PDF_WORKER_URL_KEY, '') || '').replace(/\/+$/, '');
    const token = lsGet(PSQ_PDF_AUTH_TOKEN_KEY, '') || '';
    return { url, token };
}

/**
 * Call the PSLink PDF worker (cloud Fly.io) with raw xlsx bytes → PDF blob.
 * F7: 60s hard timeout via AbortController. F6 WOPI 401 re-auth path
 * deferred to 3r when WOPI flow ports.
 * @param {Uint8Array} xlsxBytes
 * @returns {Promise<Blob>}
 */
async function _psqXlsxToPdf(xlsxBytes) {
    const cfg = _psqGetPdfWorkerConfig();
    if (!cfg.url)   throw new Error('PDF worker URL not configured (Settings → Storage)');
    if (!cfg.token) throw new Error('PDF worker auth token not configured');
    const endpoint = cfg.url + '/xlsx-to-pdf';
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), _PSQ_PDF_TIMEOUT_MS);
    try {
        const resp = await fetch(endpoint, {
            method: 'POST',
            headers: {
                'Content-Type':  'application/octet-stream',
                'Authorization': 'Bearer ' + cfg.token,
            },
            body: /** @type {any} */ (xlsxBytes),
            signal: ctrl.signal,
        });
        if (!resp.ok) {
            let errText = '';
            try { errText = await resp.text(); } catch (_e) {}
            throw new Error('PDF render failed: HTTP ' + resp.status + (errText ? ' — ' + errText.slice(0, 200) : ''));
        }
        return await resp.blob();
    } catch (err) {
        const e = /** @type {any} */ (err);
        if (e && (e.name === 'AbortError' || /aborted/i.test(e.message || ''))) {
            throw new Error('PDF render timed out after ' + (_PSQ_PDF_TIMEOUT_MS / 1000) + 's (F7 ceiling)');
        }
        throw err;
    } finally { clearTimeout(timer); }
}

async function stage3PrepareAll() {
    if (!_psqState.main) {
        setStatus('Stage 3: ยังไม่มี main file', 'err');
        return;
    }
    const mode = _psqState.outputMode;
    if (mode !== 'pdf') {
        setStatus('Stage 3: switch output mode to PDF first (xlsx mode is identity copy)', 'err');
        return;
    }
    const buf = _psqState.main.buffer;
    if (!buf) { setStatus('main file buffer missing', 'err'); return; }
    setStatus('Rendering PDF via Fly.io worker… (≤60s)', '');
    try {
        const pdfBlob = await _psqXlsxToPdf(new Uint8Array(buf));
        const url = URL.createObjectURL(pdfBlob);
        const a = document.createElement('a');
        const baseName = _psqState.main.name
            ? _psqState.main.name.replace(/\.xlsx?$/i, '')
            : 'main';
        a.href = url;
        a.download = baseName + '.pdf';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        setStatus(`Stage 3 done · ${baseName}.pdf · ${(pdfBlob.size / 1024).toFixed(1)} KB`, 'ok');
        bus.emit('psq:stage3', { size: pdfBlob.size });
    } catch (err) {
        const e = /** @type {any} */ (err);
        setStatus('Stage 3 error: ' + ((e && e.message) || e), 'err');
        if (typeof console !== 'undefined') console.warn('[PSQ S3]', e);
    }
}

function stage4OpenEditor() {
    setStatus('Path E Collabora live xlsx editor — port Session 3r (full WOPI flow)', '');
}

// ── UI render ──────────────────────────────────────────────────────────
/** @param {HTMLElement} rootEl */
function renderPanel(rootEl) {
    rootEl.innerHTML = `
        <div class="psq-panel" style="font-family:var(--sans, system-ui, sans-serif);color:var(--fg, #f5f5f7);">
            <style>
                .psq-panel label { display:block; font-size:10px; color:var(--dim, #888); text-transform:uppercase; letter-spacing:.08em; margin:6px 0 4px; font-weight:700; }
                .psq-panel .grid-3 { display:grid; grid-template-columns:repeat(3, 1fr); gap:12px; margin-bottom:14px; }
                @media (max-width: 720px) { .psq-panel .grid-3 { grid-template-columns:1fr; } }
                .psq-panel .slot { background:var(--bg, #0d0d0d); border:1px solid var(--border, #2a2a2a); border-radius:8px; padding:12px; }
                .psq-panel .slot-title { font-size:11px; text-transform:uppercase; letter-spacing:.08em; color:var(--accent, #089981); font-weight:700; margin-bottom:6px; }
                .psq-panel .slot-name { font-size:12px; font-family:var(--mono); color:var(--fg, #f5f5f7); margin-bottom:8px; word-break:break-all; min-height:18px; }
                .psq-panel .slot-name.empty { color:var(--dim, #888); font-style:italic; }
                .psq-panel .slot-actions { display:flex; gap:6px; }
                .psq-panel .slot-actions button { font-size:11px; padding:6px 10px; border-radius:6px; border:1px solid var(--border, #2a2a2a); background:var(--card, #1a1a1a); color:var(--fg, #f5f5f7); cursor:pointer; font-family:inherit; }
                .psq-panel .slot-actions button:hover { border-color:var(--accent, #089981); }
                .psq-panel .slot-actions button.x { color:#f43f5e; }
                .psq-panel .counter-strip { display:grid; grid-template-columns:1fr 1fr; gap:12px; padding:12px 14px; background:rgba(8, 153, 129, 0.06); border:1px solid var(--accent, #089981); border-radius:8px; margin-bottom:14px; }
                .psq-panel .counter-cell .lbl { font-size:10px; text-transform:uppercase; letter-spacing:.08em; color:var(--dim, #888); margin-bottom:2px; font-weight:700; }
                .psq-panel .counter-cell .val { font-size:18px; font-family:var(--mono); color:var(--accent, #089981); font-weight:700; }
                .psq-panel .counter-cell .meta { font-size:10px; color:var(--dim, #888); margin-top:2px; }
                .psq-panel .toggle-row { display:flex; align-items:center; gap:12px; margin-bottom:14px; }
                .psq-panel .toggle-row label { margin:0; }
                .psq-panel .chip-bar { display:flex; flex-wrap:wrap; gap:6px; }
                .psq-panel .chip { font-size:11px; font-weight:600; padding:6px 12px; border:1px solid var(--border, #2a2a2a); border-radius:999px; background:transparent; color:var(--fg, #f5f5f7); cursor:pointer; transition:all .15s; }
                .psq-panel .chip.active { background:var(--accent, #089981); border-color:var(--accent, #089981); color:#000; }
                .psq-panel .stages { display:grid; grid-template-columns:repeat(2, 1fr); gap:8px; margin-top:14px; }
                @media (max-width: 640px) { .psq-panel .stages { grid-template-columns:1fr; } }
                .psq-panel .stage-btn { background:var(--card, #1a1a1a); color:var(--fg, #f5f5f7); border:1px solid var(--border, #2a2a2a); padding:14px 16px; border-radius:8px; cursor:pointer; font-family:inherit; font-size:13px; text-align:left; }
                .psq-panel .stage-btn:hover { border-color:var(--accent, #089981); }
                .psq-panel .stage-btn .num { font-family:var(--mono); font-size:11px; color:var(--accent, #089981); font-weight:700; margin-right:6px; }
                .psq-panel .stage-btn .desc { display:block; font-size:11px; color:var(--dim, #888); margin-top:4px; }
                .psq-panel .workers { background:var(--bg, #0d0d0d); border:1px solid var(--border, #2a2a2a); border-radius:8px; padding:10px 14px; margin-top:14px; font-size:11px; line-height:1.6; }
                .psq-panel .workers strong { color:var(--accent, #089981); }
                .psq-panel #psq-status { display:block; padding:10px 14px; font-size:12px; color:var(--dim, #888); margin-top:10px; min-height:18px; }
                .psq-panel #psq-status[data-type="ok"] { color:var(--accent, #089981); }
                .psq-panel #psq-status[data-type="err"] { color:#f43f5e; }
                .psq-panel .stub-note { background:rgba(245, 158, 11, 0.08); border-left:3px solid #f59e0b; padding:10px 14px; font-size:12px; color:var(--dim, #888); margin-top:12px; border-radius:4px; }
            </style>

            <div class="counter-strip">
                <div class="counter-cell">
                    <div class="lbl">Comp1 — Next #</div>
                    <div class="val" id="psq-c1-num"></div>
                    <div class="meta" id="psq-c1-meta"></div>
                </div>
                <div class="counter-cell">
                    <div class="lbl">Comp2 — Next #</div>
                    <div class="val" id="psq-c2-num"></div>
                    <div class="meta" id="psq-c2-meta"></div>
                </div>
            </div>

            <label>File slots</label>
            <div class="grid-3">
                <div class="slot" data-slot="main">
                    <div class="slot-title">Main</div>
                    <div class="slot-name empty" id="psq-name-main">— no file —</div>
                    <div class="slot-actions">
                        <button data-pick="main">Choose</button>
                        <button class="x" data-clear="main">Clear</button>
                    </div>
                    <input type="file" data-input="main" accept=".xlsx,.xls" style="display:none;" />
                </div>
                <div class="slot" data-slot="comp1">
                    <div class="slot-title">Comp1 — British Trading</div>
                    <div class="slot-name empty" id="psq-name-comp1">— no template —</div>
                    <div class="slot-actions">
                        <button data-pick="comp1">Choose</button>
                        <button class="x" data-clear="comp1">Clear</button>
                    </div>
                    <input type="file" data-input="comp1" accept=".xlsx,.xls" style="display:none;" />
                </div>
                <div class="slot" data-slot="comp2">
                    <div class="slot-title">Comp2 — QMVV</div>
                    <div class="slot-name empty" id="psq-name-comp2">— no template —</div>
                    <div class="slot-actions">
                        <button data-pick="comp2">Choose</button>
                        <button class="x" data-clear="comp2">Clear</button>
                    </div>
                    <input type="file" data-input="comp2" accept=".xlsx,.xls" style="display:none;" />
                </div>
            </div>

            <div class="toggle-row">
                <label style="margin:0;">Output Mode</label>
                <div class="chip-bar" id="psq-output-bar"></div>
            </div>

            <div class="stages">
                <button class="stage-btn" id="psq-stage-1">
                    <span class="num">Stage 1</span>Apply numbering
                    <span class="desc">Patch Comp1/Comp2 quotation numbers + dates (anti-bid-rigging variation)</span>
                </button>
                <button class="stage-btn" id="psq-stage-2">
                    <span class="num">Stage 2</span>Generate .eml + Gmail link
                    <span class="desc">Build .eml file (Outlook) + Gmail authuser deep-link with attachments</span>
                </button>
                <button class="stage-btn" id="psq-stage-3">
                    <span class="num">Stage 3</span>Prepare ALL (xlsx / PDF)
                    <span class="desc">Recalc + render — uses Fly.io PDF worker (cloud or Tailscale local)</span>
                </button>
                <button class="stage-btn" id="psq-stage-4">
                    <span class="num">Path E</span>Open Collabora editor
                    <span class="desc">Live in-browser xlsx editing — Cloud Collabora always (Tailscale clipboard bug)</span>
                </button>
            </div>

            <div class="workers">
                <strong>Backends:</strong>
                Collabora <code>${he(lsGet(PSQ_COLLABORA_URL_KEY, 'pslink-collabora.fly.dev'))}</code> ·
                WOPI <code>${he(lsGet(PSQ_WOPI_URL_KEY, 'pslink-wopi.fly.dev'))}</code> ·
                PDF <code>${he(lsGet(PSQ_PDF_WORKER_URL_KEY, 'pslink-pdf-worker.fly.dev'))}</code>
                ${lsGet(PSQ_LOCAL_BASE_OVERRIDE, '') ? '<br><strong>Hybrid override (this device):</strong> ' + he(lsGet(PSQ_LOCAL_BASE_OVERRIDE, '')) : ''}
            </div>

            <div id="psq-status"></div>

            <div class="stub-note">
                <strong>Session 3q port</strong> — Stage 1 (parse main + display Comp1/Comp2 numbers w/ period reset + counter persist) + Stage 3 (real PDF render via Fly.io worker w/ 60s timeout) live. Stage 2 .eml + Path E Collabora editor + template encrypted Gist storage ship in Session 3r.
            </div>
        </div>
    `;
}

function renderCounter() {
    if (!_psqPanel) return;
    const c1 = _psqPanel.querySelector('#psq-c1-num');
    const c2 = _psqPanel.querySelector('#psq-c2-num');
    const c1Meta = _psqPanel.querySelector('#psq-c1-meta');
    const c2Meta = _psqPanel.querySelector('#psq-c2-meta');
    if (c1)     c1.textContent     = peekQuotationNumber('comp1');
    if (c2)     c2.textContent     = peekQuotationNumber('comp2');
    if (c1Meta) c1Meta.textContent = `period ${periodKey('comp1')} · counter at ${_psqLog.comp1.counter}`;
    if (c2Meta) c2Meta.textContent = `period ${periodKey('comp2')} · counter at ${_psqLog.comp2.counter}`;
}

function renderSlots() {
    if (!_psqPanel) return;
    /** @type {('main' | 'comp1' | 'comp2')[]} */
    const slots = ['main', 'comp1', 'comp2'];
    for (const slot of slots) {
        const nameEl = _psqPanel.querySelector(`#psq-name-${slot}`);
        if (!nameEl) continue;
        const data = _psqState[slot];
        if (data && data.name) {
            nameEl.textContent = data.name;
            nameEl.classList.remove('empty');
        } else {
            nameEl.textContent = (slot === 'main') ? '— no file —' : '— no template —';
            nameEl.classList.add('empty');
        }
    }
}

function renderOutputBar() {
    if (!_psqPanel) return;
    const bar = _psqPanel.querySelector('#psq-output-bar');
    if (!bar) return;
    const modes = [
        { id: 'excel', label: 'XLSX' },
        { id: 'pdf',   label: 'PDF'  },
    ];
    bar.innerHTML = modes.map((m) => {
        const active = m.id === _psqState.outputMode ? ' active' : '';
        return `<button class="chip${active}" data-output="${m.id}">${he(m.label)}</button>`;
    }).join('');
}

/** @param {string} msg @param {'ok' | 'err' | ''} [type] */
function setStatus(msg, type) {
    if (!_psqPanel) return;
    const el = /** @type {HTMLElement | null} */ (_psqPanel.querySelector('#psq-status'));
    if (!el) return;
    el.textContent = msg;
    el.dataset.type = type || '';
    if (msg && type === 'ok') setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; el.dataset.type = ''; } }, 5000);
}

function wireEvents() {
    if (!_psqPanel) return;
    const panel = _psqPanel;

    panel.addEventListener('click', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);

        // File slot pick → trigger hidden input
        const pickBtn = t.closest('[data-pick]');
        if (pickBtn) {
            const slot = /** @type {HTMLElement} */ (pickBtn).dataset.pick;
            const input = /** @type {HTMLInputElement | null} */ (panel.querySelector(`input[data-input="${slot}"]`));
            input?.click();
            return;
        }
        // File slot clear
        const clearBtn = t.closest('[data-clear]');
        if (clearBtn) {
            const slot = /** @type {HTMLElement} */ (clearBtn).dataset.clear;
            if (slot === 'main' || slot === 'comp1' || slot === 'comp2') clearSlot(slot);
            return;
        }
        // Output mode chip
        const outBtn = t.closest('[data-output]');
        if (outBtn) {
            const m = /** @type {HTMLElement} */ (outBtn).dataset.output;
            if (m === 'excel' || m === 'pdf') {
                _psqState.outputMode = m;
                renderOutputBar();
            }
            return;
        }
    });

    // File inputs (one per slot)
    panel.querySelectorAll('input[data-input]').forEach((el) => {
        const input = /** @type {HTMLInputElement} */ (el);
        input.addEventListener('change', () => {
            const slot = input.dataset.input;
            const file = input.files && input.files[0];
            if (!file) return;
            if (slot === 'main' || slot === 'comp1' || slot === 'comp2') loadFileToSlot(slot, file);
        });
    });

    // Stage buttons
    panel.querySelector('#psq-stage-1')?.addEventListener('click', () => stage1Apply());
    panel.querySelector('#psq-stage-2')?.addEventListener('click', () => stage2Distribute());
    panel.querySelector('#psq-stage-3')?.addEventListener('click', () => stage3PrepareAll());
    panel.querySelector('#psq-stage-4')?.addEventListener('click', () => stage4OpenEditor());
}

// ── Module lifecycle ───────────────────────────────────────────────────
/**
 * @param {HTMLElement} rootEl
 * @param {{ bus?: any, lsSave?: any, lsGet?: any }} [_ctx]
 */
export function init(rootEl, _ctx) {
    loadPsqLog();
    _psqPanel = rootEl;
    renderPanel(rootEl);
    renderCounter();
    renderSlots();
    renderOutputBar();
    wireEvents();
    bus.emit('psq:init', { rootEl, log: _psqLog });
    return {
        id:           'psq',
        version:      '0.3-session3q-core-heavy',
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

export function destroy() {
    if (_psqState.main)  { _psqState.main.buffer  = null; _psqState.main.wb  = null; }
    if (_psqState.comp1) { _psqState.comp1.buffer = null; _psqState.comp1.wb = null; }
    if (_psqState.comp2) { _psqState.comp2.buffer = null; _psqState.comp2.wb = null; }
    _psqPanel = null;
    bus.emit('psq:destroy');
}
