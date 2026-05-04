# PSLink — Project Reference

## Persona (from `~/.claude/CLAUDE.md`)

- เรียกผู้ใช้ว่า "พี่เก่ง" เสมอ
- แทนตัวเองว่า "จูน"
- ห้ามใช้อีโมจิ เว้นแต่พี่เก่งขอ

### Tone — June
ภาพลักษณ์: น้องสาวเรียนดี แว่นกลม ยิ้มง่าย approachable ทำงานเป็น

**การพิมพ์**
- พิมพ์สั้น กระชับ ไม่ verbose
- ขึ้นต้นด้วย "พี่เก่งคะ" เวลา ping ก่อนตามด้วยเนื้อหา
- ลงท้าย "คะ" / "นะคะ" / "ค่ะ" สลับตามความเป็นทางการ
- ตอบรับด้วย "รับทราบค่ะ" / "ได้ค่ะ" / "เรียบร้อยค่ะ" / "อะเครค่ะ" ตามบริบท
- ไม่มี filler ไม่อธิบายความรู้สึก

**ความมั่นใจ**
- ถามก่อนแทนที่จะสรุปเอง
- Proactive แจ้งสถานะล่วงหน้า
- ไม่ขอโทษโดยไม่จำเป็น

## Overview

PSLink is a **single-file personal productivity PWA** (one HTML file: `index.html`, ~52k lines) combining:
- **Personal finance** — monthly income/expense tracker
- **Stock watchlist + market data** — Finnhub/Alpaca real-time, scanner, news, AI chat
- **Utility suite** in the Utilities tab — PS Quotation (PSQ), PS Upscaler (PSUP), PS AI Studio (PSAI), PS Background Remover (PSBGR), PS Micro Imaging (PSI), PS SpecFlow (PSF), PDF tools

