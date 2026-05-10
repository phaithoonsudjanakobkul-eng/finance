// PS SpecFlow — lazy module (Session 3j UI port — toolbar + rows editor + history + export stub, 2026-05-09)
//
// Status: PARTIAL PORT (toolbar, hierarchical rows editor, history undo/redo
// with snapshot debounce, basic paste handler, DOCX export stub). Real
// docx.js DOCX construction, Word/Docs-style rich text formatting (bold/italic/
// underline), full clipboard HTML normalization, sticky-header scrollable
// workstation pattern (CLAUDE.md Coding Rule 13) all stay in monolith
// index.html until Session 3k+ port. PSF is the LARGEST module (~6k lines)
// so its full port spans multiple sub-sessions; this lands the editor shell.
//
// Ported in 3j:
//   - Constants (max level, spacing, font, history limit — kept from skeleton)
//   - Rows array management (CRUD: add/remove/move/level adjust)
//   - History (snapshots + undo/redo + debounced auto-snapshot + suppress flag)
//   - Toolbar (Add / Indent +/- / Undo / Redo / Clear / Export DOCX)
//   - Rows editor (level indentation, text edit-in-place, focus tracking)
//   - Paste handler (basic — captures clipboard text into new row)
//   - DOCX export stub (downloads .json sketch — real docx.js in Session 3k+)
//
// CRITICAL invariants (from CLAUDE.md Coding Rule 13 — workstation pattern):
//   - Single-column scrollable: sticky header `flex-shrink:0` + body `flex:1; min-height:0; overflow-y:auto`
//   - Real PSF UI uses this pattern; v2 mount inherits parent layout for now
//   - Web Worker for history if performance becomes an issue (deferred)

import { lsSave, lsGetJson } from '../../core/storage.js';
import { bus } from '../../core/bus.js';

export const _PSF_MAX_LEVEL  = 7;
export const _PSF_SP         = 4;
export const _PSF_FONT       = 'TH Sarabun New';
export const _PSF_HIST_LIMIT = 200;
const _PSF_LS_ROWS = 'ps_psf_rows';

/** @typedef {{ idx: number, level: number, text: string }} PsfRow */

/** @type {{
 *   rows: PsfRow[],
 *   inited: boolean,
 *   pastedHtml: string | null,
 *   history: any[],
 *   historyIdx: number,
 *   histDebounce: any,
 *   histSuppress: boolean,
 *   focusedIdx: number | null,
 * }} */
const _psfState = {
    rows:         [],
    inited:       false,
    pastedHtml:   null,
    history:      [],
    historyIdx:   -1,
    histDebounce: null,
    histSuppress: false,
    focusedIdx:   null,
};

/** @type {HTMLElement | null} */
let _psfPanel = null;

// ── Persistence ────────────────────────────────────────────────────────
function loadRows() {
    const saved = lsGetJson(_PSF_LS_ROWS, /** @type {PsfRow[] | null} */ (null));
    if (Array.isArray(saved)) _psfState.rows = saved;
}
function saveRows() {
    lsSave(_PSF_LS_ROWS, JSON.stringify(_psfState.rows));
}
export function getRows()   { return _psfState.rows; }
/** @param {PsfRow[]} rows */
export function setRows(rows) {
    _psfState.rows = Array.isArray(rows) ? rows : [];
    saveRows();
    bus.emit('psf:rows-changed', { count: _psfState.rows.length });
}
export function getState() { return _psfState; }

// ── History (snapshot per-keystroke with 800ms debounce) ───────────────
function snapshotNow() {
    if (_psfState.histSuppress) return;
    const snap = JSON.stringify(_psfState.rows);
    // If pointer < end, drop redo branch
    if (_psfState.historyIdx < _psfState.history.length - 1) {
        _psfState.history.length = _psfState.historyIdx + 1;
    }
    // Skip if identical to last snapshot
    if (_psfState.history.length > 0 && _psfState.history[_psfState.history.length - 1] === snap) return;
    _psfState.history.push(snap);
    if (_psfState.history.length > _PSF_HIST_LIMIT) {
        _psfState.history.shift();
    }
    _psfState.historyIdx = _psfState.history.length - 1;
    bus.emit('psf:history-snapshot', { idx: _psfState.historyIdx, total: _psfState.history.length });
}

function snapshotDebounced() {
    if (_psfState.histDebounce) clearTimeout(_psfState.histDebounce);
    _psfState.histDebounce = setTimeout(() => {
        _psfState.histDebounce = null;
        snapshotNow();
    }, 800);
}

