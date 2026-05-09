# PSLink — `src/` (Vite scaffold)

Created in **Session 2** (2026-05-09) of the Vite migration. See [MIGRATION-PLAN.md](../MIGRATION-PLAN.md) for the full plan.

## Status

**Empty skeleton.** Folders exist so future module/preset/tab extractions land in the right place per Architecture conventions. The current production build still ships the monolithic root `index.html` — Vite serves it as-is in this phase.

## Folder map (target architecture)

```
src/
├── main.js                # entry — boot, theme, splash, router (Session 3)
├── core/                  # cross-cutting infra (Session 3)
│   ├── storage.js         # localStorage wrapper + IDB
│   ├── gist-sync.js       # encryption + Gist sync
│   ├── r2.js              # R2 client + retry queue
│   ├── theme.js           # _applyTheme, _applyPreset
│   ├── bus.js             # event bus for cross-module comms
│   ├── state.js           # singleton store for shared state
│   └── presets/           # preset registry (Architecture conv. §1)
│       ├── index.js
│       ├── origin.js
│       ├── phosphor.js
│       └── cinematic.js
├── tabs/                  # tab modules (Architecture conv. §2)
│   ├── index.js           # tab router + registry
│   ├── dashboard/
│   ├── records/
│   ├── watchlist/
│   ├── news/
│   └── utilities/
│       ├── index.js
│       └── registry.js    # _utilTools entries
├── modules/               # lazy-loaded utility modules (Architecture conv. §3)
│   ├── psai/index.js      # PS AI Studio
│   ├── psbgr/index.js     # PS Background Remover
│   ├── psec/index.js      # PS Email Composer
│   ├── psf/index.js       # PS SpecFlow
│   ├── psi/index.js       # PS Micro Imaging
│   ├── psq/index.js       # PS Quotation
│   └── psup/index.js      # PS Upscaler
├── widgets/               # reusable widgets (Architecture conv. §4)
│   ├── muse/              # NOT lazy — stays in shell
│   ├── ai-chat/
│   └── clock/
└── styles/
    ├── tokens.css
    ├── base.css
    └── presets/
        ├── origin.css
        ├── phosphor.css
        └── cinematic.css
```

## Hard rules (Architecture conv. — locked for project lifetime)

1. Every tab/module/widget exports `init(rootEl, ctx)` + optional `destroy()`
2. Every preset exports `{ id, label, axes, variants?, variantColors?, darkOnly? }`
3. CSS imported only inside the file that uses it (Vite tree-shake handles dead-code elim)
4. Cross-module communication via `core/bus.js` event bus — no direct calls between modules
5. localStorage keys keep `ps_<prefix>_*` convention (no breaking change for existing user data)
6. Module-scope vars replace `_psXXX*` global prefix (no naming collision possible)

## When to add a new file here

See **"Adding new features post-migration (workflow recipes)"** section in [MIGRATION-PLAN.md](../MIGRATION-PLAN.md) for preset / tab / utility / widget recipes.
