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
| PS SpecFlow | `_psf` | 6,079 | 60 | docx.js | `src/modules/psf/index.js` |
| Muse | `_muse` | 5,040 | 251 | — | **STAYS IN SHELL** (`src/widgets/muse/`) |
| PS Micro Imaging | `_psi` | 4,695 | 195 | OpenCV.js (10MB WASM) | `src/modules/psi/index.js` |
| PS Quotation | `_psq` | 4,227 | 163 | SheetJS | `src/modules/psq/index.js` |
| PS Upscaler | `_psup` | 2,126 | 39 | ORT-Web | `src/modules/psup/index.js` |
| PS Email Composer | `_psec` | 1,495 | 69 | — | `src/modules/psec/index.js` |
| PS Background Remover | `_psbgr` | 1,010 | 48 | transformers.js | `src/modules/psbgr/index.js` |
| PS AI Studio | `_psai` | 909 | 34 | — | `src/modules/psai/index.js` |
| **Lazy-loaded total** | | **~20.5k (~35%)** | | | |
| Shell remainder | | ~37k (~65%) | | | `src/main.js` + `src/core/` + `src/tabs/` + `src/widgets/` |

**Folder-per-module pattern (decided 2026-05-09):** even modules that fit in one file get their own folder with `index.js` as entry. Reason: PSF (6k) and PSI (4.7k) will need to break into sub-files within 1-2 years; the folder lets us add `psi/canvas.js`, `psi/histogram.js`, etc. without restructuring imports later.

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

## Architecture conventions (lock for life of project)

These conventions define HOW new presets / tabs / utilities / widgets are added post-migration. Locking them now means feature growth stays flat per file (no more mega-file bloat) and the `pslink-preset-scaffold` skill can scaffold against them deterministically.

### 1. Preset registry pattern

```
src/core/presets/
├── index.js          # registry: export { origin, phosphor, cinematic, ... }
├── origin.js         # preset object: { id, label, axes, variantColors?, darkOnly? }
├── phosphor.js
└── cinematic.js
src/styles/presets/
├── origin.css        # :root + html.dark + variant overrides
├── phosphor.css
└── cinematic.css
```

**Adding a new preset** (e.g. "Brutalist"):
1. Create `src/core/presets/brutalist.js` (preset object)
2. Create `src/styles/presets/brutalist.css` (overrides)
3. Add `export { brutalist }` to `src/core/presets/index.js` (1 line)
4. HMR shows result immediately. **No other files touched.**

### 2. Tab registry pattern

```
src/tabs/
├── index.js          # tab router + registry
├── dashboard/index.js
├── records/index.js
├── watchlist/index.js
├── news/index.js
└── utilities/
    ├── index.js
    └── registry.js   # _utilTools (PSI/PSUP/PSAI/...)
```

**Adding a new tab** (e.g. "Calendar"):
1. Create `src/tabs/calendar/index.js` exporting `init(rootEl)` + optional `destroy()`
2. Add tab pill markup to `src/index.html` nav (1 element)
3. Register in `src/tabs/index.js` (1 line)

### 3. Utility module registry

```
src/modules/
├── psi/index.js      # exports init(panelEl), optional destroy()
├── psf/index.js
└── ...
```

**Adding a new utility** (e.g. "PS Receipt OCR"):
1. Create `src/modules/psro/index.js` exporting `init(panelEl)`
2. Add entry to `src/tabs/utilities/registry.js` `_utilTools` array
3. Lazy-loaded automatically via dynamic `import('./modules/psro/index.js')`
4. If introduces a CDN dep — update CDN audit table above

### 4. Widget pattern

```
src/widgets/
├── muse/
├── ai-chat/
└── clock/
```

**Adding a new widget**: drop folder, import from the tab(s) that use it.

### Hard rules (treat as code conventions)

1. **Every tab/module/widget exports `init(rootEl, ctx)`** + optional `destroy()` — uniform contract across the app
2. **Every preset exports `{ id, label, axes, variants?, variantColors?, darkOnly? }`** — uniform contract
3. **CSS imported only inside the file that uses it** → Vite tree-shake handles dead-code elimination
4. **Cross-module communication goes through `src/core/bus.js` event bus** — no direct calls between modules. Core APIs (storage, gist-sync, theme, R2) imported normally.
5. **localStorage keys keep `ps_<prefix>_*` convention** — no breaking change for existing user data
6. **Module-scope vars replace `_psXXX*` global prefix** — no naming collision possible at runtime

---

## Session 2 plan (target: within 1 week)

**Goal**: Get Vite building current `index.html` as a single bundle, with TypeScript opt-in already wired. No splitting yet.

