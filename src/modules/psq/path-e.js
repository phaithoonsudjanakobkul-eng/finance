// PSQ Path E — Collabora live xlsx editor lifecycle (V16-18).
//
// Public entry point `openEditor(args)` does the whole dance:
//   1. POST the xlsx buffer to the WOPI host  → receive fileId
//   2. Build the Collabora viewer URL          (wopi.js helpers)
//   3. Mount an iframe modal at z-index 9100
//   4. Listen for postMessage from Collabora's origin
//   5. On UI_Close (user clicked their save+close in Collabora):
//      GET the file back from WOPI → resolve with the updated bytes
//   6. Cleanup on close
//
// Per project_pslink_hybrid_tailscale.md Collabora ALWAYS runs on cloud
// Fly.io — Tailscale + sub-cell clipboard is broken. URL helpers in
// wopi.js are unaware of Hybrid (no local fallback).
//
// State machine (exported for unit testing):
//   idle → uploading → open → saving → closed
//                              ↓
//                            error  (any failure)

import { trimTrailingSlash, buildWopiSrc, buildCollaboraViewerUrl, isOriginAllowed, parseCollaboraMessage } from './wopi.js';

/** @typedef {'idle' | 'uploading' | 'open' | 'saving' | 'closed' | 'error'} State */

/**
 * Pure transition function. Returns the next state, or the current state
 * when the event is invalid for that state. Used by tests + by the
 * runtime to drive the modal.
 *
 * @param {State} cur @param {'upload-start' | 'upload-ok' | 'upload-fail' | 'close-request' | 'download-ok' | 'download-fail' | 'reset'} ev
 * @returns {State}
 */
export function transition(cur, ev) {
    if (ev === 'reset') return 'idle';
    if (cur === 'idle' && ev === 'upload-start') return 'uploading';
    if (cur === 'uploading') {
        if (ev === 'upload-ok')   return 'open';
        if (ev === 'upload-fail') return 'error';
    }
    if (cur === 'open' && ev === 'close-request') return 'saving';
    if (cur === 'saving') {
        if (ev === 'download-ok')   return 'closed';
        if (ev === 'download-fail') return 'error';
    }
    return cur;
}

/**
 * POST the file to the WOPI host. Returns the fileId from the response.
 * Throws on network / non-2xx so the caller can transition to 'error'.
 *
 * @param {{ wopiBase: string, token: string, buffer: ArrayBuffer, filename: string }} args
 * @returns {Promise<string>}
 */
