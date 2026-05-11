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
import {
    coverDims, clampPan, resolveSplit, syncFracFromPx, syncPxFromFrac, clampZoom,
} from './pan-zoom.js';
import { openTrimFor } from './video-trim.js';
import { idbGet } from '../../core/idb.js';
import { uploadClipToR2, loadClipForSlot } from './r2-clip.js';
import { extractTikTokId, embedUrl as tiktokEmbedUrl } from './tiktok.js';

/** @typedef {import('./state.js').Slot} Slot */

/** @type {HTMLElement | null} */
let _host = null;
let _editMode = false;
/** @type {Set<number>} unlocked preset indices for this session */
const _unlocked = new Set();

// Active slot index per preset, in-memory (loaded from state on mount)
/** @type {number[]} */
let _activeSlots = [];

// Pan/zoom drag state for the active hero
let _dragging = false;
let _dragStartX = 0, _dragStartY = 0;
let _dragStartPanX = 0, _dragStartPanY = 0;
let _saveFracTimer = /** @type {any} */ (0);

/** @type {ResizeObserver | null} */
let _heroResizeObserver = null;
let _heroResizeRaf = 0;

/** @returns {number} */
function getActiveSlot() {
    const p = getActivePresetIdx();
    return _activeSlots[p] || 0;
}
/** @param {number} idx */
function setActiveSlot(idx) {
    const p = getActivePresetIdx();
    if (!_activeSlots.length) _activeSlots = loadActiveSlots();
    _activeSlots[p] = idx;
    saveActiveSlots(_activeSlots);
}

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

// ── Active hero (V7) ──────────────────────────────────────────────────

/** Apply pan/zoom transform to the hero IMG. @param {HTMLImageElement} img */
function applyHeroTransform(img) {
    if (!_host) return;
    const slot = getCurrentSlot();
    if (!slot || slot.type !== 'image') return;
    // Invariant 1: don't clear transform when image is loaded but clientWidth=0
    // (transient layout). Returning early avoids the black flash.
    const slotW = img.clientWidth;
    const slotH = img.clientHeight;
    if (slotW === 0 || slotH === 0) return;
    const c = coverDims({ naturalW: img.naturalWidth, naturalH: img.naturalHeight, slotW, slotH });
    const zoom = clampZoom(/** @type {any} */ (slot).zoom || 1);
    // Derive panX/Y from fraction (Invariant 3: fraction is source of truth)
    const px = syncPxFromFrac({
        srcW: c.srcW, srcH: c.srcH, slotW, slotH, zoom,
        panFracX: /** @type {any} */ (slot).panFracX || 0,
        panFracY: /** @type {any} */ (slot).panFracY || 0,
    });
    const clamped = clampPan({ srcW: c.srcW, srcH: c.srcH, slotW, slotH, zoom, panX: px.panX, panY: px.panY });
    const split = resolveSplit({ srcW: c.srcW, srcH: c.srcH, slotW, slotH, zoom, panX: clamped.panX, panY: clamped.panY });
    img.style.objectPosition = `${split.opXPct}% ${split.opYPct}%`;
    // Invariant 2: always translate3d, never bare translate, never empty
    img.style.transform = `translate3d(${split.txX}px, ${split.txY}px, 0) scale(${zoom})`;
}

function getCurrentSlot() {
    const idx = getActivePresetIdx();
    const slots = loadSlots(idx);
    const active = getActiveSlot();
    return slots[active];
}

function setSlotPanZoom(/** @type {{ panFracX?: number, panFracY?: number, zoom?: number }} */ delta) {
    const idx = getActivePresetIdx();
    const active = getActiveSlot();
    const slots = loadSlots(idx);
    const s = slots[active];
    if (!s || s.type !== 'image') return;
    /** @type {any} */
    const cs = s;
    if (delta.panFracX != null) cs.panFracX = delta.panFracX;
    if (delta.panFracY != null) cs.panFracY = delta.panFracY;
    if (delta.zoom     != null) cs.zoom     = delta.zoom;
    saveSlots(idx, slots);
    if (_saveFracTimer) clearTimeout(_saveFracTimer);
    _saveFracTimer = setTimeout(() => {
        bus.emit('settings:changed', { key: 'muse-pan' });
    }, 250);
}

