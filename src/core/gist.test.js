import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
    gistEncrypt,
    gistDecrypt,
    encKey,
    decKey,
    applyToLocalStorage,
    buildExportFromLocalStorage,
    pushToGist,
    GIST_ID,
    GIST_FILENAME,
    _resetGistEnvelopeForTests,
} from './gist.js';

beforeEach(() => {
    localStorage.clear();
    _resetGistEnvelopeForTests();
});

describe('GIST_ID / GIST_FILENAME constants', () => {
    it('matches the monolith hardcoded gist id', () => {
        expect(GIST_ID).toBe('5f913baf7d6636bf42da5e5d07a1570c');
        expect(GIST_FILENAME).toBe('PSLink Database.json');
    });
});

describe('encKey / decKey (API-key obfuscation)', () => {
    it('round-trips ASCII tokens', () => {
        const v = 'sk_test_abc123';
        expect(decKey(encKey(v))).toBe(v);
    });

    it('round-trips Thai characters (UTF-8 safe)', () => {
        const v = 'รหัสลับสุดยอด';
        expect(decKey(encKey(v))).toBe(v);
    });

    it('encKey returns empty string for empty input', () => {
        expect(encKey('')).toBe('');
        expect(decKey('')).toBe('');
    });

    it('decKey returns empty string on malformed base64 (no throw)', () => {
        expect(decKey('not%%base64')).toBe('');
    });
});

describe('gistEncrypt / gistDecrypt round-trip', () => {
    it('encrypts + decrypts a JSON payload', async () => {
        const token = 'ghp_testtokentestoken1234567890ABCDef';
        const obj = { records: [{ id: '2026-05', payday: 12000 }], watchlist: ['AAPL', 'MSFT'] };
        const ct = await gistEncrypt(token, obj);
        expect(ct).toContain('"enc":1');
        const decrypted = await gistDecrypt(token, ct);
        expect(decrypted).toEqual(obj);
    });

    it('produces different ciphertext per call (random IV)', async () => {
        const token = 't';
        const obj = { x: 1 };
        const a = await gistEncrypt(token, obj);
        const b = await gistEncrypt(token, obj);
        expect(a).not.toBe(b);
    });

    it('decrypt with wrong token rejects', async () => {
        const ct = await gistEncrypt('right-token', { secret: 42 });
        await expect(gistDecrypt('wrong-token', ct)).rejects.toBeTruthy();
    });

    it('passes plain JSON through unchanged (legacy/v1 backward compat)', async () => {
        const plain = JSON.stringify({ records: [], watchlist: [] });
        const out = await gistDecrypt('any-token', plain);
        expect(out).toEqual({ records: [], watchlist: [] });
    });

    it('throws on invalid JSON content', async () => {
        await expect(gistDecrypt('t', 'not-json-at-all')).rejects.toThrow(/Invalid Gist content/);
    });

    it('handles Thai content in payload', async () => {
        const token = 't';
        const obj = { note: 'สวัสดีพี่เก่ง — ใบเสนอราคา' };
        const ct = await gistEncrypt(token, obj);
        const back = await gistDecrypt(token, ct);
        expect(back.note).toBe('สวัสดีพี่เก่ง — ใบเสนอราคา');
    });
});

describe('applyToLocalStorage — records + watchlist + cache', () => {
    it('writes records when array', () => {
        const r = applyToLocalStorage({ records: [{ id: '2026-05', payday: 100 }] });
        expect(r.applied).toContain('ps_records');
        expect(JSON.parse(localStorage.getItem('ps_records') || '[]')).toEqual([{ id: '2026-05', payday: 100 }]);
    });

    it('skips records when not array', () => {
        const r = applyToLocalStorage({ records: 'oops' });
        expect(r.applied).not.toContain('ps_records');
        expect(r.skipped).toContain('records');
    });

    it('writes watchlist symbols', () => {
        applyToLocalStorage({ watchlist: ['AAPL', 'MSFT', 'NVDA'] });
        expect(JSON.parse(localStorage.getItem('ps_watchlist') || '[]')).toEqual(['AAPL', 'MSFT', 'NVDA']);
    });

    it('merges wl+profile per symbol into ps_wl_cache', () => {
        applyToLocalStorage({
            wlCache: {
                wl:      { AAPL: { c: 200, dp: 1.2 } },
                profile: { AAPL: { name: 'Apple Inc', logo: 'http://x/aapl.png' } },
            },
        });
        const cache = JSON.parse(localStorage.getItem('ps_wl_cache') || '{}');
        expect(cache.AAPL).toEqual({ c: 200, dp: 1.2, name: 'Apple Inc', logo: 'http://x/aapl.png' });
    });

    it('writes pinned watchlist from profileCard.pinnedWl', () => {
        applyToLocalStorage({ profileCard: { pinnedWl: '["AAPL","NVDA"]' } });
        expect(localStorage.getItem('ps_pinned_wl')).toBe('["AAPL","NVDA"]');
    });
});

