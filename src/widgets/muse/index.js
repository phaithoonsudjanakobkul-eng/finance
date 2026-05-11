// Muse playlist widget — Dashboard playlist panel.
//
// V6 scope (slot UI + state — NOT clip rendering yet):
//   - 6 preset pills (A-F) with active highlight
//   - slot grid (4-10 slots, default 7) showing preview/placeholder
//   - edit-mode toggle: drag-to-reorder, add/remove, password set/clear
//   - wheel-without-Ctrl cycles presets (per CLAUDE.md)
//   - password gate: clicking a locked preset prompts for the pw
//   - persists to localStorage via ../muse/state.js + emits
//     'settings:changed' so the auto-push pipeline picks the new
//     state up.
//
// V7-V11 add: image / video / TikTok clip rendering + R2 sync + polish.

import { bus } from '../../core/bus.js';
import {
    PRESET_KEYS, PRESET_LETTERS,
    getActivePresetIdx, setActivePresetIdx,
    loadSlots, saveSlots,
    loadActiveSlots, saveActiveSlots,
    loadPasswordHashes, savePasswordHashes,
    deriveVisibleSlotCount, padSlots, reorderSlots,
    hashPassword, verifyPassword,
} from './state.js';

/** @typedef {import('./state.js').Slot} Slot */

/** @type {HTMLElement | null} */
let _host = null;
let _editMode = false;
/** @type {Set<number>} unlocked preset indices for this session */
const _unlocked = new Set();

function isUnlocked(/** @type {number} */ idx) {
    const hashes = loadPasswordHashes();
    if (!hashes[idx]) return true;
    return _unlocked.has(idx);
}

async function promptUnlock(/** @type {number} */ idx) {
    const hashes = loadPasswordHashes();
    if (!hashes[idx]) return true;
    const pw = window.prompt(`Preset ${PRESET_LETTERS[idx]} is locked. Enter password:`);
    if (pw == null) return false;
    const ok = await verifyPassword(pw, hashes[idx]);
    if (ok) _unlocked.add(idx);
    else window.alert('Wrong password');
    return ok;
}

/** @param {Slot} slot @param {number} i @returns {string} */
function renderSlotInner(slot, i) {
    if (slot.type === 'image') {
        const thumb = /** @type {any} */ (slot).thumb || '';
        return `<div class="muse-slot-thumb" style="position:absolute;inset:0;background:center/cover url('${thumb}');"></div>`;
    }
    if (slot.type === 'video') {
        return `<div class="muse-slot-thumb" style="position:absolute;inset:0;background:#111;display:flex;align-items:center;justify-content:center;color:var(--accent, #089981);font-size:28px;">▶</div>`;
    }
    if (slot.type === 'tiktok') {
        return `<div class="muse-slot-thumb" style="position:absolute;inset:0;background:#111;display:flex;align-items:center;justify-content:center;color:var(--text-secondary, #aaa);font-size:11px;font-family:var(--mono);text-transform:uppercase;letter-spacing:0.1em;">TIKTOK</div>`;
    }
    return `<div class="muse-slot-empty" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--dim, #888);font-size:11px;font-family:var(--mono);text-transform:uppercase;letter-spacing:0.1em;">empty · ${String(i + 1).padStart(2, '0')}</div>`;
}

function renderPresetBar() {
    if (!_host) return;
    const idx = getActivePresetIdx();
    const hashes = loadPasswordHashes();
    const bar = _host.querySelector('#muse-preset-bar');
    if (!bar) return;
    bar.innerHTML = PRESET_LETTERS.map((L, i) => {
        const active = i === idx;
        const locked = !!hashes[i] && !_unlocked.has(i);
        const style = active
            ? 'background:var(--accent, #089981);color:#000;border-color:var(--accent, #089981);'
            : 'background:var(--card, #1a1a1a);color:var(--fg, #f5f5f7);border-color:var(--border, #2a2a2a);';
        return `<button data-muse-preset="${i}" title="${locked ? 'Locked — click to unlock' : 'Switch to preset ' + L}" style="${style}padding:4px 10px;border:1px solid;border-radius:999px;cursor:pointer;font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:0.06em;">${L}${locked ? ' 🔒' : ''}</button>`;
    }).join('');
}