function onHeroPointerDown(/** @type {PointerEvent} */ e) {
    if (!_host) return;
    const img = /** @type {HTMLImageElement | null} */ (_host.querySelector('#muse-hero-img'));
    if (!img) return;
    const slot = getCurrentSlot();
    if (!slot || slot.type !== 'image') return;
    const slotW = img.clientWidth;
    const slotH = img.clientHeight;
    const c = coverDims({ naturalW: img.naturalWidth, naturalH: img.naturalHeight, slotW, slotH });
    const zoom = clampZoom(/** @type {any} */ (slot).zoom || 1);
    const px = syncPxFromFrac({
        srcW: c.srcW, srcH: c.srcH, slotW, slotH, zoom,
        panFracX: /** @type {any} */ (slot).panFracX || 0,
        panFracY: /** @type {any} */ (slot).panFracY || 0,
    });
    _dragging = true;
    _dragStartX = e.clientX;
    _dragStartY = e.clientY;
    _dragStartPanX = px.panX;
    _dragStartPanY = px.panY;
    img.style.cursor = 'grabbing';
    img.setPointerCapture(e.pointerId);
}
function onHeroPointerMove(/** @type {PointerEvent} */ e) {
    if (!_dragging || !_host) return;
    const img = /** @type {HTMLImageElement | null} */ (_host.querySelector('#muse-hero-img'));
    if (!img) return;
    const slot = getCurrentSlot();
    if (!slot || slot.type !== 'image') return;
    const slotW = img.clientWidth;
    const slotH = img.clientHeight;
    const c = coverDims({ naturalW: img.naturalWidth, naturalH: img.naturalHeight, slotW, slotH });
    const zoom = clampZoom(/** @type {any} */ (slot).zoom || 1);
    const dx = e.clientX - _dragStartX;
    const dy = e.clientY - _dragStartY;
    const panX = _dragStartPanX + dx;
    const panY = _dragStartPanY + dy;
    const clamped = clampPan({ srcW: c.srcW, srcH: c.srcH, slotW, slotH, zoom, panX, panY });
    const frac = syncFracFromPx({ srcW: c.srcW, srcH: c.srcH, slotW, slotH, zoom, panX: clamped.panX, panY: clamped.panY });
    setSlotPanZoom({ panFracX: frac.panFracX, panFracY: frac.panFracY });
    applyHeroTransform(img);
}
function onHeroPointerUp(/** @type {PointerEvent} */ e) {
    _dragging = false;
    if (!_host) return;
    const img = /** @type {HTMLImageElement | null} */ (_host.querySelector('#muse-hero-img'));
    if (img) {
        img.style.cursor = 'grab';
        try { img.releasePointerCapture(e.pointerId); } catch (_) {}
    }
}
function onHeroWheel(/** @type {WheelEvent} */ e) {
    if (!e.ctrlKey && !e.metaKey) return; // wheel-without-Ctrl is preset cycle
    e.preventDefault();
    if (!_host) return;
    const img = /** @type {HTMLImageElement | null} */ (_host.querySelector('#muse-hero-img'));
    if (!img) return;
    const slot = getCurrentSlot();
    if (!slot || slot.type !== 'image') return;
    const cur = clampZoom(/** @type {any} */ (slot).zoom || 1);
    const factor = Math.exp(-e.deltaY / 400);
    const z = clampZoom(cur * factor);
    setSlotPanZoom({ zoom: z });
    applyHeroTransform(img);
}

function disconnectHeroObserver() {
    if (_heroResizeObserver) {
        try { _heroResizeObserver.disconnect(); } catch (_) {}
        _heroResizeObserver = null;
    }
}