1. Create branch `vite-migration` from `main`
2. `cd` to project root, `npm init -y`
3. `npm i -D vite vite-plugin-pwa typescript` (singlefile vs chunked: TBD — likely chunked)
4. Create `vite.config.js`:
   - `base: '/pslink/'` for GitHub Pages subpath
   - `build.outDir: 'dist'`
   - `vite-plugin-pwa` config (manifest + service worker)
   - `build.target: 'baseline-widely-available'`
5. Create `tsconfig.json` with **incremental TS adoption**:
   - `allowJs: true`, `checkJs: true`, `strict: true`, `noEmit: true`
   - JSDoc throughout codebase becomes type-checked from day 1
   - New modules can be written as `.ts`; old `.js` keeps working
   - Full conversion deferred to Phase 4
6. Reorganize:
   - `index.html` → `src/index.html` (HTML body only, link to main.js)
   - All `<script>` content → `src/main.js`
   - Inline `<style>` → `src/styles.css` (or keep inline, TBD)
   - Pre-create empty folders matching the conventions above (`src/core/`, `src/tabs/`, `src/modules/`, `src/widgets/`, `src/styles/presets/`)
7. Run `npm run dev` — verify hot reload works
8. Run `npm run build` — verify `dist/` produces working bundle
9. Run `tsc --noEmit` — should pass with 0 errors (JSDoc may surface latent bugs; fix them before merge)
10. Test feature parity manually (every tab, every utility)
11. Update `dev-server.js` if needed (or replace with Vite dev)

**Don't merge yet** — verify on preview first.

**Risk areas**:
- Service worker registration path changes
- Inline `<script>` ordering (Vite hoists imports — verify nothing breaks)
- Tailwind CDN → PostCSS migration may break utility classes if PurgeCSS too aggressive
- CSS variable definitions in `_applyPreset` — verify still work after build
- `tsc --noEmit` may surface dozens of legit type bugs in current code — budget time to fix them, not silence them with `// @ts-ignore`

---

## Session 3 plan (target: within 2 weeks)

**Goal**: Split utilities into lazy-loaded modules using folder pattern. Setup CI/CD.

1. Extract per-prefix to module folders (follow Architecture conventions §3):
   ```
   src/main.js
   src/modules/psai/index.js
   src/modules/psbgr/index.js
   src/modules/psec/index.js
   src/modules/psf/index.js
   src/modules/psi/index.js
   src/modules/psq/index.js
   src/modules/psup/index.js
   ```
   Each `index.js` exports `init(panelEl)` + optional `destroy()` (per Hard Rule §1)
2. Extract Muse → `src/widgets/muse/index.js` (stays in shell, NOT lazy)
3. Convert utility tab loader to use dynamic `import()`:
   ```js
   async function loadUtility(name) {
     const mod = await import(`./modules/${name}/index.js`);
     mod.init(panelEl);
   }
   ```
4. Add idle pre-warm after boot + watchlist refresh:
   ```js
   requestIdleCallback(() => {
     ['psf','psi','psq','psup','psec','psbgr','psai'].forEach(n =>
       import(`./modules/${n}/index.js`).catch(() => {})
     );
   });
   ```
5. Extract presets → `src/core/presets/{origin,phosphor,cinematic}.js` + `src/styles/presets/*.css` (follow §1)
6. Extract tabs → `src/tabs/{dashboard,records,watchlist,news,utilities}/index.js` (follow §2)
7. Wire `src/core/bus.js` event bus (per Hard Rule §4)
8. Setup `.github/workflows/deploy.yml`:
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
9. Update `pslink-preset-scaffold` skill — scaffold against new folder pattern (drop 2 files instead of inline JS+CSS blocks)
10. Test deploy preview (push to `vite-migration` branch first)
11. Merge to `main` when feature-parity confirmed
12. Update `CLAUDE.md` — Rules 1, 2 become Vite-aware; line refs in Rules 13-26 + memory re-anchored to new files
13. Move `.backups/` retention to git tags (`backup-N`) — optional, deferred per locked decision

---

## Phase 4 plan (target: 1-2 weeks after Session 3)

**Goal**: Lock in 10-year sustainability — full TypeScript, tests, Tauri Desktop shell.

### 4a. Convert .js → .ts (incremental TS already running since Session 2)

By this point `tsconfig.json` has `allowJs: true`, `checkJs: true`, `strict: true` and JSDoc has been type-checked since Session 2. Phase 4a flips files one by one:

