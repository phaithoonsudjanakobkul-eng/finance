// PS SpecFlow — lazy module (Session 3b skeleton, 2026-05-09)
//
// Status: PARTIAL PORT (skeleton + state container + history scaffolding).
// Full DOCX builder (docx.js), Word/Docs-style undo-redo, paste-from-clipboard
// HTML normalization, and rich UI rendering stay in monolith index.html until
// Session 3c+ port. PSF is the LARGEST module (~6k lines) so its full port
// will likely span multiple sub-sessions.
//
// Scaffolding in place here:
//   - constants (max level, spacing, font)
//   - rows array
//   - history (snapshots + index + suppress flag)
//   - clipboard pasted HTML capture slot
//
// CRITICAL: PSF uses the "single-column scrollable workstation" pattern from
// CLAUDE.md Coding Rule 13 — sticky header `flex-shrink:0` + scrollable body
// `flex:1; min-height:0; overflow-y:auto`. New PSF UI must preserve this.

import { lsSave, lsGetJson } from '../../core/storage.js';
import { bus } from '../../core/bus.js';

export const _PSF_MAX_LEVEL = 7;
export const _PSF_SP        = 4;
export const _PSF_FONT      = 'TH Sarabun New';
export const _PSF_HIST_LIMIT = 200;

/** @typedef {{ idx: number, level: number, text: string, [key: string]: any }} PsfRow */

/** @type {{
 *   rows: PsfRow[],
 *   inited: boolean,
 *   pastedHtml: string | null,
 *   history: any[],
 *   historyIdx: number,
 *   histDebounce: any,
 *   histSuppress: boolean,
 * }} */
const _psfState = {
    rows:         [],
    inited:       false,
    pastedHtml:   null,
    history:      [],
    historyIdx:   -1,
    histDebounce: null,
    histSuppress: false,
};

/** @returns {PsfRow[]} */
export function getRows() { return _psfState.rows; }

/** @param {PsfRow[]} rows */
export function setRows(rows) {
    _psfState.rows = Array.isArray(rows) ? rows : [];
    bus.emit('psf:rows-changed', { count: _psfState.rows.length });
}

export function getState() { return _psfState; }

/** Inspect history for debugging */
export function _historyInfo() {
    return {
        snapshots: _psfState.history.length,
        idx:       _psfState.historyIdx,
        canUndo:   _psfState.historyIdx > 0,
        canRedo:   _psfState.historyIdx < _psfState.history.length - 1,
    };
}

/**
 * Module entry — Architecture conv. Hard Rule §1.
 * Returns ready state + reference info; full UI render deferred to Session 3c+.
 * @param {HTMLElement} rootEl
 * @param {{ bus?: any, lsSave?: any, lsGet?: any }} [_ctx]
 */
export function init(rootEl, _ctx) {
    bus.emit('psf:init', { rootEl, rowCount: _psfState.rows.length });
    return {
        id:          'psf',
        version:     '0.1-session3b-skeleton',
        ready:       true,
        rowCount:    _psfState.rows.length,
        maxLevel:    _PSF_MAX_LEVEL,
        font:        _PSF_FONT,
        historyLen:  _psfState.history.length,
    };
}

/**
 * Module teardown — preserves rows + history (sticky data) but clears the
 * pasted clipboard buffer + debounce timer.
 */
export function destroy() {
    _psfState.pastedHtml = null;
    if (_psfState.histDebounce) {
        clearTimeout(_psfState.histDebounce);
        _psfState.histDebounce = null;
    }
    bus.emit('psf:destroy');
}