function renderSlots() {
    if (!_host) return;
    const idx = getActivePresetIdx();
    if (!isUnlocked(idx)) {
        /** @type {HTMLElement | null} */
        const grid = _host.querySelector('#muse-slot-grid');
        if (grid) grid.innerHTML = `<div style="grid-column:1/-1;padding:24px;text-align:center;color:var(--dim, #888);font-size:12px;font-family:var(--mono);">🔒  preset ${PRESET_LETTERS[idx]} is locked</div>`;
        return;
    }
    const raw = loadSlots(idx);
    const visible = deriveVisibleSlotCount(raw);
    const slots = padSlots(raw, visible);
    /** @type {HTMLElement | null} */
    const grid = _host.querySelector('#muse-slot-grid');
    if (!grid) return;
    grid.innerHTML = slots.map((s, i) => {
        const draggable = _editMode ? 'draggable="true"' : '';
        const editChrome = _editMode
            ? '<button class="muse-slot-rm" title="Clear slot" style="position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,0.55);color:#fff;border:0;cursor:pointer;font-size:12px;line-height:1;">×</button>'
            : '';
        return `<div class="muse-slot" data-slot-idx="${i}" ${draggable} style="position:relative;aspect-ratio:9/16;border-radius:8px;background:var(--bg, #0d0d0d);border:1px solid var(--border, #2a2a2a);overflow:hidden;cursor:${_editMode ? 'grab' : 'pointer'};">${renderSlotInner(s, i)}${editChrome}</div>`;
    }).join('');
}

function renderEditControls() {
    if (!_host) return;
    /** @type {HTMLElement | null} */
    const edit = _host.querySelector('#muse-edit-btn');
    /** @type {HTMLElement | null} */
    const controls = _host.querySelector('#muse-edit-controls');
    const hashes = loadPasswordHashes();
    const idx = getActivePresetIdx();
    if (edit) {
        edit.textContent = _editMode ? 'Done' : 'Edit';
        /** @type {HTMLButtonElement} */ (edit).style.background = _editMode ? 'var(--accent, #089981)' : 'transparent';
        /** @type {HTMLButtonElement} */ (edit).style.color = _editMode ? '#000' : 'var(--fg, #f5f5f7)';
    }
    if (controls) {
        if (_editMode && isUnlocked(idx)) {
            controls.style.display = 'flex';
            controls.innerHTML = `
                <button id="muse-pw-set"    style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;font-family:var(--mono);">${hashes[idx] ? 'Change password' : 'Set password'}</button>
                ${hashes[idx] ? '<button id="muse-pw-clear" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:4px 10px;border-radius:6px;cursor:pointer;font-size:11px;font-family:var(--mono);">Clear password</button>' : ''}
                <span style="font-size:11px;color:var(--dim, #888);font-family:var(--mono);margin-left:auto;">Drag slots to reorder · × to clear</span>
            `;
        } else {
            controls.style.display = 'none';
            controls.innerHTML = '';
        }
    }
}

function rerenderAll() {
    renderPresetBar();
    renderSlots();
    renderEditControls();
}

async function cyclePreset(/** @type {number} */ delta) {
    if (!_host) return;
    const cur = getActivePresetIdx();
    const next = (cur + delta + PRESET_KEYS.length) % PRESET_KEYS.length;
    if (!isUnlocked(next)) {
        const ok = await promptUnlock(next);
        if (!ok) return;
    }
    setActivePresetIdx(next);
    rerenderAll();
    bus.emit('muse:preset-changed', { idx: next });
    bus.emit('settings:changed', { key: 'muse-preset' });
}

async function handlePresetClick(/** @type {number} */ targetIdx) {
    if (!isUnlocked(targetIdx)) {
        const ok = await promptUnlock(targetIdx);
        if (!ok) return;
    }
    setActivePresetIdx(targetIdx);
    rerenderAll();
    bus.emit('muse:preset-changed', { idx: targetIdx });
    bus.emit('settings:changed', { key: 'muse-preset' });
}

function handleSlotClear(/** @type {number} */ slotIdx) {
    const idx = getActivePresetIdx();
    const visible = deriveVisibleSlotCount(loadSlots(idx));
    const slots = padSlots(loadSlots(idx), visible);
    slots[slotIdx] = { type: 'empty' };
    // Trim trailing empties so we don't bloat storage
    while (slots.length > 0 && slots[slots.length - 1].type === 'empty') slots.pop();
    saveSlots(idx, slots);
    rerenderAll();
    bus.emit('settings:changed', { key: 'muse-slots' });
}

async function handleSetPassword() {
    const idx = getActivePresetIdx();
    const pw = window.prompt(`Set password for preset ${PRESET_LETTERS[idx]} (blank to cancel)`);
    if (!pw) return;
    const h = await hashPassword(pw);
    const hashes = loadPasswordHashes();
    hashes[idx] = h;
    savePasswordHashes(hashes);
    _unlocked.add(idx); // already in possession; don't lock ourselves out
    rerenderAll();
    bus.emit('settings:changed', { key: 'muse-pw' });
}

function handleClearPassword() {
    const idx = getActivePresetIdx();
    if (!window.confirm(`Clear password for preset ${PRESET_LETTERS[idx]}?`)) return;
    const hashes = loadPasswordHashes();
    hashes[idx] = null;
    savePasswordHashes(hashes);
    rerenderAll();
    bus.emit('settings:changed', { key: 'muse-pw' });
}

/** @type {number | null} */
let _dragFrom = null;

