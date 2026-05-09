// PS Micro Imaging — lazy module (Session 3c skeleton, 2026-05-09)
//
// Status: PARTIAL PORT (skeleton + state container + OpenCV loader contract).
// Full UI rendering, calibration, measurements, histogram engine, annotations
// all stay in monolith index.html until Session 3d+ port. PSI is the largest
// non-PSF module (~4.7k lines) and depends on a 10MB OpenCV.js WASM blob —
// that's lazy-loaded on first use, not on this module init.
//
// CRITICAL invariants (DO NOT regress):
//   - Histogram engine = Web Worker (per CLAUDE.md Coding Rule 12 — image
//     processing MUST run in a Worker, never main thread)
//   - canvasId never redrawn after initial — bgCanvas holds clean image
//   - overlayCanvas is the ONLY surface for annotations (transparent stack)
//   - LUT apply uses cached _bgPixels + reusable _applyDst (avoid GC churn)
//   - _applyRafPending + _histRafPending guard against re-entrant RAF
//   - bgBitmap = GPU-resident ImageBitmap for fast loupe reads (don't drop)
//
// CDN dep: OpenCV.js — loaded via <script src="https://docs.opencv.org/...">.
// Phase 4 may consider self-hosting under public/vendor/ (per critical gap #8
// "CDN dependency self-host strategy" in MIGRATION-PLAN.md).

import { lsSave, lsGetJson } from '../../core/storage.js';
import { bus } from '../../core/bus.js';

const _PSI_LS_CALIB        = 'pslink_micro_calibration';
const _PSI_LS_LAST_PROFILE = 'pslink_calib_last_profile';
const _PSI_CP_KEY          = 'pslink_micro_calib_profiles';

/**
 * Imaging state container — port of psImagingState from monolith.
 * Most fields hydrate during init/load image; defaults match monolith.
 * @type {{
 *   pixelPerMicron: number | null,
 *   currentFile: File | null,
 *   currentImageData: ImageData | null,
 *   bgCanvas: HTMLCanvasElement | null,
 *   overlayCanvasId: string | null,
 *   overlayCtx: CanvasRenderingContext2D | null,
 *   overlayScaleX: number,
 *   overlayScaleY: number,
 *   loupeCanvas: HTMLCanvasElement | null,
 *   loupeCtx: CanvasRenderingContext2D | null,
 *   bgBitmap: ImageBitmap | null,
 *   canvasId: string | null,
 *   scaleBar: {
 *     visible: boolean, x: number, y: number, color: string,
 *     niceUm: number | null, fontSize: number, bgOpacity: number,
 *     lineWidth: number, endCaps: string,
 *   },
 *   displayAdj: {
 *     black: number, white: number, gamma: number,
 *     channel: 'all' | 'r' | 'g' | 'b', enabled: boolean,
 *     splineMode: boolean, splinePoints: any,
 *   },
 *   calibration: any,
 * }}
 */
export const psImagingState = {
    pixelPerMicron:   null,
    currentFile:      null,
    currentImageData: null,
    bgCanvas:         null,
    overlayCanvasId:  null,
    overlayCtx:       null,
    overlayScaleX:    1,
    overlayScaleY:    1,
    loupeCanvas:      null,
    loupeCtx:         null,
    bgBitmap:         null,
    canvasId:         null,
    scaleBar:         { visible: false, x: 0.88, y: 0.88, color: '#ffffff', niceUm: null, fontSize: 11, bgOpacity: 0, lineWidth: 2, endCaps: 'bracket' },
    displayAdj:       { black: 0, white: 255, gamma: 1.0, channel: 'all', enabled: false, splineMode: false, splinePoints: null },
    calibration:      null,
};

/** Load saved calibration from localStorage. */
export function loadCalibration() {
    const cal = lsGetJson(_PSI_LS_CALIB, /** @type {any} */ (null));
    if (cal) psImagingState.calibration = cal;
    return cal;
}

/** Persist current calibration. */
export function saveCalibration() {
    if (!psImagingState.calibration) return;
    lsSave(_PSI_LS_CALIB, JSON.stringify(psImagingState.calibration));
    bus.emit('psi:calib-saved', { calib: psImagingState.calibration });
}

/** Calibration profile registry (multi-objective lens support). */
export function loadCalibProfiles() {
    return lsGetJson(_PSI_CP_KEY, /** @type {Array<any>} */ ([]));
}

/** @param {Array<any>} profiles */
export function saveCalibProfiles(profiles) {
    lsSave(_PSI_CP_KEY, JSON.stringify(profiles));
}

/**
 * OpenCV.js readiness check. Real loader is in monolith index.html — this
 * just reflects current global window.cv presence. Phase 3d will own the
 * loader logic too.
 * @returns {boolean}
 */
export function isOpenCvReady() {
    const w = /** @type {any} */ (typeof window !== 'undefined' ? window : {});
    return !!(w.cv && typeof w.cv.Mat === 'function');
}

/**
 * Module entry — Architecture conv. Hard Rule §1.
 * Phase 3c proof: returns ready state + OpenCV loader status; full UI render deferred.
 * @param {HTMLElement} rootEl
 * @param {{ bus?: any, lsSave?: any, lsGet?: any }} [_ctx]
 */
export function init(rootEl, _ctx) {
    const cal = loadCalibration();
    const cvReady = isOpenCvReady();
    bus.emit('psi:init', { rootEl, cvReady, hasCalibration: !!cal });
    return {
        id:             'psi',
        version:        '0.1-session3c-skeleton',
        ready:          true,
        opencvReady:    cvReady,
        opencvNote:     cvReady ? 'cv global available' : 'OpenCV.js will lazy-load on first use (~10MB CDN)',
        calibrationSet: !!cal,
        scaleBarOn:     psImagingState.scaleBar.visible,
        displayAdjOn:   psImagingState.displayAdj.enabled,
    };
}

/**
 * Module teardown — releases ImageBitmap (GPU memory) + clears canvas refs.
 * Calibration + profile data preserved (sticky across sessions).
 */
export function destroy() {
    if (psImagingState.bgBitmap) {
        try { psImagingState.bgBitmap.close(); } catch (_e) {}
        psImagingState.bgBitmap = null;
    }
    psImagingState.bgCanvas         = null;
    psImagingState.overlayCtx       = null;
    psImagingState.loupeCanvas      = null;
    psImagingState.loupeCtx         = null;
    psImagingState.currentImageData = null;
    bus.emit('psi:destroy');
}
