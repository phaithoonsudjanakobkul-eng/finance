// Playwright config — minimal smoke layer over the Vite preview build.
//
// Run via `npm run e2e` (locally) or wire into CI as a separate job. Playwright
// auto-spawns `vite preview` then runs specs in headless chromium against it.
// Tests live under e2e/ and are kept fast: each test should finish in < 5s
// so the suite catches regressions without slowing iteration.

import { defineConfig, devices } from '@playwright/test';

const PORT = 5173; // vite dev — base=/ in dev so /src/ resolves correctly

export default defineConfig({
    testDir: './e2e',
    timeout: 30_000,
    expect: { timeout: 5_000 },
    fullyParallel: true,
    retries: 0,
    workers: 1,
    reporter: 'list',

    use: {
        baseURL: `http://localhost:${PORT}`,
        trace: 'retain-on-failure',
        actionTimeout: 5_000,
    },

    projects: [
        { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    ],

    webServer: {
        // Use dev server (base=/) so /src/ resolves directly. Preview build
        // bakes base=/pslink/ into asset URLs and would 404 in tests.
        command: 'npm run dev:vite -- --port ' + PORT + ' --strictPort',
        url: `http://localhost:${PORT}/src/`,
        reuseExistingServer: true,
        timeout: 90_000,
        stdout: 'ignore',
        stderr: 'pipe',
    },
});