function undo() {
    if (_psfState.historyIdx <= 0) { setStatus('Nothing to undo', ''); return; }
    _psfState.historyIdx--;
    restoreSnapshot(_psfState.history[_psfState.historyIdx]);
}
function redo() {
    if (_psfState.historyIdx >= _psfState.history.length - 1) { setStatus('Nothing to redo', ''); return; }
    _psfState.historyIdx++;
    restoreSnapshot(_psfState.history[_psfState.historyIdx]);
}
/** @param {string} snap */
function restoreSnapshot(snap) {
    try {
        _psfState.histSuppress = true;
        _psfState.rows = JSON.parse(snap);
        saveRows();
        renderRows();
        renderHistInfo();
    } catch (_e) {} finally { _psfState.histSuppress = false; }
}

export function historyInfo() {
    return {
        snapshots: _psfState.history.length,
        idx:       _psfState.historyIdx,
        canUndo:   _psfState.historyIdx > 0,
        canRedo:   _psfState.historyIdx < _psfState.history.length - 1,
    };
}

// ── Row CRUD ───────────────────────────────────────────────────────────
function nextIdx() {
    let mx = -1;
    for (const r of _psfState.rows) if (r.idx > mx) mx = r.idx;
    return mx + 1;
}
/** @param {number} [afterIdx] */
function addRow(afterIdx) {
    const newRow = { idx: nextIdx(), level: 0, text: '' };
    if (afterIdx == null) {
        _psfState.rows.push(newRow);
    } else {
        const i = _psfState.rows.findIndex((r) => r.idx === afterIdx);
        if (i === -1) _psfState.rows.push(newRow);
        else {
            newRow.level = _psfState.rows[i].level;
            _psfState.rows.splice(i + 1, 0, newRow);
        }
    }
    saveRows();
    snapshotDebounced();
    renderRows();
    _psfState.focusedIdx = newRow.idx;
    setTimeout(() => focusRow(newRow.idx), 10);
}
/** @param {number} idx */
function removeRow(idx) {
    const i = _psfState.rows.findIndex((r) => r.idx === idx);
    if (i === -1) return;
    _psfState.rows.splice(i, 1);
    saveRows();
    snapshotDebounced();
    renderRows();
}
/** @param {number} idx @param {1 | -1} delta */
function adjustLevel(idx, delta) {
    const r = _psfState.rows.find((x) => x.idx === idx);
    if (!r) return;
    r.level = Math.max(0, Math.min(_PSF_MAX_LEVEL, r.level + delta));
    saveRows();
    snapshotDebounced();
    renderRows();
}
/** @param {number} idx @param {1 | -1} delta */
function moveRow(idx, delta) {
    const i = _psfState.rows.findIndex((r) => r.idx === idx);
    if (i === -1) return;
    const j = i + delta;
    if (j < 0 || j >= _psfState.rows.length) return;
    const tmp = _psfState.rows[i];
    _psfState.rows[i] = _psfState.rows[j];
    _psfState.rows[j] = tmp;
    saveRows();
    snapshotDebounced();
    renderRows();
}
function clearAll() {
    if (_psfState.rows.length === 0) return;
    if (!confirm(`ลบ ${_psfState.rows.length} แถวทั้งหมด?`)) return;
    _psfState.rows = [];
    saveRows();
    snapshotDebounced();
    renderRows();
    setStatus('Cleared all rows', 'ok');
}

/** @param {number} idx @param {string} text */
function updateRowText(idx, text) {
    const r = _psfState.rows.find((x) => x.idx === idx);
    if (!r) return;
    r.text = text;
    saveRows();
    snapshotDebounced();
}

// ── Paste handler (basic — capture text into new row) ──────────────────
/** @param {ClipboardEvent} e */
function handlePaste(e) {
    if (!e.clipboardData) return;
    const html = e.clipboardData.getData('text/html');
    const text = e.clipboardData.getData('text/plain');
    if (html) _psfState.pastedHtml = html;
    if (text && (!e.target || (/** @type {HTMLElement} */ (e.target)).tagName !== 'INPUT')) {
        // Outside input — split on lines and add as rows
        e.preventDefault();
        const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        for (const line of lines) {
            _psfState.rows.push({ idx: nextIdx(), level: 0, text: line });
        }
        saveRows();
        snapshotNow();
        renderRows();
        setStatus(`Pasted ${lines.length} lines`, 'ok');
    }
}

