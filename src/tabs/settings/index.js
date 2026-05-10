// Settings tab — inspect + edit the credentials and endpoints PSLink reads
// from localStorage. Mirrors the monolith Settings modal but keeps the v2
// shell self-sufficient so pi-keng doesn't need to bounce back to the
// monolith just to rotate a key.
//
// All inputs render as type=password by default with a per-row "Reveal"
// toggle. Saves are immediate on blur (and on input for non-sensitive
// URLs to feel snappy). Each row reports a small chip — green "set" when
// the key has a value, dim "missing" otherwise.
//
// Out of scope (intentionally — these belong in monolith for now):
// - Gist token rotation (touches every encrypted-at-rest path; risky)
// - Test connection buttons (would require reaching out to ORT-Web /
//   Finnhub / etc. — defer to dedicated test fixtures)
// - Import/Export full PSLink JSON (monolith handles that natively)

import { bus } from '../../core/bus.js';
import { lsGet, lsSave } from '../../core/storage.js';
import { pullFromGist, pushToGist } from '../../core/gist.js';
import { escapeHtml, escapeAttr } from '../../core/escape.js';

/** @typedef {{
 *   key: string,
 *   label: string,
 *   hint?: string,
 *   sensitive?: boolean,
 * }} SettingRow */

/** @typedef {{ title: string, rows: SettingRow[] }} SettingSection */

/** @type {SettingSection[]} */
const _SECTIONS = [
    { title: 'Stock data APIs', rows: [
        { key: 'ps_finnhub_key',    label: 'Finnhub key',         sensitive: true,  hint: '60 calls/min free tier' },
        { key: 'ps_alpaca_key',     label: 'Alpaca key',          sensitive: true,  hint: 'Quotes + sparklines + WS' },
        { key: 'ps_alpaca_secret',  label: 'Alpaca secret',       sensitive: true },
        { key: 'ps_openrouter_key', label: 'OpenRouter key',      sensitive: true,  hint: 'AI chat (watchlist FAB)' },
    ]},
    { title: 'Cloud sync', rows: [
        { key: 'ps_gist_token',     label: 'GitHub Gist token',   sensitive: true,  hint: 'gist scope · drives encrypted sync of records/watchlist/settings' },
        { key: 'ps_r2_worker_url',  label: 'R2 worker URL',       hint: 'Cloudflare worker proxy for encrypted media' },
        { key: 'ps_r2_auth_token',  label: 'R2 auth token',       sensitive: true },
    ]},
    { title: 'PSQ + Path E', rows: [
        { key: 'ps_psq_collabora_url',     label: 'Collabora URL',      hint: 'Live xlsx editor (Fly.io)' },
        { key: 'ps_psq_wopi_url',          label: 'WOPI host URL',      hint: 'Fly.io WOPI host' },
        { key: 'ps_psq_wopi_token',        label: 'WOPI token',         sensitive: true },
        { key: 'ps_pdf_worker_url',        label: 'PDF worker URL',     hint: 'Cloud Fly.io · or Tailscale local' },
        { key: 'ps_pdf_auth_token',        label: 'PDF worker token',   sensitive: true },
        { key: 'ps_psq_local_base',        label: 'Tailscale base (synced)' },
        { key: 'ps_psq_local_base_override', label: 'Tailscale override (per-device)', hint: 'NOT synced to Gist · wins over base' },
    ]},
];

/** @type {HTMLElement | null} */
let _panel = null;

function renderPanel(/** @type {HTMLElement} */ rootEl) {
    rootEl.innerHTML = `
        <div id="settings-root" style="display:flex;flex-direction:column;gap:14px;padding:16px;color:var(--fg, #f5f5f7);">
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;">
                <span style="font-size:18px;font-weight:700;letter-spacing:-0.02em;">Settings</span>
                <span style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);">tab/settings · localStorage editor</span>
            </div>
            <div style="font-size:12px;color:var(--dim, #888);background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:12px;">
                Edits write to localStorage on blur. Pull from Gist hydrates this device with the latest cross-device snapshot (decrypts AES-GCM via the Gist token below). Push back to Gist still happens through the monolith.
            </div>
            <div style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;display:flex;align-items:center;gap:12px;flex-wrap:wrap;">
                <div style="flex:1;min-width:200px;">
                    <div class="dash-label sec-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:4px;">Gist sync</div>
                    <div id="gist-pull-status" style="font-size:12px;color:var(--dim, #888);font-family:var(--mono, monospace);">Click Pull to hydrate this device from Gist</div>
                </div>
                <button id="gist-pull-btn" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:8px 14px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:600;">Pull from Gist</button>
                <button id="gist-push-btn" style="background:var(--accent, #089981);color:#000;border:0;padding:8px 18px;border-radius:6px;cursor:pointer;font-size:12px;font-weight:700;">Push to Gist</button>
            </div>
            ${_SECTIONS.map(renderSection).join('')}
        </div>
    `;
}

