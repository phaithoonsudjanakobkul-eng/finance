// Studio Warm — editorial · refined · cream + terracotta.
// Print-magazine that renders numbers. Light + dark both supported.
// 1 variant: warm.

/** @typedef {import('./types.js').Preset} Preset */

/** @type {Preset} */
export const studioPreset = {
    id:          'studio',
    name:        'Studio Warm',
    description: 'Editorial · refined · cream + terracotta — print magazine that renders numbers',
    typography: {
        display:  "'Fraunces', 'Cormorant Garamond', Georgia, 'IBM Plex Sans Thai', serif",
        ui:       "'Bricolage Grotesque', 'Inter', 'IBM Plex Sans Thai', system-ui, sans-serif",
        data:     "'JetBrains Mono', 'SF Mono', 'Menlo', 'Roboto Mono', monospace",
        sizeXs:   '10px', sizeSm: '12px', sizeBase: '14px',
        sizeMd:   '16px', sizeLg: '20px', sizeXl:   '28px',
    },
    shape: {
        radiusXs:   '2px', radiusSm: '4px', radiusMd: '8px',
        radiusLg:   '12px', radiusPill: '999px',
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
        durFast:    '120ms', durBase: '220ms', durSlow: '320ms',
    },
    variants: ['warm'],
    defaultVariant: 'warm',
    variantColors: {
        warm: {
            light: {
                '--bg-dark':'#FAF7F0','--bg-main':'#FAF7F0','--bg-card':'#FFFFFF','--bg-card2':'#F5F1E8',
                '--border':'#E5DFD3',
                '--text-primary':'#1F1B17','--text-secondary':'#7A6F60','--text-dim':'#A89D8A',
                '--accent':'#C75D3A','--accent2':'#993C1D',
                '--up':'#3B6D11','--down':'#993C1D','--danger':'#993C1D','--warning':'#C75D3A',
                '--wl-up':'#3B6D11','--wl-dn':'#993C1D',
                '--qc-up':'#3B6D11','--qc-dn':'#993C1D',
                '--chart-up':'#3B6D11','--chart-dn':'#993C1D',
            },
            dark: {
                '--bg-dark':'#1A1612','--bg-main':'#1A1612','--bg-card':'#221D18','--bg-card2':'#2B251F',
                '--border':'#332D26',
                '--text-primary':'#F5F1E8','--text-secondary':'#A89D8A','--text-dim':'#6B6155',
                '--accent':'#E27A52','--accent2':'#C75D3A',
                '--up':'#86C786','--down':'#E27A52','--danger':'#E27A52','--warning':'#FFB76A',
                '--wl-up':'#86C786','--wl-dn':'#E27A52',
                '--qc-up':'#86C786','--qc-dn':'#E27A52',
                '--chart-up':'#86C786','--chart-dn':'#E27A52',
            },
        },
    },
};
