// PSI OpenCV.js lazy loader.
//
// OpenCV.js is ~10 MB so we never want to ship it eagerly. This module
// injects the CDN <script> on first call, waits for cv.onRuntimeInitialized,
// caches the promise so concurrent callers all wait on the same handle, and
// reports progress via a status callback so the PSI panel can render a
// "Loading OpenCV (4.7 MB / 10 MB)…" line while bytes stream in.
//
// Failures (network error / CDN down / timeout) propagate to the caller —
// PSI should disable measurement features + surface a "OpenCV unavailable"
// message rather than dying silently.

const CDN_URL = 'https://docs.opencv.org/4.10.0/opencv.js';
const SCRIPT_ID = 'psi-opencv-script';
const TIMEOUT_MS = 60_000;

/** @type {Promise<any> | null} */
let _loaderPromise = null;

/** @type {(text: string) => void} */
let _statusCallback = () => {};

/**
 * Set a status callback that will receive human-readable progress strings.
 * Call this BEFORE loadOpenCV() if the consumer wants live feedback.
 * @param {(text: string) => void} fn
 */
export function onStatus(fn) {
    _statusCallback = typeof fn === 'function' ? fn : () => {};
}

/** @returns {boolean} true if cv module is on window AND has the Mat constructor */
export function isReady() {
    const cv = /** @type {any} */ (typeof window !== 'undefined' ? window : {}).cv;
    return !!(cv && typeof cv.Mat === 'function');
}

/**
 * Lazy-load OpenCV.js. Returns the cv module. Concurrent calls reuse the
 * single in-flight promise so the script only loads once.
 *
 * @param {{ url?: string, timeoutMs?: number }} [opts]
 * @returns {Promise<any>}
 */
export function loadOpenCV(opts) {
    if (_loaderPromise) return _loaderPromise;
    if (isReady()) return Promise.resolve(/** @type {any} */ (window).cv);

    const url = (opts && opts.url) || CDN_URL;
    const timeoutMs = (opts && opts.timeoutMs) || TIMEOUT_MS;

    _loaderPromise = new Promise((resolve, reject) => {
        if (typeof document === 'undefined' || typeof window === 'undefined') {
            reject(new Error('OpenCV requires a DOM environment'));
            return;
        }

        // Reuse an existing tag if one was injected earlier (HMR, partial fail)
        let script = /** @type {HTMLScriptElement | null} */ (document.getElementById(SCRIPT_ID));
        if (!script) {
            script = document.createElement('script');
            script.id = SCRIPT_ID;
            script.async = true;
            script.src = url;
            document.head.appendChild(script);
            _statusCallback('Fetching OpenCV.js (~10 MB)…');
        }

        const timer = setTimeout(() => {
            cleanup();
            _loaderPromise = null;
            _statusCallback('OpenCV load timed out');
            reject(new Error('OpenCV load timed out'));
        }, timeoutMs);

        const cleanup = () => {
            clearTimeout(timer);
            script && script.removeEventListener('load', onLoad);
            script && script.removeEventListener('error', onError);
        };

        const onLoad = () => {
            // OpenCV.js is async-init: cv exists on window but Mat etc. aren't
            // ready until cv.onRuntimeInitialized fires. We wrap that to make
            // the whole API uniform Promise-based.
            const cv = /** @type {any} */ (window).cv;
            if (!cv) {
                cleanup();
                _loaderPromise = null;
                reject(new Error('OpenCV script loaded but `cv` is not on window'));
                return;
            }
            if (typeof cv.Mat === 'function') {
                cleanup();
                _statusCallback('OpenCV ready');
                resolve(cv);
                return;
            }
            _statusCallback('Initializing OpenCV runtime…');
            cv.onRuntimeInitialized = () => {
                cleanup();
                _statusCallback('OpenCV ready');
                resolve(cv);
            };
        };

        const onError = () => {
            cleanup();
            _loaderPromise = null;
            _statusCallback('OpenCV CDN fetch failed');
            reject(new Error('OpenCV CDN fetch failed'));
        };

        // If script tag already exists AND cv is already on window (rare), short-circuit
        if (isReady()) {
            cleanup();
            resolve(/** @type {any} */ (window).cv);
            return;
        }

        script.addEventListener('load', onLoad);
        script.addEventListener('error', onError);
    });

    return _loaderPromise;
}

/** Reset the loader for tests. NOT for production use. */
export function _resetForTests() {
    _loaderPromise = null;
    _statusCallback = () => {};
    if (typeof document !== 'undefined') {
        const tag = document.getElementById(SCRIPT_ID);
        if (tag && tag.parentNode) tag.parentNode.removeChild(tag);
    }
    if (typeof window !== 'undefined') {
        delete /** @type {any} */ (window).cv;
    }
}
