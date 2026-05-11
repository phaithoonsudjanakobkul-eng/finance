// OpenRouter REST client + watchlist-context builder for the AI chat widget.
//
// The chat widget pulls the active watchlist + cached quote data and
// hands the top-N rows to the model as a JSON-flavoured "context block"
// so it can answer questions like "which of my stocks is down most?"
// without the model having to call out.

import { lsGet, lsGetJson } from '../../core/storage.js';

/** @typedef {{ role: 'system' | 'user' | 'assistant', content: string }} ChatMsg */

const DEFAULT_MODEL = 'anthropic/claude-haiku-4-5';
const API_URL = 'https://openrouter.ai/api/v1/chat/completions';

/** @returns {string} */
function readKey() { return lsGet('ps_openrouter_key', '') || ''; }

/**
 * Build a compact "context block" the model can consume. Picks pinned
 * symbols first (most signal), falls back to the head of the full
 * watchlist. Keeps the size small so the prompt stays cheap.
 *
 * @param {{ cache: Record<string, any>, watchlist: string[], pinned: string[], n?: number }} args
 * @returns {string}
 */
export function buildContext(args) {
    const n = args.n == null ? 5 : args.n;
    const picked = /** @type {string[]} */ ([]);
    for (const s of args.pinned || []) {
        if (picked.length >= n) break;
        if (s && picked.indexOf(s) === -1) picked.push(s);
    }
    for (const s of args.watchlist || []) {
        if (picked.length >= n) break;
        if (s && picked.indexOf(s) === -1) picked.push(s);
    }
    /** @type {any[]} */
    const rows = picked.map((sym) => {
        const e = (args.cache && args.cache[sym]) || {};
        return {
            sym,
            name: e.name || '',
            last: typeof e.c  === 'number' ? e.c  : null,
            chg:  typeof e.d  === 'number' ? e.d  : null,
            chgPct: typeof e.dp === 'number' ? e.dp : null,
            vol:  typeof e.v  === 'number' ? e.v  : null,
        };
    });
    return 'Watchlist context (top ' + rows.length + ', most-pinned first):\n' + JSON.stringify(rows, null, 2);
}

/**
 * Build the array of messages to send: system prompt + context block as
 * an additional system message + the chat transcript so far.
 * @param {ChatMsg[]} history
 * @param {string} context
 * @returns {ChatMsg[]}
 */
export function buildMessages(history, context) {
    /** @type {ChatMsg[]} */
    const msgs = [
        { role: 'system', content: 'You are a friendly, terse financial assistant inside PSLink. Answer in 1-3 short sentences unless the user asks for detail. Use Markdown sparingly. If the user asks about a symbol not in their watchlist, say so and offer to add it.' },
        { role: 'system', content: context },
    ];
    return msgs.concat(history);
}

/**
 * Read the watchlist + cache from localStorage and build the context
 * block. Returns the string the chat widget passes to buildMessages.
 * @returns {string}
 */
export function defaultContext() {
    /** @type {any} */
    const watchlist = lsGetJson('ps_watchlist', []);
    /** @type {any} */
    const pinned   = lsGetJson('ps_pinned_wl', []);
    /** @type {any} */
    const cache    = lsGetJson('ps_wl_cache', {});
    return buildContext({
        watchlist: Array.isArray(watchlist) ? watchlist : [],
        pinned:    Array.isArray(pinned)    ? pinned    : [],
        cache:     (cache && typeof cache === 'object') ? cache : {},
    });
}

/**
 * @param {any} json — parsed OpenRouter response body
 * @returns {string} assistant text, or empty string if missing
 */
export function parseResponse(json) {
    if (!json || !json.choices) return '';
    const c = json.choices[0];
    if (!c || !c.message) return '';
    return c.message.content || '';
}

/**
 * Send messages to OpenRouter, return the assistant's text.
 * @param {ChatMsg[]} messages
 * @param {{ signal?: AbortSignal, model?: string }} [opts]
 * @returns {Promise<string>}
 */
export async function chat(messages, opts) {
    const key = readKey();
    if (!key) throw new Error('No OpenRouter key — set ps_openrouter_key in Settings');
    const body = {
        model: (opts && opts.model) || DEFAULT_MODEL,
        messages,
        max_tokens: 800,
    };
    const res = await fetch(API_URL, {
        method: 'POST',
        signal: opts && opts.signal,
        headers: {
            Authorization: 'Bearer ' + key,
            'Content-Type': 'application/json',
            'HTTP-Referer': typeof location !== 'undefined' ? location.origin : 'https://pslink',
            'X-Title': 'PSLink',
        },
        body: JSON.stringify(body),
    });
    if (!res.ok) {
        const txt = await res.text().catch(() => '');
        throw new Error('OpenRouter ' + res.status + ': ' + txt.slice(0, 160));
    }
    const json = await res.json();
    return parseResponse(json);
}