The frontend is hosted on GitHub Pages ([production URL](https://phaithoonsudjanakobkul-eng.github.io/pslink/)) and runs entirely client-side. State persists across multiple tiers:

- **`localStorage`** — small text/JSON (settings, records, watchlist, API keys). Synced cross-device via encrypted GitHub Gist.
- **IndexedDB** — large binary blobs (Muse video clips, profile photos full-res, AI generated images, R2 cache).
- **Cloudflare R2** — encrypted media sync (avatars, photos, video clips) for cross-device.
- **Fly.io backend services** (PSQ Path E only) — `pslink-collabora` (live xlsx editor), `pslink-wopi` (WOPI host + xlsx recalc), `pslink-pdf-worker` (xlsx → PDF). Optional Hybrid mode runs the same Docker stack locally via Tailscale Funnel; Collabora + WOPI always cloud (Tailscale clipboard limitation — see Deployment & Hybrid Mode).

The app language is primarily **Thai** for UI labels and messages, with English for code/symbols/APIs.

## Architecture

### Single-File Structure

Everything lives in `index.html`:

```
<!DOCTYPE html>
├── <head>
│   ├── PWA meta tags (iOS + Android)
│   ├── Service Worker registration (sw.js — referenced but not yet created)
│   ├── Manifest link (manifest.json — referenced but not yet created)
│   ├── CDN dependencies: Tailwind CSS, Chart.js, Lightweight Charts, OpenCV.js (PSI), ORT-Web (PSUP), transformers.js (PSBGR)
│   ├── Google Fonts (Inter, JetBrains Mono, Oxanium, Share Tech Mono, VT323, Kanit, IBM Plex Sans Thai, etc.)
│   └── <style> — all CSS inline including:
│       ├── Design tokens via _applyPreset (typography/icon/shape/density/motion CSS vars)
│       ├── Color schemes: Slate (light, default) + Onyx (dark, html.dark + [data-theme="onyx"])
│       ├── Design presets: Origin (default) + Phosphor ([data-preset="phosphor"], dark-only, 4 variants)
│       ├── Responsive breakpoints (640px, 767px, 768px, 900px, 1024px, 1200px, 1800px)
│       └── Component-specific styles (watchlist, dashboard, scanner, muse, PSI, PSQ, PSUP, PSBGR, PSAI, PSF, etc.)
├── <body>
│   ├── Mobile bottom tab bar (hidden on desktop ≥640px)
│   ├── Modals (Gist token, confirm, settings, crop, news, Muse trim, PSQ editor backdrop, etc.)
│   ├── <nav> — fixed top navigation with avatar, brand, tab pills
│   ├── <main> — tab content:
│   │   ├── tab-dashboard — profile card, alerts, pinned watchlist, charts, muse
│   │   ├── tab-edit — income/expense records entry
│   │   ├── tab-watchlist — stock table, market scanner, quick chart
│   │   ├── tab-news — aggregated news feed
│   │   └── tab-utilities — module sidebar + content area: PSQ / PSUP / PSAI / PSBGR / PSI / PSF / PDF tools
│   └── Floating widgets (AI chat FAB/popup, clock widget)
└── <script> — all JavaScript inline (majority of file)
```

### Tab System

Navigation via `showTab(tabName)` which toggles visibility of `#tab-*` divs. Tabs:

| Tab | ID | Description |
|-----|----|-------------|
| Dashboard | `tab-dashboard` | Profile card, LOW alerts, pinned watchlist, Muse playlist, financial charts |
| Records | `tab-edit` | Monthly income/expense tracker with categories |
| Watchlist | `tab-watchlist` | Full stock table + market scanner + quick chart side panel |
| News | `tab-news` | Aggregated news feed from watchlist symbols |
| Utilities | `tab-utilities` | Module sidebar + content area: PS Quotation, PS Upscaler, PS AI Studio, PS Background Remover, PS Micro Imaging, PS SpecFlow, PDF tools |

### Data Flow

```
User Input / API Response
        ↓
  JavaScript State (global vars: records[], watchlist[], wlDataCache{}, _museClips[], _psupQueue[], etc.)
        ↓
  Storage tier (chosen by data type — see Coding Rule 14):
    • localStorage  — small text/JSON (records, watchlist, settings, API keys)
    • IndexedDB     — large binary blobs (Muse video clips, photos full-res, AI outputs)
        ↓
  Cross-device sync:
    • GitHub Gist (AES-256-GCM)             — text/metadata via _pushToGist + syncFromGist
    • Cloudflare R2 (AES-256-GCM via HKDF)  — encrypted media via _r2UploadClip / _r2UploadPhoto
        ↓
  Backend services (PSQ Path E only):
    • Cloud Fly.io (always)                 — Collabora live editor + WOPI host
    • Cloud Fly.io OR local Docker          — PDF worker (Hybrid: probe Tailscale Funnel, fall back to cloud)
```

## Key Subsystems

### 1. Financial Records (`tab-edit`)

- Global array: `let records = []`
- Stored as: `localStorage.ps_records` → JSON array
- Functions: `saveAndCalc()`, `loadMonth()`, `updateDashboard()`, `updateCharts()`

### 2. Stock Watchlist (`tab-watchlist`)

- Global array: `let watchlist = []` — list of ticker symbols
- Cache: `wlDataCache{}` — quote data per symbol
- Key functions:
  - `renderWatchlistRow(symbol, data)` — builds/updates table row
  - `fetchQuote(symbol)` — fetches real-time quote
  - `refreshWatchlist()` — batch refresh all symbols
  - `openQuickChart(symbol)` — opens side panel with TradingView chart
  - `saveWatchlist()` / `saveWlCache()` / `loadWlCache()`
  - `fetchAlpacaSparkline()` / `fetchFinnhubSparkline()` — movement sparklines
  - `updateWatchlistPriceCells()` — updates price/change cells with flash animation
- Sparkline cache: `saveSparklineCache()` / `loadSparklineCache()`
- Price flash: CSS animations `flashUp`/`flashDown` (alternating `-1` variants for restart)
- Watchlist table: `#watchlist-table` — fixed-layout table with 23 columns

#### 2a. WebSocket Tick Pipeline (perf-critical)

Real-time Alpaca + Finnhub ticks are coalesced via rAF batching so that a burst of 27-30 symbols updating in the same frame stays within the 6.94ms frame budget (144Hz):

- `_pendingTrades{}` — symbol → latest tick payload, accumulated between frames
- `_rafFlushQuotes()` — drains `_pendingTrades` once per `requestAnimationFrame`. Zero-alloc loop (for...in, no `Object.keys()`); shared `_frameTs` per frame avoids per-symbol `Date.now()`
- `_wsBackgroundMode` flag — when true, `_rafFlushQuotes` takes the **pinned-only path**: updates only `_pinnedSymSet` symbols via `_updatePinnedCellHot()` (skips full watchlist DOM writes). Set when user is on Dashboard/News/etc. (not Watchlist), cleared on watchlist tab entry.
- **`visibilitychange` rule**: on tab-visible, set `_wsBackgroundMode = wlTabHidden` (NOT unconditionally `false`) — must preserve per-tab state so Alt+Tab back doesn't falsely flip the pinned path off.
- `_suppressFlash` flag — set to `true` before a mass catchup (e.g., post-visibilitychange diff flush), reset after. Prevents "everything flashes at once" after Alt+Tab returns.

#### 2b. Viewport Culling (IntersectionObserver)

Off-viewport rows skip DOM writes entirely — burst ticks touching a symbol whose row is scrolled off don't trigger reflow/paint:

- `_wlHiddenRows: Set<symbol>` — symbols whose `<tr>` is currently off-viewport
- `_wlIntersectObserver` — populates `_wlHiddenRows` via intersection ratio; observer attached in `renderWatchlistRow` when the row is first built, unobserved + deleted on row removal
- `_handleTrade` guard: `if (_wlHiddenRows.has(sym)) return;` — skip hot-path render for off-screen rows. The row picks up fresh data from `wlDataCache` the next time it enters the viewport.
- **Never clear `_wlHiddenRows` on tab switch** — IntersectionObserver will re-populate naturally; clearing forces a storm of writes on rows that are still off-screen.
- Matching CSS on `.wl-row`: `contain: layout style paint`, `content-visibility: auto`, `contain-intrinsic-size: auto 40px`, `transform: translateZ(0)` — promotes each row to its own GPU layer and skips layout/paint for rows below the fold.

#### 2c. Sparkline Semantics (Movement column)

Sparkline = **regular session only** (09:30-16:00 ET, matches TradingView 1D). Pre/AH ticks update `wlDataCache.c` (LAST price) but **never** the sparkline. **3 invariants must hold together** (filter + market-open guard via `_isMarketOpenCached()` not `_frameMktOpen` + cache slice ≥ 320 bars) — full architecture, code refs, and 2026-04-21 bug chain in [`project_sparkline_semantics`](memory).

**Intentional divergence (do NOT "fix")**: when market closed, sparkline tip and LAST price legitimately diverge — by design. Pushing AH ticks into the sparkline to "sync them up" recreates the bug chain.

#### 2d. Two-Frame Staged Tab Switch

Entering Watchlist from another tab defers heavy work across two frames so the tab-pill click feels instant:

- Frame N+1 (inside `showTab` rAF): viewport-only catchup — only render rows currently visible
- Frame N+2: cleanup — flush any pending trades, re-apply column widths (`_applyWlCols`, `applyMobileWatchlistCols` below 1200px), clear `_suppressFlash`

### 3. Market Scanner

- Functions: `loadMarketScanner()`, `renderScannerData()`, `fetchHighVolPanel()`
- Tabs: Gainers / Losers × Regular / Pre-market / After-hours
- `setScannerTab(type, session, btn)` to switch

### 4. News Feed (`tab-news`)

- `loadNewsFeed()` — aggregates news from watchlist symbols
- `fetchStockNews(symbol)` — per-symbol news
- `renderNewsRow()` / `openNewsModal()` / `closeNewsModal()`
- Live polling with `_startNewsLivePolling()` / `_stopNewsLivePolling()`

### 5. AI Chat (Watchlist tab only)

- Floating action button (FAB) + popup panel
- Functions: `openAiPopup()`, `closeAiPopup()`, `fetchAiContext()`, `fetchTechnicals()`
- Uses OpenRouter API key (`ps_openrouter_key`)
- Markdown rendering via `renderMd()`

### 6. Muse Playlist (Dashboard)

- Media playlist with multiple presets (A/B/C/D/E/F)
- Password-protected presets (SHA-256 hashed)
- Auto-rotate, drag-to-reorder slots
- Stores in `localStorage` as `ps_muse_*` keys (metadata only for R2 clips)
- Key functions: `_museRenderSlots()`, `_museSaveCurrentPreset()`, `_museToggleEdit()`
- Toast routing: `_museToast()` routes to whichever layer is visible (trim modal > edit modal > card)
- R2 clips: `clip.storage === 'r2'` — video stored encrypted in Cloudflare R2, metadata only in localStorage/Gist. Loaded via `_r2LoadVideoForElement()` (IDB cache → R2 download → decrypt → display). Thumbnails loaded via `_r2LoadThumbForImg()`.

#### 6a. Muse Pan/Zoom on Still Images (cross-device sync)

Muse stills support drag-pan + Ctrl+wheel/pinch zoom (1×–4×), state synced via Gist using normalized fractions (`panFracX/Y` device-independent, derived to pixels on load via `_museSyncPxFromFrac`). **Architecture**: `object-position` + `transform: translate3d` split (pure translate breaks at scale 1; pure object-position breaks at zoom). Full architecture, 3 no-flash invariants, ResizeObserver wiring, Gist export shape, and **DON'T re-explore log** (translate-only / 2D transform / `will-change:transform` all failed — use `contain: paint` instead) in [`project_muse_pan_zoom`](memory).

**Hot keys (don't change):** drag = pan, Ctrl+wheel = zoom, **wheel WITHOUT Ctrl is reserved for muse preset cycling**, pinch = zoom, reset clears all.

#### 6b. Muse Video Trim (WebM converter)

- Trim modal: `#muse-video-trim-backdrop` (z-index 9300, above edit modal 9000)
- Pipeline: local video file → canvas capture → MediaRecorder → WebM blob → R2 (if configured) or base64 → localStorage
- State variables: `_museTrimStartTime`, `_museTrimEndTime`, `_museTrimExtractGen` (abort token), `_museTrimCropMode`
- Filmstrip extraction: 30 frames via async `toBlob()`, progressive rendering, pause/resume during drag
- Background seek: `_museTrimBgSeek()` — instant thumbnail + background video seek for smooth scrubbing
- Crop system: `_museCropRafLoop` — real-time canvas crop preview (9:16, 1:1, 16:9)
- Abort pattern: `++_museTrimExtractGen` invalidates all in-flight extraction callbacks (generation counter)
- Conversion: `_museTrimConvert()` — disables `ontimeupdate` during recording to prevent race conditions, uses `addEventListener('seeked', fn, {once:true})` instead of `onseeked` property to prevent other code from clearing it
- Storage limit: localStorage ≈5 MB total; video clips compete with profile photos + settings; auto-evicts regeneratable caches (logos, sparklines) when quota exceeded

### 7. PS Micro Imaging (`tab-utilities`)

- Professional microscopy image analysis suite
- OpenCV.js WASM engine for image processing
- Features: calibration, measurements (line/angle/area/freehand), histogram (ZEN-style display mapping with Catmull-Rom spline), annotations
- Keyboard shortcut: Ctrl+O to open image
- Functions prefixed: `_psi*` (e.g., `_psiHistCompute`, `_psiMERender`, `_psiCalib`)

### 8. Privacy Mode (nav eye icon)

- Masks all money/financial numbers with `•` dots via `-webkit-text-security: disc` (Chromium/Safari; Firefox shows text — acceptable for a demo/preview feature).
- Toggle: `togglePrivacyMode()` via nav eye icon. Class `html.privacy-on` drives the CSS rule.
- Persistence: `ps_privacy` localStorage + Gist `meta.privacy` boolean. `scheduleAutoSave()` fires on toggle so cross-device sync includes the state.
- **Pre-paint default for fresh device**: If `ps_privacy` is `null` (incognito / new install), inline script at `<head>` top adds `privacy-on` class BEFORE render so no real numbers flash during boot. `syncFromGist` reconciles: Gist true → stay on, Gist false → remove class, Gist missing + fresh device → default OFF (so first-time installers don't stay masked).
- Scoped elements: `#paydayDisplay`, `#sum-total-exp`, `#record-balance-val`, `#current-saving-rate`, `#sum-fixed`, `#sum-dynamic`, `#mom-change`, `#last-fixed-ref`, `#last-dynamic-ref`, `.dash-value`, `.expense-amount-wrap > input`. Watchlist/news/utilities NOT masked (stock prices are public info).

### 9. Clock Widget

- Draggable/resizable floating clock — **visible on every tab** (Dashboard, Records, Watchlist, News, Utilities), not dashboard-only
- Right-click context menu for color/font/date display
- Persisted position/style in `localStorage` (`ps_clock_pos`, `ps_clock_fab_pos`, `ps_clock_vis`, `ps_clock_color_{theme}`, `ps_clock_font`, `ps_clock_show_date`)
- **Stow via edge-hold gesture** — drag the clock to any screen edge and hold briefly to stow it into the corner FAB. No on-screen stow zone/chrome (rejected — "ขัดหูขัดตา"); the widget dims during the hold as visual feedback, then snaps into the FAB position.
- Legacy `ps_clock_color` (single global) is migrated to per-theme `ps_clock_color_{theme}` keys on first load.

### 10. PS Quotation (PSQ) — Utilities tab

Auto-fills competitor Excel quotations from a main file. Two competitor templates:
- **Comp1** (British Trading) — number format `BT{BE+1}{MM}-{counter}` (e.g. `BT257004-350`), counter starts at 350
- **Comp2** (QMVV) — number format `QMVV{MM}{YY}-{counter}` (e.g. `QMVV0426-700`), counter starts at 700
- Counter resets when the (year, month) period changes. Period key: Comp1 = `${BE+1}-${MM}`, Comp2 = `${YYYY}-${MM}`. BE year uses calendar `BE+1` regardless of month — NOT Thai fiscal Oct convention.

**Anti-bid-rigging**: date and validity vary deterministically per competitor file so quotes don't all share metadata. Cell mapping uses `_psqScanFor` keyword-scan (NOT hardcoded addresses) so templates can be edited freely.

**Storage**: `ps_psq_state` (counters + log) syncs via `psqState` field in `_buildExportData()` — Gist-only, no IndexedDB. Templates Comp1/Comp2 stored encrypted in Gist + IDB. Filenames slot-based (`comp1.xlsx` / `comp2.xlsx`), not name-based.

**Phase A (DONE 2026-04-29, milestone backup212)**: Stage 1 numbering + Stage 2 Distribute (8 tasks shipped) — `.eml` Outlook + Gmail authuser deep-link, Fly.io PDF render worker, pageSetup + NBSP + hide-non-first-sheets injectors.

**Phase A++ Editor — Path E (Collabora)**: live in-browser xlsx editor via embedded Collabora CODE iframe. Cloud Collabora **always** (Tailscale Funnel breaks Collabora's sub-cell text clipboard — see Deployment & Hybrid Mode). Local Tailscale handles only the PDF worker.

**Endpoint logic** (`_psqApplyEndpoint`): WOPI + Collabora always cloud (hardcoded). `_psqGetPdfWorkerConfig` is the only mode-aware accessor — uses `_psqLocalBase + ':10000'` when Hybrid local detected, falls back to `ps_pdf_worker_url` cloud value otherwise. `_psqDetectEndpoint` probes `${_psqLocalBase}:10000/health` with 1.5s timeout; success = local PDF, timeout = cloud PDF. Hybrid badge `PDF · LOCAL` / `PDF · CLOUD` reflects PDF route only.

**Per-device override** (`ps_psq_local_base_override`): NOT synced via Gist. When set, wins over the synced home URL. Refresh point in `syncFromGist` post-sync at line ~48422 ensures in-memory `_psqLocalBase` doesn't go stale (per Rule 21).

### 11. PS Upscaler (PSUP) — Utilities tab

In-browser image super-resolution via **ORT-Web 1.22 + WebGPU EP**. Three models in `PSUP_MODEL_REGISTRY`:

| ID | Arch | Tile | tierMul | Notes |
|---|---|---|---|---|
| `ultrasharp-v1` | ESRGAN | 192 | 1.0 | Kim2091 2022 · CC-BY-NC-SA |
| `ultrasharp-v2` | DAT2 | 128 | 0.5 | Kim2091 2024 · multi-domain |
| `bhi-dat2-real` | DAT2 (static 128×128) | 128 | 0.4 | Phhofm Dec 2024 · BHI dataset · converted locally |

**FP32 only — DAT2 FP16 conversion fails** (Cast op type mismatch with `onnxconverter-common.float16`). Don't retry. ESRGAN baseline-soft → tier 1.0×; DAT2 baseline-sharp → tier ×0.4–0.5 to soften HF/grain post-process.

**`freeDimensionOverrides` is REQUIRED** for WebGPU EP. ESRGAN models use dynamic axes; BHI uses static 128×128 (DAT trace bakes window-attn integer math).

**Per-item model assignment**: `it.modelId` per queue item. Sidebar Default Model + per-item right-click Apply Model. Worker re-loads model lazily when next item differs (~10s first time per model, IDB-cached after).

**Tier system**: `TIER_PRESETS` (Fast/Balanced/Maximum) inside worker. Per-model `tierMul` attenuates additive (HF/grain/sharpen) and multiplicative params via `1 + (val-1)*mul` — so Balanced on BHI gets 0.4× the boost UltraSharp v1 gets.

**Compare grid**: 2-4 selected items render side-by-side with synced pan/zoom (`viewScale, viewTx, viewTy` shared across panels).

**Memory monitor**: `PSUP_MEM_LIMIT_MB = 600` hard refuse · 400 warn · 200 caution. Items above 600 MB tagged `.will-skip`.

**Key file refs**: Registry ~line 13705, worker `_PSUP2_WORKER_SRC` ~13407, per-item `processItem` ~15327, Compare grid `render()` ~14533. Model conversion (Python via spandrel + torch.onnx) at [project_psup_model_conversion](memory).

### 12. PS AI Studio — Utilities tab

ComfyUI hybrid AI image-edit module. Phase 1 done end-to-end. PSLink browser ↔ ComfyUI Desktop on user's RTX 3060 (6GB) via local CORS. Flux Kontext Q4_K_S + 4 LoRAs ≈ 2-3 min/image at 24 steps.

**Flux Kontext invariants (do NOT violate):**
1. **CFG = 1.0 ALWAYS** — Flux is guidance-distilled. CFG > 1.0 produces blurry/over-saturated output and frequently *ignores the prompt entirely*. Real guidance comes via `FluxGuidance` node (Kontext recommends 2.0-3.0, default 2.5). 2026-04-26 incident: CFG=2.5 made Body_Adjuster LoRA appear inactive.
2. **LoRA balance**: morph-LoRAs (e.g. `Body_Adjuster_kontext`) and preserve-LoRAs (`kontext_hires`, `high_detail`) push opposite directions. Working ratio: morph ≥ 2× preserve strength. `Body_Adjuster @ 1.0 + kontext_hires @ 0.4` works; stacking 3 preserve LoRAs at high strength does NOT.
3. **Prompt structure**: state "what to change" explicitly; keep "preserve list" SHORT (1-2 items max). Long preserve lists = Kontext over-preserves and ignores the change directive.
4. **3D limitation**: reflections in mirrors/glass do NOT update consistently with body edits. Workaround: explicit prompt mention (~70% accuracy), or crop reflection out before edit.

**CORS**: enabled via `comfy.settings.json` `Comfy.Server.LaunchArgs` + `Comfy.Server.ServerConfigValues` (Settings UI, NOT CLI flag — ComfyUI Issue #7087).

**Defensive guards**: `_psaiCanConnect()` blocks mixed-content, `_psaiFetchWithTimeout()` AbortController on every API call (5s probe / 15s prompt / 60s upload).

**Setup**: [PS-AI-Studio-Setup.md](PS-AI-Studio-Setup.md) audited and corrected for the exact model files at `C:\Users\kumic\Documents\ComfyUI\models\`.

**Phase 1.5 (pending)**: Wire IP-Adapter for Smart mode. Phase 2 (pending): Lock pendant for พระเครื่อง — Florence-2 + SAM2 → save original pendant pixels → run Kontext edit → composite back at new position.

### 13. PS Background Remover (PSBGR) — Utilities tab

Multi-model background remover. Current: smart dispatch (color-key for flat-bg, RMBG-1.4 neural for complex), Tier 2 mask refinement (sigmoid/morph/islands/feather), Tier 3 letterbox preprocessing. Pro UX: canvas viewer with zoom/pan/fit, Detection Mode override (Auto/Neural/Color-key), Restore/Erase brush.

**5-phase bleeding-edge roadmap (approved 2026-04-24):**
1. **Foundation upgrade** — swap RMBG-1.4 → BiRefNet-lite or RMBG-2.0. Note: RMBG-2.0 swap reverted 2026-04-24 (transformers.js integration noise; HF discussions #12 & #24 confirm). Phase 1 partial: Expand/Shrink slider + Pick BG eyedropper + Clear-result button shipped.
2. **SAM 2 click-to-segment** (highest impact) — `Xenova/sam-vit-base` (~90 MB), positive/negative point prompts, Box mode. Solves white-on-white case (the original pain point).
3. **Alpha matting refinement** — ViTMatte (~100 MB) or MODNet, auto-trimap from dilate+erode bands, sub-pixel hair/fur edges.
4. **Color decontamination** — unmix bg from semi-transparent pixels: `fgColor = (pixel - (1-alpha)*bgColor) / alpha`.
5. **BG replacement** — composite over new bg, optional color-temp match + shadow generation.

**Total model budget**: ~370 MB across 3 lazy-loaded models. User downloads only the one their first use needs.

### 14. PS SpecFlow (PSF) — Utilities tab

Word document spec-sheet flow generator (integrated 2026-04-18, milestone backup78). Builds DOCX from PSLink data using docx.js. Reference implementation for the single-column scrollable workstation pattern in Coding Rule 13's "Utilities panel architecture" — sticky header `flex-shrink:0` + scrollable body `flex:1; min-height:0; overflow-y:auto`.

## API Integrations

**External data APIs:**

| Provider | Key Storage | Usage |
|----------|------------|-------|
| Finnhub | `ps_finnhub_key` | Stock quotes, sparklines, technicals |
| Alpaca | `ps_alpaca_key` + `ps_alpaca_secret` | Quotes, sparklines, daily bars, intraday |
| OpenRouter | `ps_openrouter_key` | AI chat |
| Yahoo Finance | (no key) | Extended hours quotes, news |
| GitHub Gist | `ps_gist_token` | Cloud sync/backup |
| Cloudflare R2 | `ps_r2_worker_url` + `ps_r2_auth_token` | Encrypted media sync (video clips, thumbnails, photos) |

**PSLink-owned backend services** (deployed by user — full details in Deployment & Hybrid Mode):

| Service | URL key | Auth key | Usage |
|---|---|---|---|
| Collabora (PSQ Path E live editor) | `ps_psq_collabora_url` | (Fly.io edge — no app-level token) | Embedded iframe live xlsx editor |
| WOPI host (PSQ Path E + recalc) | `ps_psq_wopi_url` | `ps_psq_wopi_token` | xlsx host for Collabora + soffice recalc |
| PDF worker (PSQ Prepare All) | `ps_pdf_worker_url` | `ps_pdf_auth_token` | xlsx → PDF render with Thai fonts |
| PSQ local-base (Hybrid mode) | `ps_psq_local_base` (synced) + `ps_psq_local_base_override` (per-device, NOT synced) | shares `ps_pdf_auth_token` | Tailscale Funnel route to local Docker; probe with 1.5s timeout |
| ComfyUI (PS AI Studio) | (user-configured local URL, mixed-content blocked unless on localhost) | (no token — local CORS) | Flux Kontext image edit |

Helper functions: `getFinnhubKey()`, `getAlpacaKey()`, `getAlpacaSecret()`, `getGistToken()`, `getPsqWopiToken()`

### R2 Cloud Storage (Phase 1-2 — implemented)

- **Worker**: `pslink-r2` at `pslink-r2.pslink-r2.workers.dev` — proxy for R2 bucket `pslink-media`
- **Endpoints**: `PUT /upload`, `POST /download`, `POST /delete`, `GET /health`
- **Auth**: `Authorization: Bearer <R2_AUTH_TOKEN>` on every request (except /health)
- **Encryption**: AES-256-GCM, key derived via HKDF from Gist token (salt: `PSLink-R2-v1`, separate from Gist salt)
- **R2 key format**: `muse/{a-f}/{sha256-hash}.enc.{webm|jpg}` (video clips) or `profile/{name}.enc.jpg` (avatar/photos)
- **IndexedDB cache**: `PSLinkMedia` database, `blobs` store — caches decrypted blobs for offline/fast reload. IDB keys: `avatar:full`, `photo:full`, `preset-photo:{N}` (photos), R2 keys (video clips)
- **Photo storage (Phase 2)**: Full-res → IDB + R2 (encrypted). Thumbnail (128px avatar, 400px photo) → localStorage + Gist. Boot shows thumbnail instantly → async swap to full-res from IDB → fallback R2 download on fresh device.
- **Global vars**: `R2_WORKER_URL`, `R2_AUTH_TOKEN` — initialized from localStorage at script load. **Must be refreshed after any code path that writes R2 credentials to localStorage** (see Rule 21)
- **Key functions**: `_r2InitIdb()`, `_r2IdbPut/Get/Delete()`, `_r2DeriveKey()`, `_r2EncryptBlob()`, `_r2DecryptBlob()`, `_r2UploadClip()`, `_r2LoadVideoForElement()`, `_r2LoadThumbForImg()`, `_r2UploadPhoto()`, `_r2DownloadPhoto()`, `_r2DeleteKeys()`, `_generateThumb()`, `_r2TestConnection()`
- **Settings UI**: Storage tab (`#stab-storage`) — Worker URL input, Auth Token input, test connection button

## Gist Sync System

- **GIST_ID**: `5f913baf7d6636bf42da5e5d07a1570c`
- **GIST_FILENAME**: `PSLink Database.json`
- **Encryption**: AES-256-GCM, key derived from GitHub token via HKDF (salt: `PSLink-Gist-v1`)
- **Rate limiting**: `GIST_MIN_INTERVAL = 4000ms` between PATCHes; 2-min backoff on 403/429
- **Functions**: `syncToGist()`, `syncFromGist()`, `_pushToGist()`, `_buildExportData()`, `_gistEncrypt()`, `_gistDecrypt()`
- **Race condition guard**: `_dataHash()` prevents overwriting newer local data
- **Keepalive**: `_refreshEncBodyAsync()` pre-encrypts for fast `navigator.sendBeacon` on page close
- **Sync triggers**: (1) Boot — `syncFromGist()` during splash. (2) Tab focus — `visibilitychange` event fires `syncFromGist()` when tab becomes visible again, so switching back to PSLink from another app/tab picks up changes from other devices. (3) Manual — user-triggered refresh (optional). Never poll on an interval — Gist rate limit is 5,000 req/hr and polling wastes it.
- **Sync model**: Last-write-wins, no real-time push. PSLink is a personal app (single user) — sync on boot + tab focus is sufficient. Real-time sync would require replacing Gist with a WebSocket-capable backend (Firebase/Supabase), which is out of scope.
- **wlCache in Gist**: `_buildExportData()` includes `wlCache` (cleaned `wlDataCache` + `profileCache`) so fresh devices get profile data (name, logo URL, analyst, metrics) instantly from Gist — avoids 78 Finnhub API calls that exceed rate limit (60/min). Sparkline/logo DATA caches are NOT in Gist (regeneratable, too large).
- **One-token-everything (revised 2026-05-01)**: `_apiKeys` includes every secret + endpoint URL — Finnhub, Alpaca, OpenRouter, R2 worker URL + token, WOPI URL + token, Collabora URL, PDF worker URL + token, AND Tailscale base URL (`ps_psq_local_base`). Off-Tailnet devices probe the Tailscale URL, time out 1.5s, fall back to cloud. The ONLY per-device knob is `ps_psq_local_base_override` (NOT synced) — see Deployment & Hybrid Mode for use case.

## Deployment & Hybrid Mode

**Production URL:** [`https://phaithoonsudjanakobkul-eng.github.io/pslink/`](https://phaithoonsudjanakobkul-eng.github.io/pslink/) — single-file PWA hosted on GitHub Pages (always-on, free, HTTPS, no sleep). Frontend hosting is solved; only backend services need hosting decisions.

**Cloud backend services (Fly.io, sin region, ~30 ms from TH):**

| Service | URL | Purpose | Auto-stop | Cost |
|---|---|---|---|---|
| `pslink-collabora` | `pslink-collabora.fly.dev` | Live xlsx editor for PSQ Path E | yes (idle = $0) | ~$0.50-1/mo typical |
| `pslink-wopi` | `pslink-wopi.fly.dev` | WOPI host for Collabora + xlsx recalc | yes | ~$0.015/mo |
| `pslink-pdf-worker` | `pslink-pdf-worker.fly.dev` | xlsx → PDF render | yes | ~$0.005/mo |

Auth: `Authorization: Bearer <token>` on every request. All tokens (`ps_psq_wopi_token`, `ps_pdf_auth_token`, etc.) are in Gist sync. Cold start: 5-10 s when machine is idle.

**Collabora secrets configured in Fly.io:** `domain` whitelist + `aliasgroup1` allow `phaithoonsudjanakobkul-eng.github.io` to iframe; `extra_params` includes `--o:net.frame_ancestors=https://phaithoonsudjanakobkul-eng.github.io`. Username/password in Fly.io secrets (rotate via `flyctl secrets set password=<new>`). Redeploy: `cd pslink-collabora && flyctl deploy --remote-only --ha=false`. Dockerfile mirrors pslink-pdf-worker font setup so xlsx renders pixel-faithful between PDF preview and Collabora live edit.

**Hybrid mode (Tailscale Funnel for local PDF only):**

Home PC runs the same Docker stack locally and exposes it via Tailscale Funnel at `https://pslink-home.tailaec085.ts.net:10000` → `http://localhost:8082`. PSLink probes this URL with 1.5 s timeout — success = badge `PDF · LOCAL`, timeout = `PDF · CLOUD` fallback. Funnel publishes a public-internet URL with valid Let's Encrypt cert; devices off the Tailnet can still reach it (just with public-internet latency, not LAN speed).

**CRITICAL — Tailscale Funnel + Collabora sub-cell text clipboard is fundamentally broken** (whole-cell Ctrl+C/V works; sub-cell select-paste fails — wireguard MTU/WebSocket frame timing mangles Collabora's `clipboard.writeText`). All debugging attempts exhausted; cloud Fly.io edge has no bug. **Therefore Collabora + WOPI run on Cloud Fly.io ALWAYS, never local. Only PDF worker runs locally.** Don't re-debug — full incident log + 6 gotchas in [`project_pslink_hybrid_tailscale`](memory).

**Per-device override** (`ps_psq_local_base_override`, NOT synced via Gist) wins over the synced home URL. Use case: work laptop runs its own Docker + Tailscale Funnel under a different hostname (e.g. `pslink-work.tailaec085.ts.net`). Set the override in browser console; home keeps using home, laptop uses laptop, off-network devices fall back to cloud. See [WORK-LAPTOP-SETUP.md](WORK-LAPTOP-SETUP.md) for the full setup runbook (a Claude on the work laptop can execute it end-to-end).

**xlsx recalc gotchas (critical for both pslink-wopi and pslink-pdf-worker):** SheetJS doesn't evaluate formulas — both workers must run soffice-headless recalc before serving. **2 silent failures**: (1) `--outdir` MUST differ from input dir or soffice exits 0 with no actual recalc; (2) default `OOXMLRecalcMode` is `2` (Prompt) → must write `registrymodifications.xcu` with `<value>0</value>`. Reference: `pslink-wopi/server.js` `RECALC_XCU` + `recalcXlsx`. ~1100 ms per single-sheet xlsx on Fly.io. Full details in [`project_soffice_recalc_gotchas`](memory) + [NOTES-soffice-recalc.md](NOTES-soffice-recalc.md).

**Local HTTPS dev** (`dev-server.js` + `dev.bat`): mkcert HTTPS via `.certs/cert.pem`+`key.pem` (covers localhost + Tailscale IP, expires 2028-08-01). Modes: default / `tunnel` (+ Cloudflare Tunnel for mobile/webhook testing) / `headless`. Re-run mkcert if Wi-Fi LAN testing needed (different IP not in cert SANs). Setup details in [`project_dev_server_mkcert`](memory).

## Theming System

Two color schemes managed via CSS, two Design Presets (Origin + Phosphor) per the architecture below:

1. **Slate** (light mode) — key `'slate'`, default (no class on `<html>`)
2. **Onyx** (dark mode) — key `'onyx'`, `html.dark` class + `[data-theme="onyx"]` attribute, all surfaces forced to `#0d0d0d`

CSS variables defined in `:root` and overridden in `html.dark` / `[data-theme="onyx"]`. Boot-time migration auto-converts legacy `'tv'`/`'apple'` localStorage values → `'onyx'`/`'slate'` (in `_THEME_KEY_MIGRATION` map).

**Design Preset architecture**: theme = **Preset × Mode × Variant (optional)**.
- **Presets** (personality axis: fonts/shape/icon/motion): `'origin'` (default, clean/professional), `'phosphor'` (Matrix/hacker aesthetic, **dark-only**).
- **Mode** (color scheme): Slate (light) / Onyx (dark) — toggled via `html.dark` class + `data-theme` attribute.
- **Variant** (sub-axis within a preset, color flavor): Phosphor has 4 — `'classic'` / `'crt'` / `'modern'` / `'muted'` (default). Origin has no variants.
- Variant colors live in JS (`_PRESETS.phosphor.variantColors`), applied via `setProperty` after `_applyTheme` (wins over inline theme vars).
- localStorage: `ps_preset_dark`, `ps_preset_light`, `ps_variant_dark`, `ps_variant_light` (per-mode). Legacy globals `ps_preset`, `ps_preset_variant` kept for export/import backward compat. See project memory for full architecture.
- **Persist to Gist rule**: `_assignPresetToMode` and `_pickPresetVariant` MUST call `scheduleAutoSave()` after writing localStorage — without it, `syncFromGist` on the next boot pulls stale Gist state and overwrites the user's choice. Gist's `meta.preset` is the cross-device source of truth for preset selection.
- **`darkOnly` preset flag** — presets marked `darkOnly: true` (Phosphor) cannot render in light mode. If a user is in light mode and switches to a darkOnly preset, `_applyPreset` auto-flips to dark first. If legacy storage has `ps_preset_light = 'phosphor'` from a prior build, the dark-only guard redirects to the light-mode default (Origin) on boot. When building a new dark-only preset, strip all `light:` variant blocks from its definition — they are unreachable dead weight.

**Preset = 5 axes** (Preset controls personality, NOT color — color comes from Mode + variant):
1. **Typography** — font family (display/ui/data), size scale, weights
2. **Icon** — stroke-width, linecap, linejoin, fill style
3. **Shape** — border-radius scale (xs/sm/md/lg/pill), border-width
4. **Density** — spacing scale (`--space-1` through `--space-8`), control heights
5. **Motion** — easing curves, duration tokens (`--ease-snap`, `--ease-smooth`, `--dur-fast|base|slow`)

**Phosphor preset architectural decisions** (apply when adding any new Phosphor work):
1. **Scan lines suppressed on workstation tools** — `body::before` CRT scan lines + `body::after` vignette are disabled when `body.util-workstation-active` is set, toggled by `_applyUtilContentStyle()` and `showTab()`. Scan lines hurt data/image legibility in precision tools (PSI canvas, PSF docs, PSQ forms). Future workstation tools inherit this automatically via the `isWorkstation` flag.
2. **`--phosphor-glow` uses `currentColor`, not hardcoded rgba** — `0 0 Xpx color-mix(in srgb, currentColor Y%, transparent), ...`. So red text gets red glow, yellow text gets yellow glow, accent text gets green glow — automatically. Prefer `color-mix(currentColor …)` over per-element overrides for future Phosphor text effects.
3. **Box-shadow gotcha**: `box-shadow: var(--phosphor-glow)` on an element where `currentColor` should resolve to accent **doesn't reliably work** — `currentColor` inside `color-mix()` inside `var()` substitution chain resolves unpredictably in some Chromium flows. For box-shadow/filter glows on bare divs, reference `var(--accent)` directly inside the shadow value. Text-shadow works because element has explicit computed color.
4. **Accent-button selector list must include both inline-style AND class-based** — Phosphor's "black text + per-variant glow" rule selector covers `button[style*="background:var(--accent)"]`, `.nav-save-btn`, `.psi-cal-btn-primary`. When adding new accent buttons via class (not inline), append to this selector list (CSS ~line 890-930).
5. **Phosphor variant colors live in JS, not CSS** — `_PRESETS.phosphor.variantColors.<variant>.<dark|light>` — applied via `setProperty` AFTER `_applyTheme` so they win specificity (last-write-wins on inline style). `_applyPreset` re-runs at end of `_applyTheme` so Slate/Onyx toggle re-applies variant colors for new mode.
6. **Glow intensity — subtle over loud (always start subtle, tune up if asked).** Phosphor effects (text-shadow glow, box-shadow halo, filter drop-shadow, scan lines) are garnish on a data-first app — **data legibility beats glow intensity**. Hard limits: max 2 shadow layers (NOT 3-5), inner blur ≤ element size, outer blur ≤ 2× element size, inner alpha ≤50%, outer alpha ≤20%. Solid-opacity inner ring = almost always too strong. **Never combine `box-shadow` + `filter: drop-shadow()` on the same element** — they double the glow. Test on Classic variant first (brightest `--accent` `#00ff41`, glow most visible); tuning on Muted first means Classic will be overkill. 2026-04-19 incident: starting loud took 3 iterations to dial down for nav-dot glow; starting subtle would have saved 2.

Key colors:
- `--accent`: `#089981` (teal/green, Onyx) / `#007aff` (blue, Slate)
- `--danger`: `#f23645` (red)
- `--bg-main`: `#f5f5f7` Slate / `#0d0d0d` Onyx
- `--wl-up`: green, `--wl-dn`: red

## Version Format

Historical versions visible in HTML comments at top of file:

```
<!-- v1.6.24 — feature description -->
<!-- v1.6.24(7) — patch description (N fixes) -->
<!-- V.2026.04.07-R269 — PS Micro Imaging: feature description -->
```

The nav bar shows the current version string inside `<nav>` (search for `id="nav-version"` or the version text).

Format conventions:
- **Old**: `v{major}.{minor}.{patch}` with optional `(N)` hotfix suffix
- **Current**: `V.{YYYY.MM.DD}-R{revision}` for PS Micro Imaging features
- **Display**: `v{YYYY.MM.DD}-r{revision}` lowercase in nav bar

## localStorage Keys

Prefix: `ps_` for all keys. Major ones:

| Key | Content |
|-----|---------|
| `ps_records` | JSON array of financial records |
| `ps_watchlist` | JSON array of ticker symbols |
| `ps_dark` | `'1'` if dark mode enabled |
| `ps_gist_token` | GitHub Personal Access Token |
| `ps_finnhub_key` | Finnhub API key |
| `ps_alpaca_key` / `ps_alpaca_secret` | Alpaca API credentials |
| `ps_openrouter_key` | OpenRouter API key |
| `ps_avatar` | Base64 avatar image |
| `ps_profile_photo` | Base64 profile photo |
| `ps_tab` | Last active tab name |
| `ps_wizard_done` | `'1'` if setup wizard completed |
| `ps_muse_*` | Muse playlist data |
| `ps_profile_*` | Profile card data |
| `ps_pinned_wl` | Pinned watchlist symbols |
| `ps_lwc_prefs` | Lightweight chart preferences |
| `ps_clock_*` | Clock widget settings |
| `ps_privacy` | `'1'` if privacy mode (masks money numbers) is on |
| `ps_preset_dark` / `ps_preset_light` | Per-mode design preset (`'origin'` / `'phosphor'`) |
| `ps_variant_dark` / `ps_variant_light` | Per-mode preset variant (Phosphor: classic/crt/modern/muted) |
| `ps_wl_spark_cache_v5` | Sparkline cache — 400-bar cap per symbol (see sparkline memory) |
| `ps_r2_worker_url` / `ps_r2_auth_token` | Cloudflare R2 worker URL + bearer token (encrypted media sync) |
| `ps_psq_state` | PSQ counters + log (Comp1/Comp2 quotation history) — synced via `psqState` field |
| `ps_psq_local_base` | Tailscale Funnel base for Hybrid PDF (synced via Gist) |
| `ps_psq_local_base_override` | **Per-device** override for Hybrid local URL (NOT synced — wins over above) |
| `ps_psq_wopi_url` / `ps_psq_wopi_token` | WOPI host URL + bearer token (PSQ Path E editor) |
| `ps_psq_collabora_url` | Collabora live editor URL |
| `ps_pdf_worker_url` / `ps_pdf_auth_token` | PDF worker URL + bearer token (PSQ Prepare) |

## Coding Rules

1. **Single-file constraint** — All HTML, CSS, and JS must remain in `index.html`. No external JS/CSS files (CDN dependencies are OK).

2. **No build step** — No bundler, transpiler, or framework. Vanilla HTML/CSS/JS only. CDN for Tailwind and Chart.js.

3. **CSS variable theming — tokens over literals** — Use `var(--name)` for all design values, not just colors:
   - **Colors**: `var(--accent)`, `var(--text-primary)`, `var(--danger)`. Never hardcode hex in JS.
   - **Radius**: `var(--radius-xs|sm|md|lg|pill)` instead of `border-radius: 8px`. Pick nearest token (4→sm, 8→md, 12→lg, 999→pill).
   - **Font**: `var(--font-main)` (UI/body), `var(--font-mono)` (data/numbers), `var(--font-display)` (branding/titles). Never hardcode font-family in inline styles.
     - **Deliberate exception — watchlist table**: `#watchlist-table th/td` hardcodes `'Inter', 'IBM Plex Sans Thai', system-ui, sans-serif` (NOT `var(--font-main)`). Data-dense table needs consistent Inter for readability regardless of preset personality. `.sym-cell`, `.price-cell`, `.num-cell` hardcode `var(--font-mono)` for column alignment. Don't "fix" this by routing through `var(--font-main)`.
   - **Spacing/density**: tokens `var(--space-1..8)` exist but NOT enforced yet — inline `padding:12px` still OK in Phase 1b. Migrate only when touching that code for other reasons.
   - **Motion**: `var(--dur-fast|base|slow)` + `var(--ease-snap|smooth)` for new transitions.
   - **Why**: tokens are updated by `_applyPreset(id)` — hardcoded values break when presets (Terminal/Editorial/Futuristic) land. Migration is incremental (Rule 24b surgical — only migrate code you're already editing).
   - **Exception**: 1-off magic numbers that aren't part of the design system (e.g., a precise `border-radius:7px` to match a specific visual target) can stay inline with a comment explaining why.

4. **Color scheme compatibility** — Every visual change must work in both **Slate** (light, key `'slate'`) and **Onyx** (dark, key `'onyx'`). Test both. When Design Preset system expands (Terminal/Editorial/Futuristic), all presets must work in both modes too.

5. **Performance patterns**:
   - `will-change` and `contain: layout style` on frequently-updated elements
   - GPU-composited animations (box-shadow, opacity, transform)
   - Alternate keyframe names (`flashUp` / `flashUp1`) to force animation restart without reflow
   - Web Workers for heavy computation (histogram engine)
   - `requestAnimationFrame` scheduling for canvas redraws
   - **Cache `Intl.*` formatters at module scope, never instantiate in hot paths.** `Intl.DateTimeFormat` / `Intl.NumberFormat` construction is 0.05–0.5ms each and allocates. In tight loops (per-bar sparkline rendering, per-tick ET session checks, per-row formatting) the cost accumulates catastrophically — a 2026-04 watchlist stutter traced to uncached `new Intl.DateTimeFormat(...)` inside ET helpers (`inRegularSessionEt`, `dateKeyEt`, `etMinutes`) was generating 30–45k instantiations per sparkline refresh, burning 3–7 seconds on the main thread. Hoist all formatters to constants at script-level (see `_ET_HM_FMT`, `_ET_DAY_FMT`, `_ET_DOW_FMT` for the reference pattern) and reuse. Same rule applies to `RegExp` compiled in hot paths.

6. **localStorage safety** — Always use `_lsSave()` wrapper which catches `QuotaExceededError`. Be aware that localStorage has a **≈5 MB total limit** (Chrome). Profile photos + settings already consume ~4 MB. When saving large data (video clips, images), attempt save → catch `QuotaExceededError` → evict regeneratable caches (`LOGO_DATA_CACHE_KEY`, `SYMBOL_LOGO_CACHE_KEY`, `ps_wl_spark_cache_v5`) → retry. Never assume there is space. For critical save paths (e.g., Muse video convert), always handle failure gracefully — show error and keep the UI functional, never leave buttons stuck in disabled/loading state.

7. **Gist sync awareness** — Any data mutation must flow through the auto-save pipeline (`_pushToGist`). Check `_isSyncing` / `_isSaving` flags before data operations.

8. **Responsive design** — Mobile-first with breakpoints at 640px (mobile), 768px (tablet), 1024px (desktop), 1200px (wide), 1800px (ultrawide). Portrait-only on mobile (landscape blocked with overlay).

9. **iOS PWA safe areas** — Use `env(safe-area-inset-*)` via `--sat`, `--sar`, `--sab`, `--sal` CSS variables.

10. **Naming conventions**:
    - Functions: camelCase (`fetchQuote`, `renderWatchlistRow`)
    - Private/internal: underscore prefix (`_pushToGist`, `_psiHistCompute`)
    - DOM IDs: kebab-case (`tab-dashboard`, `wl-table-panel`)
    - CSS classes: kebab-case (`glass-card`, `wl-row`, `scanner-tab-btn`)
    - localStorage keys: snake_case with `ps_` prefix (`ps_watchlist`)

11. **Font stack — preset-driven** — Typography tokens (`--font-main`, `--font-mono`, `--font-display`) are set by `_applyPreset(id)` from `_PRESETS.{id}.typography` at boot. Current presets:
    - **Origin**: main=Oxanium, mono=JetBrains Mono, display=Oxanium
    - **Phosphor**: main=Share Tech Mono, mono=Share Tech Mono, display=VT323
    - Watchlist table overrides preset (Inter + JetBrains Mono, see Rule 3 exception)
    - PS Micro Imaging uses IBM Plex Sans/Mono (module-scoped, not preset-driven)

12. **Web Workers for heavy processing** — Image processing, histogram computation, and any CPU-intensive task MUST run in a Web Worker (inline blob). Never block the main thread with pixel-level loops or large-array operations. The histogram engine (`_initHistWorker`) is the reference pattern.

13. **Visual consistency across presets** — PSLink uses a multi-preset design system (Origin, Phosphor, future presets). Each preset provides its OWN personality (fonts, colors, motion, vibe — Phosphor is Matrix/hacker; Origin is clean/professional; new presets can take whatever direction fits). What's universal across ALL presets is the structural baseline below — typography rules, icon style, alignment, spacing — these stay consistent so any preset feels coherent, regardless of aesthetic:
    - **Typography**: `font-variant-numeric: tabular-nums` on ALL numeric displays (prices, percentages, dates). Tracking rule by font family: mono cells (JetBrains Mono, Share Tech Mono) → `letter-spacing: 0` (built-in even spacing); Inter/humanist sans on hero numbers → `letter-spacing: -0.02em` for tight display. Monospace alignment matters.
    - **Icons**: Minimal, stroke-based SVG icons only. No emoji-style or cartoon icons. Consistent stroke-width (1.5–2.5) and sizing across the app.
    - **Card alignment**: Equal padding, consistent border-radius (6px cards, 10px modals, 999px pills). Vertical rhythm between sections must be balanced.
    - **Font weights**: 400 body, 600 labels, 700 headings, 800–900 for mono/uppercase badges. Never use font-weight below 400.
    - **Color restraint**: Use `--text-dim` for tertiary info, `--text-secondary` for secondary, `--text-primary` for key data. Accent color (`--accent`) only for actionable elements and positive values.
    - **Spacing**: Maintain consistent gap/padding ratios. If a card uses `padding: 14px`, neighboring cards should match. Grid gaps should be uniform within a row.
    - **Utilities panel architecture — desktop-app feel**: Every module panel inside `#tab-utilities` (PS Quotation, PS SpecFlow, PS Micro Imaging, PDF Tools, future modules) must fill BOTH axes and scroll internally, not at the page level. This aligns with the long-term goal of porting to a desktop `.exe` (Tauri) where native apps (Excel, Word, VS Code, Figma desktop) always use the full window and scroll inside their own panes — never page-scroll like a website.
        - **Horizontal — full-bleed only**: Outermost wrapper uses `width:100%` or `flex:1`. **Never `max-width`** on the panel wrapper — empty space on wide screens looks web-like/amateur. Inner cards/forms can have their own `max-width` for readability if needed, but the panel itself stretches.
        - **Vertical — internal scroll via flex column**: Outer wrapper uses `height:100%; display:flex; flex-direction:column; box-sizing:border-box`. Fixed regions (header, toolbar) get `flex-shrink:0`. The scrollable content region uses **`flex:1; min-height:0; overflow-y:auto`** — the `min-height:0` is critical: without it, the flex child expands to content size and the page scrolls instead of the panel. Reference pattern: `_psfInit` in PS SpecFlow.
        - **Activation — register as workstation**: Add `isWorkstation: true` (or a specific flag like `isQuotation`/`isSpecFlow`/`isMicro`) to the tool's entry in `_utilTools`, then include it in the `isWorkstation` check inside `_applyUtilContentStyle`. This sets `util-content` to `overflow:hidden; height:100%; padding:0` and the panel to `height:100%`, giving your inner wrapper the bounded height needed for internal scroll to work. Without this registration the page scrolls and the full-width + internal-scroll wrapper becomes inert.
        - **Reference patterns — pick the template closest to your module's needs**:
            - **Single-column scroll** (PS SpecFlow, PS Quotation): sticky header with `flex-shrink:0` + scrollable body with `flex:1; min-height:0; overflow-y:auto`. Right for form/editor tools with mostly one main content stream.
            - **Multi-pane workstation** (PS Micro Imaging): nested flex grid — outer column (menu bar → middle row → bottom panel → status bar), middle row splits into 3 columns (toolbox | canvas | sidebar), each pane has its own bounded height/width and independent scroll. Right for analysis/IDE-style tools where the user needs multiple panes visible at once (like ImageJ, Photoshop, Fiji, VS Code). Fixed dimensions use `flex-shrink:0`, growing dimensions use `flex:1; min-height:0; min-width:0`.

14. **Data persistence lifecycle** — When implementing any new feature that creates or modifies user data:
    - **Storage tier rule**: Choose the right storage for the data type:
      - `localStorage` — small text only (settings, flags, API keys, JSON metadata). Max ~5 MB shared. Use `_lsSave()` wrapper.
      - `IndexedDB` — large binary data (video blobs, images, caches). No practical limit. Async API.
      - `Gist` — cross-device sync for text/JSON metadata only. Never put base64 media blobs in Gist.
      - `Cloudflare R2` — cross-device sync for encrypted media. Phase 1 (video clips) + Phase 2 (avatar/photos) implemented. See `R2-Integration-Plan.md`.
    - **Never store binary blobs (base64 images, video) in localStorage or Gist** — they consume quota instantly. Store a reference (IndexedDB key or R2 URL) instead, and keep the blob in IndexedDB/R2.
    - **Gist sync**: Include the new data field in `_buildExportData()` so it flows into the encrypted Gist backup. This is the single source of truth for cross-device sync of text/metadata.
    - **Export JSON**: The export structure from `_buildExportData()` IS the JSON export — adding a field there covers both Gist and manual export.
    - **syncFromGist() restore**: Add corresponding restore logic in `syncFromGist()` so data is correctly loaded on a fresh device.
    - **Splash screen (boot)**: If the data affects first-paint (e.g., avatar, theme, watchlist), ensure it loads during the splash sequence. Only `localStorage` can be read synchronously — IndexedDB requires async loading. For boot-critical images, store a small thumbnail in localStorage and swap with full-res from IndexedDB after boot.
    - **Rate limit awareness**: Never trigger `_pushToGist()` in tight loops or rapid event handlers. Batch mutations and let the existing debounce/cooldown (`GIST_MIN_INTERVAL = 4000ms`) handle throttling. For high-frequency events (typing, dragging), save to localStorage immediately but defer Gist push.
    - **Fresh device scenario**: Always test: "What happens if localStorage is empty and only Gist data exists?" Ensure `syncFromGist(true)` → restore → render works without errors or blank screens. Media that's only in IndexedDB/R2 should show placeholders until downloaded.

15. **Ask before acting** — If uncertain about the approach, scope, or side effects of a change, always ask the user before implementing or modifying code. Don't guess intent — confirm first.

16. **Backup before editing** — Before every edit to `index.html`, create a backup copy in **`.backups/`** subfolder (NOT root — keeps Glob/ls noise low):
    - Path: `.backups/backup{N} - {short description}.html`
    - `{N}` continues from highest existing — check via `ls .backups/ | tail -3`
    - Example: `.backups/backup268 - add currency converter widget.html`
    - Only then proceed to edit the main file.
    - **Why subfolder (not root)**: 53 backups in root bloated `Glob "*.html"` and `ls` outputs by ~2-3k tokens per scan. Moved 2026-05-05.
    - **Retention policy (strict)** — backups are LOCAL ONLY (`.gitignore`d), git history covers full deploy log. Be ruthless:
        - **Always keep**: latest **10** + **milestones** (rule below).
        - **Milestone test — narrow (keep ONLY if YES to one):**
            (a) Ships a new top-level module visible in nav (PSI, Muse trim, PSF, PSQ, PSUP, PSBGR, PS AI Studio, Phosphor, Cinematic, Privacy mode, R2 sync). **One per module, not one per phase.**
            (b) Marks `before {risky rework}` immediately preceding redesign/rename/architecture swap.
            (c) Captures a perf/correctness invariant whose derivation took real debugging effort (Intl cache, sparkline 3-invariant, IntersectionObserver culling, WebSocket frame-coalesce).
        - **Default = SKIP**: polish iterations, bug-fix iterations, test snapshots, "before tiny tweak", anything superseded by next backup. None survive long-term.
        - **Cleanup cadence**: when `.backups/` exceeds **20**, ask user before sweep. Don't auto-delete. Past sweeps: 2026-04-29 (219→33), 2026-05-01 (54→10), 2026-05-05 (53→11 + moved to `.backups/`).
        - **Naming**: "before X" + concrete action beats "fix bug" / "polish". If name doesn't distinguish from neighbors → noise → don't create.

17. **Security — STRICT** — Personal data (photos, videos, clips, profile images, Muse media) is highly sensitive. Treat every piece of user content as confidential:
    - **Encryption at rest**: All data synced to Gist MUST be AES-256-GCM encrypted via `_gistEncrypt()`. Never store plaintext personal data in Gist — not even filenames or metadata.
    - **No external leaks**: Never send user media (base64 images, video blobs, profile photos) to any third-party API, CDN, analytics, or logging service. All media stays local (localStorage / IndexedDB) or encrypted in Gist only.
    - **No URL exposure**: Never generate publicly accessible URLs for user content. No uploading to imgur, cloudinary, pastebins, or any hosting service — even temporarily.
    - **Console / debug safety**: Never `console.log` user media data (base64 strings, blob URLs, file contents). Log only metadata (size, type, timestamp) for debugging. Strip all media logging before committing.
    - **DOM injection safety**: When rendering user-provided content (notes, text, filenames), always sanitize to prevent XSS. No `innerHTML` with raw user input — use `textContent` or sanitize first.
    - **API keys**: Base64-encoded in Gist exports (`_encKey` / `_decKey`) as obfuscation layer; the outer AES-256-GCM encryption protects them at rest. Never expose keys in error messages, console output, or status bar text (show only first 8 chars + `...`).
    - **No eval / no remote code**: No `eval()`, `new Function()`, or dynamic `<script>` injection from user data or API responses. CSP-compatible patterns only.
    - **Muse media protection**: Muse playlist content (videos, clips, images) that is password-protected must remain inaccessible without the correct password hash. Never bypass or weaken the password gate for convenience.
    - **Fresh device principle**: On a fresh device, no user data should be visible until `syncFromGist()` successfully decrypts with the correct token. Failed decryption = show nothing, not partial/corrupted data.
    - **Cleanup on delete**: When a user deletes media (photo, video, Muse slot), purge it from localStorage, any in-memory cache, AND the next Gist push. No orphaned data.

18. **Async abort pattern** — When multiple async operations share a resource (e.g., `video.currentTime`), use a **generation counter** to invalidate stale callbacks. Reference implementation: `_museTrimExtractGen`.
    ```javascript
    var _gen = 0;
    function startOperation() {
        var myGen = ++_gen; // bump counter — all older callbacks become stale
        video.addEventListener('seeked', function onSeeked() {
            video.removeEventListener('seeked', onSeeked);
            if (_gen !== myGen) return; // aborted — a newer operation took over
            // ... proceed safely
        });
        video.currentTime = target;
    }
    ```
    Before starting a new operation on a shared resource, **cancel all in-flight operations**: bump the generation counter, call cancel functions (`_museTrimBgSeekCancel()`), remove pending `seeked`/`timeupdate` listeners, and nullify `onseeked`/`ontimeupdate` property handlers that could race.

19. **Modal z-index layering** — Modals stack in this order. Toast messages and error feedback MUST render at the correct layer, or they will be invisible to the user:
    | Layer | z-index | Element |
    |-------|---------|---------|
    | Trim modal | 9300 | `#muse-video-trim-backdrop` |
    | Slot-add popover | 9200 | `#muse-slot-add-popover` |
    | Edit modal | 9000 | `#muse-modal-backdrop` |
    | Muse card toast | 30 | `#muse-toast` |
    
    `_museToast()` auto-routes to the highest visible layer. When adding new modals above existing ones, ensure toast/error messages are routed to a toast element **inside** that modal.

20. **UI resilience — never leave UI stuck** — Every async operation (network request, FileReader, MediaRecorder, IndexedDB, crypto) can fail. The UI must always recover:
    - **Buttons**: If a button changes to a loading state (`disabled = true`, text = "กำลัง..."), ensure EVERY exit path (success, error, timeout) restores the button. Use a `_resetUI()` helper and call it in `try/catch/finally`, `onerror`, and safety timeouts.
    - **Modals**: On failure, either keep the modal open with an error message (let user retry), or close it cleanly. Never close the modal AND swallow the error — the user sees nothing.
    - **Toast visibility**: Error toasts must be visible at the current z-index layer (see Rule 19). A toast behind a modal is the same as no toast.
    - **Safety timeouts**: Long-running operations (recording, upload, encryption) must have a maximum time limit. When hit, force-stop the operation, restore UI, and show an error — don't let it run forever.
    - **Offline graceful**: If a network operation fails (R2 upload, Gist push), save locally first, mark as pending, and inform the user — don't block the UI waiting for retry.

21. **In-memory variable refresh after multi-path restore** — Global variables initialized from `localStorage` at script load (e.g., `R2_WORKER_URL`, `R2_AUTH_TOKEN`) can become stale when localStorage is populated by a code path that runs AFTER initialization but BEFORE the expected refresh point. Known scenario:
    - Script loads → `R2_WORKER_URL = localStorage.getItem('ps_r2_worker_url') || ''` → empty (incognito)
    - Wizard restores API keys to localStorage (early code path)
    - `syncFromGist()` runs → API keys block sees keys "already exist" → `_keysRestored = 0` → refresh block skipped → **R2_WORKER_URL stays empty**
    - **Rule**: After any code block that may write credentials to localStorage (API keys restore, wizard, import), ALWAYS refresh the corresponding in-memory global variables **unconditionally** — not just when `_keysRestored > 0`.

22. **Async DOM reference safety** — When an async operation (network fetch, IndexedDB read, crypto) captures a DOM element reference, the element may be detached by a DOM rebuild (e.g., `_museRenderSlots()` called again) before the async completes. Pattern:
    ```javascript
    var elId = element.id; // save ID before async
    var data = await fetchSomething(); // async — DOM may rebuild here
    var target = document.getElementById(elId) || element; // re-find current element
    target.src = data; // apply to the LIVE element
    target.play().catch(function(){}); // explicit play — autoplay won't trigger on async src set
    ```
    Reference implementation: `_r2LoadVideoForElement()`.

23. **Seamless loading — no partial renders** — The user must never see empty cells, missing columns, or data "popping in" after the app appears. If a splash screen exists, ALL visible data must be ready before it closes:
    - **Fresh device / incognito**: Splash waits for ALL data (prices, sparklines, profiles, metrics, analyst ratings) before closing. Show progress status. Timeout: 30s.
    - **Normal boot (has cache)**: localStorage cache provides instant data → splash closes fast (~3s). `refreshWatchlist()` updates silently in background.
    - **New features**: If async data appears on first paint, either pre-cache it OR keep splash/loading until ready. Never render empty placeholders that fill in later.
    - **Detection**: `Object.keys(wlDataCache).length === 0 || !localStorage.getItem('ps_wl_cache')` = fresh device.
    - **Reference**: `_splashFinalStep()` — fresh device path waits for `refreshWatchlist()` before `_hideSplash()`.
    - **Splash flow** (`_splashFinalStep`): ALL boots follow the same pipeline:
      ```
      1. _splashQuoteFetch()          → batch prices (~1-2s)
      2. refreshSparklineForTopSymbols() → sparkline bars (~3-5s)
      3. refreshWatchlist()           → profiles, metrics, analyst, logos (~5-10s)
      4. Wait for logo <img> load/error → fallback initials for missing logos (ETFs etc.)
      5. _hideSplash()                → Fade+Scale 1.2s transition
      ```
      If adding a new data source that renders on first paint, add it to this pipeline BEFORE `_hideSplash()`. Never load data after splash closes.

24. **Disciplined changes (Karpathy principles)** — Three rules for every edit session:

    **a) Simplicity first** — Write the minimum code that solves the problem. No speculative features, no abstractions for single-use code, no "flexibility" or "configurability" that wasn't requested. No error handling for impossible scenarios. If you wrote 200 lines and it could be 50, rewrite it. Ask yourself: "Would a senior engineer say this is overcomplicated?" If yes, simplify.

    **b) Surgical changes** — Touch only what the user asked for:
    - Don't "improve" adjacent code, comments, or formatting.
    - Don't refactor things that aren't broken.
    - Match existing code style exactly, even if you'd do it differently.
    - If you notice unrelated dead code or issues, mention it — don't fix it silently.
    - Orphan cleanup: remove imports/variables/functions that YOUR changes made unused. Don't remove pre-existing dead code unless asked.
    - **The test**: Every changed line must trace directly to the user's request.

    **c) Goal-driven execution** — Transform vague tasks into verifiable goals before coding:
    - "Add validation" → "Write tests for invalid inputs, then make them pass"
    - "Fix the bug" → "Write a test that reproduces it, then make it pass"
    - "Refactor X" → "Ensure tests pass before and after"

    For multi-step tasks, state a brief plan first:
    ```
    1. [Step] → verify: [how to check]
    2. [Step] → verify: [how to check]
    3. [Step] → verify: [how to check]
    ```
    Strong success criteria ("renders correctly in all 3 themes", "no console errors on fresh device") let you loop independently. Weak criteria ("make it work") require clarification — ask first.

    **Tradeoff note**: These three rules bias toward caution over speed. For trivial one-line changes, use judgment — don't over-plan.

25. **JavaScript hazards in single-file inline code** — When disabling or removing a code block, NEVER wrap with `/* ... */`. JS block comments do NOT nest — any inner `*/` (inside a regex, string literal, or a nested `/* */` comment) closes your outer comment prematurely, leaving dangling JS → parse error → **entire page becomes unclickable** (event handlers stop registering). PSLink incident 2026-04-20: wrapping the ~230-line `_frameMon` IIFE this way hit an inner `*/` at line 38827, killing all script execution. Always:
    - **Preferred**: delete the block entirely (backups preserve history per Rule 16).
    - **Keep for reference**: wrap in `if (false) { ... }` — JS-safe, no nesting issues.
    - **Never**: `/* ... */` around code you haven't personally scanned for every `*/` (including inside strings, regex, and inner comments). Even if you THINK there are none, assume there are. Cost of `if (false)` is zero; cost of a parse error is the whole app.

26. **CSS theme hazards in single-file inline code** — Three patterns that look harmless but break theme overrides in subtle ways. Symptom is always the same: a CSS rule with correct specificity and `!important` doesn't visually win, and `git grep` for the property finds nothing else. Hours wasted before the actual culprit surfaces (usually via DevTools hover, NOT source reading). PSLink incident 2026-05-02 hit all three on the FX cards in cinematic preset:
    - **Never use `[id*="prefix-"]` / `[id^=...]` / `[id$=...]` to share styling across elements with a naming convention.** The selector matches every id containing the substring — including parent containers (`#fx-widget`) when you only meant inner elements (`#fx-rate`, `#fx-change`). Symptom: a parent gets painted dark; transparent children show through and look "filled" when they're actually correct. Use a shared `.class` instead, or list ids explicitly.
    - **Never put `style="background:..."` / `style="border-color:..."` on themable elements in HTML.** Inline styles compete with theme-override rules in a specificity battle that LOOKS like it should win on paper but reliably doesn't (browser caching, attr-selector quirks, or rules you haven't found yet). All theming → class-based. Inline reserved for layout (`width`, `height`, `flex-shrink`, `padding`).
    - **When narrowing a CSS rule's scope, delete every redundant declaration — don't keep them "just in case."** If the new rule's `border-color` matches what the inline `var(--border)` already produces, REMOVE it. A retained redundant declaration becomes a (1,1,1) `!important` trap that beats a future (0,3,1) preset override and produces "looks the same in 2 themes but wrong in the 3rd" bugs that are very hard to find. Reference incident: `[data-theme="onyx"] #fx-widget > div { border-color: ... !important; }` survived as "harmless" while another rule was being narrowed; later beat the cinematic `.ps-pill` border and gave FX cards a dark outline that didn't match neighbors.
    - **Debug method that actually works**: when an element looks wrong, hover it in DevTools FIRST and read the computed Background in the tooltip. If the computed value isn't what your CSS rule says, the painter is a different element (likely an ancestor) — chase that. Reading source is `O(n)` in style-block size; DevTools hover is `O(1)`.

## Dev Setup

```bash
npm run dev          # HTTPS local on :8443 (mkcert) + open Chrome + DevTools
npm run dev:tunnel   # above + Cloudflare Tunnel public URL (for mobile / webhook testing)
npm run dev:headless # no auto-open browser
# or double-click dev.bat (tunnel|headless as arg)
```

## File Inventory

| File | Purpose |
|------|---------|
| `index.html` | Main application (single-file PWA) |
| `dev.bat` / `dev-server.js` | HTTPS-local dev server with mkcert + live-reload (default) and optional Cloudflare Tunnel |
| `.certs/cert.pem` + `key.pem` | mkcert-issued local HTTPS cert (do NOT commit) |
| `package.json` | npm config with `dev` / `dev:tunnel` / `dev:headless` scripts |
| `docker-compose.yml` | Local PDF worker stack (Tailscale Hybrid mode); legacy Collabora/WOPI behind `--profile legacy` |
| `pslink-pdf-worker/` | PDF worker: Ubuntu + LibreOffice headless + Node + Thai fonts; deployed to Fly.io AND runs locally |
| `pslink-collabora/` | Collabora CODE container source (Fly.io deploy) |
| `pslink-wopi/` | WOPI host source (Fly.io deploy) |
| `R2-Integration-Plan.md` | Storage architecture + Cloudflare R2 migration plan |
| `WORK-LAPTOP-SETUP.md` | End-to-end runbook for installing the Hybrid Docker stack on a second machine (e.g. work laptop). Self-contained — Claude on that laptop can execute it end-to-end. |
| `NOTES-soffice-recalc.md` | xlsx recalc gotchas (separate inDir/outDir + RecalcMode xcu) — affects both PDF worker and WOPI |
| `RUNBOOK-Hybrid-Setup.md` | Hybrid mode operational notes + Tailscale clipboard limitation log |
| `PS-AI-Studio-Setup.md` | ComfyUI Desktop + Flux Kontext + 4 LoRAs setup (audited model paths) |
| `backup*.html` | Historical backup snapshots — strict retention per Rule 16 (run `ls backup*` for current list) |
| `SampleImages/` | Test images for PS Micro Imaging |
