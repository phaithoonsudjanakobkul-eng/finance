// PSUP tier attenuation math — pure helper extracted for tests.
//
// `attenuateTier(preset, tierMul)` applies a per-model `tierMul` factor
// to a TIER_PRESET so DAT2 models (sharper baseline) get a softer
// post-process than ESRGAN (tierMul 1.0). Additive params (hf1/hf2/
// grain/sharpen) scale linearly; multiplicative params (contrast/sat
// around 1.0) get the offset from 1 scaled.
//
//   contrast: 1.04 (Balanced) × 0.4 (BHI) → 1 + (1.04 - 1) * 0.4 = 1.016
//   sharpen : 0.18 (Balanced) × 0.4 (BHI) → 0.072
//
// The worker currently computes this inline (it's a single-thread
// blob, can't import). Keeping the math here lets us pin the contract
// with tests so a worker-side change is paired with a test update.

/** @typedef {{ hf1: number, hf2: number, grain: number, sharpen: number, contrast: number, sat: number }} TierPreset */

/**
 * Apply `tierMul` to a TIER_PRESET.
 *
 * @param {TierPreset} preset — one of TIER_PRESETS.fast/balanced/maximum
 * @param {number} tierMul — per-model attenuation; 1.0 = full strength, 0 = clean
 * @returns {TierPreset}
 */
export function attenuateTier(preset, tierMul) {
    const mul = (typeof tierMul === 'number' && isFinite(tierMul) && tierMul >= 0) ? tierMul : 1.0;
    return {
        hf1:      preset.hf1 * mul,
        hf2:      preset.hf2 * mul,
        grain:    preset.grain * mul,
        sharpen:  preset.sharpen * mul,
        contrast: 1 + (preset.contrast - 1) * mul,
        sat:      1 + (preset.sat - 1) * mul,
    };
}
