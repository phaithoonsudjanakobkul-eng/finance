// PSLink — core event bus (Session 3a, 2026-05-09)
//
// Per Architecture conv. Hard Rule §4: cross-module communication goes through
// this bus, not direct calls. Modules emit + subscribe by string topic.
//
// Wire-compatible with Node EventTarget but minimal — no DOM CustomEvent
// overhead, no propagation, no bubbling. Use for:
//   - "wl:tick"           (WS pipeline → renderers)
//   - "records:saved"     (Records → Dashboard refresh)
//   - "preset:changed"    (theme switch → all open modules)
//   - "psq:state-updated" (PSQ → Dashboard counter)
//   - "r2:flush-pending"  (network online → R2 retry)
//
// Topics use ":" namespacing, lowercase. Subscribers receive raw payload.

/** @typedef {(payload: any) => void} BusHandler */

/** @type {Map<string, Set<BusHandler>>} */
const _subs = new Map();

export const bus = {
    /**
     * Subscribe to a topic. Returns an unsubscribe function.
     * @param {string} topic
     * @param {BusHandler} handler
     * @returns {() => void}
     */
    on(topic, handler) {
        let set = _subs.get(topic);
        if (!set) { set = new Set(); _subs.set(topic, set); }
        set.add(handler);
        return () => set.delete(handler);
    },

    /**
     * Subscribe once — auto-unsubscribes after first emit.
     * @param {string} topic
     * @param {BusHandler} handler
     */
    once(topic, handler) {
        const off = this.on(topic, (payload) => {
            off();
            handler(payload);
        });
        return off;
    },

    /**
     * Emit a topic. Handlers run synchronously in subscription order.
     * Errors in one handler don't abort siblings (caught + logged).
     * @param {string} topic
     * @param {any} [payload]
     */
    emit(topic, payload) {
        const set = _subs.get(topic);
        if (!set) return;
        for (const h of set) {
            try { h(payload); }
            catch (e) { console.error('[bus]', topic, 'handler error:', e); }
        }
    },

    /**
     * Remove all subscribers for a topic (or all topics if omitted).
     * Useful for module destroy() lifecycle.
     * @param {string} [topic]
     */
    clear(topic) {
        if (topic) _subs.delete(topic);
        else _subs.clear();
    },

    /** Inspect subscription state — for debugging only */
    _state() {
        /** @type {Record<string, number>} */
        const out = {};
        for (const [t, s] of _subs) out[t] = s.size;
        return out;
    },
};

// Expose on window for legacy inline scripts to interop during migration
if (typeof window !== 'undefined') {
    /** @type {any} */ (window).__psBus = bus;
}