export async function uploadToWopi(args) {
    const base = trimTrailingSlash(args.wopiBase);
    if (!base) throw new Error('No WOPI base');
    const res = await fetch(`${base}/upload?filename=${encodeURIComponent(args.filename || 'edit.xlsx')}`, {
        method: 'POST',
        headers: {
            Authorization: 'Bearer ' + args.token,
            'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        },
        body: args.buffer,
    });
    if (!res.ok) throw new Error('WOPI upload failed: HTTP ' + res.status);
    const json = await res.json().catch(() => ({}));
    if (!json || typeof json.fileId !== 'string') throw new Error('WOPI upload returned no fileId');
    return json.fileId;
}

/**
 * GET the (possibly-updated) file back from WOPI.
 * @param {{ wopiBase: string, token: string, fileId: string }} args
 * @returns {Promise<ArrayBuffer>}
 */
export async function downloadFromWopi(args) {
    const wopiSrc = buildWopiSrc(args.wopiBase, args.fileId);
    if (!wopiSrc) throw new Error('Invalid WOPI src');
    const res = await fetch(`${wopiSrc}/contents`, {
        headers: { Authorization: 'Bearer ' + args.token },
    });
    if (!res.ok) throw new Error('WOPI download failed: HTTP ' + res.status);
    return res.arrayBuffer();
}

/** @type {HTMLElement | null} */
let _modal = null;

/**
 * Mount a position:fixed iframe modal pointing at `viewerUrl`. Returns a
 * dispose function that removes the modal + listener.
 *
 * @param {{ viewerUrl: string, collaboraBase: string, onClose: () => void, onMessage?: (m: any) => void }} args
 * @returns {() => void}
 */
export function mountIframeModal(args) {
    if (_modal) return () => {};
    const back = document.createElement('div');
    back.id = 'psq-path-e-backdrop';
    back.style.cssText = 'position:fixed;inset:0;z-index:9100;background:rgba(0,0,0,0.78);display:flex;align-items:center;justify-content:center;padding:16px;';
    back.innerHTML = `
        <div id="psq-path-e-panel" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:12px;width:min(1280px, 98vw);height:min(800px, 92vh);display:flex;flex-direction:column;overflow:hidden;">
            <div style="display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--border, #2a2a2a);">
                <strong style="font-family:var(--font-display, var(--sans, system-ui));font-size:14px;letter-spacing:-0.01em;">Collabora · live xlsx editor</strong>
                <span id="psq-path-e-status" style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);"></span>
                <button id="psq-path-e-close" title="Save and close" style="margin-left:auto;background:var(--accent, #089981);border:0;color:#000;padding:6px 12px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;">Save &amp; close</button>
            </div>
            <iframe id="psq-path-e-iframe" src="${viewer(args.viewerUrl)}" style="flex:1;width:100%;border:0;background:#fff;"></iframe>
        </div>
    `;
    document.body.appendChild(back);
    _modal = back;
    function dispose() {
        window.removeEventListener('message', onMsg);
        if (_modal && _modal.parentNode) _modal.parentNode.removeChild(_modal);
        _modal = null;
    }
    function onMsg(/** @type {MessageEvent} */ e) {
        if (!isOriginAllowed(e, args.collaboraBase)) return;
        const m = parseCollaboraMessage(e.data);
        if (!m) return;
        if (args.onMessage) args.onMessage(m);
        if (m.MessageId === 'UI_Close' || m.MessageId === 'Action_Save_Resp') {
            args.onClose();
        }
    }
    window.addEventListener('message', onMsg);
    back.querySelector('#psq-path-e-close')?.addEventListener('click', () => args.onClose());
    return dispose;
}

/** Defensive: refuse to render an iframe pointing at javascript: / data: / arbitrary text. */
function viewer(/** @type {string} */ url) {
    if (typeof url !== 'string') return '';
    if (!/^https:\/\//.test(url)) return '';
    return url;
}

/**
 * High-level entry: upload → mount iframe → wait for close → download.
 * Resolves with the updated xlsx ArrayBuffer, or null if the user closed
 * before a download could complete.
 *
 * @param {{
 *   wopiBase: string, wopiToken: string, collaboraBase: string,
 *   buffer: ArrayBuffer, filename: string,
 *   onStateChange?: (s: State, info?: any) => void
 * }} args
 * @returns {Promise<ArrayBuffer | null>}
 */
export async function openEditor(args) {
    /** @type {State} */ let state = 'idle';
    /**
     * @param {State} s
     * @param {any} [info]
     */
    const fire = (s, info) => {
        state = s;
        if (args.onStateChange) args.onStateChange(state, info);
    };
    fire(transition(state, 'upload-start'));
    /** @type {string} */ let fileId;
    try {
        fileId = await uploadToWopi({ wopiBase: args.wopiBase, token: args.wopiToken, buffer: args.buffer, filename: args.filename });
        fire(transition(state, 'upload-ok'), { fileId });
    } catch (e) {
        fire(transition(state, 'upload-fail'), e);
        throw e;
    }
    const wopiSrc = buildWopiSrc(args.wopiBase, fileId);
    const viewerUrl = buildCollaboraViewerUrl(args.collaboraBase, wopiSrc, args.wopiToken);
    return new Promise((resolve) => {
        const dispose = mountIframeModal({
            viewerUrl,
            collaboraBase: args.collaboraBase,
            onClose: async () => {
                fire(transition(state, 'close-request'));
                try {
                    const buf = await downloadFromWopi({ wopiBase: args.wopiBase, token: args.wopiToken, fileId });
                    fire(transition(state, 'download-ok'));
                    dispose();
                    resolve(buf);
                } catch (e) {
                    fire(transition(state, 'download-fail'), e);
                    dispose();
                    resolve(null);
                }
            },
        });
    });
}
