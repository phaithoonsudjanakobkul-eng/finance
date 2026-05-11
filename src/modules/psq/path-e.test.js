// Path-E state machine tests. The network/iframe layer requires a live
// Collabora + WOPI host, so e2e coverage is left manual. The state
// machine + URL composition stay testable.

import { describe, it, expect } from 'vitest';
import { transition } from './path-e.js';

describe('transition', () => {
    it('idle + upload-start → uploading', () => {
        expect(transition('idle', 'upload-start')).toBe('uploading');
    });
    it('uploading + upload-ok → open', () => {
        expect(transition('uploading', 'upload-ok')).toBe('open');
    });
    it('uploading + upload-fail → error', () => {
        expect(transition('uploading', 'upload-fail')).toBe('error');
    });
    it('open + close-request → saving', () => {
        expect(transition('open', 'close-request')).toBe('saving');
    });
    it('saving + download-ok → closed', () => {
        expect(transition('saving', 'download-ok')).toBe('closed');
    });
    it('saving + download-fail → error', () => {
        expect(transition('saving', 'download-fail')).toBe('error');
    });
    it('any state + reset → idle', () => {
        expect(transition('error',    'reset')).toBe('idle');
        expect(transition('saving',   'reset')).toBe('idle');
        expect(transition('closed',   'reset')).toBe('idle');
    });
    it('invalid event keeps current state', () => {
        // closed shouldn't accept upload-start without reset first
        expect(transition('closed', 'upload-start')).toBe('closed');
        // idle shouldn't accept close-request
        expect(transition('idle', 'close-request')).toBe('idle');
        // open shouldn't accept upload-ok
        expect(transition('open', 'upload-ok')).toBe('open');
    });
});