describe('applyToLocalStorage — apiKeys', () => {
    it('decodes obfuscated keys back to plaintext', () => {
        const data = {
            apiKeys: {
                ps_finnhub_key: encKey('finhub-secret'),
                ps_alpaca_key:  encKey('alpaca-secret'),
            },
        };
        applyToLocalStorage(data);
        expect(localStorage.getItem('ps_finnhub_key')).toBe('finhub-secret');
        expect(localStorage.getItem('ps_alpaca_key')).toBe('alpaca-secret');
    });

    it('skips empty values', () => {
        const r = applyToLocalStorage({ apiKeys: { ps_finnhub_key: '', ps_alpaca_key: encKey('v') } });
        expect(r.applied).not.toContain('ps_finnhub_key');
        expect(r.applied).toContain('ps_alpaca_key');
    });
});

describe('applyToLocalStorage — preset', () => {
    it('writes per-mode preset + variant', () => {
        applyToLocalStorage({
            meta: {
                preset: {
                    active: 'phosphor',
                    activeVariant: 'classic',
                    dark: 'phosphor',
                    light: 'origin',
                    variantDark: 'classic',
                    variantLight: '',
                },
            },
        });
        expect(localStorage.getItem('ps_preset')).toBe('phosphor');
        expect(localStorage.getItem('ps_preset_dark')).toBe('phosphor');
        expect(localStorage.getItem('ps_preset_light')).toBe('origin');
        expect(localStorage.getItem('ps_variant_dark')).toBe('classic');
        // Empty variantLight should NOT be written
        expect(localStorage.getItem('ps_variant_light')).toBeNull();
    });
});

describe('applyToLocalStorage — meta scalars', () => {
    it('encodes booleans as "1" / "0" matching monolith', () => {
        applyToLocalStorage({ meta: { dark: true, privacy: false } });
        expect(localStorage.getItem('ps_dark')).toBe('1');
        expect(localStorage.getItem('ps_privacy')).toBe('0');
    });
});

describe('applyToLocalStorage — psqState / psecState / uiState', () => {
    it('serializes objects to JSON strings', () => {
        applyToLocalStorage({
            psqState:  { counters: { c1: 350 }, log: [] },
            psecState: { lastTemplate: 'order', form: { customer: 'Acme' } },
            uiState:   { tab: 'watchlist', dashSectionOrder: ['fin', 'wl'] },
        });
        expect(JSON.parse(localStorage.getItem('ps_psq_state') || '{}').counters.c1).toBe(350);
        expect(JSON.parse(localStorage.getItem('ps_psec_state') || '{}').lastTemplate).toBe('order');
        expect(localStorage.getItem('ps_tab')).toBe('watchlist');
        expect(JSON.parse(localStorage.getItem('ps_dash_section_order') || 'null')).toEqual(['fin', 'wl']);
    });
});

describe('applyToLocalStorage — empty / malformed input', () => {
    it('returns skipped: ["not-an-object"] for null', () => {
        const r = applyToLocalStorage(null);
        expect(r.applied).toEqual([]);
        expect(r.skipped).toContain('not-an-object');
    });

    it('returns empty result for empty object (no fields applied)', () => {
        const r = applyToLocalStorage({});
        expect(r.applied).toEqual([]);
    });
});