function onDragStart(/** @type {DragEvent} */ e) {
    if (!_editMode || !_host) return;
    const target = /** @type {HTMLElement | null} */ (e.target);
    const slot = target && target.closest && target.closest('.muse-slot');
    if (!slot) return;
    _dragFrom = parseInt(/** @type {HTMLElement} */ (slot).dataset.slotIdx || '-1', 10);
    if (e.dataTransfer) {
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', String(_dragFrom));
    }
}
function onDragOver(/** @type {DragEvent} */ e) {
    if (!_editMode) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
}
function onDrop(/** @type {DragEvent} */ e) {
    if (!_editMode || !_host || _dragFrom == null) return;
    e.preventDefault();
    const target = /** @type {HTMLElement | null} */ (e.target);
    const slot = target && target.closest && target.closest('.muse-slot');
    if (!slot) return;
    const to = parseInt(/** @type {HTMLElement} */ (slot).dataset.slotIdx || '-1', 10);
    if (to < 0 || to === _dragFrom) { _dragFrom = null; return; }
    const idx = getActivePresetIdx();
    const visible = deriveVisibleSlotCount(loadSlots(idx));
    const slots = padSlots(loadSlots(idx), visible);
    const reordered = reorderSlots(slots, _dragFrom, to);
    saveSlots(idx, reordered);
    _dragFrom = null;
    rerenderAll();
    bus.emit('settings:changed', { key: 'muse-slots' });
}

function onClick(/** @type {Event} */ e) {
    if (!_host) return;
    const t = /** @type {HTMLElement} */ (e.target);
    if (!t) return;
    if (t.dataset && t.dataset.museAction === 'edit') {
        _editMode = !_editMode;
        rerenderAll();
        return;
    }
    if (t.dataset && t.dataset.musePreset != null) {
        handlePresetClick(parseInt(t.dataset.musePreset, 10));
        return;
    }
    if (t.classList.contains('muse-slot-rm')) {
        const slot = t.closest && t.closest('.muse-slot');
        if (slot) {
            const i = parseInt(/** @type {HTMLElement} */ (slot).dataset.slotIdx || '-1', 10);
            if (i >= 0) handleSlotClear(i);
        }
        return;
    }
    if (t.id === 'muse-pw-set')   { handleSetPassword();   return; }
    if (t.id === 'muse-pw-clear') { handleClearPassword(); return; }
}

function onWheel(/** @type {WheelEvent} */ e) {
    // Per CLAUDE.md: wheel WITHOUT Ctrl is reserved for muse preset cycling
    if (e.ctrlKey || e.metaKey) return;
    e.preventDefault();
    cyclePreset(e.deltaY > 0 ? 1 : -1);
}

/**
 * Mount the Muse widget into `host`. Returns destroy().
 * @param {HTMLElement} host
 * @returns {{ destroy: () => void }}
 */
export function mount(host) {
    _host = host;
    host.innerHTML = `
        <div id="muse-root" class="dash-card" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;display:flex;flex-direction:column;gap:10px;">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <div class="dash-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);font-weight:700;">Muse</div>
                <div id="muse-preset-bar" style="display:flex;gap:4px;flex-wrap:wrap;"></div>
                <button id="muse-edit-btn" data-muse-action="edit" title="Edit slots" style="margin-left:auto;background:transparent;border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:4px 12px;border-radius:6px;cursor:pointer;font-family:var(--mono);font-size:11px;font-weight:700;letter-spacing:0.06em;text-transform:uppercase;">Edit</button>
            </div>
            <div id="muse-edit-controls" style="display:none;gap:8px;align-items:center;flex-wrap:wrap;"></div>
            <div id="muse-slot-grid" style="display:grid;grid-template-columns:repeat(7, 1fr);gap:8px;"></div>
            <div style="font-size:10px;color:var(--dim, #888);font-family:var(--mono);text-transform:uppercase;letter-spacing:0.08em;">wheel cycles preset · drag reorders in edit mode · clips port in V7</div>
        </div>
    `;
    host.addEventListener('click', onClick);
    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('dragstart', onDragStart);
    host.addEventListener('dragover',  onDragOver);
    host.addEventListener('drop',      onDrop);
    rerenderAll();
    // Mobile / tablet — drop to 4 cols under 720px
    function applyResponsive() {
        const grid = /** @type {HTMLElement | null} */ (host.querySelector('#muse-slot-grid'));
        if (!grid) return;
        grid.style.gridTemplateColumns = window.innerWidth < 720 ? 'repeat(4, 1fr)' : 'repeat(7, 1fr)';
    }
    applyResponsive();
    window.addEventListener('resize', applyResponsive);
    return {
        destroy() {
            host.removeEventListener('click', onClick);
            host.removeEventListener('wheel', onWheel);
            host.removeEventListener('dragstart', onDragStart);
            host.removeEventListener('dragover',  onDragOver);
            host.removeEventListener('drop',      onDrop);
            window.removeEventListener('resize', applyResponsive);
            _host = null;
            _editMode = false;
        },
    };
}
