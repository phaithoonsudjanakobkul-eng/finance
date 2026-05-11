# PSLink Migration — Visual Parity Phase

**Decision committed**: 2026-05-10
**Owner**: Phaithoon (พี่เก่ง) + Claude (จูน)
**Sibling docs**: [MIGRATION-PLAN.md](MIGRATION-PLAN.md) (overall plan, lines 1-629)

This document is the entry point for the **visual port phase** that brings v2 from "feature-complete logic skeleton" to "looks like the monolith". A new Claude session reads THIS file first; only fall back to MIGRATION-PLAN.md for historical Phase A/B/C context.

---

## The decision

**Goal**: visual parity at level **B — Functionally identical**
- Layout, feature set, interaction, vibe match the monolith
- Implementation re-routed through preset registry / core utils / shared CSS where appropriate (do not re-port the duplicated CSS rules verbatim)
- 99% of users cannot tell v2 from monolith; small detail diffs OK

**NOT level A (pixel-perfect)** — wastes effort on duplicated CSS rules that should be cleaned during port
**NOT level C (improved)** — keep changes additive only; no design changes during the port phase

**Freeze rule**: as of 2026-05-10, the monolith stops receiving NEW features. Bug fixes only on the monolith side. Every new feature lands in v2. This stops the moving-target problem.

---

## Pre-flight checklist (READ BEFORE STARTING)

1. **Production URL still serves the monolith** at `https://phaithoonsudjanakobkul-eng.github.io/pslink/` — pi-keng uses this every day. Don't break it. v2 cutover happens at the END of this phase (see Cutover sequence).
2. **`/src/` with trailing slash required** when running `npm run dev:vite`. Without slash, Vite serves the monolith. The launcher `dev-v2.bat` and the `dev:vite` npm script both pass `--open /src/` so the browser auto-lands correctly.
3. **Production root URL ≠ v2 shell URL**:
   - `pslink/` → monolith (root `index.html`)
   - `pslink/src/` → v2 shell
   - Pi-keng will keep using `pslink/` until cutover. v2 work is parallel.
4. **`MIGRATION-PLAN.md` is the historical record**. Do not re-read its 629 lines on every session — the past Sessions 1-3 are done. This file (`MIGRATION-VISUAL-PHASE.md`) is the forward-looking truth.
5. **Memory entries auto-load**. Check `MEMORY.md` index at session start for relevant project memories.
6. **Tests gate every commit**. After every change run:
   ```bash
   npm test         # 446+ unit · must stay green
   npx tsc --noEmit # 0 errors
   npm run e2e      # 16+ specs · runs ~10s
   ```

---

## Current state (2026-05-11, V1 shipped)

### What's done (logic layer — B-grade complete)

- **6 tabs** ported with feature-rich content (Dashboard / Records / Watchlist / News / Utilities / Settings)
- **7 utility modules** ported with real UI (PSI / PSQ / PSF / PSEC / PSAI / PSBGR / PSUP) inside Utilities tab
- **Top nav chrome** — sticky bar, brand, 6 pill tabs, clock, widget host (privacy toggle); dev panels collapsed in `<details>`
- **4 preset architectures** wired (Origin / Phosphor / Studio / Cinematic) with body-level CSS
- **Gist sync** read+push+auto with debounced auto-push and post-pull guard
- **PSI measurement family** (line / angle / area / freehand) + calibration profile modal + LUT Web Worker
- **Watchlist** WS pipeline + Alpaca + viewport culling + add/remove + sort + drag-to-reorder + scanner
- **Test harness** — Vitest 446 unit / 24 files + Playwright 16 e2e / CI gates type-check + tests + e2e before deploy
- **Shared utils** (core/escape, core/formatters, news/cache, watchlist/sort+reorder)
- **Path E URL helpers** (psq/wopi.js — 33 tests; iframe UI deferred)

### Visual phase progress