describe('buildExportFromLocalStorage', () => {
    it('builds a payload with default empty shapes when localStorage is empty', () => {
        const exp = buildExportFromLocalStorage();
        expect(exp.records).toEqual([]);
        expect(exp.watchlist).toEqual([]);
        expect(exp.apiKeys).toEqual({});
        expect(typeof exp.lastModifiedTs).toBe('number');
        expect(exp.meta.preset).toBeDefined();
    });

    it('round-trips through applyToLocalStorage (records + watchlist)', () => {
        localStorage.setItem('ps_records',   JSON.stringify([{ id: '2026-05', payday: 100, fixed: [], dynamic: [] }]));
        localStorage.setItem('ps_watchlist', JSON.stringify(['AAPL', 'NVDA']));
        const exp = buildExportFromLocalStorage();
        localStorage.clear();
        applyToLocalStorage(exp);
        expect(JSON.parse(localStorage.getItem('ps_records') || '[]')).toEqual([{ id: '2026-05', payday: 100, fixed: [], dynamic: [] }]);
        expect(JSON.parse(localStorage.getItem('ps_watchlist') || '[]')).toEqual(['AAPL', 'NVDA']);
    });

    it('encodes API keys via encKey (not plaintext) so a leaked Gist URL is still obfuscated', () => {
        localStorage.setItem('ps_finnhub_key', 'fin_secret_xyz');
        const exp = buildExportFromLocalStorage();
        expect(exp.apiKeys.ps_finnhub_key).not.toBe('fin_secret_xyz');
        expect(decKey(exp.apiKeys.ps_finnhub_key)).toBe('fin_secret_xyz');
    });

    it('splits ps_wl_cache into wl + profile by field type for monolith compat', () => {
        localStorage.setItem('ps_wl_cache', JSON.stringify({
            AAPL: { c: 200, dp: 1.2, name: 'Apple', logo: 'http://x' },
        }));
        const exp = buildExportFromLocalStorage();
        expect(exp.wlCache.wl.AAPL).toEqual({ c: 200, dp: 1.2 });
        expect(exp.wlCache.profile.AAPL).toEqual({ name: 'Apple', logo: 'http://x' });
    });
});

describe('pushToGist — mocked fetch', () => {
    it('PATCHes the gist with an AES-encrypted envelope', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(/** @type {any} */ ({
            ok: true, status: 200, json: () => Promise.resolve({}),
        }));
        const r = await pushToGist('test-token', { records: [], watchlist: [], lastModifiedTs: 1 });
        expect(r.ok).toBe(true);
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        const [url, init] = fetchSpy.mock.calls[0];
        expect(String(url)).toContain(GIST_ID);
        expect(/** @type {any} */ (init).method).toBe('PATCH');
        const body = JSON.parse(/** @type {any} */ (init).body);
        const fileContent = body.files[GIST_FILENAME].content;
        // Encrypted envelope wraps as { enc:1, iv:..., d:... }
        const env = JSON.parse(fileContent);
        expect(env.enc).toBe(1);
        expect(typeof env.iv).toBe('string');
        expect(typeof env.d).toBe('string');
        fetchSpy.mockRestore();
    });

    it('throttles back-to-back calls within GIST_MIN_INTERVAL_MS', async () => {
        const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(/** @type {any} */ ({
            ok: true, status: 200, json: () => Promise.resolve({}),
        }));
        const a = await pushToGist('t', { lastModifiedTs: 1 });
        const b = await pushToGist('t', { lastModifiedTs: 2 });
        expect(a.ok).toBe(true);
        expect(b.throttled).toBe(true);
        // Only the first call hit the network
        expect(fetchSpy).toHaveBeenCalledTimes(1);
        fetchSpy.mockRestore();
    });

    it('rejects 401 with explicit message', async () => {
        vi.spyOn(globalThis, 'fetch').mockResolvedValue(/** @type {any} */ ({ ok: false, status: 401 }));
        await expect(pushToGist('t', { lastModifiedTs: 1 })).rejects.toThrow(/401/);
    });

    it('throws when token missing', async () => {
        await expect(pushToGist('', { lastModifiedTs: 1 })).rejects.toThrow(/No Gist token/);
    });
});
