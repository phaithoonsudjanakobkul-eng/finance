// Profile photo edit modal — V4.
//
// Click avatar in nav → this mounts a modal over the page (NO <dialog>,
// NO portal — per project_profile_edit_modal.md DON'T re-explore log;
// they break splash transform stacking). Just a position:fixed backdrop
// + inner panel with z-index 9000.
//
// Flow:
//   1. user clicks "Choose photo" → file picker
//   2. preview image loads → mounted in cropper viewport
//   3. drag inside viewport to pan, wheel to zoom
//   4. click Save:
//      - thumbnail (128×128 JPEG, base64) → localStorage ps_avatar
//      - full-res   (max 1024×1024 JPEG, Blob) → IndexedDB key 'avatar:full'
//      - 'profile:avatar-changed' bus event → nav avatar-chip refreshes
//      - 'settings:changed' bus event → auto-push picks up
//
// R2 sync is V5 — this widget pushes nothing to the network; that's
// added by a bus.on('profile:avatar-changed') listener once V5 lands.

import { bus } from '../../core/bus.js';
import { lsSave } from '../../core/storage.js';
import { idbPut } from '../../core/idb.js';
import { r2UploadEncrypted, isR2Configured } from '../../core/r2.js';
import { minZoom, clampPan, computeCropRect, centerPan, zoomAboutCenter } from './crop.js';

const VP_SIZE       = 280;   // viewport CSS pixels (square crop preview)
const FULL_MAX      = 1024;  // max output side for full-res
const THUMB_SIZE    = 128;
const JPEG_QUALITY  = 0.88;

/** @typedef {{ destroy: () => void }} ProfileEditHandle */

/** @type {ProfileEditHandle | null} */
let _open = null;

/**
 * Open the profile-edit modal. No-op if already open. Returns a handle
 * the caller can use to programmatically close.
 * @returns {ProfileEditHandle | null}
 */
