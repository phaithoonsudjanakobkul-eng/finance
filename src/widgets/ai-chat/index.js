// AI chat FAB + popup — V13-14.
//
// Floating action button shown only on the Watchlist tab. Clicking opens
// a popup chat panel above the body (z-index 9100). Sends the user
// prompt + watchlist context to OpenRouter; response is rendered via
// the minimal Markdown helper.
//
// Chat history is in-memory only (resets on close) — keeps the prompt
// short and avoids persisting model output unnecessarily.

import { bus } from '../../core/bus.js';
import { renderMd } from './markdown.js';
import { chat, defaultContext, buildMessages } from './openrouter.js';

/** @typedef {{ role: 'user' | 'assistant', content: string }} Msg */

const FAB_ID = 'ai-chat-fab';
const POPUP_ID = 'ai-chat-popup';

/** @type {HTMLElement | null} */
let _fab = null;
/** @type {HTMLElement | null} */
let _popup = null;
/** @type {Msg[]} */
let _history = [];
/** @type {AbortController | null} */
let _inflight = null;

function mountFab() {
    if (_fab && _fab.isConnected) return;
    const btn = document.createElement('button');
    btn.id = FAB_ID;
    btn.title = 'Ask the AI about your watchlist';
    btn.style.cssText = 'position:fixed;right:calc(env(safe-area-inset-right, 0px) + 22px);bottom:calc(env(safe-area-inset-bottom, 0px) + 22px);width:54px;height:54px;border-radius:50%;background:var(--accent, #089981);color:#000;border:0;cursor:pointer;font-size:22px;font-weight:700;box-shadow:0 8px 24px rgb(0 0 0 / 0.35);z-index:5500;display:flex;align-items:center;justify-content:center;font-family:var(--font-display, var(--mono, monospace));';
    btn.textContent = 'AI';
    btn.addEventListener('click', () => openPopup());
    document.body.appendChild(btn);
    _fab = btn;
}

function unmountFab() {
    if (_fab && _fab.parentNode) _fab.parentNode.removeChild(_fab);
    _fab = null;
}

function appendMsg(/** @type {Msg} */ m) {
    if (!_popup) return;
    const list = _popup.querySelector('.ai-chat-list');
    if (!list) return;
    const row = document.createElement('div');
    row.className = 'ai-chat-row ai-chat-' + m.role;
    row.style.cssText = 'display:flex;flex-direction:column;gap:2px;padding:8px 12px;border-radius:10px;max-width:90%;' +
        (m.role === 'user'
            ? 'background:var(--accent, #089981);color:#000;align-self:flex-end;'
            : 'background:var(--bg, #0d0d0d);color:var(--fg, #f5f5f7);border:1px solid var(--border, #2a2a2a);align-self:flex-start;');
    const body = document.createElement('div');
    body.className = 'ai-chat-md';
    body.style.cssText = 'font-size:13px;line-height:1.5;word-break:break-word;';
    body.innerHTML = m.role === 'assistant' ? renderMd(m.content) : escapeText(m.content);
    row.appendChild(body);
    list.appendChild(row);
    list.scrollTop = list.scrollHeight;
}

