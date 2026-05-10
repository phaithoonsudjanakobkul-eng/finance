import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { loadOpenCV, isReady, onStatus, _resetForTests } from './opencv-loader.js';

beforeEach(() => {
    _resetForTests();
});

afterEach(() => {
    _resetForTests();
});

describe('isReady', () => {
    it('returns false when cv is absent', () => {
        expect(isReady()).toBe(false);
    });

    it('returns true when cv has Mat constructor', () => {
        /** @type {any} */ (window).cv = { Mat: function () {} };
        expect(isReady()).toBe(true);
    });

    it('returns false when cv exists but Mat is missing', () => {
        /** @type {any} */ (window).cv = {};
        expect(isReady()).toBe(false);
    });
});

describe('loadOpenCV — already-loaded short circuit', () => {
    it('resolves to existing cv when isReady() is true', async () => {
        const fakeCv = { Mat: function () {} };
        /** @type {any} */ (window).cv = fakeCv;
        const cv = await loadOpenCV();
        expect(cv).toBe(fakeCv);
    });
});

describe('loadOpenCV — script injection', () => {
    it('appends a <script> tag with id="psi-opencv-script" on first call', async () => {
        // Don't await — we just want to observe the side effect
        loadOpenCV().catch(() => {});
        const tag = document.getElementById('psi-opencv-script');
        expect(tag).not.toBeNull();
        expect(tag && tag.tagName).toBe('SCRIPT');
        expect(/** @type {HTMLScriptElement} */ (tag).async).toBe(true);
    });

    it('coalesces concurrent calls onto the same in-flight promise', () => {
        const a = loadOpenCV();
        const b = loadOpenCV();
        expect(a).toBe(b);
        a.catch(() => {});
        b.catch(() => {});
    });

    it('script tag is created exactly once across concurrent calls', () => {
        loadOpenCV().catch(() => {});
        loadOpenCV().catch(() => {});
        loadOpenCV().catch(() => {});
        const tags = document.querySelectorAll('#psi-opencv-script');
        expect(tags.length).toBe(1);
    });
});

describe('loadOpenCV — runtime resolution', () => {
    it('resolves when cv has Mat at script load time (sync init path)', async () => {
        const promise = loadOpenCV();
        const tag = /** @type {HTMLScriptElement} */ (document.getElementById('psi-opencv-script'));
        const fakeCv = { Mat: function () {} };
        /** @type {any} */ (window).cv = fakeCv;
        tag.dispatchEvent(new Event('load'));
        const cv = await promise;
        expect(cv).toBe(fakeCv);
    });

    it('waits for cv.onRuntimeInitialized when Mat is not yet on cv (async init path)', async () => {
        const promise = loadOpenCV();
        const tag = /** @type {HTMLScriptElement} */ (document.getElementById('psi-opencv-script'));
        /** @type {any} */
        const fakeCv = {};
        /** @type {any} */ (window).cv = fakeCv;
        tag.dispatchEvent(new Event('load'));
        // Promise hasn't resolved yet — Mat is missing, waiting on onRuntimeInitialized
        let resolved = false;
        promise.then(() => { resolved = true; });
        await new Promise((r) => setTimeout(r, 10));
        expect(resolved).toBe(false);
        // Trigger async init
        fakeCv.Mat = function () {};
        fakeCv.onRuntimeInitialized();
        const cv = await promise;
        expect(cv).toBe(fakeCv);
    });

    it('rejects on script error event', async () => {
        const promise = loadOpenCV();
        const tag = /** @type {HTMLScriptElement} */ (document.getElementById('psi-opencv-script'));
        tag.dispatchEvent(new Event('error'));
        await expect(promise).rejects.toThrow(/CDN fetch failed/);
    });

    it('rejects when cv is not on window after script load (defensive)', async () => {
        const promise = loadOpenCV();
        const tag = /** @type {HTMLScriptElement} */ (document.getElementById('psi-opencv-script'));
        delete /** @type {any} */ (window).cv;
        tag.dispatchEvent(new Event('load'));
        await expect(promise).rejects.toThrow(/`cv` is not on window/);
    });

    it('clears _loaderPromise on rejection so the next call retries', async () => {
        const a = loadOpenCV();
        const tag = /** @type {HTMLScriptElement} */ (document.getElementById('psi-opencv-script'));
        tag.dispatchEvent(new Event('error'));
        await expect(a).rejects.toBeTruthy();
        // Second call should NOT immediately resolve to the same rejected promise
        const b = loadOpenCV();
        expect(b).not.toBe(a);
        b.catch(() => {});
    });
});

describe('onStatus', () => {
    it('fires status callback when load starts', () => {
        const status = vi.fn();
        onStatus(status);
        loadOpenCV().catch(() => {});
        expect(status).toHaveBeenCalled();
        const firstCall = status.mock.calls[0][0];
        expect(typeof firstCall).toBe('string');
        expect(firstCall).toMatch(/Fetching|OpenCV/i);
    });

    it('fires "OpenCV ready" once cv is available', async () => {
        const status = vi.fn();
        onStatus(status);
        const promise = loadOpenCV();
        const tag = /** @type {HTMLScriptElement} */ (document.getElementById('psi-opencv-script'));
        /** @type {any} */ (window).cv = { Mat: function () {} };
        tag.dispatchEvent(new Event('load'));
        await promise;
        const calls = status.mock.calls.map((c) => c[0]);
        expect(calls.some((s) => /ready/i.test(String(s)))).toBe(true);
    });
});
