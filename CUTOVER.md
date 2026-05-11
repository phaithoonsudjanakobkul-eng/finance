# PSLink — V23 Cutover Runbook

**Status:** Ready for pi-keng to execute. V2 has reached visual + feature parity (V1-V22 all shipped 2026-05-11). This file is the single self-contained step-by-step that flips production `pslink/` from the monolith `index.html` to the Vite-bundled v2 shell at `src/index.html`.

**Why this isn't done by Claude:** the GitHub Pages source switch (`build_type=workflow`) is blocked by Claude Code's auto-mode classifier even with broad auth (per `project_pages_source_cutover.md`). The cutover is a one-time human-driven flip.

---

## Pre-flight (must all be true before flipping)

- [ ] All 35 e2e specs green (`npm run e2e`)
- [ ] All 587 unit specs green (`npm test`)
- [ ] `npx tsc --noEmit` returns clean
- [ ] Manually use `npm run dev:vite` for one full work session (file records, edit watchlist, run PSQ stage flow, open Muse) — confirm nothing feels missing vs the monolith
- [ ] Manually test the production preview at `https://phaithoonsudjanakobkul-eng.github.io/pslink/src/` (deployed automatically by current CI) with **real Gist data** so the cross-device sync path is validated end-to-end
- [ ] Confirm R2 worker URL + token + Gist token are all in your dev machine's localStorage (otherwise V5 photo + V9 video sync round-trips can't be checked)

If any of these fail, **don't cut over**. File the gap as a follow-up V item and re-run the trio after fix.

---

## Cutover step-by-step

### Option A — single-entry build (recommended)

The cleanest path. After this, `vite build` produces `dist/index.html` directly from `src/index.html`; no more multi-entry.

1. **Pi-keng edits `vite.config.js`:**

   ```js
   // BEFORE
   input: {
       prod: 'index.html',
       v2:   'src/index.html',
   }

   // AFTER (single entry)
   input: 'src/index.html'
   ```

2. **Move v2 entry to root:**

   ```bash
   git mv src/index.html index.html
   ```

   This breaks the current dev workflow (Vite expects `index.html` at the root by default). The `vite.config.js` `input` change above keeps it working. Update relative paths inside `index.html` that refer to `src/main.js` — they're already `/src/main.js` style, which Vite resolves from the project root, so no edits needed.

3. **Archive the monolith for reference:**

   ```bash
   mkdir -p legacy
   git mv index.html legacy/index.monolith.html  # the OLD monolith, before the move above
   ```

   Order: do (3) BEFORE (2) so the monolith doesn't get overwritten.

4. **Re-test locally:**

   ```bash
   npm run dev:vite   # confirms the shell still boots
   npm run build:vite # confirms the build still produces dist/index.html
   npm run e2e        # confirms playwright is happy with the new entry
   ```

5. **Commit + push:**

   ```bash
   git add -A
   git commit -m "cutover: production root is now v2 shell"
   git push origin main
   ```

6. **GitHub Pages source:** still on `gh-pages` branch published via `.github/workflows/deploy.yml`. The workflow already runs `vite build` and pushes `dist/` to `gh-pages` — no GH Pages settings change needed.

7. **Update `CLAUDE.md`:**
   - Retire Rule 1 (single-file constraint — no longer applies, v2 is multi-file by design)
   - Retire Rule 2 (no build step — v2 uses Vite)
   - Re-anchor line refs in Rules 13-26 to v2 paths (e.g., `_psqApplyEndpoint` → `src/modules/psq/index.js`)
   - Mark Rule 16 (backup before editing index.html) as legacy-only — root index.html is now the v2 shell, no longer hand-edited

### Option B — keep multi-entry, swap default

Slightly hackier; keep if Option A reveals an issue.

1. Reorder `vite.config.js` input so `src/index.html` is first; rename `prod` key to `legacy`:

   ```js
   input: {
       app:    'src/index.html',
       legacy: 'index.html',  // archived
   }
   ```

2. Change root `index.html` to a redirect:

   ```html
   <!doctype html>
   <meta http-equiv="refresh" content="0;url=./src/">
   ```

3. Commit + push.

This keeps the monolith file accessible at `pslink/legacy/` style URLs if anyone needs the old behavior, at the cost of an extra redirect hop on every prod boot. **Not recommended** unless Option A's build fails for a non-obvious reason.

---

## Post-cutover follow-ups (within 1 week)

1. **Memory entry update:** rewrite `project_vite_migration_progress.md` to mark Phase D complete; add a `project_cutover_completed.md` entry capturing the cutover date, the option chosen, and any quirks observed.
2. **Re-enable VitePWA** (was disabled in Session 3a due to html-proxy collision; once entry is single, the collision goes away). Replace the static `manifest.webmanifest` + hand-written `sw.js` with the VitePWA-generated equivalents that respect Vite's asset hashing.
3. **PWA icon files:** swap the inline-SVG placeholder icons in `manifest.webmanifest` for real PNG/ICO assets at 192/512/maskable.
4. **Live test PSQ Path E:** the V16-18 port has no automated coverage — schedule one Quotation cycle against the Fly.io Collabora to confirm upload/save/download round-trip.

---

## Rollback path

Total revert time: ~5 minutes.

```bash
git revert <cutover-commit>
git push origin main
```

CI redeploys the monolith. The `legacy/index.monolith.html` archive is untouched.

If the revert is needed AFTER post-cutover follow-up #2 (VitePWA re-enable), revert that commit too — `git revert <cutover-commit> <pwa-commit>` in chronological order.

---

## Acceptance for "done"

- [ ] Production URL `https://phaithoonsudjanakobkul-eng.github.io/pslink/` loads the v2 shell within 2 s on a cold reload
- [ ] Dashboard renders the 3-card hero with current profile + payday + month-day
- [ ] Watchlist live ticks work end-to-end (Alpaca + Finnhub keys present in synced Gist)
- [ ] PSQ stages 1-4 all click through to the right modal/iframe with the right WOPI/Collabora URLs
- [ ] Cinematic preset reads as glass-card photo background, not the dev-panel proof-of-concept

Once all four are checked the visual port phase is closed and PSLink runs on Vite-bundled v2 by default.
