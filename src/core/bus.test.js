import { describe, it, expect, beforeEach, vi } from 'vitest';
import { bus } from './bus.js';

beforeEach(() => {
    bus.clear();
});

describe('bus.on / emit', () => {
    it('delivers payload to subscriber', () => {
        const received = [];
        bus.on('test:topic', (p) => received.push(p));
        bus.emit('test:topic', { x: 1 });
        expect(received).toEqual([{ x: 1 }]);
    });

    it('delivers to multiple subscribers in subscription order', () => {
        const order = [];
        bus.on('t', () => order.push('a'));
        bus.on('t', () => order.push('b'));
        bus.on('t', () => order.push('c'));
        bus.emit('t');
        expect(order).toEqual(['a', 'b', 'c']);
    });

    it('returns an unsubscribe fn that detaches the handler', () => {
        const received = [];
        const off = bus.on('t', (p) => received.push(p));
        bus.emit('t', 1);
        off();
        bus.emit('t', 2);
        expect(received).toEqual([1]);
    });

    it('emit on a topic with no subscribers is a no-op', () => {
        expect(() => bus.emit('nobody-here', 'x')).not.toThrow();
    });
});

describe('bus.once', () => {
    it('fires exactly once then auto-detaches', () => {
        const received = [];
        bus.once('t', (p) => received.push(p));
        bus.emit('t', 1);
        bus.emit('t', 2);
        expect(received).toEqual([1]);
    });

    it('returned off() prevents the once handler from running at all', () => {
        const received = [];
        const off = bus.once('t', (p) => received.push(p));
        off();
        bus.emit('t', 1);
        expect(received).toEqual([]);
    });
});

describe('bus error isolation', () => {
    it('continues delivering to siblings when one handler throws', () => {
        const errSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        const received = [];
        bus.on('t', () => { throw new Error('boom'); });
        bus.on('t', (p) => received.push(p));
        bus.emit('t', 'after-throw');
        expect(received).toEqual(['after-throw']);
        expect(errSpy).toHaveBeenCalled();
        errSpy.mockRestore();
    });
});

describe('bus.clear', () => {
    it('clears a single topic without affecting others', () => {
        const a = [], b = [];
        bus.on('t1', () => a.push(1));
        bus.on('t2', () => b.push(1));
        bus.clear('t1');
        bus.emit('t1');
        bus.emit('t2');
        expect(a).toEqual([]);
        expect(b).toEqual([1]);
    });

    it('clear() with no arg removes everything', () => {
        const received = [];
        bus.on('t1', () => received.push(1));
        bus.on('t2', () => received.push(2));
        bus.clear();
        bus.emit('t1');
        bus.emit('t2');
        expect(received).toEqual([]);
    });
});

describe('bus._state', () => {
    it('reports current subscriber counts', () => {
        bus.on('a', () => {});
        bus.on('a', () => {});
        bus.on('b', () => {});
        const s = bus._state();
        expect(s.a).toBe(2);
        expect(s.b).toBe(1);
    });
});

describe('window.__psBus interop', () => {
    it('exposes the same bus on window for legacy inline scripts', () => {
        expect(/** @type {any} */ (window).__psBus).toBe(bus);
    });
});
