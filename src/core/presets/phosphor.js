// Phosphor — Matrix/hacker aesthetic. Scan lines, text glow, blinking cursor,
// uppercase. DARK ONLY (phosphor-on-black DNA has no light analogue —
// applyPreset auto-flips to dark + heals legacy light slot to Origin).
// 4 variants: classic / crt / modern / muted (default).

/** @typedef {import('./types.js').Preset} Preset */

/** @type {Preset} */
export const phosphorPreset = {
    id:          'phosphor',
    name:        'Phosphor',
    description: 'Matrix/hacker aesthetic — scan lines, text glow, blinking cursor, uppercase',
    typography: {
        display:  "'VT323', 'Share Tech Mono', monospace",
        ui:       "'Share Tech Mono', 'Consolas', monospace",
        data:     "'Share Tech Mono', 'Consolas', monospace",
        sizeXs:   '10px', sizeSm: '12px', sizeBase: '14px',
        sizeMd:   '16px', sizeLg: '20px', sizeXl:   '28px',
    },
    shape: {
        radiusXs:  '0', radiusSm: '0', radiusMd: '0',
        radiusLg:  '0', radiusPill: '0',
        borderWidth: '1px',
    },
    icon: { stroke: '2', linecap: 'square', linejoin: 'miter' },
    density: {
        space1: '4px',  space2: '8px',  space3: '12px', space4: '16px',
        space5: '20px', space6: '24px', space7: '32px', space8: '40px',
        controlHeightSm: '28px', controlHeightMd: '36px',
    },
    motion: {
        easeSnap:   'steps(2, end)',
        easeSmooth: 'steps(4, end)',
        durFast:    '60ms', durBase: '100ms', durSlow: '160ms',
    },
    effects: {
        scanLines: true, textGlow: true, blinkingCursor: true, uppercase: true,
    },
    variants: ['classic', 'crt', 'modern', 'muted'],
    defaultVariant: 'muted',
    darkOnly: true,
    variantColors: {
        classic: {
            dark: {
                '--bg-dark':'#000000','--bg-main':'#000000','--bg-card':'#000000','--bg-card2':'#0a0a0a',
                '--border':'#003b14',
                '--text-primary':'#00ff41','--text-secondary':'#00b82e','--text-dim':'#006b1a',
                '--accent':'#00ff41','--accent2':'#00cc33',
                '--up':'#00ff41','--down':'#ff003c','--danger':'#ff003c','--warning':'#ffb000',
                '--wl-up':'#00ff41','--wl-dn':'#ff003c',
                '--qc-up':'#00ff41','--qc-dn':'#ff003c',
                '--chart-up':'#00ff41','--chart-dn':'#ff003c',
                '--phosphor-glow':'0 0 4px color-mix(in srgb, currentColor 66%, transparent), 0 0 8px color-mix(in srgb, currentColor 33%, transparent)',
            },
        },
        crt: {
            dark: {
                '--bg-dark':'#000500','--bg-main':'#000500','--bg-card':'#000a03','--bg-card2':'#021205',
                '--border':'#1a4d20',
                '--text-primary':'#39ff14','--text-secondary':'#2ecc38','--text-dim':'#1a7a1a',
                '--accent':'#39ff14','--accent2':'#2bcc0f',
                '--up':'#39ff14','--down':'#ff4d4d','--danger':'#ff4d4d','--warning':'#ffaa00',
                '--wl-up':'#39ff14','--wl-dn':'#ff4d4d',
                '--qc-up':'#39ff14','--qc-dn':'#ff4d4d',
                '--chart-up':'#39ff14','--chart-dn':'#ff4d4d',
                '--phosphor-glow':'0 0 6px color-mix(in srgb, currentColor 88%, transparent), 0 0 12px color-mix(in srgb, currentColor 44%, transparent), 0 0 20px color-mix(in srgb, currentColor 22%, transparent)',
            },
        },
        modern: {
            dark: {
                '--bg-dark':'#0a0a0a','--bg-main':'#0a0a0a','--bg-card':'#0d0d0d','--bg-card2':'#141414',
                '--border':'#1f3a2a',
                '--text-primary':'#00ff9d','--text-secondary':'#33cc85','--text-dim':'#2d5a43',
                '--accent':'#00ff9d','--accent2':'#00cc7f',
                '--up':'#00ff9d','--down':'#ff5577','--danger':'#ff5577','--warning':'#ffc040',
                '--wl-up':'#00ff9d','--wl-dn':'#ff5577',
                '--qc-up':'#00ff9d','--qc-dn':'#ff5577',
                '--chart-up':'#00ff9d','--chart-dn':'#ff5577',
                '--phosphor-glow':'0 0 3px color-mix(in srgb, currentColor 33%, transparent)',
            },
        },
        muted: {
            dark: {
                '--bg-dark':'#0c0c0c','--bg-main':'#0c0c0c','--bg-card':'#101010','--bg-card2':'#161616',
                '--border':'#1f3d24',
                '--text-primary':'#4ade80','--text-secondary':'#3d9e64','--text-dim':'#2a5e40',
                '--accent':'#4ade80','--accent2':'#3dbf6a',
                '--up':'#4ade80','--down':'#f87171','--danger':'#f87171','--warning':'#fbbf24',
                '--wl-up':'#4ade80','--wl-dn':'#f87171',
                '--qc-up':'#4ade80','--qc-dn':'#f87171',
                '--chart-up':'#4ade80','--chart-dn':'#f87171',
                '--phosphor-glow':'0 0 2px color-mix(in srgb, currentColor 28%, transparent)',
            },
        },
    },
};
