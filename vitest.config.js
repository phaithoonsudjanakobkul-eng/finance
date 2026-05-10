// Vitest config — happy-dom environment so DOM globals (document,
// localStorage, classList) work without bringing in full jsdom.
//
// `include` scoped to src/**/*.test.js so monolith index.html and
// pslink-* worker dirs aren't scanned.

import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'happy-dom',
        include: ['src/**/*.test.js'],
        globals: false,
        css: false,
    },
});
