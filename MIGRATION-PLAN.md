# PSLink — Vite Migration Plan

**Decision committed**: 2026-05-08
**Target completion**: before 2026-05-25 (before file hits 70k lines)
**Owner**: Phaithoon (พี่เก่ง) + Claude (จูน)

This document is the single source of truth for migrating PSLink from a single 57.8k-line `index.html` to a modern Vite + dynamic-import architecture. It is OneDrive-synced so it stays in sync between work laptop and personal laptop.

---

## Why this migration is happening now

| Metric | 2026-04-24 | 2026-05-08 | Δ |
|---|---|---|---|
| Lines | 42,000 | 57,851 | +15,851 (+1.1k/day) |

**Forecast at current pace:**
- 70k → ~11 days (mid-May 2026)
- 100k → ~38 days (mid-June 2026)
- 120k (Claude effectiveness drops 50%) → ~56 days (early July 2026)

The original "lazy `<script>` injection" plan would buy 2-3 months but still requires a Vite migration at 100k. Doing it twice (lazy-script then Vite) wastes 5-6 sessions vs doing Vite once (3-4 sessions). **GitHub Actions build-on-push** removes the "no build step" objection by preserving the `git push` → live deploy UX.

---

## Module inventory (verified 2026-05-08)

Modules are **physically interleaved** in `index.html` — they were added organically over time, not in contiguous blocks. Migration uses **prefix-grep** as source of truth, not physical line ranges.

| Module | Prefix | Lines (span) | Fns | CDN dep | Migration target |
|---|---|---|---|---|---|
| PS SpecFlow | `_psf` | 6,079 | 60 | docx.js | `src/modules/psf.js` |
| Muse | `_muse` | 5,040 | 251 | — | **STAYS IN SHELL** |
| PS Micro Imaging | `_psi` | 4,695 | 195 | OpenCV.js (10MB WASM) | `src/modules/psi.js` |
| PS Quotation | `_psq` | 4,227 | 163 | SheetJS | `src/modules/psq.js` |
| PS Upscaler | `_psup` | 2,126 | 39 | ORT-Web | `src/modules/psup.js` |
| PS Email Composer | `_psec` | 1,495 | 69 | — | `src/modules/psec.js` |
| PS Background Remover | `_psbgr` | 1,010 | 48 | transformers.js | `src/modules/psbgr.js` |
| PS AI Studio | `_psai` | 909 | 34 | — | `src/modules/psai.js` |
| **Lazy-loaded total** | | **~20.5k (~35%)** | | | |
| Shell remainder | | ~37k (~65%) | | | `src/main.js` |

**Stays in shell** (NOT lazy-loaded):
- Muse playlist — renders on Dashboard (default tab); lazy-load would break first paint
- Watchlist CORE (`_handleTrade`, rAF tick pipeline, `_wsBackgroundMode`, `_pendingTrades`, WebSocket) — must keep ticking when user is on other tabs
- Boot path (theme apply, splash screen, sync hooks)
- Dashboard, Records, News (reasonable size, used on every session)

---

## Banner comments added in Session 1

These banners mark each module's first-declaration line. Use as navigation aid only — NOT module boundaries (modules are physically interleaved).

| Module | Anchor line (after Session 1) | Anchor pattern |
|---|---|---|
| PSAI | ~14333 | `var _psaiSettings = {` |
| PSQ | ~15310 | `var _psqState = { main: null, ... }` |
| PSF | ~19858 | `let _psfRows = [];` |
| PSUP | ~20392 | `let _psupQueue = [];` |
| PSBGR | ~22755 | `let _psbgrLibCache = {};` |
| PSEC | ~25963 | `const _psecTemplates = {` |
| PSI | ~27497 | `function _psiToggleStage(n) {` |
| Muse | ~46813 | `function _museGetActiveSlots() {` |

Banner format:
```
/* ═══════════════════════════════════════════════════════════════════
 * MODULE: PS XXX  (prefix: _psXXX*)
 * Migration → src/modules/psXXX.js  ·  See MIGRATION-PLAN.md
 * ═══════════════════════════════════════════════════════════════════ */
```

---

## CDN dependency audit

Will need to be installed via npm or kept as CDN imports in Vite config. Most are publicly available on npm.

| Library | Current usage | Vite plan |
|---|---|---|
| Tailwind CSS | `<script src="https://cdn.tailwindcss.com">` | Switch to PostCSS plugin (`tailwindcss` + `autoprefixer`) — proper purging, no runtime overhead |
| Chart.js | CDN script | `npm i chart.js` + import in shell |
| Lightweight Charts | CDN script | `npm i lightweight-charts` |
| OpenCV.js | CDN, lazy-loaded by PSI | Keep CDN (large WASM, no npm benefit) — load via dynamic `<script>` from psi.js |
| ORT-Web | CDN, lazy-loaded by PSUP | Keep CDN or `npm i onnxruntime-web` — TBD in Session 2 |
| transformers.js | CDN, lazy-loaded by PSBGR | Keep CDN or `npm i @xenova/transformers` — TBD |
| SheetJS (xlsx) | CDN | `npm i xlsx` |
| docx.js | CDN | `npm i docx` |
| Google Fonts | `<link>` | Keep `<link>` in `src/index.html` |

---

## Session 2 plan (target: within 1 week)

**Goal**: Get Vite building current `index.html` as a single bundle. No splitting yet.

1. Create branch `vite-migration` from `main`
2. `cd` to project root, `npm init -y`
3. `npm i -D vite vite-plugin-pwa vite-plugin-singlefile-or-not` (TBD — likely chunked output, not single-file)
4. Create `vite.config.js`:
   - `base: '/pslink/'` for GitHub Pages subpath
   - `build.outDir: 'dist'`
   - `vite-plugin-pwa` config (manifest + service worker)
   - `build.target: 'baseline-widely-available'`