1. Rename module-by-module: `src/modules/psai/index.js` → `index.ts`
2. Add explicit types where JSDoc was loose
3. Fix `tsc --noEmit` errors per module (don't silence with `@ts-ignore`)
4. Order — smallest first to build muscle: PSAI (909) → PSBGR (1010) → PSEC (1495) → PSUP (2126) → PSQ (4227) → PSI (4695) → PSF (6079) → core/widgets/tabs/main
5. Drop `allowJs: true` once last `.js` is converted

### 4b. Tests (Vitest + Playwright)

**Vitest** for pure functions (target: critical paths, NOT 100% coverage):
- Encryption round-trip (`_gistEncrypt` / `_gistDecrypt`) — must be byte-identical
- Sparkline filter — 3 invariants (filter + market-open guard via `_isMarketOpenCached` + 320-bar slice)
- Intl helper cache (`_ET_HM_FMT` etc.) — verify hot paths don't re-instantiate
- PSQ period key + counter logic (Comp1 BE+1, Comp2 calendar)
- Privacy mode masking — pre-paint default behavior

**Playwright** for critical e2e paths:
- Records save → reload → data preserved
- Watchlist add symbol → live tick render → flash animation
- Gist sync round-trip (push from device A, pull on fresh device B profile)
- Boot on fresh device (empty localStorage) → splash → render with no blank cells

### 4c. Tauri Desktop shell

**Architecture (locked 2026-05-09):** **1 Tauri app "PSLink Desktop"** embedding 3 priority utilities (PSI / PSUP / PSAI). Web stays canonical; desktop reuses `src/modules/{psi,psup,psai}` via Tauri shell. Single .exe / .dmg / .AppImage, single auto-updater channel.

Native benefits per utility:
- **PSI**: native file dialogs (no FSA permission dance), large image RAM (no browser quota)
- **PSUP**: WebGPU bypass + no browser tab quota for ORT model cache
- **PSAI**: localhost ComfyUI without mixed-content blocker

Steps:
1. `npm i -D @tauri-apps/cli` + `cargo install tauri-cli`
2. `cargo tauri init` → `src-tauri/` scaffold
3. `tauri.conf.json` — point `frontendDist` to `dist-desktop/`, build via Vite mode that embeds only PSI/PSUP/PSAI tab panels
4. CI: add `release-tauri.yml` workflow — cross-compile .exe / .dmg / .AppImage on `v*` tag push
5. Auto-updater via `tauri-plugin-updater`

**NOT in scope for Phase 4**: Records / Watchlist / News on desktop — they have no native benefit, web is canonical. May reconsider later if "personal-finance offline mode" becomes a real use case.

---

## Adding new features post-migration (workflow recipes)

### Recipe: Add a new design preset

```
1. (optional) Run `pslink-preset-scaffold` skill → generates the 2 files
2. Create src/core/presets/<id>.js          # preset object
3. Create src/styles/presets/<id>.css       # CSS overrides
4. Add export to src/core/presets/index.js  # 1 line
5. HMR auto-reload → test in browser (both Slate and Onyx if not darkOnly)
6. Run `pslink-preset-audit` skill if specificity feels off
7. git commit — diff is 3 files, easy to review
```
**Time**: ~5 min vs ~30 min current (scroll mega-file + edit 4-6 sites + risk specificity bug).

### Recipe: Add a new tab

```
1. Create src/tabs/<name>/
   ├── index.js                # export init(rootEl), destroy()
   ├── <name>.css
   └── views/                  # sub-views if needed
2. Add tab pill markup to src/index.html nav
3. Register route in src/tabs/index.js (1 line)
4. (optional) Add to mobile bottom-bar markup
```

### Recipe: Add a new utility module

```
1. Create src/modules/<prefix>/
   ├── index.js                # export init(panelEl), destroy()
   └── <files>                 # break up if >2k lines
2. Add entry to src/tabs/utilities/registry.js _utilTools array:
   { id: 'psro', label: 'PS Receipt OCR', icon: '...', isWorkstation: true }
3. (if has CDN dep) Update CDN dependency audit table in this doc
4. Lazy-loads automatically via dynamic import()
```

### Recipe: Add a new widget (clock variant, FAB, etc.)

```
1. Create src/widgets/<name>/index.js
2. Import from the tab(s) that use it
3. Lifecycle managed by importing tab (init on tab enter, destroy on leave)
```

### Recipe: Add a new core capability (storage layer, sync provider, encryption helper)

```
1. Add to src/core/<capability>.js (or .ts)
2. Export typed API
3. Document API surface in src/core/README.md
4. All modules import via `import { x } from '../../core/<capability>.js'`
```

---

## 4 rules during interim dev (between sessions)

1. **New code stays inside its module's banner section** (or gets a new banner if it's a new module)
2. **New utility module = new banner from start** + add to this doc
3. **Avoid cross-module coupling** (e.g., PSF directly calling `_psiCalibrate()`) — use event bus or callback if unavoidable
4. **New CDN dependency = update the CDN audit table above** in this doc

---

## Decisions locked in

