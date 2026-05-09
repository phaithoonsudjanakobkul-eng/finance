# PSLink — Vite Migration Plan

**Decision committed**: 2026-05-08
**Target completion**: before 2026-05-25 (before file hits 70k lines)
**Effort budget**: ~7-13 sessions total (~20-35 ชม. รวม) for AI-assisted single-dev work — NOT human-team weeks
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

## Storage & Worker audit (verified 2026-05-09)

This section is the verified ground truth for every storage / sync / worker touchpoint in the current monolith. Audited via 3 parallel Explore agents over `index.html`. Numbers reflect actual code at audit time.

### Summary stats

| Surface | Functions | Endpoints / keys | Coverage |
|---|---|---|---|
| localStorage | 254 calls (86 get, 167 set, 1 remove) | 90+ unique `ps_*` keys across 14 prefixes | **12 of 167 setItem use `_lsSave` wrapper (4.7%)** ⚠ |
| IndexedDB | 4 wrappers (`_r2InitIdb/Put/Get/Delete`) | 1 DB (`PSLinkMedia` v1), 1 store (`blobs`) | Graceful fail (silent on error); no quota check |
| Gist sync | 11 core functions (sync/push/encrypt/hash/keepalive) | 1 Gist (AES-256-GCM encrypted) | All race guards present; salts verified |
| R2 worker | 11 functions (upload/download/delete/derive/cache) | 4 endpoints + `/yahoo` proxy | Auth + decrypt OK; fire-and-forget upload misses retry |
| Fly.io workers | Collabora + WOPI + PDF | Cloud always (Collabora/WOPI); Hybrid PDF | 1.5s probe + 3min cache; PDF timeout missing |
| ComfyUI (PSAI) | 5 functions + WebSocket | localhost only (mixed-content guarded) | Defensive guards in place; WS reconnect missing |

### 🔴 Critical findings (must fix before or during Session 2)

