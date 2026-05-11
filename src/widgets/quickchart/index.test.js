import { describe, it, expect, beforeEach } from 'vitest';
import { readPrefs, savePrefs, buildEmbedUrl, TF_OPTIONS, TF_LABEL } from './index.js';

beforeEach(() => { localStorage.clear(); });

describe('readPrefs', () => {
    it('defaults to D when nothing stored', () => {
        expect(readPrefs().timeframe).toBe('D');
    });
    it('round-trips a valid timeframe', () => {
        savePrefs({ timeframe: '60' });
        expect(readPrefs().timeframe).toBe('60');
    });
    it('rejects garbage / unknown timeframe', () => {
        localStorage.setItem('ps_lwc_prefs', JSON.stringify({ timeframe: 'bogus' }));
        expect(readPrefs().timeframe).toBe('D');
    });
});

describe('buildEmbedUrl', () => {
    it('encodes the symbol and stamps the timeframe', () => {
        const url = buildEmbedUrl('AAPL', 'D');
        expect(url).toContain('symbol=AAPL');
        expect(url).toContain('interval=D');
        expect(url).toContain('theme=dark');
    });
    it('uppercases the symbol', () => {
        expect(buildEmbedUrl('aapl', 'D')).toContain('symbol=AAPL');
    });
    it('encodes exchange-prefixed symbols', () => {
        expect(buildEmbedUrl('NASDAQ:AAPL', 'D')).toContain('symbol=NASDAQ%3AAAPL');
    });
    it('falls back to D for unknown timeframe', () => {
        expect(buildEmbedUrl('AAPL', 'bogus')).toContain('interval=D');
    });
});

describe('TF_OPTIONS + TF_LABEL', () => {
    it('every option has a label', () => {
        TF_OPTIONS.forEach((tf) => {
            expect(TF_LABEL[tf]).toBeTruthy();
        });
    });
});