/** @param {SettingSection} sec */
function renderSection(sec) {
    return `<div style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:10px;padding:14px;">
        <div class="dash-label sec-label" style="font-size:11px;text-transform:uppercase;letter-spacing:0.08em;color:var(--accent, #089981);margin-bottom:10px;">${escapeHtml(sec.title)}</div>
        <div style="display:flex;flex-direction:column;gap:10px;">${sec.rows.map(renderRow).join('')}</div>
    </div>`;
}

/** @param {SettingRow} row */
function renderRow(row) {
    const val = lsGet(row.key, '');
    const hasVal = !!val;
    const inputType = row.sensitive ? 'password' : 'text';
    const chip = hasVal
        ? '<span style="font-size:10px;font-family:var(--mono, monospace);background:color-mix(in srgb, var(--accent, #089981) 25%, transparent);color:var(--accent, #089981);padding:2px 7px;border-radius:999px;font-weight:700;">SET</span>'
        : '<span style="font-size:10px;font-family:var(--mono, monospace);background:var(--bg, #0d0d0d);color:var(--dim, #888);padding:2px 7px;border-radius:999px;border:1px solid var(--border, #2a2a2a);">MISSING</span>';
    return `<div data-row="${escapeAttr(row.key)}" style="display:grid;grid-template-columns:200px 1fr auto;gap:10px;align-items:center;">
        <div>
            <div style="font-size:13px;font-weight:600;">${escapeHtml(row.label)}</div>
            ${row.hint ? `<div style="font-size:11px;color:var(--dim, #888);margin-top:2px;font-family:var(--mono, monospace);">${escapeHtml(row.hint)}</div>` : ''}
        </div>
        <input data-input="${escapeAttr(row.key)}" type="${inputType}" autocomplete="off" spellcheck="false" placeholder="${escapeAttr(row.key)}" value="${escapeAttr(val)}" style="background:var(--bg, #0d0d0d);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:7px 10px;border-radius:6px;font-family:var(--mono, monospace);font-size:12px;outline:none;min-width:0;">
        <div style="display:flex;align-items:center;gap:6px;">
            ${row.sensitive ? `<button data-reveal="${escapeAttr(row.key)}" style="background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);color:var(--dim, #888);padding:5px 9px;border-radius:6px;cursor:pointer;font-size:11px;">Reveal</button>` : ''}
            <span data-chip="${escapeAttr(row.key)}">${chip}</span>
        </div>
    </div>`;
}

/** @param {string} key */
function refreshChip(key) {
    if (!_panel) return;
    const chipEl = _panel.querySelector(`[data-chip="${cssEscape(key)}"]`);
    if (!chipEl) return;
    const hasVal = !!lsGet(key, '');
    chipEl.innerHTML = hasVal
        ? '<span style="font-size:10px;font-family:var(--mono, monospace);background:color-mix(in srgb, var(--accent, #089981) 25%, transparent);color:var(--accent, #089981);padding:2px 7px;border-radius:999px;font-weight:700;">SET</span>'
        : '<span style="font-size:10px;font-family:var(--mono, monospace);background:var(--bg, #0d0d0d);color:var(--dim, #888);padding:2px 7px;border-radius:999px;border:1px solid var(--border, #2a2a2a);">MISSING</span>';
}