function renderHero() {
    if (!_host) return;
    disconnectHeroObserver();
    /** @type {HTMLElement | null} */
    const heroHost = _host.querySelector('#muse-hero');
    if (!heroHost) return;
    const slot = getCurrentSlot();
    if (!slot || slot.type === 'empty') {
        heroHost.innerHTML = `<div style="aspect-ratio:16/9;background:var(--bg, #0d0d0d);border:1px solid var(--border, #2a2a2a);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--dim, #888);font-size:12px;font-family:var(--mono);text-transform:uppercase;letter-spacing:0.08em;">empty — pick a slot or add an image</div>`;
        return;
    }
    if (slot.type === 'image') {
        const src = /** @type {any} */ (slot).src || '';
        const cs = /** @type {any} */ (slot);
        const isModified = (cs.zoom && cs.zoom !== 1) || cs.panFracX || cs.panFracY;
        const resetBtn = isModified ? `<button id="muse-hero-reset" title="Reset pan/zoom" style="position:absolute;top:6px;right:6px;background:rgba(0,0,0,0.55);color:#fff;border:0;border-radius:6px;padding:4px 10px;font-size:11px;font-family:var(--mono);text-transform:uppercase;letter-spacing:0.08em;cursor:pointer;">Reset</button>` : '';
        heroHost.innerHTML = `<div class="muse-hero-frame" style="aspect-ratio:16/9;background:#000;border:1px solid var(--border, #2a2a2a);border-radius:8px;overflow:hidden;position:relative;contain:paint;"><img id="muse-hero-img" alt="" draggable="false" style="width:100%;height:100%;object-fit:cover;display:block;cursor:grab;user-select:none;touch-action:none;will-change:transform;" src="${src}">${resetBtn}</div>`;
        const img = /** @type {HTMLImageElement} */ (heroHost.querySelector('#muse-hero-img'));
        img.addEventListener('pointerdown', onHeroPointerDown);
        img.addEventListener('pointermove', onHeroPointerMove);
        img.addEventListener('pointerup',   onHeroPointerUp);
        img.addEventListener('wheel',       onHeroWheel, { passive: false });
        img.addEventListener('load', () => applyHeroTransform(img), { once: true });
        if (img.complete && img.naturalWidth > 0) applyHeroTransform(img);
        // ResizeObserver re-derives pan from fraction whenever the slot
        // geometry changes (browser maximize/restore, responsive breaks).
        // rAF-coalesced so a burst of size-change callbacks doesn't thrash.
        if (typeof ResizeObserver !== 'undefined') {
            _heroResizeObserver = new ResizeObserver(() => {
                if (_heroResizeRaf) return;
                _heroResizeRaf = requestAnimationFrame(() => {
                    _heroResizeRaf = 0;
                    if (img.isConnected) applyHeroTransform(img);
                });
            });
            _heroResizeObserver.observe(img);
        }
        return;
    }
    if (slot.type === 'video') {
        const thumb  = /** @type {any} */ (slot).thumb  || '';
        heroHost.innerHTML = `<div class="muse-hero-frame" style="aspect-ratio:16/9;background:#000;border:1px solid var(--border, #2a2a2a);border-radius:8px;overflow:hidden;position:relative;"><video id="muse-hero-video" autoplay muted loop playsinline preload="metadata" style="width:100%;height:100%;object-fit:cover;background:#000;display:block;${thumb ? `background:center/cover url('${thumb}');` : ''}" ></video></div>`;
        const videoEl = /** @type {HTMLVideoElement} */ (heroHost.querySelector('#muse-hero-video'));
        if (videoEl) {
            // loadClipForSlot tries IDB first, falls back to R2 (and caches
            // back into IDB on success) — V9 cross-device path
            loadClipForSlot(slot).then((blob) => {
                if (!blob || !videoEl.isConnected) return;
                videoEl.src = URL.createObjectURL(blob);
                videoEl.play().catch(() => {/* autoplay may need user gesture */});
            });
        }
        return;
    }
    if (slot.type === 'tiktok') {
        const id = extractTikTokId(/** @type {any} */ (slot).url || '');
        if (!id) {
            heroHost.innerHTML = `<div style="aspect-ratio:16/9;background:#111;border:1px solid var(--border, #2a2a2a);border-radius:8px;display:flex;align-items:center;justify-content:center;color:var(--danger, #ef4444);font-size:11px;font-family:var(--mono);text-transform:uppercase;letter-spacing:0.08em;">invalid tiktok url</div>`;
            return;
        }
        // Per project_muse_tiktok_iframe_limit.md: TikTok iframe restarts +
        // mutes on tab return. Platform limit, not something to work around.
        heroHost.innerHTML = `<div class="muse-hero-frame" style="aspect-ratio:9/16;max-height:480px;background:#000;border:1px solid var(--border, #2a2a2a);border-radius:8px;overflow:hidden;position:relative;margin:0 auto;"><iframe id="muse-hero-tiktok" src="${tiktokEmbedUrl(id)}" allow="autoplay; encrypted-media" allowfullscreen style="width:100%;height:100%;border:0;display:block;"></iframe></div>`;
        return;
    }
}

// ── Add image flow (V7) ──────────────────────────────────────────────

