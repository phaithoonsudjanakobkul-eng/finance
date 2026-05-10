// Cinematic — photo-led · frosted glass · ambient hero.
// Dashboard restructured around active Muse media. DARK ONLY.
// 2 variants: photo (warm sunset) / aurora (cool Aero blue).

/** @typedef {import('./types.js').Preset} Preset */

/** @type {Preset} */
export const cinematicPreset = {
    id:          'cinematic',
    name:        'Cinematic',
    description: 'Photo-led · frosted glass · ambient hero — restructured Dashboard around active Muse',
    typography: {
        display:  "'Fraunces', Georgia, 'IBM Plex Sans Thai', serif",
        ui:       "'Inter Tight', 'Inter', 'IBM Plex Sans Thai', system-ui, sans-serif",
        data:     "'JetBrains Mono', 'SF Mono', 'Menlo', 'Roboto Mono', monospace",
        sizeXs:   '10px', sizeSm: '12px', sizeBase: '14px',
        sizeMd:   '16px', sizeLg: '20px', sizeXl:   '28px',
    },
    shape: {
        radiusXs:   '4px', radiusSm: '6px', radiusMd: '10px',
        radiusLg:   '14px', radiusPill: '999px',
        borderWidth: '1px',
    },
    icon: { stroke: '1.5', linecap: 'round', linejoin: 'round' },
    density: {
        space1: '4px',  space2: '8px',  space3: '12px', space4: '16px',
        space5: '20px', space6: '24px', space7: '32px', space8: '40px',
        controlHeightSm: '28px', controlHeightMd: '36px',
    },
    motion: {
        easeSnap:   'cubic-bezier(0.4, 0, 0.2, 1)',
        easeSmooth: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        durFast:    '150ms', durBase: '250ms', durSlow: '600ms',
    },
    variants: ['photo', 'aurora'],
    defaultVariant: 'photo',
    darkOnly: true,
    variantColors: {
        // Photo — warm sunset cinematic (original)
        photo: {
            dark: {
                '--bg-dark':'#0A0810','--bg-main':'#0A0810',
                '--bg-card':'rgba(245, 241, 232, 0.06)','--bg-card2':'rgba(20, 12, 16, 0.55)',
                '--border':'rgba(245, 241, 232, 0.13)',
                '--text-primary':'#F5F1E8','--text-secondary':'rgba(245, 241, 232, 0.7)','--text-dim':'rgba(245, 241, 232, 0.5)',
                '--accent':'#E8855E','--accent2':'#F0A37D',
                '--up':'#7CC57C','--down':'#E8855E','--danger':'#E8855E','--warning':'#F0A37D',
                '--wl-up':'#7CC57C','--wl-dn':'#E8855E',
                '--qc-up':'#7CC57C','--qc-dn':'#E8855E',
                '--chart-up':'#7CC57C','--chart-dn':'#E8855E',
                '--cine-glass':'rgba(245, 241, 232, 0.06)',
                '--cine-glass-strong':'rgba(20, 12, 16, 0.55)',
                '--cine-glass-border':'rgba(245, 241, 232, 0.13)',
                '--cine-glass-border-strong':'rgba(245, 241, 232, 0.18)',
                '--cine-inner-highlight':'inset 0 1px 0 rgba(255, 255, 255, 0.06)',
                '--cine-bg-warm':'hsl(15, 60%, 35%)',
                '--cine-bg-cool':'rgba(45, 30, 80, 0.45)',
                '--cine-bg-base':'#1A0E12',
                '--cine-bg-base-mid':'#221218',
                '--cine-fg-rgb':'245 241 232',
            },
        },
        // Aurora — cool Windows 7 Aero / Liquid Glass cyan-blue
        aurora: {
            dark: {
                '--bg-dark':'#08101F','--bg-main':'#08101F',
                '--bg-card':'rgba(180, 220, 240, 0.06)','--bg-card2':'rgba(8, 16, 30, 0.55)',
                '--border':'rgba(180, 220, 240, 0.13)',
                '--text-primary':'#E8F1FA','--text-secondary':'rgba(232, 241, 250, 0.7)','--text-dim':'rgba(232, 241, 250, 0.5)',
                '--accent':'#4FA9D8','--accent2':'#7DBEDF',
                '--up':'#7CC57C','--down':'#D94A5E','--danger':'#D94A5E','--warning':'#E0A85A',
                '--wl-up':'#7CC57C','--wl-dn':'#D94A5E',
                '--qc-up':'#7CC57C','--qc-dn':'#D94A5E',
                '--chart-up':'#7CC57C','--chart-dn':'#D94A5E',
                '--cine-glass':'rgba(180, 220, 240, 0.06)',
                '--cine-glass-strong':'rgba(8, 16, 30, 0.55)',
                '--cine-glass-border':'rgba(180, 220, 240, 0.13)',
                '--cine-glass-border-strong':'rgba(180, 220, 240, 0.18)',
                '--cine-inner-highlight':'inset 0 1px 0 rgba(220, 240, 255, 0.08)',
                '--cine-bg-warm':'hsl(200, 55%, 38%)',
                '--cine-bg-cool':'rgba(60, 140, 130, 0.4)',
                '--cine-bg-base':'#0A1530',
                '--cine-bg-base-mid':'#0E1A38',
                '--cine-fg-rgb':'232 241 250',
            },
        },
    },
};
