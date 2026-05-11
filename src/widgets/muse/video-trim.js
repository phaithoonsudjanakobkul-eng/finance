// Muse video trim modal — V8.
//
// Flow:
//   1. user picks video file → modal opens at z-index 9300 (above edit
//      modal 9000 per CLAUDE.md Rule 19 layering)
//   2. video element shows the file with HTML5 controls
//   3. user sets Start / End times via number inputs
//   4. "Save" runs MediaRecorder on a canvas that re-draws video frames
//      in the trimmed range → WebM Blob
//   5. Blob written to IndexedDB key 'muse-video:{slotKey}', a frame at
//      "start" captured as base64 thumb for the slot
//   6. slot stored as { type: 'video', idbKey, thumb, duration }
//
// V11 polish will add: filmstrip preview, cropping (9:16/1:1/16:9),
// abort-generation pattern. V9 adds R2 sync.

import { idbPut } from '../../core/idb.js';

/** @typedef {{ idbKey: string, thumb: string, duration: number }} TrimResult */

/** @type {{ destroy: () => void } | null} */
let _open = null;

/**
 * Capture a single frame from a <video> at its current time into a JPEG
 * data URL (used for the slot thumbnail).
 * @param {HTMLVideoElement} video
 * @returns {string}
 */
function captureFrame(video) {
    const c = document.createElement('canvas');
    c.width  = video.videoWidth  || 320;
    c.height = video.videoHeight || 568;
    const ctx = c.getContext('2d');
    if (!ctx) return '';
    ctx.drawImage(video, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.75);
}

/**
 * Open the trim modal for the given File. Resolves with the saved
 * TrimResult, or null if the user cancelled.
 * @param {File} file
 * @returns {Promise<TrimResult | null>}
 */
export function openTrimFor(file) {
    if (_open) return Promise.resolve(null);
    if (typeof document === 'undefined') return Promise.resolve(null);

    return new Promise((resolve) => {
        const backdrop = document.createElement('div');
        backdrop.id = 'muse-video-trim-backdrop';
        backdrop.style.cssText = 'position:fixed;inset:0;z-index:9300;background:rgba(0,0,0,0.78);display:flex;align-items:center;justify-content:center;padding:16px;';

        const panel = document.createElement('div');
        panel.id = 'muse-video-trim-panel';
        panel.style.cssText = 'background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:12px;padding:18px;max-width:640px;width:100%;color:var(--fg, #f5f5f7);display:flex;flex-direction:column;gap:12px;font-family:var(--font-ui, var(--sans, system-ui));';

        const url = URL.createObjectURL(file);

        panel.innerHTML = `
            <div style="display:flex;align-items:center;justify-content:space-between;">
                <div style="font-family:var(--font-display, var(--sans, system-ui));font-size:18px;font-weight:700;letter-spacing:-0.01em;">Trim video</div>
                <button id="muse-trim-close" title="Close" style="background:transparent;border:0;color:var(--dim, #888);cursor:pointer;font-size:22px;line-height:1;padding:0 6px;">×</button>
            </div>
            <video id="muse-trim-video" src="${url}" controls preload="metadata" style="width:100%;max-height:360px;background:#000;border-radius:8px;display:block;"></video>
            <div id="muse-trim-meta" style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);min-height:14px;text-transform:uppercase;letter-spacing:0.08em;">loading metadata…</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;">
                <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);text-transform:uppercase;letter-spacing:0.08em;">
                    start (s)
                    <input id="muse-trim-start" type="number" min="0" step="0.1" value="0" style="background:var(--bg, #0d0d0d);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:6px 10px;border-radius:6px;font-family:var(--mono, monospace);font-size:13px;">
                </label>
                <label style="display:flex;flex-direction:column;gap:4px;font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);text-transform:uppercase;letter-spacing:0.08em;">
                    end (s)
                    <input id="muse-trim-end" type="number" min="0" step="0.1" value="0" style="background:var(--bg, #0d0d0d);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:6px 10px;border-radius:6px;font-family:var(--mono, monospace);font-size:13px;">
                </label>
            </div>
            <div id="muse-trim-status" style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);min-height:14px;"></div>
            <div style="display:flex;gap:8px;justify-content:flex-end;">
                <button id="muse-trim-cancel" style="background:transparent;border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:8px 14px;border-radius:6px;cursor:pointer;font-size:13px;">Cancel</button>
                <button id="muse-trim-save"   style="background:var(--accent, #089981);border:0;color:#000;padding:8px 16px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:700;">Save trim</button>
            </div>
        `;

        backdrop.appendChild(panel);
        document.body.appendChild(backdrop);

        const video    = /** @type {HTMLVideoElement} */ (panel.querySelector('#muse-trim-video'));
        const startEl  = /** @type {HTMLInputElement} */ (panel.querySelector('#muse-trim-start'));
        const endEl    = /** @type {HTMLInputElement} */ (panel.querySelector('#muse-trim-end'));
        const metaEl   = /** @type {HTMLElement} */     (panel.querySelector('#muse-trim-meta'));
        const status   = /** @type {HTMLElement} */     (panel.querySelector('#muse-trim-status'));
        const closeBtn = /** @type {HTMLButtonElement} */ (panel.querySelector('#muse-trim-close'));
        const cancelBtn= /** @type {HTMLButtonElement} */ (panel.querySelector('#muse-trim-cancel'));
        const saveBtn  = /** @type {HTMLButtonElement} */ (panel.querySelector('#muse-trim-save'));

        function setStatus(/** @type {string} */ s) { status.textContent = s; }

        video.addEventListener('loadedmetadata', () => {
            const dur = isFinite(video.duration) ? video.duration : 0;
            metaEl.textContent = `${video.videoWidth}×${video.videoHeight} · ${dur.toFixed(1)}s`;
            endEl.value = String(dur.toFixed(2));
            endEl.max   = String(dur.toFixed(2));
            startEl.max = String(dur.toFixed(2));
        });

        function close(/** @type {TrimResult | null} */ result) {
            if (!_open) return;
            try { video.pause(); } catch (_) {}
            URL.revokeObjectURL(url);
            if (backdrop.parentNode) backdrop.parentNode.removeChild(backdrop);
            document.removeEventListener('keydown', onKey);
            _open = null;
            resolve(result);
        }

        function onKey(/** @type {KeyboardEvent} */ e) {
            if (e.key === 'Escape') close(null);
        }
        document.addEventListener('keydown', onKey);

        closeBtn .addEventListener('click', () => close(null));
        cancelBtn.addEventListener('click', () => close(null));
        backdrop .addEventListener('click', (e) => { if (e.target === backdrop) close(null); });

        async function onSave() {
            const start = Math.max(0, Number(startEl.value) || 0);
            const end   = Math.max(start, Number(endEl.value) || 0);
            const dur   = end - start;
            if (dur <= 0) { setStatus('End must be greater than start'); return; }
            if (dur > 60) { setStatus('Trim must be 60s or shorter'); return; }
            saveBtn.disabled  = true;
            cancelBtn.disabled = true;
            setStatus(`Encoding ${dur.toFixed(1)}s — please wait…`);
            try {
                const blob = await encodeTrim(video, start, end, setStatus);
                video.currentTime = start;
                await new Promise((r) => { video.addEventListener('seeked', r, { once: true }); });
                const thumb = captureFrame(video);
                const idbKey = `muse-video:${Date.now().toString(36)}:${Math.floor(Math.random() * 1e6).toString(36)}.webm`;
                const ok = await idbPut(idbKey, blob);
                if (!ok) throw new Error('IDB write failed');
                close({ idbKey, thumb, duration: dur });
            } catch (e) {
                const err = /** @type {any} */ (e);
                setStatus('Encoding failed: ' + (err && err.message || err));
                saveBtn.disabled = false;
                cancelBtn.disabled = false;
            }
        }
        saveBtn.addEventListener('click', onSave);

        _open = { destroy: () => close(null) };
    });
}

