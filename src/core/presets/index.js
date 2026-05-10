// Preset registry + applyPreset dispatcher.
//
// Architecture (CLAUDE.md Coding Rule per "Theming System" section):
//   theme = Preset × Mode × Variant
//     · Preset (personality): origin / phosphor / studio / cinematic
//     · Mode (color scheme):  light (slate) / dark (onyx)
//     · Variant (color flavor within preset): phosphor 4 / studio 1 / cinematic 2
//
// applyPreset writes ALL 5 axis CSS vars on document.documentElement so
// inline-specificity wins over any CSS rule. Variant colors come AFTER axis
// vars and AFTER the active theme's base colors so the most-specific layer wins.
//
// Persistence: per-mode storage (`ps_preset_dark` / `ps_preset_light` +
// `ps_variant_dark` / `ps_variant_light`). Legacy `ps_preset` + `ps_preset_variant`
// kept for export/import backward compat. Mode toggle (sun/moon) loads the
// stored pair for that mode.
//
// darkOnly guard: phosphor + cinematic have no light analogue. Selecting a
// darkOnly preset in light mode auto-flips to dark; legacy
// `ps_preset_light = phosphor` migrates to 'origin' on boot.

import { lsSave, lsGet } from '../storage.js';
import { bus } from '../bus.js';
import { originPreset    } from './origin.js';
import { phosphorPreset  } from './phosphor.js';
import { studioPreset    } from './studio.js';
import { cinematicPreset } from './cinematic.js';

// CSS overrides — body-level effects + global token defaults. Scoped via
// [data-preset="..."] selectors so only the active preset visually applies.
// Module/tab-specific overrides ship with their owning tab in Step 6.
import '../../styles/presets/phosphor.css';
import '../../styles/presets/studio.css';
import '../../styles/presets/cinematic.css';

/** @typedef {import('./types.js').Preset} Preset */

/** @type {Record<string, Preset>} */
export const presets = {
    origin:    originPreset,
    phosphor:  phosphorPreset,
    studio:    studioPreset,
    cinematic: cinematicPreset,
};

// ── State ──────────────────────────────────────────────────────────────

/** @returns {'dark' | 'light'} */
function currentMode() {
    if (typeof document === 'undefined') return 'light';
    return document.documentElement.classList.contains('dark') ? 'dark' : 'light';
}

/** @param {'dark' | 'light'} mode @returns {string} */
function getModePreset(mode) {
    return lsGet('ps_preset_' + mode, '') || lsGet('ps_preset', '') || 'origin';
}

/** @param {'dark' | 'light'} mode @returns {string} */
function getModeVariant(mode) {
    return lsGet('ps_variant_' + mode, '') || lsGet('ps_preset_variant', '') || '';
}

let _activePreset  = '';
let _activeVariant = '';

// ── Apply ──────────────────────────────────────────────────────────────

/**
 * Apply preset + variant to document root.
 * @param {string} id
 * @param {string} [variant]
 * @returns {{ preset: string, variant: string, mode: 'dark' | 'light' } | null}
 */