### Locked 2026-05-08

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
   - Web stays canonical — desktop apps reuse `src/modules/{psi,psup,psai}/index.js` via Tauri shell
   - Architecture decision: ES modules per utility (Session 3) makes this natural

### Locked 2026-05-09

4. **TypeScript adoption: incremental, not big-bang**
   - Session 2 ships `tsconfig.json` with `allowJs: true`, `checkJs: true`, `strict: true` — JSDoc gets type-checked from day 1
   - New modules can be `.ts`; old `.js` keeps working
   - Phase 4a converts module-by-module (smallest first: PSAI → ... → PSF → core)
   - Reason: PSLink has ~50+ global vars and 57k LoC; without types, refactoring becomes harder every year. AI assistants (Claude, Cursor) work measurably better on .ts.
5. **Folder-per-module pattern**: `src/modules/<prefix>/index.js` (not flat `<prefix>.js`)
   - PSF (6k) and PSI (4.7k) will need to break into sub-files within 1-2 years
   - Folder lets us add `psi/canvas.js`, `psi/histogram.js` without restructuring imports later
   - Same pattern for `src/tabs/<name>/` and `src/widgets/<name>/`
6. **Tauri Desktop architecture: 1 app, 3 utilities embedded**
   - Single .exe / .dmg / .AppImage called "PSLink Desktop"
   - Embeds PSI + PSUP + PSAI panels (the 3 with real native benefit)
   - Single auto-updater channel via `tauri-plugin-updater`
   - Reason: simpler distribution, single update story, shared shell code
7. **Tests scope: critical paths, NOT 100% coverage**
   - Vitest for pure functions (encryption, sparkline filter, Intl cache, PSQ counter, privacy mask)
   - Playwright for 4 e2e flows: Records save/reload, WL live tick, Gist round-trip, fresh-device boot
   - Reason: PSLink is a personal app — over-testing burns time without proportional safety gain. Critical paths catch the regressions that matter.
8. **Architecture conventions locked for project lifetime** (see "Architecture conventions" section above)
   - Preset / tab / utility / widget folder patterns
   - 6 hard rules (uniform `init()` contract, CSS scope, event bus, etc.)
   - Reason: prevents the "single mega-file" trap from recurring in modular form

---

## Success criteria for "migration done"

### After Session 3 (Vite + lazy modules shipped)

- [ ] `npm run build` produces `dist/` that works on GitHub Pages
- [ ] All 7 utilities load via dynamic `import()` and feature-parity verified
- [ ] First paint on cold load ≤ current performance
- [ ] First click on any utility ≤ 500ms (cold) / instant (warm via idle pre-warm)
- [ ] WebSocket tick pipeline + pinned-only path still works on tab switch
- [ ] Gist sync, R2 sync, encryption all functional
- [ ] Service worker caches modules separately (updating one doesn't invalidate all)
- [ ] GitHub Actions builds + deploys on push to main (1-2 min lag)
- [ ] `tsc --noEmit` passes with 0 errors (JSDoc-driven type check)
- [ ] CLAUDE.md Rules 1-2 updated to reflect shell + modules architecture; line refs in Rules 13-26 + memory re-anchored
- [ ] `pslink-preset-scaffold` skill updated to scaffold against folder pattern
- [ ] Memory `project_scaling_plan.md` marked complete

### After Phase 4 (10-year-ready)

- [ ] All `.js` converted to `.ts` (no `allowJs` in tsconfig)
- [ ] Vitest critical-path tests passing in CI on every push
- [ ] Playwright 4 e2e flows passing in CI
- [ ] Tauri Desktop builds .exe / .dmg / .AppImage from same codebase
- [ ] Auto-updater channel live; first .exe release tagged
- [ ] Adding a new preset / tab / utility verified to take <10 min via recipes

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
- **2026-05-09**: Plan upgraded for 10-year sustainability. Added:
  - **Architecture conventions** section — preset / tab / utility / widget folder patterns + 6 hard rules (locked for life of project)
  - **Phase 4 plan** — full TypeScript conversion + Vitest/Playwright critical-path tests + Tauri Desktop shell (1 app, 3 utilities embedded)
  - **Adding new features** workflow recipes — preset/tab/module/widget/core
  - **5 new locked decisions** (#4-#8): incremental TypeScript from Session 2, folder-per-module pattern, single Tauri Desktop app, critical-paths-only test scope, conventions locked for project lifetime
  - Module inventory targets retargeted from `<prefix>.js` → `<prefix>/index.js`
  - Session 2 plan: added `tsconfig.json` + folder scaffold steps
  - Session 3 plan: 13 steps (was 8) covering folder pattern, presets/tabs extraction, event bus, scaffold-skill update, CLAUDE.md re-anchor
  - Success criteria split: "after Session 3" + "after Phase 4"
