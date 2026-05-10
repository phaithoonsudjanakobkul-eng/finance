// Preset type contract — shared by every preset module.
// All 5 axes required (typography/shape/icon/density/motion); variant fields
// optional (presets without variants render with their base axes only).

/**
 * @typedef {{
 *   display: string, ui: string, data: string,
 *   sizeXs: string, sizeSm: string, sizeBase: string,
 *   sizeMd: string, sizeLg: string, sizeXl: string,
 * }} Typography
 */

/**
 * @typedef {{
 *   radiusXs: string, radiusSm: string, radiusMd: string,
 *   radiusLg: string, radiusPill: string, borderWidth: string,
 * }} Shape
 */

/** @typedef {{ stroke: string, linecap: string, linejoin: string }} IconStyle */

/**
 * @typedef {{
 *   space1: string, space2: string, space3: string, space4: string,
 *   space5: string, space6: string, space7: string, space8: string,
 *   controlHeightSm: string, controlHeightMd: string,
 * }} Density
 */

/**
 * @typedef {{
 *   easeSnap: string, easeSmooth: string,
 *   durFast: string, durBase: string, durSlow: string,
 * }} Motion
 */

/**
 * @typedef {{
 *   id: string, name: string, description: string,
 *   typography: Typography, shape: Shape, icon: IconStyle,
 *   density: Density, motion: Motion,
 *   effects?: { scanLines?: boolean, textGlow?: boolean, blinkingCursor?: boolean, uppercase?: boolean },
 *   variants?: string[], defaultVariant?: string,
 *   darkOnly?: boolean,
 *   variantColors?: Record<string, { dark?: Record<string, string>, light?: Record<string, string> }>,
 * }} Preset
 */

export {};
