// First-time wizard — V21.
//
// Shown when localStorage is empty and no Gist token is set. Asks the
// user for their token, pulls encrypted Gist data, then resolves so
// boot can proceed. "Skip" continues with empty-state tabs (a fresh
// install + no Gist account is a valid path).
//
// The wizard mounts on the splash overlay so the user never sees an
// empty Records/Watchlist before reaching it.

import { lsSave } from '../../core/storage.js';
import { pullFromGist } from '../../core/gist.js';
import { bus } from '../../core/bus.js';

/** @returns {boolean} */
export function isFresh() {
    try {
        if (typeof localStorage === 'undefined') return false;
        const hasRecords = !!localStorage.getItem('ps_records');
        const hasWl      = !!localStorage.getItem('ps_watchlist');
        const hasToken   = !!localStorage.getItem('ps_gist_token');
        return !hasRecords && !hasWl && !hasToken;
    } catch (_) { return false; }
}

/**
 * Mount the wizard. Returns a Promise that resolves when the user has
 * either submitted a token (and the pull completed) or chosen Skip.
 * @returns {Promise<{ usedToken: boolean, restoredKeys: number }>}
 */
export function showWizard() {
    if (typeof document === 'undefined') return Promise.resolve({ usedToken: false, restoredKeys: 0 });
    return new Promise((resolve) => {
        const overlay = document.createElement('div');
        overlay.id = 'ps-wizard-overlay';
        overlay.style.cssText = 'position:fixed;inset:0;z-index:99500;background:radial-gradient(ellipse at 30% 20%, rgba(8, 153, 129, 0.18), transparent 60%), #0a0a0a;display:flex;align-items:center;justify-content:center;padding:24px;font-family:var(--font-ui, var(--sans, system-ui));color:var(--fg, #f5f5f7);';
        overlay.innerHTML = `
            <div style="background:#141414;border:1px solid #2a2a2a;border-radius:16px;padding:24px;max-width:480px;width:100%;display:flex;flex-direction:column;gap:14px;box-shadow:0 16px 48px rgba(0,0,0,0.6);">
                <div style="font-family:var(--font-display, var(--sans, system-ui));font-size:24px;font-weight:700;letter-spacing:-0.02em;">Welcome to PSLink</div>
                <div style="font-size:13px;color:#aaa;line-height:1.5;">
                    Paste your GitHub Gist token to restore your records, watchlist, and settings on this device.
                    Or pick <strong>Skip</strong> to start fresh — you can add a token later in Settings.
                </div>
                <input id="ps-wizard-token" type="password" autocomplete="off" placeholder="ghp_…" style="background:#0a0a0a;border:1px solid #2a2a2a;color:#f5f5f7;padding:10px 12px;border-radius:8px;font-family:var(--mono, monospace);font-size:13px;outline:none;">
                <div id="ps-wizard-status" style="font-size:11px;color:#888;font-family:var(--mono, monospace);min-height:14px;"></div>
                <div style="display:flex;gap:8px;justify-content:flex-end;">
                    <button id="ps-wizard-skip"     style="background:transparent;border:1px solid #2a2a2a;color:#f5f5f7;padding:8px 16px;border-radius:8px;cursor:pointer;font-size:13px;">Skip</button>
                    <button id="ps-wizard-continue" style="background:#089981;border:0;color:#000;padding:8px 18px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;">Continue</button>
                </div>
                <div style="font-size:10px;color:#666;font-family:var(--mono, monospace);text-transform:uppercase;letter-spacing:0.08em;text-align:center;">end-to-end encrypted · token never leaves this device</div>
            </div>
        `;
        document.body.appendChild(overlay);

        const tokenEl    = /** @type {HTMLInputElement} */ (overlay.querySelector('#ps-wizard-token'));
        const status     = /** @type {HTMLElement} */     (overlay.querySelector('#ps-wizard-status'));
        const skipBtn    = /** @type {HTMLButtonElement} */ (overlay.querySelector('#ps-wizard-skip'));
        const continueBtn= /** @type {HTMLButtonElement} */ (overlay.querySelector('#ps-wizard-continue'));

        function close(/** @type {{ usedToken: boolean, restoredKeys: number }} */ result) {
            if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
            resolve(result);
        }

        skipBtn.addEventListener('click', () => close({ usedToken: false, restoredKeys: 0 }));

        async function submit() {
            const tok = tokenEl.value.trim();
            if (!tok) { status.textContent = 'Paste a token first'; return; }
            continueBtn.disabled = true; skipBtn.disabled = true;
            status.textContent = 'Pulling encrypted Gist…';
            try {
                lsSave('ps_gist_token', tok);
                const r = await pullFromGist(tok);
                status.textContent = 'Restored ' + r.applied.length + ' fields — welcome back';
                bus.emit('wizard:done', { restored: r.applied.length });
                setTimeout(() => close({ usedToken: true, restoredKeys: r.applied.length }), 600);
            } catch (e) {
                const err = /** @type {any} */ (e);
                status.textContent = 'Pull failed: ' + (err && err.message || err) + ' — token saved, you can retry from Settings';
                continueBtn.disabled = false; skipBtn.disabled = false;
            }
        }
        continueBtn.addEventListener('click', submit);
        tokenEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); submit(); }
        });
        setTimeout(() => tokenEl.focus(), 100);
    });
}