- **V1 Cinematic preset visual layer** — DONE 2026-05-11. `src/styles/presets/cinematic.css` extended with: shell chrome glass slab (`.ps-nav` / `.ps-tab-pill` / `.ps-clock` / `#tab-mount` / `.ps-dev-panel`), watchlist `.wl-row` alternating zebra glass tint + hover state, Records `#rec-prev/next/month/clone/clear` control-strip glass pills, `.rec-row` inline-style override strengthened, Dashboard `#dash-trend` SVG + `#dash-avatar` (initials-only) transparency, `.ps-brand-name` Fraunces serif. Records hero numbers (`#rec-payday` / `#sum-total-exp` / `#record-balance-val`) promoted to `--font-display`. All scoped under `html[data-preset="cinematic"]` so Origin/Phosphor/Studio are unaffected. Tests: 446 unit + 16 e2e green, tsc clean.
- **V2 Custom nav with avatar** — DONE 2026-05-11. Brand subtitle changed from `v2` pill to `PSLINK DATABASE`. Five new mountable widgets added: `src/widgets/avatar-chip` (32 px circle, ps_avatar thumbnail, click → Settings until V4 modal lands), `src/widgets/sync-status` (Gist sync dot — idle green / sync amber / error red, click = force pull), `src/widgets/save-button` (pending accent fill on edit bus events, click = force push), `src/widgets/theme-toggle` (☾/☀ in nav, re-applies active preset on flip), inline `#nav-settings-btn` cog → activate Settings tab. `src/core/gist.js` now emits `gist:syncing` + `gist:error` (in addition to existing pulled/pushed) so widgets can stay in sync. Cinematic preset extended with glass pills for every new nav control + accent-toned `.ps-brand-sub`. Tests: 446 unit + 19 e2e (3 new V2 specs) green, tsc clean.
- **V3 Dashboard hero row** — DONE 2026-05-11. Replaced the placeholder 4-card row (Profile/Month/Balance/MoM) with the monolith's 3-card profile hero: large 96 px avatar + name + role + company + contact list (phone / email / address) in card 1; "Next Payday" with 48 px numeral + days + actual date in card 2; "This Month" with 48 px day-of-month + "OF N" + month name in card 3. Profile fields read from `localStorage.ps_profile` JSON (`displayName / name / fullName`, `role / position / title`, `company / organization / org`, `email`, `phone`, `address`, `payday`). Pure helpers `_daysInMonth` + `_nextPayday` extracted from `src/tabs/dashboard/index.js` and unit-tested for leap year + month-rollover + day-clamp edge cases. Cinematic preset bumps hero numerals to 64 px Fraunces serif + stacks the 3 cards under 720 px. Tests: 457 unit (11 new payday/days-in-month specs) + 22 e2e (3 new V3 specs) green, tsc clean.
- **V4 Profile photo edit modal — Part A** — DONE 2026-05-11. `src/widgets/profile-edit/index.js` mounts a position:fixed modal (z-index 9000, NO `<dialog>`, NO portal per DON'T re-explore log) over the page. Flow: click `#nav-avatar` → pick file → preview in 280 px circular viewport → drag-to-pan + wheel-to-zoom + zoom slider → Save writes 128 px JPEG thumbnail to `localStorage.ps_avatar` and ≤1024 px JPEG full-res to IndexedDB key `avatar:full`. Emits `profile:avatar-changed` so nav avatar-chip + Dashboard 96 px avatar refresh without reload; emits `settings:changed` so auto-push picks up the new thumbnail. New shared `src/core/idb.js` (PSLinkMedia / blobs store, monolith-compatible) wraps initIdb / idbPut / idbGet / idbDelete. Pure crop math in `src/widgets/profile-edit/crop.js` (minZoom / clampPan / computeCropRect / centerPan / zoomAboutCenter) covered by 14 unit tests. Cinematic preset gives the modal panel its glass slab. R2 sync deferred to V5. Tests: 471 unit (14 new crop specs) + 23 e2e (1 new V4 spec) green, tsc clean.
- **V5 R2 sync for profile photo — Part B** — DONE 2026-05-11. New shared `src/core/r2.js` ports the monolith R2 pipeline (`deriveR2Key` HKDF SHA-256 / `encryptBlob` + `decryptBlob` AES-256-GCM with 12-byte IV / `r2Upload` PUT, `r2Download` POST against the pslink-r2 worker, `r2UploadEncrypted` + `r2DownloadDecrypted` high-level wrappers, `isR2Configured` guard). HKDF salt `PSLink-R2-v1` keeps R2 keys domain-separated from Gist. Profile-edit save now fires a best-effort `r2UploadEncrypted('profile/avatar.enc.jpg', fullBlob)` after the IDB write, emitting `profile:avatar-r2` on completion. Fresh-device path: `src/widgets/profile-edit/restore.js` `maybeRestoreAvatarFromR2()` is fired on `gist:pulled` — if IDB `avatar:full` is empty and R2 is configured, the encrypted JPEG is downloaded + decrypted + cached so the profile-edit modal has the full-res available offline next time. Tests: 481 unit (10 new R2 round-trip specs — derive + AES-GCM round-trip on text+random binary + IV non-determinism + config gating) + 23 e2e green, tsc clean.
- **V6 Muse slot UI + state** — DONE 2026-05-11. `src/widgets/muse/state.js` (pure, 28 tests) defines the storage shape — six presets A-F at `ps_muse_clips_{a..f}`, active preset idx, per-preset active-slot array, SHA-256 password hashes, fixed-or-auto visible slot count — round-tripping the monolith schema so cross-build users keep their data. SHA-256 hashing + verify use `crypto.subtle.digest`. `src/widgets/muse/index.js` mounts on Dashboard below the trend chart with: 6 preset pills (with lock icon when password set), edit-mode toggle that exposes drag-to-reorder + per-slot clear + set/clear-password controls, wheel-without-Ctrl cycles presets per CLAUDE.md memory. Mobile responsive (7 → 4 cols under 720 px). Cinematic preset gives the panel + slot tiles glass treatment + accent hover ring. Clip rendering (image / video / TikTok) lands in V7-V10; V6 ships visual placeholders so reorder/password/edit-mode can be validated standalone. Tests: 509 unit (28 new state specs) + 26 e2e (3 new V6 specs) green, tsc clean.
- **V7 Muse image clips + pan/zoom** — DONE 2026-05-11. `src/widgets/muse/pan-zoom.js` (pure, 18 tests) ports the monolith object-position + transform split — natural-cover overflow absorbed by `object-position`, zoom-induced overflow handled by `translate3d`. Round-trip helpers `syncFracFromPx` ↔ `syncPxFromFrac` keep pan device-independent for Gist sync (the panFracX/Y/zoom invariants in `project_muse_pan_zoom.md` are preserved). Muse widget now renders an **active hero** above the slot grid: drag to pan, Ctrl+wheel to zoom (1×–4×), wheel-without-Ctrl still cycles presets. Edit mode exposes "+ Add image" — file picker resizes to max 800 px JPEG (quality 0.85) before storing in `ps_muse_clips_*` as base64. Clicking any slot promotes it to active. Three no-flash invariants honored: applyHeroTransform early-returns on transient zero-width, always `translate3d(...,0)`, fraction is source of truth. Tests: 527 unit + 27 e2e (1 new V7 spec — seeded image hero renders) green, tsc clean.
- **V8 Muse video clips + WebM trim** — DONE 2026-05-11. `src/widgets/muse/video-trim.js` mounts a trim modal at z-index 9300 (above edit modal 9000 per Rule 19) when the user picks a video. UI: HTML5 `<video controls>` + start/end seconds inputs + Save (60s cap). On Save, a hidden canvas re-draws video frames in the trimmed range; `canvas.captureStream(30)` feeds a `MediaRecorder` (`video/webm;codecs=vp9` when supported, else `video/webm`, 2.5 Mbps). A frame at start is captured as the slot's base64 thumbnail. The encoded Blob is written to IndexedDB under `muse-video:{ts}:{rnd}.webm`. Slot stored as `{ type: 'video', idbKey, thumb, duration }`. Muse hero now plays video slots via `URL.createObjectURL(idbBlob)` — autoplay muted loop. R2 sync deferred to V9; advanced trim UX (filmstrip, crop, abort generation) deferred to V11. Tests: 527 unit + 28 e2e (1 new V8 spec — "+ Add video" appears in edit mode) green, tsc clean.

### What's missing (visual layer — the work of THIS phase)

| # | Item | Effort | Visible impact | Section below |
|---|---|---|---|---|
| 1 | Cinematic preset visual layer (glass cards · photo bg · 3-card profile row · backdrop-filter) — DONE 2026-05-11 | 1-2 sessions | **Highest** | [§1](#1-cinematic-preset-visual-layer) |
| 2 | Custom nav with avatar + brand chrome — DONE 2026-05-11 | 1 session | High | [§2](#2-custom-nav-with-avatar) |
| 3 | Dashboard hero row (Profile/Payday/Month 3-card layout) — DONE 2026-05-11 | 1 session | High | [§3](#3-dashboard-hero-row) |
| 4 | Profile photo upload + R2 sync (avatar + full-res) — DONE 2026-05-11 (Part A V4 + Part B V5) | 2 sessions | High | [§4](#4-profile-photo-subsystem) |
| 5 | Muse playlist port (Dashboard widget · 7 slots · video clip · pan/zoom · trim) — V6 slot UI DONE 2026-05-11, V7-V11 pending | **5-6 sessions** | **Highest** (size) | [§5](#5-muse-playlist) |
| 6 | Clock widget (drag/resize floating · stow gesture · context menu) | 1 session | Medium | [§6](#6-clock-widget) |
| 7 | AI chat FAB + popup (Watchlist tab · OpenRouter context) | 1-2 sessions | Medium | [§7](#7-ai-chat-fab) |
| 8 | Watchlist Quick Chart side panel (TradingView iframe) | 1 session | Medium | [§8](#8-watchlist-quick-chart) |
| 9 | PSQ Path E iframe UI (Collabora live editor) | 2-3 sessions | Module | [§9](#9-psq-path-e-iframe) |
| 10 | Mobile bottom nav + responsive layout | 2 sessions | Mobile users | [§10](#10-mobile-responsive) |
| 11 | First-time wizard | 1 session | New device only | [§11](#11-first-time-wizard) |
| 12 | PWA manifest + service worker | 1 session | Install/offline | [§12](#12-pwa-manifest--sw) |
| 13 | Cutover sequence | 1 session | One-shot flip | [§13](#13-cutover-sequence) |

**Total estimate**: 19-25 sessions for full visual parity + cutover.

---

## Port priority order

Reordered for **maximum visible progress per session** (ship most-impactful first so pi-keng sees v2 closing the gap each session):

```
Session V1   →  §1 Cinematic preset visual layer (CSS overrides)
Session V2   →  §2 Custom nav + avatar
Session V3   →  §3 Dashboard hero row (3-card layout)
Session V4-5 →  §4 Profile photo subsystem
Session V6-11→  §5 Muse playlist (5-6 sessions, biggest)
Session V12  →  §6 Clock widget
Session V13-14→ §7 AI chat FAB
Session V15  →  §8 Watchlist Quick Chart
Session V16-18→ §9 PSQ Path E iframe
Session V19-20→ §10 Mobile responsive
Session V21  →  §11 First-time wizard
Session V22  →  §12 PWA manifest + SW
Session V23  →  §13 Cutover (production root URL flips to v2)
```

Order rationale: 1-3 ship in 3 sessions and immediately make v2 feel "near monolith" — every later session adds real features, not chrome polish. Muse is intentionally not first because it's huge; cinematic chrome makes the Dashboard look right even before Muse lands.

---

## Per-item brief

### §1. Cinematic preset visual layer

**What**: when `data-preset="cinematic"` is set on `<html>`, paint the existing v2 cards with glass overlay, accent gradient, photo background bleed, Fraunces serif on hero numbers. The preset CSS file already exists at `src/styles/presets/cinematic.css` (body-level only). This session adds **module-scoped overrides**.

**Files affected**:
- `src/styles/presets/cinematic.css` (extend) — add overrides for `.dash-card`, `.wl-row`, `#financial-bar-grid`, `#monthInput`, `.ps-tab-pill`, `#tab-mount`
- `src/index.html` — add `data-preset="cinematic"` to `<html>` as the default for v2 (or keep Origin default, ship Cinematic as a switch)

**Acceptance**:
- Dashboard cards show backdrop-filter glass + accent border tint
- Watchlist rows show alternating subtle glass tint
- Hero numbers use Fraunces serif (already in `_PRESETS.cinematic.typography`)
- Switch to Origin preset → no glass, no serif (preset isolation works)
- All 446 unit + 16 e2e still green

**DON'T re-explore** (logged in `feedback_cinematic_thead_dont_touch.md` + `project_cinematic_backdrop_filter_flicker.md`):
- Don't put backdrop-filter on `<thead>` table-cell — bleed-through bug, 11 attempts failed in monolith
- Don't try SVG pre-blur to fix Chromium backdrop-filter flicker — already reverted, fidelity unacceptable
- Don't add `[data-theme="onyx"] #foo` per-element overrides — beats preset rules at (1,1,1 > 0,3,1) specificity, causes the FX-cards-stay-dark bug
- The `.ps-pill` shared class pattern in `project_pslink_pill_pattern.md` is the correct style

**Reference monolith CSS**: search `index.html` for `[data-preset="cinematic"]` — copy that block, port selectors that match v2 element IDs, reroute hardcoded values through `var(--cine-*)` tokens.

---

### §2. Custom nav with avatar

**What**: replace the "PSLink + v2 tag + 6 pill tabs + clock + privacy" nav with a richer chrome:
- Left: PSLink wordmark + small "PSLINK DATABASE" subtitle + avatar circle (32px, opens profile modal on click)
- Center: 6 pill tabs (current style is fine — keep)
- Right: SYNC button (with idle/syncing/error indicator) + SAVE button (records dirty indicator) + clock + theme toggle + privacy + settings cog → opens Settings tab

**Files affected**:
- `src/index.html` — extend nav HTML
- `src/widgets/sync-status/index.js` (new) — pulls from `bus.on('gist:pulled' / 'gist:pushed' / 'gist:error')` for indicator state
- `src/widgets/save-button/index.js` (new) — pulls from `bus.on('records:dirty' / 'records:saved')` (need to add `:dirty` event in records tab)

**Acceptance**:
- Nav matches monolith layout (positions, spacing, font sizes)
- SYNC button shows green dot when fresh, yellow on syncing, red on error
- SAVE button enables when records have unsaved changes
- Avatar opens profile edit modal (modal port deferred to §4)

**Avatar source**: `localStorage.ps_avatar` (base64 thumbnail, 128px). Full-res in IDB / R2 (deferred to §4 — for now, thumbnail is enough).

---

### §3. Dashboard hero row

**What**: replace the current 4-card row (PROFILE / MONTH / BALANCE / MOM CHANGE) with the monolith's 3-card profile row:
- Card 1: Profile (large avatar 96px + name + role + company + contact list — phone, email, address)
- Card 2: Next Payday (large day number + "DAYS" label + actual date)
- Card 3: This Month (large day-of-month + "OF 31" + month name)

Plus the existing 6-month trend below + pinned watchlist + LOW alerts (top of grid).

**Files affected**:
- `src/tabs/dashboard/index.js` — restructure render
- `src/styles/presets/cinematic.css` — Cinematic-specific styling (huge serif numerals)

**Acceptance**:
- 3-card layout at desktop, stacks at mobile
- Profile fields read from `localStorage.ps_profile` JSON
- Numbers in Fraunces serif at Cinematic preset
- 446 unit + e2e (add `dashboard-hero` spec) green

---

### §4. Profile photo subsystem

**What**: avatar upload + crop + thumbnail + full-res with R2 sync. Two parts:

**Part A** (1 session): edit modal. Click avatar in nav → modal opens with current photo + Upload + Crop (square) + Save. Saves thumbnail (128px JPEG) to `ps_avatar` localStorage and full-res to IndexedDB at key `avatar:full`.

**Part B** (1 session): R2 sync. Push full-res to `pslink-r2` worker as `profile/avatar.enc.jpg` (AES-GCM via HKDF). On fresh device, boot pulls thumbnail from Gist → swaps to full-res from IDB → fallback R2 download if IDB empty.

**Files affected**:
- `src/widgets/profile-edit/index.js` (new) — modal component
- `src/core/r2.js` (new) — R2 upload/download/decrypt helpers (port from monolith `_r2*` functions)
- `src/core/r2.test.js` — encryption round-trip tests

**Acceptance**:
- Upload + crop produces thumbnail under 50 KB and full-res under 5 MB
- Thumbnail in localStorage, full-res in IDB (verify with DevTools)
- R2 sync round-trip: upload → fresh device → pull thumbnail → full-res via R2 → matches original

**DON'T re-explore** (`project_profile_edit_modal.md`):
- Don't use `<dialog>` element + portal — z-index lift breaks splash transform stacking
- Don't use SVG mask / clip-path for crop — 4-strip approach failed
- The current monolith uses simple position:absolute lift + Lucide icon polish — copy that pattern

---

### §5. Muse playlist

**Biggest single port. 5-6 sessions estimated.**

5 sub-sessions:
- **V6** Slot UI + state — 7 slot cards on Dashboard, drag-to-reorder, password-protect logic, preset switcher (A/B/C/D/E/F/G presets each with own clip set)
- **V7** Image clips + pan/zoom — load image → display → drag pan + Ctrl+wheel zoom + pinch zoom (`object-position` + `transform translate3d` split per `project_muse_pan_zoom.md`)
- **V8** Video clips + WebM converter — load video file → trim modal (filmstrip + start/end markers) → MediaRecorder → WebM blob → save
- **V9** R2 video sync — encrypted upload to `pslink-r2` `muse/{a-f}/{sha256}.enc.webm`, lazy load via `_r2LoadVideoForElement`
- **V10** TikTok iframe slot type — embed TikTok player. **DON'T fix the restart-on-tab-return platform limit** (`project_muse_tiktok_iframe_limit.md` documents 4 failed attempts)
- **V11** Polish + Cinematic photo album row (215px portrait chips at bottom of Dashboard)

**Files affected**:
- `src/widgets/muse/` (entire folder — currently empty)
- `src/widgets/muse/index.js` — main controller
- `src/widgets/muse/state.js` — preset state, clip array, password hashing
- `src/widgets/muse/trim.js` — video trim modal (largest file, port from monolith `_museTrim*` functions)
- `src/widgets/muse/r2-clip.js` — R2 video upload/load
- `src/widgets/muse/pan-zoom.js` — image pan/zoom controller (port from `project_muse_pan_zoom.md`)

**Critical invariants (from memory)**:
- 3 no-flash invariants in `project_muse_pan_zoom.md` — preserve exactly
- Pan/zoom uses `object-position` + `translate3d` split — pure translate breaks at scale 1
- Wheel WITHOUT Ctrl is reserved for muse preset cycling (don't bind for zoom alone)
- Trim modal at z-index 9300 (above edit 9000), filmstrip extracts via async `toBlob`
- Async abort pattern: `_museTrimExtractGen` counter invalidates stale callbacks
- Storage limit: video clips compete with profile photo + settings in localStorage 5 MB pool — auto-evict regeneratable caches before save

---

### §6. Clock widget

**What**: floating clock widget (replaces nav clock as the "primary" — nav clock becomes secondary mini display). Drag to position, right-click context menu (color, font, show date), edge-hold gesture stows into corner FAB.

**Files affected**:
- `src/widgets/clock/index.js` (new — folder currently empty)
- `src/widgets/clock/index.test.js` (extract pure positioning math)

**Acceptance**:
- Drag positions stored in `ps_clock_pos` (per-theme: `_dark` and `_light`)
- Edge-hold-stow gesture works on every tab
- Visible on every tab (per CLAUDE.md — not Dashboard-only)
- Context menu: color + font + show-date + reset position

**DON'T re-explore** (project memory):
- No on-screen stow zone chrome (rejected as "ขัดหูขัดตา") — widget dims during edge-hold then snaps to FAB

---

### §7. AI chat FAB

**What**: floating action button on Watchlist tab (only). Click → popup panel with chat. Sends user prompt + `wlDataCache` context to OpenRouter. Markdown rendering for response.

**Files affected**:
- `src/widgets/ai-chat/index.js` (new — folder empty)
- `src/widgets/ai-chat/openrouter.js` — API client (uses `ps_openrouter_key`)
- `src/widgets/ai-chat/markdown.js` — minimal Markdown renderer (or reuse from monolith `renderMd`)

**Acceptance**:
- FAB visible only on Watchlist tab
- Popup respects safe-area insets on iOS PWA
- Context includes top 5 watchlist symbols + their cached `c/d/dp/v/name`
- Response renders Markdown (bold/italic/links/code blocks)

---

### §8. Watchlist Quick Chart

**What**: side panel that opens when user clicks a row → shows TradingView Lightweight Charts widget for that symbol. Already partially scaffolded — focus card exists with sparkline, this expands it.

**Files affected**:
- `src/tabs/watchlist/index.js` — extend `renderFocusCard` to add chart toggle
- `src/widgets/quickchart/index.js` (new) — TradingView widget mount

**Acceptance**:
- Click row → focus card opens with chart
- Chart respects timeframe preference (`ps_lwc_prefs`)
- Doesn't pile up iframes (single instance, swap symbol on row change)

---

### §9. PSQ Path E iframe

**What**: live xlsx editor inside PSQ panel via Collabora iframe. URL helpers already exist at `src/modules/psq/wopi.js` (33 tests). This adds the UI:
- "Open in Collabora" button per file slot in PSQ panel
- WOPI upload of xlsx → fileId
- Iframe mount with proper origin guard postMessage listener
- Save & Close → fetch updated xlsx → patch back to slot

**Effort**: 2-3 sessions. **Requires live test against Fly.io Collabora — cannot fully verify in CI.**

**Files affected**:
- `src/modules/psq/index.js` — Path E button + iframe state machine
- `src/modules/psq/path-e.js` (new) — upload/iframe lifecycle
- `src/modules/psq/path-e.test.js` — state-machine transitions

**DON'T re-explore** (`project_pslink_hybrid_tailscale.md`):
- Collabora **always** runs on cloud Fly.io (Tailscale clipboard sub-cell text bug)
- Don't add Tailscale fallback for Collabora — only PDF worker has Hybrid
- Cool asset hash is pinned at `4610258811` — bump together with `flyctl deploy` of pslink-collabora

---

### §10. Mobile responsive

**What**: bottom tab nav on mobile (replace top nav at < 640px), responsive layouts for all tabs, portrait-only enforcement.

**Files affected**:
- `src/index.html` — bottom nav HTML (hidden at desktop)
- `src/styles/responsive.css` (new) — breakpoints at 640/768/1024/1200/1800
- Each tab module — responsive variants

**Effort**: 2 sessions. **DON'T re-explore** (`project_cinematic_responsive_wip.md`):
- Mobile/iPad piecemeal port (backups 282-287 in monolith) didn't converge — needs dedicated UX/UI pass
- Cinematic stays at all viewports; no Origin fallback (pi-keng rejected "เพี้ยง")

---

### §11. First-time wizard

**What**: on fresh device with no data, show wizard: enter Gist token → pull encrypted data → land on Dashboard. Prevents new install from staring at empty Records/Watchlist.

**Files affected**:
- `src/widgets/wizard/index.js` (new)
- `src/main.js` — bootHydrate detects fresh device, mounts wizard before any tab

**Acceptance**:
- Fresh localStorage + no token → wizard mounts (not a blank tab)
- Token entry → pullFromGist → decrypt → "Welcome back" toast → Dashboard
- Wizard skipped on devices that already have data

---

### §12. PWA manifest + SW

**What**: installable PWA. Currently `vite.config.js` has VitePWA disabled (Session 3a comment) due to html-proxy build error.

**Files affected**:
- `vite.config.js` — re-enable VitePWA with proper config
- `manifest.json` (new) — name, theme_color, icons (port from monolith comment)
- Service worker — minimal precache + offline fallback

**DON'T re-explore**: VitePWA's html-proxy collision was caused by multi-entry build extracting inline CSS. Either drop multi-entry (cutover-time), or use a custom plugin that scopes to v2 only.

---

### §13. Cutover sequence

**One-shot session.** Sequence:

1. Verify v2 has reached visual + feature parity (acceptance: pi-keng can use v2 daily for one full session without missing anything from monolith)
2. Test on production preview URL (`pslink/src/`) using real data via Gist sync
3. Pi-keng (NOT Claude — auto-mode classifier blocks the agent) updates `vite.config.js`:
   ```js
   input: {
       prod: 'src/index.html',  // SWAP — was 'index.html'
   }
   ```
   Or simpler: copy `src/index.html` → `index.html` so root entry point IS v2 shell
4. CI builds + deploys → production URL `pslink/` now serves v2 shell
5. Monolith file → `legacy/index.monolith.html` for archival reference
6. Update CLAUDE.md to retire Rules 1-2 (single-file constraint, no build step)
7. Re-anchor line refs in CLAUDE.md Rules 13-26 to new v2 structure

**Rollback path**: `git revert <cutover-commit>` puts the monolith entry back. CI redeploys monolith. Total revert time ~5 min.

---

## DON'T re-explore log

These are **dead ends** logged in project memories. Re-attempting them wastes a session AND risks regressing.

- `feedback_cinematic_thead_dont_touch.md` — 11 in-table approaches for thead bleed-through, all failed (SUPERSEDED 2026-05-09 by external-bar pattern in `project_cinematic_thead_external_bar.md`)
- `project_cinematic_backdrop_filter_flicker.md` — SVG pre-blur reverted, accept the Chromium flicker
- `project_muse_tiktok_iframe_limit.md` — 4 attempts to keep TikTok playing on tab return, all failed (platform limit)
- `feedback_js_block_comment_trap.md` — never wrap unknown JS with `/* */` (inner `*/` breaks page); use `if (false) {}` or delete
- `project_pslink_hybrid_tailscale.md` — Tailscale + Collabora sub-cell clipboard fundamentally broken; Collabora cloud-only forever
- `project_profile_edit_modal.md` — 8 dead approaches for profile modal z-index; current pattern works
- `feedback_phosphor_effects_subtle.md` — start subtle, tune up if asked; max 2 shadow layers, no box-shadow + filter doubling
- `project_pslink_pill_pattern.md` — never re-add `[data-theme="onyx"] #foo` per-element overrides; they beat preset rules at specificity

---

## Session brief for incoming Claude

When you (the new Claude) start, before writing any code:

1. Read this file end-to-end (you're doing that now ✓)
2. Read [CLAUDE.md](CLAUDE.md) Persona + Rules sections (skip the architecture lore — it's stale during this phase)
3. Skim `MEMORY.md` index in `~/.claude/projects/.../memory/` to surface any DON'T-re-explore entries
4. Decide which item from §1-§12 to tackle this session (default: pick the lowest-numbered unfinished one)
5. Run `npm test && npx tsc --noEmit && npm run e2e` first to confirm green baseline
6. Make the changes — keep commits atomic per acceptance criterion
7. After every change rerun the test trio
8. Update this file's "Current state" section + memory entries when shipping a section

**Working agreement** (from prior session):
- Persona: คะ/ค่ะ, น้องสาวเรียนดี · ตรง · ไม่ filler · ไม่ขอโทษโดยไม่จำเป็น · ไม่ใช้อีโมจิ
- Push commits ONLY when pi-keng explicitly says so. Otherwise commit locally + summarize.
- Per CLAUDE.md Rule 16: backup `index.html` to `.backups/backupN - <description>.html` BEFORE every monolith edit. Visual phase mostly touches `src/**` so backups apply only when crossing into root files.

**End-of-session output expected**:
- Summary table: shipped commits + tests added + visual change in 1 line
- Updated `Current state` in this file
- Memory file updates if any pattern/decision crystallized

---

## Glossary

- **Monolith**: the 57k-line root `index.html` shipped to production
- **v2 / v2 shell**: the Vite-bundled shell at `src/index.html` (currently 165 lines + dynamic imports)
- **Preset**: theme aesthetic (Origin / Phosphor / Studio / Cinematic) — controls fonts/icons/density/motion via CSS vars
- **Mode**: color scheme (Slate light / Onyx dark)
- **Variant**: sub-flavor within a preset (Phosphor: classic/crt/modern/muted)
- **Cutover**: the moment when production URL `pslink/` flips from monolith → v2
- **Pi-keng / พี่เก่ง**: Phaithoon Sudjanakobkul, project owner
- **June / จูน**: Claude (you, the new session)
