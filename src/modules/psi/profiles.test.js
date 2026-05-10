import { describe, it, expect, beforeEach } from 'vitest';
import {
    PSI_PROFILES_KEY,
    loadProfiles,
    persistProfiles,
    makeProfileId,
    addProfile,
    deleteProfile,
    findProfile,
} from './profiles.js';

beforeEach(() => {
    localStorage.clear();
});

describe('loadProfiles', () => {
    it('returns [] when key missing', () => {
        expect(loadProfiles()).toEqual([]);
    });

    it('returns the parsed array when key is valid JSON', () => {
        localStorage.setItem(PSI_PROFILES_KEY, JSON.stringify([{ id: 'a', name: 'x', ratio: 1, unit: 'µm', saved: 0 }]));
        const out = loadProfiles();
        expect(out).toHaveLength(1);
        expect(out[0].name).toBe('x');
    });

    it('returns [] when stored value is malformed JSON (lenient)', () => {
        localStorage.setItem(PSI_PROFILES_KEY, '{not-json');
        expect(loadProfiles()).toEqual([]);
    });

    it('returns [] when stored value is JSON but not an array', () => {
        localStorage.setItem(PSI_PROFILES_KEY, JSON.stringify({ id: 'a', name: 'x' }));
        expect(loadProfiles()).toEqual([]);
    });
});

describe('makeProfileId', () => {
    it('produces unique ids on rapid successive calls', () => {
        const ids = new Set();
        for (let i = 0; i < 50; i++) ids.add(makeProfileId());
        expect(ids.size).toBe(50);
    });

    it('starts with the cp_ prefix', () => {
        expect(makeProfileId()).toMatch(/^cp_\d+_[0-9a-z]+$/);
    });
});

describe('addProfile', () => {
    it('appends and persists a valid profile', () => {
        const result = addProfile('10× Olympus', 2.5);
        expect(result).not.toBeNull();
        if (!result) return;
        expect(result.profiles).toHaveLength(1);
        expect(result.added.name).toBe('10× Olympus');
        expect(result.added.ratio).toBe(2.5);
        expect(result.added.unit).toBe('µm');
        expect(loadProfiles()).toHaveLength(1);
    });

    it('trims whitespace from the name', () => {
        const result = addProfile('  20× Lens  ', 5);
        expect(result?.added.name).toBe('20× Lens');
    });

    it('returns null for blank or whitespace-only names', () => {
        expect(addProfile('', 2)).toBeNull();
        expect(addProfile('   ', 2)).toBeNull();
        // Storage left untouched on rejection
        expect(loadProfiles()).toEqual([]);
    });

    it('returns null for non-positive ratios', () => {
        expect(addProfile('A', 0)).toBeNull();
        expect(addProfile('A', -1)).toBeNull();
    });

    it('returns null for non-finite ratios', () => {
        expect(addProfile('A', NaN)).toBeNull();
        expect(addProfile('A', Infinity)).toBeNull();
    });

    it('returns null when name is missing/non-string', () => {
        expect(addProfile(/** @type {any} */ (null), 2)).toBeNull();
        expect(addProfile(/** @type {any} */ (undefined), 2)).toBeNull();
    });

    it('appends to existing profiles without replacing them', () => {
        addProfile('A', 1);
        addProfile('B', 2);
        const all = loadProfiles();
        expect(all.map((p) => p.name)).toEqual(['A', 'B']);
    });
});

describe('deleteProfile', () => {
    it('removes the profile by id', () => {
        const a = addProfile('A', 1)?.added;
        const b = addProfile('B', 2)?.added;
        expect(a && b).toBeTruthy();
        if (!a || !b) return;
        const after = deleteProfile(a.id);
        expect(after).toHaveLength(1);
        expect(after[0].id).toBe(b.id);
        expect(loadProfiles()).toHaveLength(1);
    });

    it('is a no-op when id is unknown', () => {
        addProfile('A', 1);
        const before = loadProfiles();
        const after = deleteProfile('cp_unknown_xxx');
        expect(after).toHaveLength(before.length);
    });

    it('returns [] when storage is already empty', () => {
        expect(deleteProfile('cp_x')).toEqual([]);
    });
});

describe('findProfile', () => {
    it('returns the matching profile', () => {
        const p = addProfile('A', 1.5)?.added;
        expect(p).toBeTruthy();
        if (!p) return;
        expect(findProfile(p.id)?.name).toBe('A');
    });

    it('returns null when no match', () => {
        addProfile('A', 1);
        expect(findProfile('cp_nope')).toBeNull();
    });
});

describe('persistProfiles', () => {
    it('writes JSON-encoded profiles to localStorage', () => {
        const sample = [{ id: 'a', name: 'X', ratio: 3, unit: /** @type {'µm'} */ ('µm'), saved: 1 }];
        persistProfiles(sample);
        expect(JSON.parse(localStorage.getItem(PSI_PROFILES_KEY) || '[]')).toEqual(sample);
    });
});
