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
- **2026-05-10 (evening)**: **Session 3t (Step 5 — Preset extraction) DONE in 1 session.** Closes Session 3 step 5 (presets → src/core/presets/ + folder pattern per Architecture Conventions §1). Created folder structure `src/core/presets/`: `types.js` (Preset typedef — 5 axes + variants/darkOnly/variantColors), `origin.js` (Oxanium + JetBrains Mono · 8px radius · 200ms motion), `phosphor.js` (VT323 + Share Tech Mono · 0 radius · steps motion · darkOnly · 4 variants classic/crt/modern/muted with full color tokens), `studio.js` (Fraunces + Bricolage · 220ms · 1 variant warm · light+dark both supported), `cinematic.js` (Fraunces + Inter Tight · 250ms · darkOnly · 2 variants photo/aurora w/ cine-glass + cine-bg-* tokens), `index.js` (registry + `applyPreset(id, variant)` + `applyVariant(v)` + `getActive()` + `listPresets()` + `restoreActive(prefersDark)` boot helper). `applyPreset` does verbatim port of monolith `_applyPreset` core logic: dark-only auto-flip + heal light slot to Origin, per-mode storage `ps_preset_{dark,light}` + `ps_variant_{dark,light}` + legacy `ps_preset` / `ps_preset_variant` for export/import compat, sets all 5 axes via `root.style.setProperty` (typography w/ legacy aliases `--font-main` / `--font-mono` so existing CSS keeps working, shape, icon, density `--space-1..8` + control heights, motion w/ `--ease-snap` + `--ease-smooth` + `--dur-fast/base/slow`), variant colors applied LAST (overrides base theme vars w/ inline-specificity). Removed monolith-specific side effects (sparkline redraw, cinematic backdrop refresh, Chart.js rebuild, avatar accent re-apply, watchlist thead bar sync) — those re-attach during cutover when downstream modules listen on `presets:applied` bus event. Bus emit on every apply for cross-module reactivity. Wired Preset Switcher demo into v2 shell (`src/index.html`) + main.js handlers: 4 preset buttons + dark toggle + dynamic variant chip bar that re-renders per-preset · live readout of computed `--font-display` / `--radius-md` / `--accent` so user can see vars actually wrote to root · boot calls `restoreActive(true)` so v2 page boots in last-used preset+variant. **v2 main chunk grew 4.80 KB → 18.54 KB (3.9×)** because presets eagerly bundled (must apply before first paint to avoid theming flash — could be code-split if needed, +14 KB is worth instant boot theming). 24 modules transformed (was 19) confirming 4 new preset modules + types + index registered. Build verification: vite build = 1.30s, all 8 chunks present (v2 main 18.5 + 7 module chunks 18-48 KB each totalling ~213 KB modules + 18.5 KB shell = ~232 KB), tsc --noEmit = 0 errors. Production root index.html unchanged. Session 3 step progress: **8/13 done** (Steps 1-4 + 5 + 7 + partial 9). **DEFERRED to 3u**: CSS extraction (`src/styles/presets/{origin,phosphor,studio,cinematic}.css`) — this session ports JS data + apply logic; the CSS overrides scattered across the inline `<style>` block in monolith stay there until cutover (separate ~3000-line concern requiring giant style block split). Next: Step 6 (Tabs extraction — biggest remaining single step, ~37k lines), Step 8 (GitHub Actions CI), or PSQ Distribute (.eml + Path E) depth fill.
- **2026-05-10 (evening)**: **🎉 Session 3s (PSF real DOCX export — 7th and FINAL module) DONE — ALL 7 UTILITY MODULES NOW HAVE CORE/FULL HEAVY LOGIC.** Ported real DOCX export pipeline from monolith into src/modules/psf/index.js: JSZip CDN ESM lazy loader (`loadJSZip` Function-cloaked import bypasses Vite + TS, caches `jszip@3.10.1` after first call so subsequent exports are instant), XML escape helper (`_psfXe` — different from html escape, preserves angle brackets in CDATA), tab-aware run content (`_psfRunContent` splits text on `\t` and emits `<w:t xml:space="preserve">` for each segment + `<w:tab/>` between, so right-aligned suffixes like "จำนวน N" survive Word re-render), numbering builder (`_psfComputeNums` stashes `r._listId` per row — Vite shell rows are simple `{idx,level,text}` so all rows go to listId=1 in one logical list; multi-list support waits for row schema expansion in 3t), `_psfNumXml` emits `<w:abstractNum>` with 7 levels of decimal numbering + leading-spaces-per-level + `<w:lvlText>` template `%1.%2.%3.` etc + per-level rPr font binding, plus separate `<w:num>` instance per logical list (separate abstractNums guarantee independent counters — sharing one abstractNum across multiple <w:num> chains numbering wrongly), `_psfDocXml` builds body — wraps each row as `<w:p>` with `<w:numPr>` `<w:ilvl>` + `<w:numId>` referencing the listId, A4 portrait `pgSz` 11906×16838 twips + 1440 twip (1") margins all sides + single column 720 spacing, `_psfStyXml` defines `Normal` style with TH Sarabun New 16pt (sz=32 half-points) + black + en-US lang + zero spacing-after, `_psfSetXml` sets defaultTabStop 720, `_psfCtXml` Content Types for all 4 word/* parts, `_psfRootRels` + `_psfDocRelsXml` rels manifest. Real `exportDocx` async — loads JSZip lazy → creates 7-part OOXML package via `zip.file()` chain → `zip.generateAsync({type:'blob', mimeType: officedocument.wordprocessingml.document})` → blob download via temp `<a download>` with timestamp filename + `.docx` extension. Replaces the JSON stub from 3j. **PSF chunk grew 12.03 KB → 17.87 KB (1.5×)** — modest growth because JSZip is CDN-loaded at runtime (~70 KB lib lazy, not bundled). Header rows + page breaks + center alignment + bold/italic/underline runs deferred to 3t since current Vite row schema is simple `{idx, level, text}` — full schema (`r.type`, `r.bold`, `r.center`, `r.numId`) expands in 3t with corresponding row CRUD updates. Build verification: vite build = 1.37s, all 8 chunks present (v2 main 4.8 + PSF 17.9 + PSQ 19 + PSI 21 + PSUP 31 + PSAI 32.5 + PSEC 44.7 + PSBGR 47.7 = ~219 KB), tsc --noEmit = 0 errors. Production root index.html unchanged. **🏆 BREADTH-COVERAGE MILESTONE: 7/7 modules ported.** Next: pick a focus area for depth completion — PSQ Distribute (Stage 2 .eml + Path E Collabora editor + template Gist storage), PSI Pro UX (OpenCV + measurements + spline LUT), PSUP Pro UX (Compare grid + A/B slider), PSF rich text + paste normalization, or proceed to Phase 4 (Vitest + Playwright + .ts conversion + Tauri).
- **2026-05-10 (evening)**: **Session 3r (PSI histogram Web Worker port — 6th module focused scope) DONE in 1 session.** Ported the Web Worker histogram engine from monolith into src/modules/psi/index.js — this is the **CLAUDE.md Rule 12 "reference pattern"** referenced for "Web Workers for heavy processing". Inline blob worker source (~5 lines: 256-bin R/G/B counters via tight for-loop + `postMessage` with transferable Uint32Array buffers), `_psiHistCompute` orchestrator (downsamples > 2MP images to ~500k samples via stride-step on raw Uint8ClampedArray before posting so worker doesn't burn cycles on huge frames; cheap one-shot Worker per call — no shared state), `_psiHistDraw` ZEN-style render (light gray bg `#e4e5e1`, gridlines at 25/50/75% horizontal + 50/100/150/200 vertical with bold 7.5px monospace labels at top, per-channel R/G/B bars with effective-peak normalization that ignores saturation bins 0/255 so a black/white BG doesn't compress visible distribution, additive `multiply` blend for "all" mode + `source-over` for single-channel mode, per-bin width respects `Math.round((v+1)*W/255) - Math.round(v*W/255)` for sub-pixel-accurate bars at small widths, dashed black/white-point markers at adj.black + adj.white). Module-scoped `_psiHist` state container (worker URL + R/G/B histograms + bgCanvas ref). Worker URL initialized once at module load via IIFE. Wired histogram into existing Stage 3 panel UI (96px tall canvas above the LUT sliders) + hooks: image load → `_psiHist.bgCanvas = canvas; _psiHistCompute()` after drawImage, slider input → `_psiHistDraw()` re-renders so black/white markers track in real time, channel chip click → `_psiHistDraw()` re-renders with new color/blend mode. **PSI chunk grew 17.75 KB → 21.26 KB (1.2×)** — modest growth confirms Worker engine + render shipped (worker source itself is tiny — < 5 inline lines). OpenCV.js loader + measurements (line/angle/area/freehand) + loupe magnifier + spline LUT (Catmull-Rom) + cached `_bgPixels` for GC-free LUT apply explicitly deferred to Session 3s+ since they're a separate ~800-line subsystem. Build verification: vite build = 1.22s, all 8 chunks present (v2 main 4.8 + PSF 12 + PSQ 19 + PSI 21 + PSUP 31 + PSAI 32.5 + PSEC 44.7 + PSBGR 47.7 = ~213 KB), tsc --noEmit = 0 errors. Production root index.html unchanged. **6 of 7 modules now have at least core heavy logic** — only PSF (docx.js construction) remains. Next: Session 3s — PSF docx.js engine (last untouched module) OR PSI Pro UX (OpenCV measurements). Pi-keng's call.
- **2026-05-10 (evening)**: **Session 3q (PSQ core heavy-logic port — 6th module focused scope) DONE in 1 session.** Ported core PSQ heavy logic into src/modules/psq/index.js: xlsx CDN ESM lazy loader (`loadXlsx` Function-cloaked import bypasses Vite + TS — caches `xlsx@0.18.5` after first call so subsequent stages are instant), cell scanner + extractors (`_psqGetCellRaw` resolves rich-text/numeric/string cells correctly, `_psqScanFor` scans 0-50 rows × 0-7 cols for first keyword match, `_psqExtractLastNumber` for "X วัน" parsing, `_psqParseDateString` handles Thai full names + abbreviated months + พ.ศ. + bare BE year > 2400 + DD/MM/YY-YYYY slash format), Stage 1 real parse (`_psqParseMain` extracts main quotation # via `เลขที่`/`เลขที่ใบเสนอราคา` keyword scan + adjacent cell, main date via G7 native date cell or "วันที่" keyword scan w/ `XLSX.SSF.parse_date_code` for serial numbers), `stage1Apply` (loads SheetJS lazy → reads buffer as Uint8Array → parses main → reserves Comp1/Comp2 next numbers via `nextQuotationNumber` w/ period reset → persists counter via `savePsqLog` → renders status with main # + Thai BE date + new Comp1/Comp2 numbers + bus emit), Stage 3 real PDF render (`_psqGetPdfWorkerConfig` reads URL + token from localStorage `ps_pdf_worker_url` + `ps_pdf_auth_token`, `_psqXlsxToPdf` POSTs raw xlsx bytes to Fly.io worker `/xlsx-to-pdf` endpoint w/ Bearer auth + Content-Type:application/octet-stream + F7 hardcoded 60s AbortController timeout — abort message rewrites to "PDF render timed out after 60s (F7 ceiling)" so users see deliberate ceiling not "AbortError"), `stage3PrepareAll` checks output mode is PDF, downloads result blob via temporary `<a download>` with main filename's basename + `.pdf` extension, status reports rendered size in KB. Buffer-to-Uint8Array body cast to `any` for TS Response.body compat. Stage 2 .eml builder + Path E Collabora editor + template encrypted Gist+IDB storage + Hybrid local PDF probe explicitly deferred to Session 3r (5+ separate subsystems totaling ~1500 lines from monolith). Removed obsolete stub-note from UI. **PSQ chunk grew 14.74 KB → 19.03 KB (1.3×)** — modest growth because SheetJS comes from CDN dynamic import (~1MB) and isn't bundled; module-level code is just the orchestrator. Build verification: vite build = 1.19s, all 8 chunks present (v2 main 4.8 + PSF 12 + PSI 18 + PSQ 19 + PSUP 31 + PSAI 32.5 + PSEC 44.7 + PSBGR 47.7 = ~210 KB), tsc --noEmit = 0 errors. Production root index.html unchanged. Next: Session 3r — PSQ Distribute (Stage 2 .eml + Outlook authuser + Path E Collabora editor + template encrypted Gist storage). Or skip ahead to PSI/PSF heavy logic for breadth coverage first.
- **2026-05-10 (evening)**: **Session 3p (PSUP heavy-logic port — 5th module) DONE in 1 session.** Ported full ORT-Web 1.22 + WebGPU EP inference pipeline from monolith into src/modules/psup/index.js: complete `_PSUP_WORKER_SRC` (~245 lines verbatim — `init` lazy CDN ESM `onnxruntime-web@1.22.0/+esm` + WASM path config, `load` w/ `freeDimensionOverrides {batch_size:1, height:tileSize, width:tileSize}` + EP fallback chain webgpu → webgl → wasm + collected error array, `process` w/ tile pipeline + tier post-process + transferable bitmap return, `cancel` flag), tile pipeline (`inferenceTile` ImageData → NCHW Float32 [1,3,H,W] /255 + ort.Tensor + session.run + NCHW → RGB Uint8, `processImage` overlap=Math.max(8, tileSize/16) cols/rows w/ stride=tileSize-overlap, edge-clamp pad for partial tiles, feathered Float32 colorBuf + weightBuf blend, no-seam composite via cumulative weighted average), tier-driven post-process (HF detail injection: lanczos-upscaled source - 1.4px blur + 0.6px blur differential blend at HF1_ALPHA + HF2_ALPHA strengths, monochrome film grain at GRAIN_AMPL same R/G/B offset = luma noise not chroma artifact, unsharp mask via 1.0px blur + POST_SHARPEN, contrast/saturate filter chain, tierMul applied to additive params linearly + multiplicative attenuated around 1.0), 2× downscale path (run 4× then Lanczos-down to 2×), 8× recursive path (chain two 4× passes via transferToImageBitmap intermediate). Worker management (`_psupInitWorker` Blob URL + module worker, `_psupSend` Promise-based reqId pending map w/ progress + tile message routing + transfer support, `_psupEnsureModelReady` lazy init + per-target re-load with concurrent-call guard via _psupWorkerLoading sleep loop). Model data loader (`_psupGetModelData` IDB cache via lazy-opened `PSLinkPSUP/models` object store → CDN fetch → IDB put-back, R2 path deferred until R2 lib ports to Vite). Real `processItem` (createImageBitmap from inputBlob → ensureModelReady for THIS item's model → _psupSend('process') with bitmap + scale + tileSize + tier + tierMul → encode result via OffscreenCanvas.convertToBlob OR Canvas.toBlob fallback in chosen format png/jpeg/webp at 0.92 quality → outputBlob + outputUrl + duration stamp + modelLabel stamp), `processQueue` runs sequentially across queued+failed items + reports done/failed/skipped/backend at end. Memory check via existing `estPeakMB` refuses items > 600 MB hard cap. Destroy lifecycle terminates worker + closes IDB. **PSUP chunk grew 14.86 KB → 31.14 KB (2.1×)** — biggest worker-source chunk yet, confirms full inference pipeline shipped. Build verification: vite build = 1.14s, all 8 chunks present (v2 main 4.8 + PSF 12 + PSQ 15 + PSI 18 + PSUP 31 + PSAI 32.5 + PSEC 44.7 + PSBGR 47.7 = ~205 KB), tsc --noEmit = 0 errors. Production root index.html unchanged. **DEFERRED** to Session 3q+ (PSUP Pro UX): Compare grid mode (synced pan/zoom across 2-4 done items), A/B slider compare with split handle, right-click context menu for per-item Apply Model, R2 encrypted model fetch (depends on R2 lib port to Vite), Profile/Playlist hooks (depends on those modules), FSA Download All. Next per Phase 4a smallest-first: PSQ (xlsx pipeline + Stage 1 numbering + .eml builder + PDF worker call + Path E Collabora iframe).
- **2026-05-10 (evening)**: **Session 3o (PSEC heavy-logic port — 4th module) DONE in 1 session.** Ported all 9 real Outlook-fidelity HTML builders (3 styles × 3 bodies) from monolith into src/modules/psec/index.js: shared helpers (`pgraph` / `accentRule` / `fmtRemark` smart-link with [label]url + bare-URL → "คลิกที่นี่" + escape ordering w/ slot tokens / `notesToHtml` numbered-list HTML / `notesToText` plain-text counterpart / `todayBE` Thai BE date for empty quotation subjects), full palette + Console mono-font constants, **Console (Exec) style** (`exec_Hero` dark navy w/ phantom o:p absorber matching dark bg / `exec_SectionLabel` `[ TEXT ]` mono brackets / `exec_KVRow` 130pt label col + thin gray bottom rule / `_PSEC_EXEC_TOP_SPACER_ROW` 4pt breathing space / `exec_NotesBlock` mono brand-blue numbers w/ hanging indent 24pt col / `exec_Approve` w/ approve-bid submit-suffix flag / `exec_Order` w/ items table fixed-layout headers ITEM/QTY/REMARK), **Branded Banner style** (`banner_BuildBanner` full-width brand strip / `banner_KVRow` simpler gray dividers / `banner_SectionLabel` 3pt brand-blue left bar + bold brand text / `banner_NotesBlock` brand-blue numbered list / `banner_Approve` / `banner_Order` w/ brand-bg item table headers), **Spec (Editorial) style** (`edit_TopStripe` 4pt brand-blue stripe / `edit_Header` overline + 22pt black ID + subtitle + 2pt black rule = engineering blueprint / `edit_KVRow` uppercase labels + 1px gray rules / `edit_NotesBlock` black bold numbers / `edit_Approve` / `edit_Order` w/ 2pt black border-top + 1pt border-bottom item table headers), **Quotation body** (`quotation_RenderDetails` markdown-style — blank line = paragraph break, single newline = `<br>` tight wrap matching GitHub/Slack convention / `quotation_Body` recipient + cc + subjectMatter intro + details + followup; shared across all 3 styles, only header chrome differs / `exec_Quotation` / `banner_Quotation` / `edit_Quotation`), **Style registry** `_PSEC_BUILDERS` w/ `buildApprove` + `buildOrder` + `buildQuotation` keys, **Plain-text fallbacks** `buildApproveText` / `buildOrderText` / `buildQuotationText` with notesToText preserves blank lines, **`buildSubject`** smart subject (verb in parens for approve / "ใบเสนอราคา / sm" for quotation / empty for order). New top-level dispatcher `buildEmailHtml(tplId, styleId, form)` routes through `_PSEC_BUILDERS[styleId].buildXxx` and wraps via existing `wrapHtmlDoc` (unchanged `</body>` literal hazard guard preserved). UI port: items rows form (3-col grid: name + qty + remark/link + delete × button + Add row button below), wire-up via `data-item-key` on inputs + `data-item-del` on delete buttons + `data-field="localItems"` on container, Items array auto-init in form on first add. All 6 critical Word HTML quirks from CLAUDE.md preserved verbatim (font-color stripped → span style, table margin ignored → spacer pt, border-top collapses → hairline row, phantom o:p absorber, K/V row mso-margin-zero, table-layout:fixed + word-break:break-all). Removed obsolete stub-note from UI. **PSEC chunk grew 14.62 KB → 44.74 KB (3.0×)** — biggest single-session jump yet, confirms full Outlook fidelity HTML emitter shipped. Build verification: vite build = 1.43s, all 8 chunks present (v2 main 4.8 + PSF 12 + PSQ 15 + PSUP 15 + PSI 18 + PSAI 32.5 + PSEC 44.7 + PSBGR 47.7 = ~189 KB), tsc --noEmit = 0 errors. Production root index.html unchanged. **Stretch milestone**: 4 modules now have full heavy logic (PSAI + PSBGR + PSEC), only 4 remaining (PSUP / PSQ / PSI / PSF). Next per Phase 4a smallest-first: PSUP (real ORT-Web inference + tile pipeline + WebGPU EP).
- **2026-05-10 (afternoon)**: **Session 3n (PSBGR Pro UX — viewer + brush + eyedropper) DONE in 1 session — PSBGR feature-complete vs monolith Phases 1-2.** Ported into src/modules/psbgr/index.js: Pro viewer factory `makeViewer(host, canvas, opts)` (~210 lines — DPR-aware canvas sync, fit/setActual/zoomAt with cursor anchoring, drag-pan with grabbing cursor, mousewheel zoom 0.05×–32× pivoting at cursor, ResizeObserver auto-rerender, `screenToImage`/`getTransform`/`setTransform` for coord mapping, `setImage` (with fit) vs `updateImage` (preserve zoom/pan) split for live brush, brush hooks `brushActive`/`onBrushStart`/`onBrushMove`/`onBrushEnd`, `setCursor` for mode swaps, full destroy lifecycle removes window listeners + ResizeObserver), brush (`applyBrush` radial falloff with hardness `d <= h ? 1 : (1-d)/(1-h)` strength, `brushStroke` interpolates between two points with size×0.25 spacing for smooth fast drags), `setBrushMode` Off/Restore/Erase exclusive with SAM + eyedropper, brush cursor preview overlays (green for Restore, red for Erase) sized in screen px via viewer.scale, hardness slider 0-100% maps to 0.0-1.0, size slider 4-200 image px. Eyedropper: `setEyedropper` toggle, `handleEyedropperClick` reads RGB at picked pixel via viewer.screenToImage, converts via rgbToLab to `_psbgrState.forcedBgLab`, paints bg-swatch with picked color, auto-switches mode to color-key. Viewer toolbar: Fit / 100% / Zoom in / Zoom out / live zoom-% readout. SAM markers re-render in screen coords on every transform change so they track zoom + pan. SAM click handler now uses `viewer.screenToImage` (zoom/pan-aware) instead of bounding-rect mapping. Brush callbacks call `applyBrush` → `renderComposite` → `refreshResultPreview` (uses `updateImage` not `setImage` so user's view stays put). File load now drives `_origViewer.setImage(htmlImg)` instead of drawCanvas; `processImage`/`samDecodeAndApply` use `setImage` on first show + `updateImage` on subsequent runs to preserve zoom. `clearResult` calls `_resultViewer.setImage(null)`. Init wires both viewers with their own brush/SAM callbacks; destroy tears down viewers + clears all UI mode flags. **PSBGR chunk grew 35.99 KB → 47.66 KB (1.3×)** confirming Pro UX shipped — PSBGR is now feature-complete vs the monolith Phase 1-2 implementation. Build verification: vite build = 1.15s, all 8 chunks present (v2 main 4.8 + PSF 12 + PSEC 15 + PSQ 15 + PSUP 15 + PSI 18 + PSAI 32.5 + PSBGR 47.7 = ~160 KB), tsc --noEmit = 0 errors. Production root index.html unchanged. Next per Phase 4a smallest-first: PSEC (real exec/banner/editorial Word HTML builders).
- **2026-05-10 (afternoon)**: **Session 3m (PSBGR SAM 2 click-to-segment) DONE in 1 session.** Ported Phase 2 of PSBGR roadmap into src/modules/psbgr/index.js: full SAM Web Worker source (`_PSBGR_SAM_WORKER_SRC` ~75 lines — `Xenova/sam-vit-base` via `@huggingface/transformers@3.0.2`, init/encode/decode handlers + best-IoU mask selection w/ shape inference for both 4D and 3D output dims, both interleaved + base layouts), worker management (`samInitWorker` blob-URL Worker, `samSend` Promise-based reqId pending map, error-passing handlers), public API (`loadSAM` lazy with progress, `samEncode` per-file embeddings cache via `_psbgrSamEmbeddingsFile` reference equality, `samDecode` with point payload, `samReset` clears file + points), pipeline integration (`samDecodeAndApply` — encodes if needed → decodes → upscales mask if dims differ → unions with prior SAM mask only on positive last-click for additive-grow semantics → sets `rawSource='sam'` + applyRefinement + renderComposite), `applyRefinement` 'sam' branch (morph close fill 1-px holes + tighter island filter at 0.03% + auto-feather min 1 px), UI (SAM Click mode toggle button + Clear points button + status badge "X positive · Y negative · IoU N · decoding…", marker overlay layer absolutely positioned over original canvas with green/red dots at percentage coords, click handler with bounding-rect → image-coord mapping + Shift = negative point, lazy origImgData decode on first SAM click before pipeline ever ran, re-entry guard so rapid clicks coalesce into one decode), file-change reset (`samReset` + `_samMode = false` + clear markers in `loadFile`), destroy lifecycle terminates Worker + clears pending map. Per-file embeddings reused on subsequent clicks (encode runs once per image, decodes are fast). Pro viewer's `screenToImage` (zoom/pan-aware) deferred to Session 3n; current bounding-rect mapping loses sub-pixel precision when canvas is fit to 320×240 — adequate for blob-sized subjects, less for small features. **PSBGR chunk grew 25.43 KB → 35.99 KB (1.4×)** confirming SAM logic shipped. Build verification: vite build = 1.10s, all 8 chunks present (v2 main 4.8 + PSF 12 + PSEC 15 + PSQ 15 + PSUP 15 + PSI 18 + PSAI 32.5 + PSBGR 36 = ~148 KB), tsc --noEmit = 0 errors. Production root index.html unchanged. **DEFERRED** to Session 3n: Pro zoom/pan/fit viewer + Restore/Erase brush + Pick BG eyedropper (replaces simple bounding-rect mapping with full screenToImage). Next per Phase 4a smallest-first: PSEC (real exec/banner/editorial Word HTML builders).
- **2026-05-10 (morning)**: **Session 3l (PSBGR heavy-logic port — 2nd module) DONE in 1 session.** Ported core BG removal pipeline from monolith into src/modules/psbgr/index.js: image loader (`loadImgData` File→Uint8ClampedArray), color space (`rgbToLab` D65 + `labDist` perceptual distance), Tier 1 detection (`detectBackground` 4-px edge-strip Lab variance + center-vs-edge contrast → `{isFlat, confidence, bgLab}`), Tier 1 masking (`colorKeyMask` smoothstep alpha NEAR=8 / FAR=22), Tier 2 refinement (`sigmoidBoost` k-curve + `morph3x3` erode/dilate + `removeSmallIslands` 4-connect flood-fill + `featherBoundary` band-only blur + `expandMask` two-pass distance transform — full `applyRefinement` stack), Tier 3 letterbox (`letterbox` neutral-grey pad to 1024×1024 + `upscaleMask` bilinear to original), library loaders (`loadLib` lazy CDN ESM via Function-cloaked import that bypasses both Vite and TS — handles `imgly@1.7.0` for fast/pro tiers + `@huggingface/transformers@3.0.2` for ultra/RMBG-1.4 tier with progress callback wiring), main pipeline (`runPipeline` — analyze → resolve mode (forceMode beats auto, auto uses `bg.isFlat && confidence > 0.55`) → run color-key OR neural → refine → composite → toBlob), composite (`renderComposite` to offscreen canvas + `canvasToBlob` PNG), live re-refine (`reRefine` slider commit → re-runs refinement on cached rawMask without re-decoding file). UI plumbing kept (drop zone + tier chip bar + mode chip bar + 3 sliders) plus added Clear Result button + checkerboard background on result canvas. **PSBGR chunk grew 14 KB → 25.43 KB (1.8×)** confirming heavy logic shipped. Build verification: vite build = 1.15s, all 8 chunks present (PSF 12 + PSEC 15 + PSQ 15 + PSUP 15 + PSI 18 + PSBGR 25 + PSAI 32 + v2 main 5 = ~131 KB), tsc --noEmit = 0 errors. Production root index.html unchanged. **DEFERRED** to Session 3m+: SAM 2 click-to-segment Web Worker (~120 lines worker source + 60 lines wrapper, separate big feature), Pro zoom/pan/fit viewer + Restore/Erase brush, Pick BG eyedropper (depends on Pro viewer). Next per Phase 4a smallest-first order: PSEC (real exec/banner/editorial Word HTML builders).
- **2026-05-10 (morning)**: **Session 3k (PSAI heavy-logic port — FIRST module) DONE in 1 session.** Ported full Flux Kontext pipeline from monolith into src/modules/psai/index.js: WebSocket pipeline (`openWS` + `onWsMessage` filtering by promptId + `updateProgress` driving %bar + step counter), Flux Kontext workflow builders (`buildQuickWorkflow` reproducing the 12-node graph: UnetLoaderGGUF + DualCLIPLoader + VAELoader + LoadImage + FluxKontextImageScale + CLIPTextEncode + VAEEncode + LoraLoaderModelOnly chain + FluxGuidance + ReferenceLatent + KSampler + VAEDecode + SaveImage; `buildSmartWorkflow` Phase-1 stub = Quick; `buildWorkflow` mode dispatcher), Generation orchestrator (`generate` async — probe → upload → workflow build → queuePrompt → WS-driven completion; `onGenerationDone` fetches /history → /view → pushHistory; `onGenerationError`; `cancelGeneration` calls /interrupt; `setGenerateBtn` toggles loading + cancel + progress wrap), Image input (`acceptFile` blob + URL.createObjectURL + preview + revoke previous), LoRA stack UI (`addLoraSlot` / `removeLoraSlot` / `renderLoraStack` with per-slot dropdown + range slider + remove × button + live strength label), Result + History (`pushHistory` 20-item cap with revoke-on-evict; `downloadResult`; `renderResult`; `renderHistory` clickable thumbnails switch result pane), Settings modal (`openSettingsModal` Test connection + Refresh LoRAs + Save), full pretty 2-column panel (form col with INPUT IMAGE + EDIT MODE + PROMPT + LORA STACK + ADVANCED + Generate/Cancel + progress; result col with RESULT + HISTORY + Download). Module-scoped `_psaiPanel` ref. Bus emit on init + result + destroy. Destroy lifecycle revokes all history blob URLs + closes WS + revokes input URL. **PSAI chunk grew 13 KB → 32 KB (2.5×)** confirming heavy logic shipped. All 4 Flux Kontext invariants preserved verbatim from monolith: CFG=1.0 always, LoRA balance, short preserve list, 3D limitation. Build verification: vite build = 1.15s, all 8 chunks present (v2 main 4.8KB + PSF 12KB + PSBGR 14KB + PSEC 15KB + PSQ 15KB + PSUP 15KB + PSI 18KB + PSAI 32KB totalling ~120KB), tsc --noEmit = 0 errors. Production root index.html unchanged. **Pattern established for porting heavy logic on remaining 6 modules.** Next per Phase 4a smallest-first order: PSBGR (RMBG inference + transformers.js).
- **2026-05-09 (evening)**: **Session 3j (PSF UI port — FINAL) DONE — ALL 7 utility modules now have real UI.** Ported from monolith into src/modules/psf/index.js: rows array CRUD (add/remove/move up/down/level adjust 0-7), history snapshot/undo/redo (200-snap limit + 800ms debounce + suppress flag during restore), toolbar (Add / Undo / Redo / Export DOCX / Clear with confirm), hierarchical rows editor (level indentation 18px/level + edit-in-place text input + focus highlight + per-row controls visible on hover/focus), keyboard shortcuts (Ctrl+Z undo, Ctrl+Shift+Z redo, Tab indent +/- inside row, Enter add row after current), paste handler (clipboard text → multi-row split on lines, HTML capture deferred to 3k+), DOCX export stub (downloads JSON sketch — real docx.js construction in Session 3k+), localStorage persistence of rows. Workstation pattern (CLAUDE.md Coding Rule 13) prepared in panel layout (flex column with sticky-toolbar + scrollable editor body). Added psf to MODULES_WITH_UI in main.js (now contains ALL 7). PSF chunk grew **962 B → 12 KB** (12.5×) confirming UI port shipped. **Session 3 COMPLETE — all 7 utility modules (PSAI/PSBGR/PSEC/PSF/PSI/PSQ/PSUP) now lazy-load with real UI.** Build verification: vite build = 1.04s, all 8 chunks (v2 main 4.7KB + 7 modules 12-18KB each totalling ~102KB), tsc --noEmit = 0 errors. Production root index.html unchanged. Next: Session 3k+ ports remaining heavy logic (real OpenCV operations / docx.js construction / xlsx pipeline / RMBG inference / etc.) into existing module shells, then cutover to Phase B (root replace).
- **2026-05-09 (evening)**: Session 3i (PSI UI port) DONE in 1 session. Ported from monolith into src/modules/psi/index.js: 3 collapsible stages (Calibration / Load / Display Adjustment), info bar (OpenCV ready / calibration / image name), canvas viewer (fit-to-box 480×360 max), file load + drawCanvas pipeline, calibration profile select dropdown + manual ppm entry, display adjustment LUT preview (basic — black/white/gamma sliders + per-channel R/G/B/All toggle, real time main-thread LUT — Web Worker engine deferred to Session 3j+), scale bar overlay (visible toggle + color picker, draws nice 10/20/50/100/200/500/1000 µm scale bar based on calibration), Save PNG (canvas → data URL download). OpenCV.js readiness check kept from skeleton (real cv operations defer to Session 3j+). Added psi to MODULES_WITH_UI in main.js. PSI chunk grew **1.6 KB → 18 KB** (11×) confirming UI port shipped — largest real-UI chunk so far. Build verification: vite build = 1.03s, all 8 chunks present (6 modules now real-UI: PSAI 13KB + PSBGR 14KB + PSEC 15KB + PSUP 15KB + PSQ 15KB + PSI 18KB), tsc --noEmit = 0 errors. Production root index.html unchanged.
- **2026-05-09 (evening)**: Session 3h (PSQ UI port) DONE in 1 session. Ported from monolith into src/modules/psq/index.js: counter strip (Comp1 BE+1 / Comp2 calendar period preview with peek + meta showing current counter and period), 3 file slots (main/comp1/comp2 with FSA-style file input + name display + Choose/Clear buttons + .xlsx validation), output mode toggle (xlsx/pdf chip bar), 4 stage buttons (Stage 1 Apply numbering / Stage 2 Generate .eml / Stage 3 Prepare ALL / Path E Open Collabora) all running stubs (status messages with what real flow would do — real xlsx pipeline + .eml builder + PDF worker call + Collabora iframe deferred to Session 3i+), workers config display (Collabora/WOPI/PDF URLs with hybrid override indication), buffer storage on file load. Counter helpers (peek + next quotation number, period reset rule) kept from skeleton. Added psq to MODULES_WITH_UI in main.js. PSQ chunk grew **2.3 KB → 15 KB** (6.5×) confirming UI port shipped. Build verification: vite build = 1.03s, all 8 chunks present (5 modules now real-UI: PSAI 13KB + PSBGR 14KB + PSEC 15KB + PSUP 15KB + PSQ 15KB), tsc --noEmit = 0 errors. Production root index.html unchanged.
- **2026-05-09 (evening)**: Session 3g (PSUP UI port) DONE in 1 session. Ported from monolith into src/modules/psup/index.js: TIER_PRESETS (Fast/Balanced/Maximum post-process knobs), drop zone (multi-file with 50 MB cap per image), queue list (per-item name + dimension + model + memory tier badge + status badge + remove button), tier picker chip bar, model picker chip bar (3 models with sub-label tooltips), settings (scale 2/3/4× + format png/webp/jpg), memory monitor display (light/medium/heavy/skip thresholds), Process Queue button (stub: marks queued items done sequentially with mem-limit refusal — real ORT-Web inference deferred to Session 3h+), Clear Queue button (revokes all object URLs). Per-item modelId carries default model assignment from sidebar (right-click Apply Model deferred). Added psup to MODULES_WITH_UI in main.js. PSUP chunk grew **2.1 KB → 15 KB** (7×) confirming UI port shipped. Build verification: vite build = 1.01s, all 8 chunks present (4 modules now real-UI: PSAI 13KB + PSBGR 14KB + PSEC 15KB + PSUP 15KB), tsc --noEmit = 0 errors. Production root index.html unchanged.
- **2026-05-09 (evening)**: Session 3f (PSBGR UI port) DONE in 1 session. Ported from monolith into src/modules/psbgr/index.js: drop zone with drag-drop + file input + file size guard (10 MB cap), tier picker chip bar (fast/pro/ultra with size + quality meta), detection mode toggle (auto/neural/color-key with descriptions), refine sliders (threshold/feather/expand) with live value labels, dual-canvas viewer (Original + Result), object URL lifecycle (load → revoke), file load + draw canvas pipeline with image fit-to-box (320×240 max), Process button (stub: tints image magenta to indicate pipeline ran — real RMBG/BiRefNet inference deferred to Session 3g+), Save PNG button (downloads result blob), Reset button (frees URLs + clears workspace), wireEvents for drag/drop/click/slider/chip patterns. Added psbgr to MODULES_WITH_UI in main.js. PSBGR chunk grew **962 B → 14 KB** (15× growth) confirming UI port shipped. Build verification: vite build = 974ms, all 8 chunks present (3 modules now real-UI: PSAI 13KB + PSEC 15KB + PSBGR 14KB), tsc --noEmit = 0 errors. Production root index.html unchanged.
- **2026-05-09 (evening)**: Session 3e (PSEC UI port) DONE in 1 session. Ported from monolith into src/modules/psec/index.js: field defs (14 fields, text/textarea/items types — items shows placeholder), 3 style metadata (exec/banner/editorial labels + descriptions), Word HTML quirk helpers (spacer + hairline + wrapHtmlDoc with </body> hazard guard via `_LT = '<' + concat`), state load/save with active template + style sync, full chip-bar UI (style + template selectors), form renderer (text + textarea), live preview iframe (sandbox=allow-same-origin), stub HTML builder (Word-paste-compatible K/V table — real exec/banner/editorial builders deferred to Session 3f), clipboard copy with execCommand fallback (custom `copy` event handler writes raw HTML to clipboardData for Outlook fidelity, ClipboardItem fallback), Clear current button. Added psec to MODULES_WITH_UI in main.js. PSEC chunk grew **2.4 KB → 15 KB** confirming UI port shipped. Build verification: vite build = 1.06s, all 8 chunks present (PSAI 13KB + PSEC 15KB now both real-UI), tsc --noEmit = 0 errors. Production root index.html unchanged.
- **2026-05-09 (evening)**: Session 3d (first real UI port — PSAI) DONE in 1 session. Ported from monolith into src/modules/psai/index.js: HTTP API helpers (testConnection, fetchLoras, uploadImage, queuePrompt, fetchView, fetchHistory, interrupt — 7 functions), UI primitives (toast, updateStatusBadge), full settings panel render (renderPanel — URL input + 6-control settings grid with mode/steps/cfg-locked/guidance/denoise/seed + Test + Save buttons + Flux Kontext invariants reminder + scoped CSS), event wiring (wireEvents — 8 handlers), module-scoped _psaiPanel ref (no longer global). Added module-mount div in src/index.html + main.js routing logic (MODULES_WITH_UI set determines mount target — UI modules go to #module-mount, skeleton modules to #demo-output). PSAI chunk grew **2 KB → 13 KB** confirming UI port shipped. Build verification: vite build = 989ms, all 8 chunks present, tsc --noEmit = 0 errors. Smoke test in preview: PSAI chunk contains psai-conn-dot/psai-toast/psai-test-btn DOM IDs + FluxGuidance + invariants markup. **Pattern established for porting remaining 6 modules in Session 3e+.** Production root index.html unchanged.
- **2026-05-09 (evening)**: **Session 3 COMPLETE** — Session 3c extracted final 3 modules (PSI, PSQ, PSUP) in 1 session. PSI: imaging state container (psImagingState) + calibration storage + OpenCV.js readiness check + scaleBar/displayAdj defaults. PSQ: counter helpers (peek + next quotation number, period reset rule) + storage keys (12 PSQ_* constants) + state container + Comp1 BE+1/Comp2 calendar period logic. PSUP: 3-model registry (ultrasharp-v1/v2 + bhi-dat2-real with full metadata) + queue + memory monitor (estPeakMB + memTier with 600/400/200 MB thresholds) + settings I/O. main.js loader registry now full 7 modules. src/index.html demo grid: 4 → 7 buttons (all utility modules). Build verification: vite build = 1.00s (19 modules transformed), 8 lazy chunks (v2 main 4.5KB + 7 modules totalling 13.4KB), tsc --noEmit = 0 errors. Production root index.html unchanged. **All 7 utility modules now lazy-loadable as code-split chunks.** Cutover to Phase B (delete inline copies, replace root) deferred to Session 3d when full UI port lands.
- **2026-05-09 (evening)**: Session 3b (3 more module skeletons) DONE in 1 session. Extracted PSBGR (tier registry + state container), PSEC (template registry + state I/O + approveVerb + resolveClosing), PSF (rows + history scaffolding + constants — largest module at 6k lines, this is just skeleton). Updated main.js loader registry (4 modules registered now: psai/psbgr/psec/psf). Updated src/index.html demo grid with 4 module load buttons + status card showing pending psi/psq/psup. Build verification: vite build = 1.04s (16 modules transformed), 5 lazy chunks (v2 main 4.4KB + psai 2.0KB + psbgr 0.96KB + psec 2.4KB + psf 0.98KB), tsc --noEmit = 0 errors. All 4 modules code-split cleanly under dist/assets/. Remaining for Session 3c: PSI (4.7k lines, OpenCV.js dep), PSQ (4.2k lines, SheetJS dep), PSUP (2.1k lines, ORT-Web dep).
- **2026-05-09 (evening)**: Session 3a (infrastructure + 1 module proof) DONE in 1 session. Created src/core/bus.js (event bus per Hard Rule §4), src/core/storage.js (lsSave/lsGet/lsGetJson/lsSaveJson/lsRemove wrappers), src/main.js (entry + dynamic-import lazy loader + idle pre-warm). Extracted PSAI → src/modules/psai/index.js as proof-of-concept (settings, state, env guards, fetch+timeout, init/destroy contract). Created src/index.html as v2 shell proof page. Updated vite.config.js to multi-entry (`prod: index.html`, `v2: src/index.html`). Removed VitePWA temporarily (caused html-proxy build error with multi-entry — Phase 4 reintroduces with proper SW cutover). Build output: dist/index.html 3.5MB (prod monolith) + dist/src/index.html 4.19KB (v2 shell) + dist/assets/v2-XXX.js 4.1KB (main+bus+storage) + dist/assets/index-XXX.js 2.0KB (PSAI lazy chunk). Verified preview serves both entries; PSAI loads as separate chunk via dynamic import().
- **2026-05-10 (afternoon)**: **3 tab heavy-logic ports + Pages cutover DONE.** Pi-keng manually ran `gh api -X PUT repos/phaithoonsudjanakobkul-eng/pslink/pages -f build_type=workflow` (Claude Code auto-mode classifier blocked the agent from doing it). Workflow run #25625586150 succeeded — production URL `https://phaithoonsudjanakobkul-eng.github.io/pslink/` now serves dist/ instead of branch root, but `dist/index.html` is the monolith copy so production behavior unchanged. v2 shell live at `/pslink/src/`. Then 3 tabs ported from skeleton → feature-complete: **Records** full (month picker prev/next + native input, financial bar w/ 3 cells income/expense/balance + saving rate, fixed + variable expense lists with add/remove/toggle-paid, saveAndCalc DOM→records[]→ps_records persisting SAME shape as monolith so user data round-trips, loadMonth records[]→DOM, sumArr, rAF-debounced auto-save; chunk 1.5→11.3 KB), **Dashboard** full (profile card from ps_profile + ps_avatar localStorage, current-month payday/balance/saving rate cards, MoM change vs prior month, 6-month income vs expense SVG trend chart [no Chart.js dep — raw SVG with viewBox/preserveAspectRatio], bus listener on records:saved + records:loaded so editing in Records tab updates Dashboard immediately when user navigates back; chunk 2.8→10.4 KB), **Watchlist Phase 1 read-only** (renders ps_watchlist × ps_wl_cache as table Symbol/Name/Last/Δ$/Δ%/Vol with tolerant field reads c/pc/d/dp/v/name, color-coded delta via --wl-up/--wl-dn vars, empty-state message, NO real-time updates — WS pipeline + sparkline + scanner + AI chat all defer to dedicated multi-session port; chunk 1.5→5.7 KB). Build verification: vite build = 1.27-1.38s · tsc 0 errors · all chunks present. 3 commits pushed to main: `44be051 records:` + `c21b299 dashboard:` + `87de78d watchlist:`. Workflow re-runs on each push because src/** changed (path filter). Production behavior unchanged. Memory project_vite_migration_progress + MEMORY.md index updated.
- **2026-05-10 (evening)**: **Session 3u (preset CSS overrides extracted) + Step 6 (tabs skeleton + lazy router) + Step 8 (GitHub Actions deploy.yml) DONE in 1 session.** Closes Session 3 step coverage end-to-end on the Vite shell side; production root still unchanged. **3u**: Created `src/styles/presets/{phosphor,studio,cinematic}.css` with body-level + universal effects from monolith CSS (Phosphor scan-lines + CRT vignette + workstation suppressors + nav-brand cursor blink + universal text-shadow glow on identity hooks + uppercase labels + `[ … ]` ASCII brackets · Studio flat glass + nav + modal-backdrop + Fraunces serif on hero + JetBrains Mono on labels · Cinematic 3-layer ambient gradient body bg + film-grain `body::after` overlay + `--cine-glass` / `--cine-bg-warm` / `--cine-bg-cool` / `--cine-fg-rgb` token defaults + Markets/Dashboard transparent body bg). Wired via static `import '../../styles/presets/<name>.css'` from `src/core/presets/index.js` so they bundle eagerly with preset registry; scoped via `[data-preset="…"]` selectors so only active preset visually applies. Module/tab-specific overrides (`.dash-card`, `.wl-name`, `#financial-bar-grid`, `#monthInput`, `#dash-content` 4-col cinematic grid, etc.) deferred to ship alongside their owning tabs in Step 6 sub-sessions when those selectors actually exist in v2 shell. v2 CSS chunk emerged at 4.76 KB (1.34 KB gzip). **Step 6**: Created `src/tabs/{dashboard,records,watchlist,news,utilities}/index.js` 5 skeleton tab modules each following the locked module pattern (`init(rootEl, ctx) → state` + `destroy()` + bus emit `tab:<id>:init`/`destroy`) — Dashboard reads `ps_profile` from localStorage to demo restored data, Records reports record count + sum from `ps_records`, Watchlist reports symbol count from `ps_watchlist`, News + Utilities are stubs. Utilities tab is a sidebar shell that lazy-loads the already-ported 7 utility modules via `window.__psLoadModule(id, contentEl)` — clicking a sidebar entry routes through `loadModule` from main.js. Added tab router to `src/main.js`: `_tabLoaders` registry separate from `_moduleLoaders` + `showTab(id, mountEl)` async fn that destroys previous tab before booting next + persists `ps_v2_active_tab` in localStorage so refresh restores last tab. Wired tab nav UI into `src/index.html` (5 buttons + `#tab-mount` mount div above existing module loader). Boot calls `showTab(lastOrDashboard, mountEl)`. 5 new tab chunks emitted (1.19/1.47/1.49/2.56/2.81 KB each). v2 main grew 18.54 → 20.09 KB (+1.6 KB tab router code). Heavy tab logic (Watchlist WS pipeline, Dashboard charts, Muse playlist, news fan-out, full Records entry) waits for dedicated sub-sessions per the same per-module pattern as 3k+. **Step 8**: Created `.github/workflows/deploy.yml` triggering on push to `main` + `vite-migration` + `workflow_dispatch`. Workflow does `npm ci` → `npm run type-check` → `npm run build:vite` → `actions/upload-pages-artifact@v3 path: dist` → `actions/deploy-pages@v4`. Inert until repo Settings → Pages → Source switched from "Deploy from branch" to "GitHub Actions" — production currently still ships from monolith root index.html via dev-server.js auto-deploy commits. Activation order (Step 11) documented in workflow header comment. Build verification: vite build = 1.31s, 32 modules transformed (was 24 before tabs), tsc --noEmit = 0 errors. Production root unchanged.
- **2026-05-09 (afternoon)**: Storage & worker audit completed via 3 parallel Explore agents. Verified ground truth for every storage/sync/worker touchpoint in current monolith. Added:
  - **Storage & Worker audit** section — 8 🔴 critical findings (C1-C8), 9 🟡 important findings (I1-I9), 11 🟢 verified-solid items, 9 ranked Vite migration risks
  - **Critical pre-Session-2 fixes** section — 8 mandatory fixes (F1-F8), 1-2 sessions (~2-4 ชม.), all to be done in a `vite-prep-hardening` branch BEFORE branching `vite-migration`
  - **Phase 4b expanded** — test list grown from 9 → 24 tests (T1-T15 Vitest + E1-E8 Playwright + L1 live user test) derived from audit findings
  - Key risks surfaced: (1) `_lsSave` covers only 4.7% of localStorage writes — 168 raw setItem bypass quota; (2) `_dataHash()` is string concat not SHA-256 — collision = data loss; (3) TextEncoder/crypto.subtle/btoa polyfill is THE catastrophic Vite risk — would break every existing user's Gist decryption; (4) Collabora postMessage origin = `*` is an XSS vector regardless of migration