function cssEscape(/** @type {string} */ s) {
    return String(s).replace(/([!"#$%&'()*+,./:;<=>?@[\\\]^`{|}~])/g, '\\$1');
}

function wireEvents() {
    if (!_panel) return;
    _panel.addEventListener('blur', (/** @type {Event} */ e) => {
        const t = /** @type {HTMLInputElement} */ (e.target);
        const key = t && t.getAttribute && t.getAttribute('data-input');
        if (!key) return;
        const val = t.value || '';
        lsSave(key, val);
        refreshChip(key);
        bus.emit('settings:changed', { key });
    }, true);
    _panel.addEventListener('click', (/** @type {Event} */ e) => {
        const t = /** @type {HTMLElement} */ (e.target);
        if (!t) return;
        const reveal = t.getAttribute && t.getAttribute('data-reveal');
        if (reveal) {
            const inp = /** @type {HTMLInputElement | null} */ (_panel && _panel.querySelector(`[data-input="${cssEscape(reveal)}"]`));
            if (inp) {
                const isPwd = inp.type === 'password';
                inp.type = isPwd ? 'text' : 'password';
                /** @type {HTMLElement} */ (t).textContent = isPwd ? 'Hide' : 'Reveal';
            }
            return;
        }
        if (t.id === 'gist-pull-btn') { handleGistPull(); return; }
        if (t.id === 'gist-push-btn') { handleGistPush(); return; }
    });
}

/** @param {string} text @param {'idle' | 'busy' | 'ok' | 'err'} [tone] */
function setGistStatus(text, tone) {
    if (!_panel) return;
    const el = _panel.querySelector('#gist-pull-status');
    if (!el) return;
    el.textContent = text;
    /** @type {HTMLElement} */ (el).style.color = tone === 'err' ? 'var(--wl-dn, #ef4444)'
        : tone === 'ok'  ? 'var(--accent, #089981)'
        : tone === 'busy' ? 'var(--accent, #089981)'
        : 'var(--dim, #888)';
}

async function handleGistPush() {
    if (!_panel) return;
    const btn = /** @type {HTMLButtonElement | null} */ (_panel.querySelector('#gist-push-btn'));
    const token = lsGet('ps_gist_token', '');
    if (!token) {
        setGistStatus('No Gist token set — fill the row above first', 'err');
        return;
    }
    if (btn) { btn.setAttribute('disabled', 'true'); btn.textContent = 'Pushing…'; }
    setGistStatus('Encrypting + pushing…', 'busy');
    try {
        const r = await pushToGist(/** @type {string} */ (token));
        if (r.throttled) {
            setGistStatus('Throttled (4s window) — try again shortly', 'err');
        } else {
            setGistStatus('Pushed · ' + new Date(r.lastModifiedTs).toLocaleString(), 'ok');
        }
    } catch (e) {
        const err = /** @type {any} */ (e);
        setGistStatus('Push failed: ' + (err && err.message || err), 'err');
    } finally {
        if (btn) { btn.removeAttribute('disabled'); btn.textContent = 'Push to Gist'; }
    }
}

async function handleGistPull() {
    if (!_panel) return;
    const btn = /** @type {HTMLButtonElement | null} */ (_panel.querySelector('#gist-pull-btn'));
    const token = lsGet('ps_gist_token', '');
    if (!token) {
        setGistStatus('No Gist token set — fill the row above first', 'err');
        return;
    }
    if (btn) { btn.setAttribute('disabled', 'true'); btn.textContent = 'Pulling…'; }
    setGistStatus('Decrypting…', 'busy');
    try {
        const r = await pullFromGist(/** @type {string} */ (token));
        const ts = r.lastModifiedTs ? new Date(r.lastModifiedTs).toLocaleString() : '—';
        setGistStatus(`Hydrated ${r.applied.length} key(s) · last modified ${ts}`, 'ok');
        // Refresh chip states across all rows since localStorage just changed
        for (const sec of _SECTIONS) for (const row of sec.rows) refreshChip(row.key);
        // Reflect new values in the input boxes too
        for (const sec of _SECTIONS) {
            for (const row of sec.rows) {
                const inp = /** @type {HTMLInputElement | null} */ (_panel && _panel.querySelector(`[data-input="${cssEscape(row.key)}"]`));
                if (inp) inp.value = lsGet(row.key, '');
            }
        }
        bus.emit('gist:hydrated', { applied: r.applied });
    } catch (e) {
        const err = /** @type {any} */ (e);
        setGistStatus('Pull failed: ' + (err && err.message || err), 'err');
    } finally {
        if (btn) { btn.removeAttribute('disabled'); btn.textContent = 'Pull from Gist'; }
    }
}

export function init(/** @type {HTMLElement} */ rootEl) {
    _panel = rootEl;
    renderPanel(rootEl);
    wireEvents();
    bus.emit('tab:settings:init', { rootEl });
    return { id: 'settings', version: '0.1-step6-settings', ready: true, kind: 'tab' };
}

export function destroy() {
    _panel = null;
    bus.emit('tab:settings:destroy');
}
