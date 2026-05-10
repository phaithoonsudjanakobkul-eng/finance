import { describe, it, expect, beforeEach } from 'vitest';
import {
    PSUP_MODEL_REGISTRY,
    TIER_PRESETS,
    PSUP_MEM_LIMIT_MB,
    PSUP_MEM_WARN_MB,
    PSUP_MEM_CAUTION_MB,
    getCurrentModelId,
    setCurrentModel,
    getSettings,
    updateSettings,
} from './index.js';

beforeEach(() => {
    localStorage.clear();
});

describe('PSUP_MODEL_REGISTRY', () => {
    it('exposes the 3 known model ids', () => {
        const ids = Object.keys(PSUP_MODEL_REGISTRY).sort();
        expect(ids).toEqual(['bhi-dat2-real', 'ultrasharp-v1', 'ultrasharp-v2']);
    });

    it('every model declares the expected fields', () => {
        for (const id of Object.keys(PSUP_MODEL_REGISTRY)) {
            const m = PSUP_MODEL_REGISTRY[id];
            expect(typeof m.key).toBe('string');
            expect(typeof m.file).toBe('string');
            expect(typeof m.tileSize).toBe('number');
            expect(typeof m.arch).toBe('string');
            expect(typeof m.label).toBe('string');
            expect(typeof m.tierMul).toBe('number');
            expect(m.tierMul).toBeGreaterThan(0);
        }
    });

    it('ESRGAN model uses tile size 192 + tierMul 1.0', () => {
        const m = PSUP_MODEL_REGISTRY['ultrasharp-v1'];
        expect(m.arch).toBe('ESRGAN');
        expect(m.tileSize).toBe(192);
        expect(m.tierMul).toBe(1.0);
    });

    it('DAT2 models use tile size 128 + tierMul ≤ 0.5 (soften post-process)', () => {
        const v2  = PSUP_MODEL_REGISTRY['ultrasharp-v2'];
        const bhi = PSUP_MODEL_REGISTRY['bhi-dat2-real'];
        expect(v2.arch).toBe('DAT2');
        expect(v2.tileSize).toBe(128);
        expect(v2.tierMul).toBeLessThanOrEqual(0.5);
        expect(bhi.arch).toBe('DAT2');
        expect(bhi.tileSize).toBe(128);
        expect(bhi.tierMul).toBeLessThanOrEqual(0.5);
    });

    it('models with public CDN have a cdnUrl; BHI does not (R2-only)', () => {
        expect(typeof PSUP_MODEL_REGISTRY['ultrasharp-v1'].cdnUrl).toBe('string');
        expect(typeof PSUP_MODEL_REGISTRY['ultrasharp-v2'].cdnUrl).toBe('string');
        expect(PSUP_MODEL_REGISTRY['bhi-dat2-real'].cdnUrl).toBeUndefined();
    });
});

describe('TIER_PRESETS', () => {
    it('exposes fast / balanced / maximum tiers', () => {
        expect(Object.keys(TIER_PRESETS).sort()).toEqual(['balanced', 'fast', 'maximum']);
    });

    it('every tier has all 6 expected keys', () => {
        const requiredKeys = ['hf1', 'hf2', 'grain', 'sharpen', 'contrast', 'sat'];
        for (const tier of Object.keys(TIER_PRESETS)) {
            const t = TIER_PRESETS[tier];
            for (const k of requiredKeys) expect(typeof t[k]).toBe('number');
        }
    });

    it('Fast tier zeroes all additive params (model-only output)', () => {
        const f = TIER_PRESETS.fast;
        expect(f.hf1).toBe(0);
        expect(f.hf2).toBe(0);
        expect(f.grain).toBe(0);
        expect(f.sharpen).toBe(0);
        expect(f.contrast).toBe(1);
        expect(f.sat).toBe(1);
    });

    it('Maximum tier values exceed Balanced', () => {
        expect(TIER_PRESETS.maximum.hf1).toBeGreaterThan(TIER_PRESETS.balanced.hf1);
        expect(TIER_PRESETS.maximum.grain).toBeGreaterThan(TIER_PRESETS.balanced.grain);
        expect(TIER_PRESETS.maximum.sharpen).toBeGreaterThan(TIER_PRESETS.balanced.sharpen);
    });
});

describe('memory limit constants', () => {
    it('limit > warn > caution (descending threshold)', () => {
        expect(PSUP_MEM_LIMIT_MB).toBeGreaterThan(PSUP_MEM_WARN_MB);
        expect(PSUP_MEM_WARN_MB).toBeGreaterThan(PSUP_MEM_CAUTION_MB);
    });

    it('limit matches the documented 600 MB hard refuse', () => {
        expect(PSUP_MEM_LIMIT_MB).toBe(600);
    });
});

describe('getCurrentModelId / setCurrentModel', () => {
    it('returns a registry-valid id by default', () => {
        const id = getCurrentModelId();
        expect(PSUP_MODEL_REGISTRY[id]).toBeDefined();
    });

    it('setCurrentModel switches + persists to localStorage', () => {
        setCurrentModel('ultrasharp-v2');
        expect(getCurrentModelId()).toBe('ultrasharp-v2');
        // Stored as a raw string (not JSON-encoded) — matches lsSave call
        expect(localStorage.getItem('ps_psup_model')).toBe('ultrasharp-v2');
    });

    it('setCurrentModel rejects unknown ids (no-op)', () => {
        const before = getCurrentModelId();
        setCurrentModel('not-a-real-model');
        expect(getCurrentModelId()).toBe(before);
    });
});

describe('getSettings / updateSettings', () => {
    it('returns the current settings object', () => {
        const s = getSettings();
        expect(typeof s.tier).toBe('string');
        expect(typeof s.scale).toBe('number');
    });

    it('updateSettings patches + persists', () => {
        updateSettings({ tier: 'maximum' });
        expect(getSettings().tier).toBe('maximum');
        const raw = localStorage.getItem('ps_psup_settings');
        const parsed = JSON.parse(raw || '{}');
        expect(parsed.tier).toBe('maximum');
    });

    it('updateSettings preserves untouched fields', () => {
        updateSettings({ tier: 'fast' });
        const before = { ...getSettings() };
        updateSettings({ scale: 2 });
        const after = getSettings();
        expect(after.scale).toBe(2);
        expect(after.tier).toBe(before.tier); // unchanged
    });
});