5. Reorganize:
   - `index.html` → `src/index.html` (HTML body only, link to main.js)
   - All `<script>` content → `src/main.js`
   - Inline `<style>` → `src/styles.css` (or keep inline, TBD)
6. Run `npm run dev` — verify hot reload works
7. Run `npm run build` — verify `dist/` produces working bundle
8. Test feature parity manually (every tab, every utility)
9. Update `dev-server.js` if needed (or replace with Vite dev)

**Don't merge yet** — verify on preview first.

**Risk areas**:
- Service worker registration path changes
- Inline `<script>` ordering (Vite hoists imports — verify nothing breaks)
- Tailwind CDN → PostCSS migration may break utility classes if PurgeCSS too aggressive
- CSS variable definitions in `_applyPreset` — verify still work after build

---

## Session 3 plan (target: within 2 weeks)

**Goal**: Split utilities into lazy-loaded modules. Setup CI/CD.

1. Extract per-prefix to module files:
   ```
   src/main.js
   src/modules/psai.js
   src/modules/psbgr.js
   src/modules/psec.js
   src/modules/psf.js
   src/modules/psi.js
   src/modules/psq.js
   src/modules/psup.js
   ```
2. Convert utility tab loader to use dynamic `import()`:
   ```js
   async function loadUtility(name) {
     const mod = await import(`./modules/${name}.js`);
     mod.init(panelEl);
   }
   ```
3. Add idle pre-warm after boot + watchlist refresh:
   ```js
   requestIdleCallback(() => {
     ['psf','psi','psq','psup','psec','psbgr','psai'].forEach(n =>
       import(`./modules/${n}.js`).catch(() => {})
     );
   });
   ```
4. Setup `.github/workflows/deploy.yml`:
   ```yaml
   on: push: branches: [main]
   jobs:
     build:
       runs-on: ubuntu-latest
       steps:
         - uses: actions/checkout@v4
         - uses: actions/setup-node@v4
         - run: npm ci
         - run: npm run build
         - uses: peaceiris/actions-gh-pages@v4
           with:
             github_token: ${{ secrets.GITHUB_TOKEN }}
             publish_dir: ./dist
   ```
5. Test deploy preview (push to `vite-migration` branch first)
6. Merge to `main` when feature-parity confirmed
7. Update `CLAUDE.md` Rule 2 to reflect new structure
8. Move `.backups/` retention to git tags (`backup-N`) — optional

---

## 4 rules during interim dev (between sessions)

1. **New code stays inside its module's banner section** (or gets a new banner if it's a new module)
2. **New utility module = new banner from start** + add to this doc
3. **Avoid cross-module coupling** (e.g., PSF directly calling `_psiCalibrate()`) — use event bus or callback if unavoidable
4. **New CDN dependency = update the CDN audit table above** in this doc

---

## Decisions locked in (2026-05-08)

1. **GitHub Actions build-on-push**: ✓ YES
   - Workflow: `.github/workflows/deploy.yml` runs `npm ci && npm run build` on push to main, deploys `dist/` to gh-pages branch
   - Preserves `git push` → live UX (no manual `npm run build` needed)
   - Free tier: 2,000 min/month, PSLink usage estimated ~5 min/day → free indefinitely
2. **Backup architecture**: ✓ KEEP `.backups/*.html` (no change)
   - Working well at 297+ backups, OneDrive sync handles everything
   - No pain point worth solving by switching to git tags
   - CLAUDE.md Rule 16 stays as-is post-migration
3. **Tauri partial future**: ✓ YES (for select utilities)
   - Candidate utilities for desktop: **PSI** (microscopy file dialogs + large image RAM), **PSUP** (GPU + no browser quota), **PSAI** (local ComfyUI network access without mixed-content)
   - Web stays canonical — desktop apps reuse `src/modules/{psi,psup,psai}.js` via Tauri shell
   - Architecture decision: ES modules per utility (Session 3) makes this natural — each can become a Tauri app independently
   - Not in current migration scope, but Session 2-3 architecture must keep this path open

---

## Success criteria for "migration done"

- [ ] `npm run build` produces `dist/` that works on GitHub Pages
- [ ] All 7 utilities load via dynamic `import()` and feature-parity verified
- [ ] First paint on cold load ≤ current performance
- [ ] First click on any utility ≤ 500ms (cold) / instant (warm via idle pre-warm)
- [ ] WebSocket tick pipeline + pinned-only path still works on tab switch
- [ ] Gist sync, R2 sync, encryption all functional
- [ ] Service worker caches modules separately (updating one doesn't invalidate all)
- [ ] GitHub Actions builds + deploys on push to main (1-2 min lag)
- [ ] CLAUDE.md Rule 2 updated to reflect shell + modules architecture
- [ ] Memory `project_scaling_plan.md` marked complete

---

## Rollback plan

If Session 2 or 3 hits an irrecoverable issue:
- Source of truth: `.backups/backup298 - before vite migration prep session 1.html` (Session 1 starting point)
- All migration work happens on `vite-migration` branch — `main` stays untouched until merge
- `git checkout main` + delete `vite-migration` branch = full rollback

---

## Update log

- **2026-05-08**: Plan committed. Session 1 done — banner comments added, this doc created, memory updated.
- **2026-05-08**: 3 open decisions locked in — GH Actions YES, `.backups/*.html` KEEP, Tauri partial YES (PSI/PSUP/PSAI candidates). Ready for Session 2.