export function applyPreset(id, variant) {
    const p = presets[id];
    if (!p || typeof document === 'undefined') return null;

    // Dark-only guard — auto-flip + heal light slot to Origin.
    if (p.darkOnly && !document.documentElement.classList.contains('dark')) {
        lsSave('ps_preset_light', 'origin');
        return applyPreset('origin', undefined);
    }

    _activePreset = id;
    const mode = currentMode();
    lsSave('ps_preset_' + mode, id);
    lsSave('ps_preset', id); // export/import backward compat

    const root = document.documentElement;
    root.setAttribute('data-preset', id);

    // Variant resolve
    if (p.variants && p.variants.length) {
        const v = variant
            || lsGet('ps_variant_' + mode, '')
            || lsGet('ps_preset_variant', '')
            || p.defaultVariant
            || p.variants[0];
        const vUse = p.variants.indexOf(v) !== -1 ? v : (p.defaultVariant || p.variants[0]);
        _activeVariant = vUse;
        lsSave('ps_variant_' + mode, vUse);
        lsSave('ps_preset_variant', vUse);
        root.setAttribute('data-variant', vUse);
    } else {
        _activeVariant = '';
        root.removeAttribute('data-variant');
    }

    // Typography (new tokens + legacy aliases --font-main / --font-mono)
    root.style.setProperty('--font-display',   p.typography.display);
    root.style.setProperty('--font-ui',        p.typography.ui);
    root.style.setProperty('--font-data',      p.typography.data);
    root.style.setProperty('--font-main',      p.typography.ui);
    root.style.setProperty('--font-mono',      p.typography.data);
    root.style.setProperty('--font-size-xs',   p.typography.sizeXs);
    root.style.setProperty('--font-size-sm',   p.typography.sizeSm);
    root.style.setProperty('--font-size-base', p.typography.sizeBase);
    root.style.setProperty('--font-size-md',   p.typography.sizeMd);
    root.style.setProperty('--font-size-lg',   p.typography.sizeLg);
    root.style.setProperty('--font-size-xl',   p.typography.sizeXl);

    // Shape
    root.style.setProperty('--radius-xs',    p.shape.radiusXs);
    root.style.setProperty('--radius-sm',    p.shape.radiusSm);
    root.style.setProperty('--radius-md',    p.shape.radiusMd);
    root.style.setProperty('--radius-lg',    p.shape.radiusLg);
    root.style.setProperty('--radius-pill',  p.shape.radiusPill);
    root.style.setProperty('--border-width', p.shape.borderWidth);

    // Icon
    root.style.setProperty('--icon-stroke',   p.icon.stroke);
    root.style.setProperty('--icon-linecap',  p.icon.linecap);
    root.style.setProperty('--icon-linejoin', p.icon.linejoin);

    // Density
    for (let i = 1; i <= 8; i++) {
        root.style.setProperty('--space-' + i, /** @type {any} */ (p.density)['space' + i]);
    }
    root.style.setProperty('--control-height-sm', p.density.controlHeightSm);
    root.style.setProperty('--control-height-md', p.density.controlHeightMd);

    // Motion
    root.style.setProperty('--ease-snap',   p.motion.easeSnap);
    root.style.setProperty('--ease-smooth', p.motion.easeSmooth);
    root.style.setProperty('--dur-fast',    p.motion.durFast);
    root.style.setProperty('--dur-base',    p.motion.durBase);
    root.style.setProperty('--dur-slow',    p.motion.durSlow);

    // Variant colors — applied LAST so they win specificity over base theme vars.
    if (p.variantColors && _activeVariant) {
        const isDark = root.classList.contains('dark');
        const slot = p.variantColors[_activeVariant] && p.variantColors[_activeVariant][isDark ? 'dark' : 'light'];
        if (slot) {
            for (const key in slot) {
                root.style.setProperty(key, slot[key]);
            }
        }
    }

    bus.emit('presets:applied', { preset: id, variant: _activeVariant, mode });
    return { preset: id, variant: _activeVariant, mode };
}

/**
 * Variant-only switch — keeps preset, updates data-variant.
 * @param {string} variant
 */
export function applyVariant(variant) {
    if (!_activePreset) return null;
    return applyPreset(_activePreset, variant);
}

/** @returns {{ preset: string, variant: string }} */
export function getActive() {
    return { preset: _activePreset, variant: _activeVariant };
}

/** @returns {string[]} */
export function listPresets() { return Object.keys(presets); }

/**
 * Boot helper — restore active preset+variant from per-mode storage.
 * Pass `prefersDark` from the boot script (avoids reading localStorage twice).
 * @param {boolean} [prefersDark]
 */
export function restoreActive(prefersDark) {
    if (typeof document === 'undefined') return null;
    const mode = (prefersDark || document.documentElement.classList.contains('dark')) ? 'dark' : 'light';
    const id = getModePreset(mode);
    const variant = getModeVariant(mode);
    return applyPreset(id, variant || undefined);
}

// Re-export for downstream consumers
export { originPreset, phosphorPreset, studioPreset, cinematicPreset };
