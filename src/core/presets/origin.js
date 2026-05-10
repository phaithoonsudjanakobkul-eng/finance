// Origin — PSLink default. Clean, calm, professional.
// 5-axis preset object per Architecture Conventions §1.

/** @typedef {import('./types.js').Preset} Preset */

/** @type {Preset} */
export const originPreset = {
    id:          'origin',
    name:        'PSLink Origin',
    description: 'Clean, calm, professional — the default PSLink look',
    typography: {
        display:  "'Oxanium', 'Inter', 'IBM Plex Sans Thai', system-ui, sans-serif",
        ui:       "'Oxanium', 'Inter', 'IBM Plex Sans Thai', system-ui, sans-serif",
        data:     "'JetBrains Mono', 'SF Mono', 'Menlo', 'Roboto Mono', 'Consolas', monospace",
        sizeXs:   '10px', sizeSm: '12px', sizeBase: '14px',
        sizeMd:   '16px', sizeLg: '20px', sizeXl:   '28px',
    },
    shape: {
        radiusXs:   '2px', radiusSm: '4px', radiusMd: '8px',
        radiusLg:   '12px', radiusPill: '999px',
        borderWidth: '1px',
    },
    icon: { stroke: '2', linecap: 'round', linejoin: 'round' },
    density: {
        space1: '4px',  space2: '8px',  space3: '12px', space4: '16px',
        space5: '20px', space6: '24px', space7: '32px', space8: '40px',
        controlHeightSm: '28px', controlHeightMd: '36px',
    },
    motion: {
        easeSnap:   'cubic-bezier(0.4, 0, 0.2, 1)',
        easeSmooth: 'cubic-bezier(0.25, 0.46, 0.45, 0.94)',
        durFast:    '100ms', durBase: '200ms', durSlow: '300ms',
    },
};