/**
 * Replay the video from `start..end` while a canvas captures each frame
 * to a MediaStream. MediaRecorder writes that stream to a WebM Blob.
 * Stops when the video reaches `end` time.
 *
 * @param {HTMLVideoElement} video
 * @param {number} start
 * @param {number} end
 * @param {(s: string) => void} progress
 * @returns {Promise<Blob>}
 */
function encodeTrim(video, start, end, progress) {
    return new Promise((resolve, reject) => {
        const c = document.createElement('canvas');
        c.width  = video.videoWidth  || 320;
        c.height = video.videoHeight || 568;
        const ctx = c.getContext('2d');
        if (!ctx) return reject(new Error('canvas alloc failed'));
        const stream = /** @type {any} */ (c).captureStream(30);
        const chunks = /** @type {Blob[]} */ ([]);
        /** @type {string} */
        const mime = (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported('video/webm;codecs=vp9')) ? 'video/webm;codecs=vp9' : 'video/webm';
        const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 2_500_000 });
        rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
        rec.onstop = () => resolve(new Blob(chunks, { type: 'video/webm' }));
        rec.onerror = (e) => reject(/** @type {any} */ (e).error || new Error('MediaRecorder error'));

        let raf = 0;
        function tick() {
            if (!ctx) return;
            if (video.currentTime >= end || video.ended) {
                video.pause();
                if (rec.state === 'recording') rec.stop();
                if (raf) cancelAnimationFrame(raf);
                return;
            }
            ctx.drawImage(video, 0, 0, c.width, c.height);
            progress(`Encoding · ${Math.max(0, (video.currentTime - start)).toFixed(1)} / ${(end - start).toFixed(1)}s`);
            raf = requestAnimationFrame(tick);
        }

        video.currentTime = start;
        video.addEventListener('seeked', function onSeeked() {
            video.removeEventListener('seeked', onSeeked);
            rec.start(250);
            video.play().then(() => { raf = requestAnimationFrame(tick); }).catch((e) => {
                if (raf) cancelAnimationFrame(raf);
                if (rec.state === 'recording') rec.stop();
                reject(e);
            });
        }, { once: true });
    });
}

/** @returns {boolean} */
export function isOpen() { return !!_open; }