// ── DOCX export stub ───────────────────────────────────────────────────
function exportDocx() {
    if (_psfState.rows.length === 0) {
        setStatus('No rows to export', 'err');
        return;
    }
    // Stub: download JSON sketch — real docx.js construction in Session 3k+
    const payload = {
        meta:    { font: _PSF_FONT, sp: _PSF_SP, maxLevel: _PSF_MAX_LEVEL, generated: new Date().toISOString() },
        rows:    _psfState.rows,
        note:    'Session 3j stub — real DOCX (docx.js) construction ships in Session 3k+',
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `specflow-${Date.now()}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    setStatus(`Exported ${_psfState.rows.length} rows (JSON stub) — real DOCX in Session 3k+`, 'ok');
}

/** @param {string} s */
function he(s) {
    return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── UI render ──────────────────────────────────────────────────────────
/** @param {HTMLElement} rootEl */
function renderPanel(rootEl) {
    rootEl.innerHTML = `
        <div class="psf-panel" style="font-family:var(--sans, system-ui, sans-serif);color:var(--fg, #f5f5f7);display:flex;flex-direction:column;height:100%;">
            <style>
                .psf-panel .toolbar { display:flex; flex-wrap:wrap; gap:6px; padding:10px 0; border-bottom:1px solid var(--border, #2a2a2a); margin-bottom:10px; flex-shrink:0; align-items:center; }
                .psf-panel .toolbar button { background:var(--card, #1a1a1a); color:var(--fg, #f5f5f7); border:1px solid var(--border, #2a2a2a); padding:6px 12px; border-radius:6px; font-size:12px; font-weight:600; cursor:pointer; font-family:inherit; transition:all .15s; }
                .psf-panel .toolbar button:hover:not([disabled]) { border-color:var(--accent, #089981); color:var(--accent, #089981); }
                .psf-panel .toolbar button[disabled] { opacity:.4; cursor:not-allowed; }
                .psf-panel .toolbar button.primary { background:var(--accent, #089981); color:#000; border-color:var(--accent, #089981); }
                .psf-panel .toolbar .sep { width:1px; height:20px; background:var(--border, #2a2a2a); margin:0 4px; }
                .psf-panel .toolbar .info { font-size:11px; color:var(--dim, #888); margin-left:auto; }
                .psf-panel .editor { flex:1; min-height:0; overflow-y:auto; padding-right:4px; }
                .psf-panel .row { display:flex; align-items:center; gap:6px; padding:4px 6px; border-radius:6px; transition:background .12s; }
                .psf-panel .row:hover { background:rgba(255,255,255,0.03); }
                .psf-panel .row.focused { background:rgba(8, 153, 129, 0.08); }
                .psf-panel .row .lvl { font-family:var(--mono); font-size:10px; color:var(--accent, #089981); font-weight:700; min-width:18px; text-align:center; }
                .psf-panel .row input.text { flex:1; background:transparent; color:var(--fg, #f5f5f7); border:0; padding:6px 8px; font-size:13px; outline:none; font-family:inherit; border-radius:4px; }
                .psf-panel .row input.text:focus { background:var(--bg, #0d0d0d); }
                .psf-panel .row .ctl { display:flex; gap:2px; opacity:.4; transition:opacity .15s; }
                .psf-panel .row:hover .ctl, .psf-panel .row.focused .ctl { opacity:1; }
                .psf-panel .row .ctl button { background:transparent; border:0; color:var(--dim, #888); cursor:pointer; padding:2px 5px; font-size:11px; line-height:1; border-radius:3px; }
                .psf-panel .row .ctl button:hover { color:var(--accent, #089981); background:rgba(8, 153, 129, 0.08); }
                .psf-panel .row .ctl button.x:hover { color:#f43f5e; background:rgba(244, 63, 94, 0.08); }
                .psf-panel .empty { text-align:center; padding:60px 20px; color:var(--dim, #888); font-size:13px; }
                .psf-panel .empty strong { display:block; font-size:15px; color:var(--fg, #f5f5f7); margin-bottom:6px; }
                .psf-panel #psf-status { padding:8px 0 0; font-size:12px; color:var(--dim, #888); flex-shrink:0; min-height:20px; }
                .psf-panel #psf-status[data-type="ok"] { color:var(--accent, #089981); }
                .psf-panel #psf-status[data-type="err"] { color:#f43f5e; }
                .psf-panel .stub-note { background:rgba(245, 158, 11, 0.08); border-left:3px solid #f59e0b; padding:8px 12px; font-size:11px; color:var(--dim, #888); margin-top:8px; border-radius:4px; flex-shrink:0; }
            </style>

            <div class="toolbar">
                <button id="psf-add">+ Add row</button>
                <div class="sep"></div>
                <button id="psf-undo" title="Ctrl+Z">↶ Undo</button>
                <button id="psf-redo" title="Ctrl+Shift+Z">↷ Redo</button>
                <div class="sep"></div>
                <button id="psf-export" class="primary">Export DOCX</button>
                <button id="psf-clear" style="color:#f43f5e;">Clear all</button>
                <span class="info" id="psf-info"></span>
            </div>

            <div class="editor" id="psf-editor"></div>

            <div id="psf-status"></div>

            <div class="stub-note">
                <strong>Session 3j port (final)</strong> — toolbar + rows editor + history (undo/redo) + paste-to-rows + DOCX export stub live; Real docx.js DOCX construction + rich text formatting (bold/italic/underline) + full HTML paste normalization ship in Session 3k+. <strong>All 7 utility modules now have real UI.</strong>
            </div>
        </div>
    `;
}

function renderRows() {
    if (!_psfPanel) return;
    const editor = _psfPanel.querySelector('#psf-editor');
    if (!editor) return;
    if (_psfState.rows.length === 0) {
        editor.innerHTML = `
            <div class="empty">
                <strong>No rows yet</strong>
                Click <em>+ Add row</em> above, or paste plain text (each line becomes a row).
            </div>
        `;
        renderHistInfo();
        return;
    }
    editor.innerHTML = _psfState.rows.map((r) => {
        const indent = r.level * 18;
        const focused = (_psfState.focusedIdx === r.idx) ? ' focused' : '';
        return `<div class="row${focused}" data-idx="${r.idx}" style="margin-left:${indent}px;">
            <span class="lvl">L${r.level}</span>
            <input class="text" type="text" value="${he(r.text)}" data-row-text="${r.idx}" placeholder="—" />
            <span class="ctl">
                <button data-act="indent-out" data-idx="${r.idx}" title="Outdent">←</button>
                <button data-act="indent-in"  data-idx="${r.idx}" title="Indent">→</button>
                <button data-act="up"   data-idx="${r.idx}" title="Move up">↑</button>
                <button data-act="down" data-idx="${r.idx}" title="Move down">↓</button>
                <button data-act="add-after" data-idx="${r.idx}" title="Add row below">+</button>
                <button data-act="remove" class="x" data-idx="${r.idx}" title="Remove">✕</button>
            </span>
        </div>`;
    }).join('');
    renderHistInfo();
}

function renderHistInfo() {
    if (!_psfPanel) return;
    const info = _psfPanel.querySelector('#psf-info');
    if (info) {
        const h = historyInfo();
        info.textContent = `${_psfState.rows.length} rows · history ${h.idx + 1}/${h.snapshots}`;
    }
    const undoBtn = /** @type {HTMLButtonElement | null} */ (_psfPanel.querySelector('#psf-undo'));
    const redoBtn = /** @type {HTMLButtonElement | null} */ (_psfPanel.querySelector('#psf-redo'));
    const h = historyInfo();
    if (undoBtn) undoBtn.disabled = !h.canUndo;
    if (redoBtn) redoBtn.disabled = !h.canRedo;
}

/** @param {number} idx */
function focusRow(idx) {
    if (!_psfPanel) return;
    const input = /** @type {HTMLInputElement | null} */ (_psfPanel.querySelector(`input[data-row-text="${idx}"]`));
    if (input) {
        input.focus();
        input.select();
    }
}

/** @param {string} msg @param {'ok' | 'err' | ''} [type] */
function setStatus(msg, type) {
    if (!_psfPanel) return;
    const el = /** @type {HTMLElement | null} */ (_psfPanel.querySelector('#psf-status'));
    if (!el) return;
    el.textContent = msg;
    el.dataset.type = type || '';
    if (msg && type === 'ok') setTimeout(() => { if (el.textContent === msg) { el.textContent = ''; el.dataset.type = ''; } }, 4000);
}

function wireEvents() {
    if (!_psfPanel) return;
    const panel = _psfPanel;

    // Toolbar
    panel.querySelector('#psf-add')?.addEventListener('click',    () => addRow());
    panel.querySelector('#psf-undo')?.addEventListener('click',   () => undo());
    panel.querySelector('#psf-redo')?.addEventListener('click',   () => redo());
    panel.querySelector('#psf-export')?.addEventListener('click', () => exportDocx());
    panel.querySelector('#psf-clear')?.addEventListener('click',  () => clearAll());

    // Row controls (delegated)
    panel.addEventListener('click', (e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        const btn = t.closest('[data-act]');
        if (!btn) return;
        const act = /** @type {HTMLElement} */ (btn).dataset.act;
        const idx = parseInt(/** @type {HTMLElement} */ (btn).dataset.idx || '-1', 10);
        if (idx < 0) return;
        if (act === 'indent-in')  adjustLevel(idx,  1);
        if (act === 'indent-out') adjustLevel(idx, -1);
        if (act === 'up')         moveRow(idx, -1);
        if (act === 'down')       moveRow(idx,  1);
        if (act === 'add-after')  addRow(idx);
        if (act === 'remove')     removeRow(idx);
    });

    // Row text input — delegated input event
    panel.addEventListener('input', (e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        const rowIdx = t.dataset && t.dataset.rowText;
        if (rowIdx == null) return;
        const idx = parseInt(rowIdx, 10);
        if (idx >= 0) updateRowText(idx, t.value);
    });
    panel.addEventListener('focusin', (e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        const rowIdx = t.dataset && t.dataset.rowText;
        if (rowIdx == null) return;
        const idx = parseInt(rowIdx, 10);
        if (idx >= 0) {
            _psfState.focusedIdx = idx;
            // Re-render only focus highlight without rebuilding inputs (preserve cursor)
            const rows = panel.querySelectorAll('.row');
            rows.forEach((r) => r.classList.toggle('focused', parseInt(/** @type {HTMLElement} */ (r).dataset.idx || '-1', 10) === idx));
        }
    });

    // Keyboard shortcuts on the panel
    panel.addEventListener('keydown', (e) => {
        const ke = /** @type {KeyboardEvent} */ (e);
        if ((ke.ctrlKey || ke.metaKey) && ke.key.toLowerCase() === 'z' && !ke.shiftKey) { ke.preventDefault(); undo(); return; }
        if ((ke.ctrlKey || ke.metaKey) && (ke.key.toLowerCase() === 'y' || (ke.key.toLowerCase() === 'z' && ke.shiftKey))) { ke.preventDefault(); redo(); return; }
        // Tab inside row input → indent
        if (ke.key === 'Tab') {
            const t = /** @type {HTMLInputElement} */ (ke.target);
            const rowIdx = t.dataset && t.dataset.rowText;
            if (rowIdx != null) {
                ke.preventDefault();
                adjustLevel(parseInt(rowIdx, 10), ke.shiftKey ? -1 : 1);
                setTimeout(() => focusRow(parseInt(rowIdx, 10)), 10);
            }
        }
        // Enter inside row input → add row after
        if (ke.key === 'Enter') {
            const t = /** @type {HTMLInputElement} */ (ke.target);
            const rowIdx = t.dataset && t.dataset.rowText;
            if (rowIdx != null) {
                ke.preventDefault();
                addRow(parseInt(rowIdx, 10));
            }
        }
    });

    // Paste — capture HTML on whole panel, but only convert text→rows when target is not an input
    panel.addEventListener('paste', (e) => handlePaste(/** @type {ClipboardEvent} */ (e)));
}

// ── Module lifecycle ───────────────────────────────────────────────────
/**
 * @param {HTMLElement} rootEl
 * @param {{ bus?: any, lsSave?: any, lsGet?: any }} [_ctx]
 */
export function init(rootEl, _ctx) {
    loadRows();
    _psfPanel = rootEl;
    renderPanel(rootEl);
    renderRows();
    wireEvents();
    // Seed history with current state so first undo has somewhere to go
    snapshotNow();
    bus.emit('psf:init', { rootEl, rowCount: _psfState.rows.length });
    return {
        id:          'psf',
        version:     '0.2-session3j-ui-port',
        ready:       true,
        rowCount:    _psfState.rows.length,
        maxLevel:    _PSF_MAX_LEVEL,
        font:        _PSF_FONT,
        historyLen:  _psfState.history.length,
    };
}

export function destroy() {
    if (_psfState.histDebounce) {
        clearTimeout(_psfState.histDebounce);
        _psfState.histDebounce = null;
    }
    _psfState.pastedHtml = null;
    _psfPanel = null;
    bus.emit('psf:destroy');
}