export function open() {
    if (_open) return _open;
    if (typeof document === 'undefined') return null;

    /** @type {HTMLImageElement | null} */
    let imgEl = null;
    let z  = 1, tx = 0, ty = 0, srcW = 0, srcH = 0;
    let dragging = false, dragX = 0, dragY = 0;

    const backdrop = document.createElement('div');
    backdrop.id = 'profile-edit-backdrop';
    backdrop.style.cssText = 'position:fixed;inset:0;z-index:9000;background:rgba(0,0,0,0.72);display:flex;align-items:center;justify-content:center;padding:16px;backdrop-filter:blur(6px);';

    const panel = document.createElement('div');
    panel.id = 'profile-edit-panel';
    panel.style.cssText = 'background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:12px;padding:18px;max-width:520px;width:100%;color:var(--fg, #f5f5f7);display:flex;flex-direction:column;gap:14px;font-family:var(--font-ui, var(--sans, system-ui));';
    backdrop.appendChild(panel);

    panel.innerHTML = `
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
            <div style="font-family:var(--font-display, var(--sans, system-ui));font-size:18px;font-weight:700;letter-spacing:-0.01em;">Edit profile photo</div>
            <button id="profile-edit-close" title="Close" style="background:transparent;border:0;color:var(--dim, #888);cursor:pointer;font-size:22px;line-height:1;padding:0 6px;">×</button>
        </div>
        <div style="display:flex;flex-direction:column;align-items:center;gap:10px;">
            <div id="profile-edit-viewport" style="width:${VP_SIZE}px;height:${VP_SIZE}px;border-radius:50%;background:#000;border:1px solid var(--border, #2a2a2a);overflow:hidden;position:relative;cursor:grab;user-select:none;touch-action:none;">
                <div id="profile-edit-empty" style="position:absolute;inset:0;display:flex;align-items:center;justify-content:center;color:var(--dim, #888);font-size:12px;font-family:var(--mono, monospace);text-transform:uppercase;letter-spacing:0.1em;">no photo yet</div>
            </div>
            <div style="display:flex;align-items:center;gap:8px;font-size:12px;color:var(--dim, #888);font-family:var(--mono, monospace);">
                <span>zoom</span>
                <input id="profile-edit-zoom" type="range" min="0.5" max="3" step="0.01" value="1" disabled style="width:240px;accent-color:var(--accent, #089981);">
            </div>
        </div>
        <div style="display:flex;gap:8px;justify-content:space-between;flex-wrap:wrap;">
            <input id="profile-edit-file" type="file" accept="image/*" style="display:none;">
            <button id="profile-edit-pick" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600;">Choose photo…</button>
            <div style="display:flex;gap:8px;">
                <button id="profile-edit-cancel" style="background:transparent;border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px;">Cancel</button>
                <button id="profile-edit-save" disabled style="background:var(--accent, #089981);border:0;color:#000;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;">Save</button>
            </div>
        </div>
        <div id="profile-edit-status" style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);min-height:14px;"></div>
    `;

    document.body.appendChild(backdrop);

    const viewport = /** @type {HTMLElement} */ (panel.querySelector('#profile-edit-viewport'));
    const fileBtn  = /** @type {HTMLInputElement} */ (panel.querySelector('#profile-edit-file'));
    const pickBtn  = /** @type {HTMLButtonElement} */ (panel.querySelector('#profile-edit-pick'));
    const zoomEl   = /** @type {HTMLInputElement} */ (panel.querySelector('#profile-edit-zoom'));
    const closeBtn = /** @type {HTMLButtonElement} */ (panel.querySelector('#profile-edit-close'));
    const cancelBtn= /** @type {HTMLButtonElement} */ (panel.querySelector('#profile-edit-cancel'));
    const saveBtn  = /** @type {HTMLButtonElement} */ (panel.querySelector('#profile-edit-save'));
    const status   = /** @type {HTMLElement} */ (panel.querySelector('#profile-edit-status'));
    const emptyMsg = /** @type {HTMLElement} */ (panel.querySelector('#profile-edit-empty'));

    function setStatus(/** @type {string} */ msg) { status.textContent = msg; }

    function paint() {
        if (!imgEl) return;
        imgEl.style.transform = `translate3d(${tx}px, ${ty}px, 0) scale(${z})`;
        imgEl.style.transformOrigin = '0 0';
    }

    function clamp() {
        const r = clampPan({ z, tx, ty, srcW, srcH, vpSize: VP_SIZE });
        tx = r.tx; ty = r.ty;
    }

    function loadFromFile(/** @type {File} */ file) {
        if (!file) return;
        if (!/^image\//.test(file.type)) {
            setStatus('Pick an image file (jpg/png/webp)');
            return;
        }
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = /** @type {string} */ (reader.result);
            const img = new Image();
            img.onload = () => {
                if (emptyMsg && emptyMsg.parentNode) emptyMsg.parentNode.removeChild(emptyMsg);
                if (imgEl && imgEl.parentNode) imgEl.parentNode.removeChild(imgEl);
                imgEl = img;
                imgEl.style.cssText = 'position:absolute;top:0;left:0;will-change:transform;pointer-events:none;display:block;';
                viewport.appendChild(imgEl);
                srcW = img.naturalWidth;
                srcH = img.naturalHeight;
                const zMin = minZoom({ srcW, srcH, vpSize: VP_SIZE });
                z = zMin;
                const c = centerPan({ z, srcW, srcH, vpSize: VP_SIZE });
                tx = c.tx; ty = c.ty;
                zoomEl.min = String(zMin);
                zoomEl.max = String(Math.max(zMin * 4, 3));
                zoomEl.step = String(Math.max(0.01, zMin / 20));
                zoomEl.value = String(z);
                zoomEl.disabled = false;
                saveBtn.disabled = false;
                paint();
                setStatus(`Loaded ${srcW}×${srcH}`);
            };
            img.src = dataUrl;
        };
        reader.onerror = () => setStatus('Read failed');
        reader.readAsDataURL(file);
    }

    function onPickClick() { fileBtn.click(); }
    function onFileChange() {
        const f = fileBtn.files && fileBtn.files[0];
        if (f) loadFromFile(f);
    }
    function onPointerDown(/** @type {PointerEvent} */ e) {
        if (!imgEl) return;
        dragging = true;
        dragX = e.clientX - tx;
        dragY = e.clientY - ty;
        viewport.style.cursor = 'grabbing';
        viewport.setPointerCapture(e.pointerId);
    }
    function onPointerMove(/** @type {PointerEvent} */ e) {
        if (!dragging || !imgEl) return;
        tx = e.clientX - dragX;
        ty = e.clientY - dragY;
        clamp();
        paint();
    }
    function onPointerUp(/** @type {PointerEvent} */ e) {
        dragging = false;
        viewport.style.cursor = 'grab';
        try { viewport.releasePointerCapture(e.pointerId); } catch (_) {}
    }
    function onWheel(/** @type {WheelEvent} */ e) {
        if (!imgEl) return;
        e.preventDefault();
        const zMin = minZoom({ srcW, srcH, vpSize: VP_SIZE });
        const zMax = Math.max(zMin * 4, 3);
        const z0 = z;
        const factor = Math.exp(-e.deltaY / 400);
        const z1 = Math.max(zMin, Math.min(zMax, z0 * factor));
        const p = zoomAboutCenter({ z0, z1, tx, ty, vpSize: VP_SIZE });
        z = z1; tx = p.tx; ty = p.ty;
        clamp();
        zoomEl.value = String(z);
        paint();
    }
    function onZoomInput() {
        if (!imgEl) return;
        const z1 = Number(zoomEl.value);
        if (!isFinite(z1) || z1 <= 0) return;
        const p = zoomAboutCenter({ z0: z, z1, tx, ty, vpSize: VP_SIZE });
        z = z1; tx = p.tx; ty = p.ty;
        clamp();
        paint();
    }

    /**
     * Render a square crop of the current state into a canvas at `outSize × outSize`.
     * @param {number} outSize
     * @returns {HTMLCanvasElement | null}
     */
    function renderCrop(outSize) {
        if (!imgEl) return null;
        const r = computeCropRect({ z, tx, ty, srcW, srcH, vpSize: VP_SIZE });
        const c = document.createElement('canvas');
        c.width = outSize; c.height = outSize;
        const ctx = c.getContext('2d');
        if (!ctx) return null;
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(imgEl, r.sx, r.sy, r.sSize, r.sSize, 0, 0, outSize, outSize);
        return c;
    }

    async function onSave() {
        if (!imgEl) return;
        saveBtn.disabled = true;
        setStatus('Saving…');
        try {
            const fullSize = Math.min(FULL_MAX, srcW, srcH);
            const fullCanvas = renderCrop(fullSize);
            const thumbCanvas = renderCrop(THUMB_SIZE);
            if (!fullCanvas || !thumbCanvas) throw new Error('Canvas alloc failed');

            const thumbUrl = thumbCanvas.toDataURL('image/jpeg', JPEG_QUALITY);
            lsSave('ps_avatar', thumbUrl);
            lsSave('ps_avatar_ts', String(Date.now()));

            /** @type {Blob | null} */
            const fullBlob = await new Promise((resolve) => {
                fullCanvas.toBlob((b) => resolve(b), 'image/jpeg', JPEG_QUALITY);
            });
            if (fullBlob) {
                await idbPut('avatar:full', fullBlob);
            }

            bus.emit('profile:avatar-changed', { ts: Date.now(), size: fullBlob ? fullBlob.size : 0 });
            // 'settings:changed' so auto-push picks the thumbnail up
            bus.emit('settings:changed', { key: 'avatar' });
            // R2 push is best-effort and background — close the modal even
            // if R2 isn't configured / network is down.
            if (fullBlob && isR2Configured()) {
                r2UploadEncrypted('profile/avatar.enc.jpg', fullBlob)
                    .then((ok) => bus.emit('profile:avatar-r2', { ok, ts: Date.now() }))
                    .catch(() => bus.emit('profile:avatar-r2', { ok: false, ts: Date.now() }));
            }
            setStatus('Saved · thumbnail ' + Math.round(thumbUrl.length / 1024) + ' KB · full-res ' + (fullBlob ? Math.round(fullBlob.size / 1024) + ' KB' : '—'));
            close();
        } catch (e) {
            const err = /** @type {any} */ (e);
            setStatus('Save failed: ' + (err && err.message || err));
            saveBtn.disabled = false;
        }
    }

    pickBtn.addEventListener('click', onPickClick);
    fileBtn.addEventListener('change', onFileChange);
    viewport.addEventListener('pointerdown', onPointerDown);
    viewport.addEventListener('pointermove', onPointerMove);
    viewport.addEventListener('pointerup',   onPointerUp);
    viewport.addEventListener('wheel',       onWheel, { passive: false });
    zoomEl.addEventListener('input', onZoomInput);
    closeBtn.addEventListener('click', () => close());
    cancelBtn.addEventListener('click', () => close());
    saveBtn.addEventListener('click', onSave);
    backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });

    function onKey(/** @type {KeyboardEvent} */ e) {
        if (e.key === 'Escape') close();
    }
    document.addEventListener('keydown', onKey);

    function close() {
        if (!_open) return;
        pickBtn.removeEventListener('click', onPickClick);
        fileBtn.removeEventListener('change', onFileChange);
        viewport.removeEventListener('pointerdown', onPointerDown);
        viewport.removeEventListener('pointermove', onPointerMove);
        viewport.removeEventListener('pointerup',   onPointerUp);
        viewport.removeEventListener('wheel',       onWheel);
        zoomEl.removeEventListener('input', onZoomInput);
        saveBtn.removeEventListener('click', onSave);
        document.removeEventListener('keydown', onKey);
        if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
        _open = null;
    }

    _open = { destroy: close };
    return _open;
}

/** @returns {boolean} */
export function isOpen() { return !!_open; }