/**
 * Resize an image File to max `maxSide` pixels (longest edge) and return
 * a JPEG data URL. Keeps the file small enough to safely live in localStorage.
 * @param {File} file
 * @param {number} maxSide
 * @returns {Promise<string>}
 */
async function fileToResizedDataUrl(file, maxSide) {
    const dataUrl = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(/** @type {string} */ (r.result));
        r.onerror = () => reject(new Error('read failed'));
        r.readAsDataURL(file);
    });
    return await new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const c = document.createElement('canvas');
            c.width = w; c.height = h;
            const ctx = c.getContext('2d');
            if (!ctx) return reject(new Error('canvas alloc failed'));
            ctx.imageSmoothingQuality = 'high';
            ctx.drawImage(img, 0, 0, w, h);
            resolve(c.toDataURL('image/jpeg', 0.85));
        };
        img.onerror = () => reject(new Error('img decode failed'));
        img.src = /** @type {string} */ (dataUrl);
    });
}

function handleAddTiktok() {
    const url = window.prompt('Paste TikTok URL (e.g. https://www.tiktok.com/@user/video/123…)');
    if (!url) return;
    const id = extractTikTokId(url);
    if (!id) { window.alert('Could not parse a TikTok video ID from that URL'); return; }
    const idx = getActivePresetIdx();
    const slots = loadSlots(idx);
    const visible = deriveVisibleSlotCount(slots);
    const padded = padSlots(slots, visible);
    let target = padded.findIndex((s) => s.type === 'empty');
    if (target < 0) target = getActiveSlot();
    padded[target] = { type: 'tiktok', url };
    saveSlots(idx, padded);
    setActiveSlot(target);
    rerenderAll();
    bus.emit('settings:changed', { key: 'muse-slots' });
}

async function handleAddVideo() {
    if (!_host) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'video/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();
    await new Promise((resolve) => {
        input.onchange = resolve;
        window.addEventListener('focus', () => setTimeout(resolve, 200), { once: true });
    });
    const file = input.files && input.files[0];
    if (input.parentNode) input.parentNode.removeChild(input);
    if (!file) return;
    try {
        const result = await openTrimFor(file);
        if (!result) return;
        const idx = getActivePresetIdx();
        const slots = loadSlots(idx);
        const visible = deriveVisibleSlotCount(slots);
        const padded = padSlots(slots, visible);
        let target = padded.findIndex((s) => s.type === 'empty');
        if (target < 0) target = getActiveSlot();
        padded[target] = { type: 'video', idbKey: result.idbKey, thumb: result.thumb, duration: result.duration, panFracX: 0, panFracY: 0, zoom: 1 };
        saveSlots(idx, padded);
        setActiveSlot(target);
        rerenderAll();
        bus.emit('settings:changed', { key: 'muse-slots' });
        // V9: best-effort R2 upload so this clip syncs to other devices.
        // The actual upload runs in the background; the slot already has
        // the IDB key for local playback.
        const blob = await idbGet(result.idbKey);
        if (blob) {
            uploadClipToR2(blob).then((r2Key) => {
                if (!r2Key) return;
                // Re-read in case the user has moved on / edited the slot
                const cur = loadSlots(idx);
                const s = cur[target];
                if (s && s.type === 'video' && /** @type {any} */ (s).idbKey === result.idbKey) {
                    /** @type {any} */ (s).r2Key = r2Key;
                    saveSlots(idx, cur);
                    bus.emit('muse:clip-uploaded', { r2Key, idbKey: result.idbKey });
                    bus.emit('settings:changed', { key: 'muse-clip-r2' });
                }
            }).catch(() => {/* swallow — clip still plays locally */});
        }
    } catch (e) {
        const err = /** @type {any} */ (e);
        window.alert('Add video failed: ' + (err && err.message || err));
    }
}

