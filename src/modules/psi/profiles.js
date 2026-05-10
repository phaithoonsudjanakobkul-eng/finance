// PSI calibration profile management — pure helpers extracted for tests.
//
// A "profile" pairs a human-readable name (e.g. "10× objective on Olympus
// BX53") with a measured `ratio` (pixels per micron). Users save profiles
// after a successful line-tool calibration and switch between them
// without re-measuring.
//
// Storage shape matches the monolith — same `pslink_calib_profiles` key
// and same record fields — so v2 inherits any profiles the user already
// built in v1 without a migration step.

import { lsSave, lsGetJson } from '../../core/storage.js';

export const PSI_PROFILES_KEY      = 'pslink_calib_profiles';
export const PSI_LAST_PROFILE_KEY  = 'pslink_calib_last_profile';

/**
 * @typedef {{
 *   id: string,
 *   name: string,
 *   ratio: number,
 *   unit: 'µm',
 *   saved: number,
 * }} PsiCalibProfile
 */

/**
 * Load profiles from localStorage. Returns [] when absent or malformed
 * (matches monolith's lenient JSON.parse path) so the dropdown never
 * crashes on a corrupt entry.
 *
 * @returns {PsiCalibProfile[]}
 */
export function loadProfiles() {
    const raw = lsGetJson(PSI_PROFILES_KEY, /** @type {any} */ ([]));
    return Array.isArray(raw) ? raw : [];
}

/** @param {PsiCalibProfile[]} profiles */
export function persistProfiles(profiles) {
    lsSave(PSI_PROFILES_KEY, JSON.stringify(profiles));
}

/**
 * Generate a stable unique id. Profile ids are timestamp-based + a tiny
 * random suffix so two saves in the same millisecond don't collide.
 * @returns {string}
 */
export function makeProfileId() {
    return 'cp_' + Date.now() + '_' + Math.floor(Math.random() * 1e6).toString(36);
}

/**
 * Append a new profile to storage and return the updated list. Trims and
 * validates the name; rejects non-finite or non-positive ratios. Returns
 * `null` when inputs are invalid so the caller can surface an error
 * instead of writing junk.
 *
 * @param {string} name
 * @param {number} ratio
 * @returns {{ profiles: PsiCalibProfile[], added: PsiCalibProfile } | null}
 */
export function addProfile(name, ratio) {
    const trimmed = String(name == null ? '' : name).trim();
    if (!trimmed) return null;
    if (typeof ratio !== 'number' || !isFinite(ratio) || ratio <= 0) return null;
    /** @type {PsiCalibProfile} */
    const next = {
        id: makeProfileId(),
        name: trimmed,
        ratio,
        unit: 'µm',
        saved: Date.now(),
    };
    const profiles = loadProfiles().concat([next]);
    persistProfiles(profiles);
    return { profiles, added: next };
}

/**
 * Remove a profile by id. Returns the updated list (unchanged when no
 * match — caller can compare lengths to detect a no-op).
 *
 * @param {string} id
 * @returns {PsiCalibProfile[]}
 */
export function deleteProfile(id) {
    const before = loadProfiles();
    const after = before.filter((p) => p.id !== id);
    if (after.length !== before.length) persistProfiles(after);
    return after;
}

/**
 * @param {string} id
 * @returns {PsiCalibProfile | null}
 */
export function findProfile(id) {
    return loadProfiles().find((p) => p.id === id) || null;
}
