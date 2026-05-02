---
name: soffice xlsx recalc gotchas (PSLink workers)
description: Two silent failures when using soffice headless to recalc PSLink xlsx — outdir-collision + RecalcMode default. Both required for SUM/BAHTTEXT cached values to be fresh.
type: project
originSessionId: 8952ad1c-82f8-40d5-b8df-d7456ec50e27
---
PSLink writes xlsx via SheetJS which does NOT evaluate formulas — `<v>` cached values for SUM/BAHTTEXT cells stay at template defaults (often 0). Both `pslink-wopi` (Path E editor) and `pslink-pdf-worker` (PDF render) rely on a soffice-headless recalc step to refresh these caches before serving. Two non-obvious failures can each silently kill that recalc:

**1. `--outdir` must differ from input dir**
- soffice refuses to overwrite the source file. Internal save fails with `SfxBaseModel::impl_store ... 0x4c0c (Sfx Class:Write Code:12)` on stderr.
- soffice still **exits 0** despite the failure, so `proc.on('close', code => code === 0 ? resolve...)` resolves cleanly.
- The function then `readFileSync` the input path (or output path that doesn't exist depending on layout) and returns either the stale bytes or throws a misleading ENOENT.
- **Fix:** separate `inDir/` and `outDir/`, write input to `inDir/x.xlsx`, run soffice with `--outdir outDir`, read from `outDir/x.xlsx`. Add explicit `fs.existsSync(outPath)` check after — bug-hides without it.
- **Why:** This was the primary Comp2-shows-0 bug (2026-04-30). Comp1 looked fine because its template's cached values happened to already be correct, masking the failure.

**2. RecalcMode default = 2 (Prompt) → headless never recalcs**
- Default `OOXMLRecalcMode` / `ODFRecalcMode` is 2 (ask user). In headless there's no user → soffice resolves to "never recalc" → opens file, writes back without re-evaluating any formulas.
- **Fix:** before launching soffice, write `${profile}/user/registrymodifications.xcu` with values 0 (Always recalc):
```xml
<oor:items xmlns:oor="..." xmlns:xs="..." xmlns:xsi="...">
  <item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="OOXMLRecalcMode" oor:op="fuse"><value>0</value></prop></item>
  <item oor:path="/org.openoffice.Office.Calc/Formula/Load"><prop oor:name="ODFRecalcMode" oor:op="fuse"><value>0</value></prop></item>
</oor:items>
```
- Path matters: `${profile}/user/registrymodifications.xcu`, applied via `-env:UserInstallation=file://${profile}`. `mkdirSync(path.join(profile, 'user'), { recursive: true })` first.
- **RecalcMode values (per officecfg/registry/schema/.../Calc.xcs):** `0` = Always recalculate, `1` = Never recalculate, `2` = Prompt (default). The Collabora Dockerfile in the same repo has `<value>1</value>` with comment claiming "Force recalc" — the comment is wrong; `1` means Never. Pre-existing bug, but Collabora doesn't need recalc on its side because pslink-wopi recalcs before serving via WOPI.

**How to apply:**
- Reference implementations: [pslink-wopi/server.js](../../../../pslink-wopi/server.js) `RECALC_XCU` + `recalcXlsx`, [pslink-pdf-worker/server.js](../../../../pslink-pdf-worker/server.js) same pattern.
- When adding any new soffice convert step: separate inDir/outDir, write the xcu, verify output file exists, log a warn if recalc 0-value differs from expected.
- Do NOT trust soffice exit code as a recalc-success signal. Always verify by reading the output and checking a known formula cell.
- The full xcu → recalc pipeline is `~1100ms` typical for a single sheet (BT, QMVV) on Fly.io shared-cpu-1x.
