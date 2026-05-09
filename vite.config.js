// PSLink — Vite config (Session 2 scaffold, 2026-05-09)
//
// Strategy: minimal-impact Phase A. Vite serves the EXISTING root index.html as
// the entry point (no file moves yet). Inline scripts/styles stay where they
// are — Vite handles HMR for the whole HTML on save. Phase B (Session 3) will
// extract scripts to src/main.js and split modules per Architecture conventions.
//
// Dual-deploy intent:
//   - Production (root index.html on GitHub Pages) keeps working unchanged.
//     dev-server.js still serves it via HTTPS + auto-deploys on save.
//   - `npm run dev:vite` opens Vite dev server on port 5173 with HMR for
//     parallel testing. `npm run build:vite` produces a Vite-bundled dist/
//     for eventual cutover.
//
// Folder targets pre-created under src/ are EMPTY in Session 2 — they exist
// so future module extractions land in the right place per the conventions
// locked in MIGRATION-PLAN.md (preset/tab/module/widget patterns).

import { defineConfig } from 'vite';
// VitePWA disabled in Session 3a — caused html-proxy build error with multi-entry
// (tries to extract inline CSS from src/index.html even with disable:true).
// Phase 4 will reintroduce PWA via vite-plugin-pwa with proper SW cutover plan
// (per critical gap #2 in MIGRATION-PLAN.md).
// import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  // Project root = repo root (where existing index.html lives).
  root: '.',

  // GitHub Pages publishes from /pslink/ subpath in production.
  // Dev server uses '/' so HMR works on localhost without prefix issues.
  // (process.env access guarded via globalThis to avoid tsc Node-types dep.)
  base: (/** @type {any} */ (globalThis)).process?.env?.NODE_ENV === 'production' ? '/pslink/' : '/',

  server: {
    port: 5173,
    open: false,            // dev-server.js opens browser; avoid double-open
    strictPort: false,
  },

  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'es2020',       // matches PSLink browser support (Chromium 88+, Safari 14+)
    sourcemap: true,        // ship source maps for prod debugging until Phase 4 review
    rollupOptions: {
      // Multi-entry build (Session 3a):
      //   - index.html      → root production monolith (unchanged)
      //   - src/index.html  → Vite-native v2 shell (proof + cutover target)
      // Output structure: dist/index.html + dist/src/index.html + dist/assets/*
      // Lazy modules (modules/psai etc.) become their own chunks via dynamic import().
      input: {
        prod: 'index.html',
        v2:   'src/index.html',
      },
    },
    // PSLink uses many CDN scripts inline. Don't try to inline external assets
    // that aren't bundled — let them stay as <script src="https://..."> in the
    // shipped HTML.
    assetsInlineLimit: 0,
  },

  // Treat OpenCV WASM, model files, etc. as external assets — don't try to import
  optimizeDeps: {
    exclude: [
      // Future: list npm-imported native deps here once we add them in Session 3
    ],
  },

  plugins: [
    // Phase 4 will add VitePWA here — see import comment above.
  ],
});