function escapeText(/** @type {string} */ s) {
    return String(s).replace(/[&<>"']/g, (c) => /** @type {any} */ ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[c]);
}

async function send(/** @type {string} */ prompt) {
    if (!_popup || !prompt.trim()) return;
    const status = _popup.querySelector('.ai-chat-status');
    appendMsg({ role: 'user', content: prompt });
    _history.push({ role: 'user', content: prompt });
    if (status) status.textContent = 'Thinking…';
    _inflight = new AbortController();
    try {
        const ctx = defaultContext();
        const msgs = buildMessages(_history.map((m) => /** @type {any} */ ({ role: m.role, content: m.content })), ctx);
        const reply = await chat(msgs, { signal: _inflight.signal });
        _history.push({ role: 'assistant', content: reply });
        appendMsg({ role: 'assistant', content: reply });
        if (status) status.textContent = '';
    } catch (e) {
        const err = /** @type {any} */ (e);
        if (status) status.textContent = 'Error: ' + (err && err.message || err);
    } finally {
        _inflight = null;
    }
}

function openPopup() {
    if (_popup) return;
    const panel = document.createElement('div');
    panel.id = POPUP_ID;
    panel.style.cssText = 'position:fixed;right:calc(env(safe-area-inset-right, 0px) + 22px);bottom:calc(env(safe-area-inset-bottom, 0px) + 88px);width:min(380px, calc(100vw - 32px));height:min(520px, 70vh);z-index:5600;background:var(--card, #1a1a1a);border:1px solid var(--border, #2a2a2a);border-radius:14px;box-shadow:0 12px 40px rgb(0 0 0 / 0.45);display:flex;flex-direction:column;color:var(--fg, #f5f5f7);font-family:var(--font-ui, var(--sans, system-ui));overflow:hidden;';

    panel.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border, #2a2a2a);">
            <div style="font-family:var(--font-display, var(--sans, system-ui));font-size:14px;font-weight:700;">AI · watchlist</div>
            <span class="ai-chat-status" style="font-size:11px;color:var(--dim, #888);font-family:var(--mono, monospace);margin-left:auto;"></span>
            <button class="ai-chat-close" title="Close" style="background:transparent;border:0;color:var(--dim, #888);cursor:pointer;font-size:20px;line-height:1;padding:0 4px;">×</button>
        </div>
        <div class="ai-chat-list" style="flex:1;overflow-y:auto;padding:12px;display:flex;flex-direction:column;gap:8px;"></div>
        <div style="display:flex;gap:6px;padding:10px;border-top:1px solid var(--border, #2a2a2a);">
            <input class="ai-chat-input" type="text" placeholder="Ask about your watchlist…" style="flex:1;background:var(--bg, #0d0d0d);border:1px solid var(--border, #2a2a2a);color:var(--fg, #f5f5f7);padding:8px 10px;border-radius:8px;font-size:13px;outline:none;font-family:inherit;">
            <button class="ai-chat-send" style="background:var(--accent, #089981);border:0;color:#000;padding:8px 14px;border-radius:8px;cursor:pointer;font-size:13px;font-weight:700;">Send</button>
        </div>
    `;
    document.body.appendChild(panel);
    _popup = panel;

    if (_history.length === 0) {
        appendMsg({ role: 'assistant', content: 'Hi! I see your watchlist context — ask me anything about your symbols, prices, or trends.' });
    } else {
        _history.forEach(appendMsg);
    }

    const input = /** @type {HTMLInputElement} */ (panel.querySelector('.ai-chat-input'));
    const sendBtn = /** @type {HTMLButtonElement} */ (panel.querySelector('.ai-chat-send'));
    const closeBtn = /** @type {HTMLButtonElement} */ (panel.querySelector('.ai-chat-close'));

    function trigger() {
        const v = input.value.trim();
        if (!v) return;
        input.value = '';
        send(v);
    }
    sendBtn.addEventListener('click', trigger);
    input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            trigger();
        }
    });
    closeBtn.addEventListener('click', () => closePopup());

    setTimeout(() => input.focus(), 50);
}

function closePopup() {
    if (_inflight) { try { _inflight.abort(); } catch (_) {} _inflight = null; }
    if (_popup && _popup.parentNode) _popup.parentNode.removeChild(_popup);
    _popup = null;
}

/**
 * Mount lifecycle wired to tab:active so the FAB only shows on Watchlist.
 * @returns {{ destroy: () => void }}
 */
export function mount() {
    /** @param {any} d */
    function onTab(d) {
        if (!d) return;
        if (d.id === 'watchlist') mountFab();
        else { unmountFab(); closePopup(); }
    }
    const off = bus.on('tab:active', onTab);
    // If we mount mid-session (e.g. main.js called us late), check the
    // current active tab pill class.
    const cur = document.querySelector('button[data-tab].is-active');
    if (cur && /** @type {HTMLElement} */ (cur).dataset.tab === 'watchlist') {
        mountFab();
    }
    return {
        destroy() {
            off && off();
            closePopup();
            unmountFab();
            _history = [];
        },
    };
}