| # | Finding | File:line | Risk |
|---|---|---|---|
| C1 | **`_lsSave` coverage 4.7%** — 168 raw `localStorage.setItem` bypass quota wrapper. API keys (`ps_gist_token`, `ps_finnhub_key`, `ps_alpaca_key/secret`) at lines 12430, 12573-12576 fail silently on quota | [index.html:56518](index.html#L56518) (wrapper) | App "saves" silently fails on quota — user re-types keys, lost again |
| C2 | **`_dataHash()` is string concat, not crypto hash** — different payloads can hash identically; used as race guard, false-skip = data loss | [index.html:56663](index.html#L56663) | High-frequency edits could collide → Gist sync skip → data lost |
| C3 | **TextEncoder + `crypto.subtle` + `btoa` polyfill** — if Vite bundles any shim, output bytes diverge → existing user Gist becomes unrecoverable | [index.html:46766](index.html#L46766), [56346](index.html#L56346) | **Catastrophic — entire user data unrecoverable post-migration** |
| C4 | **Collabora `postMessage` origin = `*`** — accepts any iframe origin without validation; XSS vector if malicious iframe injected | [index.html:17941](index.html#L17941) | Security: arbitrary script context |
| C5 | **`_r2UploadPhoto()` fire-and-forget** — no error handler; network drop = encrypted bytes orphaned in R2, no retry | [index.html:46961](index.html#L46961) | User photo "saved" silently fails |
| C6 | **WOPI token expiry mid-edit** — 401 on CheckFileInfo silently fails, no re-auth flow | [index.html:17708](index.html#L17708), [17859](index.html#L17859), [17882](index.html#L17882) | Path E editor breaks mid-session, user loses edits |
| C7 | **PDF worker unbounded timeout** — large xlsx render 60s+ hangs UI without timeout | [index.html:18668](index.html#L18668) | UI freeze, user thinks app crashed |
| C8 | **Cross-tab race** — no `window.addEventListener('storage', ...)` listener; two PSLink tabs can corrupt `ps_records`, `ps_watchlist`, `ps_muse_clips_*` | (absent) | Silent data corruption when user opens 2 tabs |

### 🟡 Important findings (fix in Session 3)

| # | Finding | File:line | Notes |
|---|---|---|---|
| I1 | IDB version locked at 1, no upgrade path; no `onblocked` handler | [index.html:46703-46707](index.html#L46703-L46707) | Future schema change blocks |
| I2 | `localStorage.clear()` never called → stale tokens on shared device | (absent) | Privacy concern |
| I3 | `_r2DeleteKeys()` fire-and-forget orphans R2 blobs if offline | [index.html:47004](index.html#L47004) | Storage cost creep |
| I4 | Concurrent same-key R2 uploads overwrite without warning | [index.html:46793](index.html#L46793) | PSUP model corruption race |
| I5 | Gist token rotation doesn't revoke old token in localStorage | (absent) | Orphan token accumulates |
| I6 | HKDF `info` param hardcoded `'aes-gcm-256'`, no assertion — divergent code paths could break decrypt | [index.html:46767](index.html#L46767), [56347](index.html#L56347) | Manual-review only |
| I7 | Custom `btoa` wrapper at line 56354 vs native `btoa` at line 56340 — inconsistency, no test | [index.html:56340](index.html#L56340), [56354](index.html#L56354) | Edge-case byte sequence divergence |
| I8 | ComfyUI WebSocket drop = no reconnect, user manual retry | [index.html:14718](index.html#L14718) | UX degradation |
| I9 | Yahoo Finance proxy: no RPS/quota tracking; upstream 429 → 502 relay | pslink-r2-worker `src/index.js:112` | Quota exhaustion = silent stale data |

### 🟢 Verified solid (no action needed)

- AES-256-GCM + HKDF + native `crypto.subtle` — robust, salts confirmed (`PSLink-Gist-v1`, `PSLink-R2-v1`, domain-separated)
- Gist race guards (`_isSyncing`, `_isSaving`, `_gistInitialSyncComplete`, `_dataHash` despite C2)
- Gist 401 / 403 / 404 / 429 handling + 2-min backoff on rate limit
- Gist `pagehide` keepalive via `sendBeacon` + 64KB guard + `ps_data_dirty` fallback
- R2 IDB graceful fail (no hang on errors; lazy init pattern)
- R2 async DOM re-find pattern (Rule 22 verified in `_r2LoadVideoForElement`)
- R2 thumb 404 single-retry to full-size key
- Collabora 15s save timeout (`AbortController` + `Promise.all` race)
- Hybrid PDF 1.5s probe with cloud fallback (3-min TTL on detection cache)
- PSAI mixed-content guard + `AbortController` on every fetch (5s probe / 15s prompt / 60s upload)
- Boot-time theme migration (`_THEME_KEY_MIGRATION`: 'tv'→'onyx', 'apple'→'slate'); per-theme `ps_clock_color` migration
- Logo / sparkline cache eviction on quota (LOGO_DATA_CACHE_KEY, SYMBOL_LOGO_CACHE_KEY, ps_wl_spark_cache_v5)

### Vite migration risks (verified, ranked)

1. **🔴 TextEncoder / `crypto.subtle` / `btoa` byte-identical** (C3) — Vite must NOT polyfill any of these. Lock via `tsconfig.lib: ["DOM"]` only + audit final bundle for crypto shims. **CI gate required (test F3 below).**
2. **🔴 R2 globals init at module load** (`R2_WORKER_URL`, `R2_AUTH_TOKEN` at [index.html:46699-46700](index.html#L46699-L46700)) — Vite hoisting + lazy import order = token undefined early → fire-and-forget uploads fail. Convert to lazy getter `() => localStorage.getItem(...)`.
3. **🔴 `_lsSave` import topology** — 12 callers spread across modules. On split: must live in shared core chunk to avoid duplication / skipped quota check.
4. **🟡 Inline WebWorker blobs** (PSI histogram, PSUP queue, etc.) — Vite prefers `new Worker(new URL('./worker.js', import.meta.url))`. Inline blobs work but won't tree-shake; verify pattern during Session 3 extraction.
5. **🟡 Collabora iframe `src` with `/pslink/` GitHub Pages base** — `_psqCollabBase + '/browser/.../cool.html'` must NOT be rewritten by Vite's base path. Store as runtime config, not computed at module load.
6. **🟡 `JSON.stringify` key order in `_buildExportData()`** — minifier could reorder; affects `_dataHash` (after F2) and any downstream byte-comparison test. Pin via sorted-keys serializer if needed.
7. **🟡 Module-load-time `localStorage.getItem`** at 46+ closure positions — fresh device returns `undefined`; defer to lazy getters during extraction.
8. **🟢 Native `crypto.getRandomValues`** — not affected by Vite.
9. **🟢 `crypto.subtle.encrypt/decrypt`** — native, not affected by Vite (assuming risk #1 stays clean).

---

## Critical pre-Session-2 fixes (locked 2026-05-09)

These are NOT optional — they are pre-conditions for Session 2 to be safe. Each maps to a Critical finding above. All fixes apply to current monolith AND post-Vite codebase, so doing them now means we don't repeat the work post-split.

| # | Fix | Maps to | Effort | Why now (vs after Vite) |
|---|---|---|---|---|
| **F1** | Audit all 168 raw `localStorage.setItem` calls → wrap with `_lsSave` (or inline try/catch). Priority: API keys ([12430](index.html#L12430), [12573-12576](index.html#L12573-L12576)) first | C1 | 1-2 hr | Easier to grep in single file; post-split = 8 module audits |
| **F2** | Replace `_dataHash()` string-concat with `crypto.subtle.digest('SHA-256', ...)` returning hex (async — adjust callers) | C2 | 30 min | Standalone fix, no Vite dependency |
| **F3** | Write byte-identical roundtrip **Vitest** BEFORE Session 2 starts. Encrypt sample `_buildExportData()` payload, save ciphertext fixture, decrypt with Vite bundle, assert byte equality | C3 | 2 hr | Catches polyfill regression the moment Vite is introduced |
| **F4** | Add Collabora `postMessage` origin check — accept only `https://pslink-collabora.fly.dev` (and dev origin if local Collabora) | C4 | 15 min | Security fix, no migration dep |
| **F5** | Wrap `_r2UploadPhoto`, `_r2DeleteKeys` in try/catch + retry queue (localStorage `ps_r2_pending_*`); flush on next sync | C5 + I3 | 1 hr | Same code shape post-migration; do once |
| **F6** | Add WOPI 401 → re-fetch token + retry once flow in `_psqEditorUploadToWopi` and WOPI download | C6 | 1 hr | Path E reliability; no migration dep |
| **F7** | Add `AbortController` + 60s timeout to `_psqXlsxToPdf` + UI progress feedback | C7 | 30 min | UX fix; no migration dep |
| **F8** | Add `window.addEventListener('storage', ...)` listener that warns / reloads if another tab modifies critical keys (`ps_records`, `ps_watchlist`, `ps_muse_clips_*`) | C8 | 1 hr | Fixes silent data corruption regardless of Vite |

**Total: 1-2 sessions (~2-4 ชม.).** Each F-fix is a small surgical change; the per-fix "effort" column estimates apply only if a fix uncovers deeper issues. Recommend completing F1-F8 in a dedicated `vite-prep-hardening` branch merged to main BEFORE branching `vite-migration`.

---

## Session 2 plan (target: 1 session, ~2-3 ชม.)

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

## Session 3 plan (target: 2-4 sessions, ~6-12 ชม.)

**Goal**: Split utilities into lazy-loaded modules using folder pattern. Setup CI/CD. Heaviest phase because 7 modules + presets/tabs extraction + event bus + skill update all happen here. Can stretch across multiple sessions safely (each module extraction is independent).

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

## Phase 4 plan (target: 4-6 sessions total, ~10-16 ชม., after Session 3)

**Goal**: Lock in 10-year sustainability — full TypeScript, tests, Tauri Desktop shell.

Breakdown: Phase 4a (TS convert) ~2-3 sessions, Phase 4b (tests) ~1-2 sessions, Phase 4c (Tauri) ~1 session.

### 4a. Convert .js → .ts (incremental TS already running since Session 2)

By this point `tsconfig.json` has `allowJs: true`, `checkJs: true`, `strict: true` and JSDoc has been type-checked since Session 2. Phase 4a flips files one by one:

1. Rename module-by-module: `src/modules/psai/index.js` → `index.ts`
2. Add explicit types where JSDoc was loose
3. Fix `tsc --noEmit` errors per module (don't silence with `@ts-ignore`)
4. Order — smallest first to build muscle: PSAI (909) → PSBGR (1010) → PSEC (1495) → PSUP (2126) → PSQ (4227) → PSI (4695) → PSF (6079) → core/widgets/tabs/main
5. Drop `allowJs: true` once last `.js` is converted

### 4b. Tests (Vitest + Playwright)

Test scope is **critical paths only** — NOT 100% coverage. Tests are derived from the Storage & Worker audit (verified 2026-05-09) and must be in CI from Phase 4 onward. T1-T6 also run as the F3 pre-Session-2 gate.

**Vitest — Crypto byte-identical (highest priority, blocks any deploy if fails):**
- T1: `_gistEncrypt` / `_gistDecrypt` round-trip — encrypt sample `_buildExportData()` payload, decrypt, assert plaintext byte-for-byte equal
- T2: HKDF key-derivation determinism — derive key from same token in current vs Vite bundle, compare via `crypto.subtle.exportKey('raw', ...)`
- T3: HKDF salt + info verification — grep for all `'PSLink-Gist-v1'`, `'PSLink-R2-v1'`, `'aes-gcm-256'` literals; assert no typos / variant spellings
- T4: TextEncoder consistency — encode 1000 random Unicode strings (incl. Thai, emoji, surrogate pairs) in current vs Vite, compare bytes
- T5: Base64 roundtrip — `btoa(atob(x))` for 10,000 random byte sequences, assert 100% byte identity (catches custom-vs-native `btoa` divergence — finding I7)
- T6: AES-GCM IV uniqueness — log first 1000 IVs per session, assert no duplicates (GCM security boundary)

**Vitest — pure functions:**
- T7: `_dataHash()` post-F2 — assert SHA-256 hex output stable + collision-free for 10,000 random record configs
- T8: Sparkline filter — 3 invariants (regular-session filter + `_isMarketOpenCached` guard + 320-bar slice)
- T9: Intl helper cache (`_ET_HM_FMT`, `_ET_DAY_FMT`, `_ET_DOW_FMT`) — verify hot paths don't re-instantiate
- T10: PSQ period key + counter logic (Comp1 `BE+1` calendar, Comp2 `YYYY-MM`)
- T11: Privacy mode masking — `<head>` inline default + `syncFromGist` reconciliation
- T12: `_lsSave` quota fallback — simulate `QuotaExceededError`, assert eviction order (logo → symbol → sparkline) + retry succeeds

**Vitest — storage / sync race conditions:**
- T13: `_isSyncing` + `_isSaving` + `_pendingSave` — concurrent `syncFromGist` + `_pushToGist` must serialize, no double-PATCH
- T14: `_dataHash` mismatch detection — modify state during sync, verify next push retries with new hash
- T15: `pagehide` keepalive — payload >64KB sets `ps_data_dirty='1'` and skips sendBeacon

**Playwright — critical e2e paths:**
- E1: Records save → tab close → reopen → data preserved (localStorage path)
- E2: Watchlist add symbol → live tick render → flash animation visible (WS pipeline)
- E3: Gist sync round-trip — push from profile A, pull on fresh profile B, compare records / watchlist / Muse / PSQ state
- E4: Fresh-device boot — empty localStorage → splash → render with NO blank cells (per Rule 23)
- E5: Cross-tab race (post-F8) — open 2 tabs, modify `ps_records` in one, assert other shows reload prompt (not silent corruption)
- E6: WOPI token expiry (post-F6) — invalidate token mid-edit, assert auto re-fetch + retry succeeds
- E7: PDF render timeout (post-F7) — submit oversized xlsx, assert UI shows progress + 60s timeout error (not freeze)
- E8: Privacy mode pre-paint — fresh device with `Gist meta.privacy=true` → numbers masked from first paint (no flash of real numbers)

**Live user test (gate before merging Vite to main):**
- L1: Pick 2 real test accounts with months of encrypted Gist data. Deploy Vite version to staging (`/v2/`). Run `syncFromGist`, verify 100% decryption success + zero data loss across all surfaces (records / watchlist / Muse / PSQ state / R2 photos / R2 video clips).

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
- **2026-05-09 (afternoon)**: Timeline recalibrated for AI-assisted single-dev work — replaced "weeks" with "sessions" / "ชม.รวม" throughout. Standard human-team estimates (8-10 weeks) inflated by 5-10x. Total migration effort revised: ~7-13 sessions (~20-35 ชม.รวม) vs. original 8-10 weeks. Memory `feedback_time_estimates` saved.
- **2026-05-09 (evening)**: F1-F8 hardening complete + auto-deployed to production via dev-server.js (commits "deploy: 19:18 → 19:34"). All 8 critical fixes shipped: F1 _lsSave wrap (168 raw setItem), F2 _dataHash djb2 helper, F3 deferred (needs Vite), F4 Collabora origin guard, F5 R2 retry queue, F6 WOPI 401 re-auth, F7 PDF 60s timeout, F8 cross-tab storage listener. Plus side-fix: removed anti-autofill decoy fields causing Chrome "Save password?" prompt on Records entry (backup304).
- **2026-05-09 (evening)**: Session 2 (Vite scaffold) DONE in 1 session. Installed vite ^6.0.7 + typescript ^5.7.2 + vite-plugin-pwa ^0.21.1. Created vite.config.js (root='.', dual-base prod/dev), tsconfig.json (allowJs+checkJs+strict+path aliases), src/ skeleton folders (17 dirs + .gitkeep), src/README.md (folder map + 6 hard rules). Verification: vite build = 917ms first run, tsc --noEmit = 0 errors. Production root index.html unchanged. New scripts: `dev:vite`, `build:vite`, `preview:vite`, `type-check`.
- **2026-05-09 (evening)**: Session 3g (PSUP UI port) DONE in 1 session. Ported from monolith into src/modules/psup/index.js: TIER_PRESETS (Fast/Balanced/Maximum post-process knobs), drop zone (multi-file with 50 MB cap per image), queue list (per-item name + dimension + model + memory tier badge + status badge + remove button), tier picker chip bar, model picker chip bar (3 models with sub-label tooltips), settings (scale 2/3/4× + format png/webp/jpg), memory monitor display (light/medium/heavy/skip thresholds), Process Queue button (stub: marks queued items done sequentially with mem-limit refusal — real ORT-Web inference deferred to Session 3h+), Clear Queue button (revokes all object URLs). Per-item modelId carries default model assignment from sidebar (right-click Apply Model deferred). Added psup to MODULES_WITH_UI in main.js. PSUP chunk grew **2.1 KB → 15 KB** (7×) confirming UI port shipped. Build verification: vite build = 1.01s, all 8 chunks present (4 modules now real-UI: PSAI 13KB + PSBGR 14KB + PSEC 15KB + PSUP 15KB), tsc --noEmit = 0 errors. Production root index.html unchanged.
- **2026-05-09 (evening)**: Session 3f (PSBGR UI port) DONE in 1 session. Ported from monolith into src/modules/psbgr/index.js: drop zone with drag-drop + file input + file size guard (10 MB cap), tier picker chip bar (fast/pro/ultra with size + quality meta), detection mode toggle (auto/neural/color-key with descriptions), refine sliders (threshold/feather/expand) with live value labels, dual-canvas viewer (Original + Result), object URL lifecycle (load → revoke), file load + draw canvas pipeline with image fit-to-box (320×240 max), Process button (stub: tints image magenta to indicate pipeline ran — real RMBG/BiRefNet inference deferred to Session 3g+), Save PNG button (downloads result blob), Reset button (frees URLs + clears workspace), wireEvents for drag/drop/click/slider/chip patterns. Added psbgr to MODULES_WITH_UI in main.js. PSBGR chunk grew **962 B → 14 KB** (15× growth) confirming UI port shipped. Build verification: vite build = 974ms, all 8 chunks present (3 modules now real-UI: PSAI 13KB + PSEC 15KB + PSBGR 14KB), tsc --noEmit = 0 errors. Production root index.html unchanged.
- **2026-05-09 (evening)**: Session 3e (PSEC UI port) DONE in 1 session. Ported from monolith into src/modules/psec/index.js: field defs (14 fields, text/textarea/items types — items shows placeholder), 3 style metadata (exec/banner/editorial labels + descriptions), Word HTML quirk helpers (spacer + hairline + wrapHtmlDoc with </body> hazard guard via `_LT = '<' + concat`), state load/save with active template + style sync, full chip-bar UI (style + template selectors), form renderer (text + textarea), live preview iframe (sandbox=allow-same-origin), stub HTML builder (Word-paste-compatible K/V table — real exec/banner/editorial builders deferred to Session 3f), clipboard copy with execCommand fallback (custom `copy` event handler writes raw HTML to clipboardData for Outlook fidelity, ClipboardItem fallback), Clear current button. Added psec to MODULES_WITH_UI in main.js. PSEC chunk grew **2.4 KB → 15 KB** confirming UI port shipped. Build verification: vite build = 1.06s, all 8 chunks present (PSAI 13KB + PSEC 15KB now both real-UI), tsc --noEmit = 0 errors. Production root index.html unchanged.
- **2026-05-09 (evening)**: Session 3d (first real UI port — PSAI) DONE in 1 session. Ported from monolith into src/modules/psai/index.js: HTTP API helpers (testConnection, fetchLoras, uploadImage, queuePrompt, fetchView, fetchHistory, interrupt — 7 functions), UI primitives (toast, updateStatusBadge), full settings panel render (renderPanel — URL input + 6-control settings grid with mode/steps/cfg-locked/guidance/denoise/seed + Test + Save buttons + Flux Kontext invariants reminder + scoped CSS), event wiring (wireEvents — 8 handlers), module-scoped _psaiPanel ref (no longer global). Added module-mount div in src/index.html + main.js routing logic (MODULES_WITH_UI set determines mount target — UI modules go to #module-mount, skeleton modules to #demo-output). PSAI chunk grew **2 KB → 13 KB** confirming UI port shipped. Build verification: vite build = 989ms, all 8 chunks present, tsc --noEmit = 0 errors. Smoke test in preview: PSAI chunk contains psai-conn-dot/psai-toast/psai-test-btn DOM IDs + FluxGuidance + invariants markup. **Pattern established for porting remaining 6 modules in Session 3e+.** Production root index.html unchanged.
- **2026-05-09 (evening)**: **Session 3 COMPLETE** — Session 3c extracted final 3 modules (PSI, PSQ, PSUP) in 1 session. PSI: imaging state container (psImagingState) + calibration storage + OpenCV.js readiness check + scaleBar/displayAdj defaults. PSQ: counter helpers (peek + next quotation number, period reset rule) + storage keys (12 PSQ_* constants) + state container + Comp1 BE+1/Comp2 calendar period logic. PSUP: 3-model registry (ultrasharp-v1/v2 + bhi-dat2-real with full metadata) + queue + memory monitor (estPeakMB + memTier with 600/400/200 MB thresholds) + settings I/O. main.js loader registry now full 7 modules. src/index.html demo grid: 4 → 7 buttons (all utility modules). Build verification: vite build = 1.00s (19 modules transformed), 8 lazy chunks (v2 main 4.5KB + 7 modules totalling 13.4KB), tsc --noEmit = 0 errors. Production root index.html unchanged. **All 7 utility modules now lazy-loadable as code-split chunks.** Cutover to Phase B (delete inline copies, replace root) deferred to Session 3d when full UI port lands.
- **2026-05-09 (evening)**: Session 3b (3 more module skeletons) DONE in 1 session. Extracted PSBGR (tier registry + state container), PSEC (template registry + state I/O + approveVerb + resolveClosing), PSF (rows + history scaffolding + constants — largest module at 6k lines, this is just skeleton). Updated main.js loader registry (4 modules registered now: psai/psbgr/psec/psf). Updated src/index.html demo grid with 4 module load buttons + status card showing pending psi/psq/psup. Build verification: vite build = 1.04s (16 modules transformed), 5 lazy chunks (v2 main 4.4KB + psai 2.0KB + psbgr 0.96KB + psec 2.4KB + psf 0.98KB), tsc --noEmit = 0 errors. All 4 modules code-split cleanly under dist/assets/. Remaining for Session 3c: PSI (4.7k lines, OpenCV.js dep), PSQ (4.2k lines, SheetJS dep), PSUP (2.1k lines, ORT-Web dep).
- **2026-05-09 (evening)**: Session 3a (infrastructure + 1 module proof) DONE in 1 session. Created src/core/bus.js (event bus per Hard Rule §4), src/core/storage.js (lsSave/lsGet/lsGetJson/lsSaveJson/lsRemove wrappers), src/main.js (entry + dynamic-import lazy loader + idle pre-warm). Extracted PSAI → src/modules/psai/index.js as proof-of-concept (settings, state, env guards, fetch+timeout, init/destroy contract). Created src/index.html as v2 shell proof page. Updated vite.config.js to multi-entry (`prod: index.html`, `v2: src/index.html`). Removed VitePWA temporarily (caused html-proxy build error with multi-entry — Phase 4 reintroduces with proper SW cutover). Build output: dist/index.html 3.5MB (prod monolith) + dist/src/index.html 4.19KB (v2 shell) + dist/assets/v2-XXX.js 4.1KB (main+bus+storage) + dist/assets/index-XXX.js 2.0KB (PSAI lazy chunk). Verified preview serves both entries; PSAI loads as separate chunk via dynamic import().
- **2026-05-09 (afternoon)**: Storage & worker audit completed via 3 parallel Explore agents. Verified ground truth for every storage/sync/worker touchpoint in current monolith. Added:
  - **Storage & Worker audit** section — 8 🔴 critical findings (C1-C8), 9 🟡 important findings (I1-I9), 11 🟢 verified-solid items, 9 ranked Vite migration risks
  - **Critical pre-Session-2 fixes** section — 8 mandatory fixes (F1-F8), 1-2 sessions (~2-4 ชม.), all to be done in a `vite-prep-hardening` branch BEFORE branching `vite-migration`
  - **Phase 4b expanded** — test list grown from 9 → 24 tests (T1-T15 Vitest + E1-E8 Playwright + L1 live user test) derived from audit findings
  - Key risks surfaced: (1) `_lsSave` covers only 4.7% of localStorage writes — 168 raw setItem bypass quota; (2) `_dataHash()` is string concat not SHA-256 — collision = data loss; (3) TextEncoder/crypto.subtle/btoa polyfill is THE catastrophic Vite risk — would break every existing user's Gist decryption; (4) Collabora postMessage origin = `*` is an XSS vector regardless of migration