async function handleAddImage() {
    if (!_host) return;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    input.click();
    await new Promise((resolve) => {
        input.onchange = resolve;
        // Fallback if user cancels: input still goes through change-less path.
        // Most browsers fire focus on body when picker closes.
        window.addEventListener('focus', () => setTimeout(resolve, 200), { once: true });
    });
    const file = input.files && input.files[0];
    if (input.parentNode) input.parentNode.removeChild(input);
    if (!file) return;
    try {
        const dataUrl = await fileToResizedDataUrl(file, 800);
        const idx = getActivePresetIdx();
        const slots = loadSlots(idx);
        const visible = deriveVisibleSlotCount(slots);
        const padded = padSlots(slots, visible);
        // Find the first empty slot, otherwise overwrite the active slot
        let target = padded.findIndex((s) => s.type === 'empty');
        if (target < 0) target = getActiveSlot();
        padded[target] = { type: 'image', src: dataUrl, thumb: dataUrl, panFracX: 0, panFracY: 0, zoom: 1 };
        saveSlots(idx, padded);
        setActiveSlot(target);
        rerenderAll();
        bus.emit('settings:changed', { key: 'muse-slots' });
    } catch (e) {
        const err = /** @type {any} */ (e);
        window.alert('Add image failed: ' + (err && err.message || err));
    }
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
    const active = getActiveSlot();
    grid.innerHTML = slots.map((s, i) => {
        const draggable = _editMode ? 'draggable="true"' : '';
        const editChrome = _editMode
            ? '<button class="muse-slot-rm" title="Clear slot" style="position:absolute;top:4px;right:4px;width:20px;height:20px;border-radius:50%;background:rgba(0,0,0,0.55);color:#fff;border:0;cursor:pointer;font-size:12px;line-height:1;">×</button>'
            : '';
        const isActive = i === active;
        const activeRing = isActive ? 'box-shadow:0 0 0 2px var(--accent, #089981);' : '';
        return `<div class="muse-slot${isActive ? ' is-active' : ''}" data-slot-idx="${i}" ${draggable} style="position:relative;aspect-ratio:9/16;border-radius:8px;background:var(--bg, #0d0d0d);border:1px solid var(--border, #2a2a2a);overflow:hidden;cursor:${_editMode ? 'grab' : 'pointer'};${activeRing}">${renderSlotInner(s, i)}${editChrome}</div>`;
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
                <button id="muse-add-image"  style="background:var(--accent, #089981);border:0;color:#000;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-family:var(--mono);font-weight:700;">+ Image</button>
                <button id="muse-add-video"  style="background:var(--accent, #089981);border:0;color:#000;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-family:var(--mono);font-weight:700;">+ Video</button>
                <button id="muse-add-tiktok" style="background:var(--accent, #089981);border:0;color:#000;padding:4px 12px;border-radius:6px;cursor:pointer;font-size:11px;font-family:var(--mono);font-weight:700;">+ TikTok</button>
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
    renderHero();
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
    if (t.id === 'muse-add-image')  { handleAddImage();  return; }
    if (t.id === 'muse-add-video')  { handleAddVideo();  return; }
    if (t.id === 'muse-add-tiktok') { handleAddTiktok(); return; }
    if (t.id === 'muse-hero-reset') {
        // Reset pan/zoom on the active image slot
        const idx = getActivePresetIdx();
        const slots = loadSlots(idx);
        const s = slots[getActiveSlot()];
        if (s && s.type === 'image') {
            /** @type {any} */ (s).panFracX = 0;
            /** @type {any} */ (s).panFracY = 0;
            /** @type {any} */ (s).zoom     = 1;
            saveSlots(idx, slots);
            renderHero();
            bus.emit('settings:changed', { key: 'muse-pan' });
        }
        return;
    }
    // Click slot → set active (when not in edit mode, no drag in progress)
    const slot = t.closest && t.closest('.muse-slot');
    if (slot && !_editMode) {
        const i = parseInt(/** @type {HTMLElement} */ (slot).dataset.slotIdx || '-1', 10);
        if (i >= 0) {
            setActiveSlot(i);
            renderHero();
            renderSlots();
        }
    }
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
            <div id="muse-hero"></div>
            <div id="muse-edit-controls" style="display:none;gap:8px;align-items:center;flex-wrap:wrap;"></div>
            <div id="muse-slot-grid" style="display:grid;grid-template-columns:repeat(7, 1fr);gap:8px;"></div>
            <div style="font-size:10px;color:var(--dim, #888);font-family:var(--mono);text-transform:uppercase;letter-spacing:0.08em;">wheel cycles preset · Ctrl+wheel zooms · drag reorders in edit · video + tiktok in V8/V10</div>
        </div>
    `;
    _activeSlots = loadActiveSlots();
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
            disconnectHeroObserver();
            if (_heroResizeRaf) { cancelAnimationFrame(_heroResizeRaf); _heroResizeRaf = 0; }
            _host = null;
            _editMode = false;
        },
    };
}
