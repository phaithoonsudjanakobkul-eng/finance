// Best-effort restore of the full-res avatar from R2 to IDB.
//
// Fresh-device path: Gist pull brings the 128 px thumbnail to ps_avatar
// (nav + dashboard render instantly), but the full-res JPEG only exists
// on R2 in encrypted form. Once R2 + Gist tokens land in localStorage
// we can pull the encrypted bytes, decrypt, and cache to IDB so the next
// time the profile-edit modal opens it has the full-res available
// without going to the network.
//
// All paths swallow errors — this is purely opportunistic.

import { idbGet, idbPut } from '../../core/idb.js';
import { r2DownloadDecrypted, isR2Configured } from '../../core/r2.js';

/**
 * If IDB avatar:full is empty and R2 is configured, pull it down.
 * @returns {Promise<{ restored: boolean, reason?: string }>}
 */
export async function maybeRestoreAvatarFromR2() {
    if (!isR2Configured()) return { restored: false, reason: 'no-config' };
    const cached = await idbGet('avatar:full');
    if (cached) return { restored: false, reason: 'already-cached' };
    const blob = await r2DownloadDecrypted('profile/avatar.enc.jpg', 'image/jpeg');
    if (!blob) return { restored: false, reason: 'r2-miss' };
    const ok = await idbPut('avatar:full', blob);
    return { restored: !!ok };
}
