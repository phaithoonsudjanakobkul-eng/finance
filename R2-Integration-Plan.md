# Complete Storage Architecture + R2 Implementation Plan

## Problem

PSLink เก็บทุกอย่าง (settings + base64 media) รวมกันใน localStorage + Gist ทำให้ชน limit (localStorage 5 MB, Gist 10 MB per file) — profile photos + settings กิน 4.4 MB, แม้ video clip 0.39 MB ก็ save ไม่ได้

---

## Complete Data Map — ข้อมูลแต่ละชิ้นควรอยู่ที่ไหน

### MEDIA (binary blobs — ย้ายออกจาก localStorage/Gist)

| ข้อมูล | ปัจจุบัน | ย้ายไป | Sync ข้ามเครื่อง | Phase |
|--------|---------|--------|-----------------|-------|
| Muse video clips (WebM) | localStorage + Gist (base64) | **R2** (encrypted) + **IndexedDB** (cache) | R2 key ใน Gist | 1 |
| Muse video thumbnails | localStorage + Gist (base64) | **R2** (encrypted) + **IndexedDB** (cache) | R2 key ใน Gist | 1 |
| Avatar (ps_avatar) | localStorage + Gist (~500 KB) | **IndexedDB** (local) | ไม่ sync / หรือ R2 ภายหลัง | 2 |
| Profile photo (ps_profile_photo) | localStorage + Gist (~500 KB) | **IndexedDB** (local) | ไม่ sync / หรือ R2 ภายหลัง | 2 |
| Profile presets photos (ps_profile_presets) | localStorage + Gist (~800 KB) | **IndexedDB** (local) | ไม่ sync / หรือ R2 ภายหลัง | 2 |
| Profile free images (ps_profile_free_imgs) | localStorage + Gist | **IndexedDB** (local) | ไม่ sync / หรือ R2 ภายหลัง | 2 |
| Logo data cache (ps_logo_data_cache_v6) | localStorage + Gist (~500 KB) | **IndexedDB** (re-fetchable) | ไม่ต้อง sync | 3 |
| Symbol logo cache (ps_symbol_logo_cache_v5) | localStorage + Gist (~350 KB) | **IndexedDB** (re-fetchable) | ไม่ต้อง sync | 3 |

### SETTINGS + CREDENTIALS (text — อยู่ localStorage + Gist เหมือนเดิม)

| ข้อมูล | Key | ขนาด | Sync |
|--------|-----|------|------|
| Gist token | ps_gist_token | ~50 B | ไม่ sync (ใส่เอง) |
| Finnhub API key | ps_finnhub_key | ~40 B | ✓ Gist |
| Alpaca key + secret | ps_alpaca_key, ps_alpaca_secret | ~80 B | ✓ Gist |
| OpenRouter API key | ps_openrouter_key | ~60 B | ✓ Gist |
| Other API keys | ps_erapi_key, ps_twelvedata_key, ps_fmp_key, ps_gemini_key, ps_perplexity_key, ps_claude_key | ~300 B | ✓ Gist |
| R2 Worker URL | ps_r2_worker_url | ~60 B | ✓ Gist (ใหม่) |
| R2 Auth Token | ps_r2_auth_token | ~40 B | ✓ Gist (ใหม่) |

### USER DATA (text/JSON — อยู่ localStorage + Gist เหมือนเดิม)

| ข้อมูล | Key | Sync |
|--------|-----|------|
| Financial records (รายรับรายจ่าย) | ps_records | ✓ Gist |
| Watchlist symbols | ps_watchlist | ✓ Gist |
| Pinned watchlist | ps_pinned_wl | ✓ Gist |
| Profile nickname + email | ps_profile_nickname, ps_profile_email | ✓ Gist |
| Profile notes | ps_profile_notes, ps_profile_notes_html | ✓ Gist |
| Muse clip metadata (R2 refs) | ps_muse_clips_a..f | ✓ Gist |
| Muse passwords | ps_muse_pws | ✓ Gist |
| Muse auto-rotate config | ps_muse_autorotate | ✓ Gist |
| Muse transition config | ps_muse_transition | ✓ Gist |
| FX self-tracking | ps_fx_self_* | ✓ Gist |
| Chart prefs | ps_lwc_prefs | ✓ Gist |
| PS Micro calibration | pslink_micro_calibration | ไม่ sync |

### UI STATE (text — localStorage, sync บางตัวผ่าน Gist)

| ข้อมูล | Key | Sync |
|--------|-----|------|
| Last active tab | ps_tab | ไม่ sync |
| Dark mode | ps_dark | ✓ Gist |
| Theme selection | ps_theme, ps_theme_dark, ps_theme_light | ✓ Gist |
| Wizard completed | ps_wizard_done | ไม่ sync |
| Dashboard collapse state | ps_dash_collapsed | ✓ Gist |
| Dashboard section order | ps_dash_section_order | ✓ Gist |
| Display mode | ps_display_mode | ✓ Gist |
| Muse active preset index | ps_muse_preset_idx | ✓ Gist |
| Muse collapsed | ps_muse_collapsed | ✓ Gist |
| Muse layout mode | ps_muse_layout | ✓ Gist |
| Muse slot count | ps_muse_slot_count | ✓ Gist |
| Profile preset index | ps_profile_preset_idx | ✓ Gist |
| Profile pills hidden | ps_profile_pills_hidden | ✓ Gist |
| Clock widget state | ps_clock_* (pos, color, font, vis, show_date) | ✓ Gist |
| AI FAB position | ps_ai_fab_pos | ไม่ sync |
| Current month | ps_month | ไม่ sync |
| Settings tab | ps_settings_tab | ไม่ sync |

### CACHES (regeneratable — ย้ายไป IndexedDB ภายหลัง)

| ข้อมูล | Key | ที่ควรอยู่ | Phase |
|--------|-----|----------|-------|
| Sparkline cache | ps_wl_spark_cache_v5 | IndexedDB | 3 |
| WL data cache | ps_wl_cache | IndexedDB | 3 |
| Scanner cache | ps_scanner_cache_v2 | IndexedDB | 3 |
| News snapshot | ps_news_feed_snapshot_v1 | IndexedDB | 3 |
| LOW price cache | ps_low_cache_v2 | IndexedDB | 3 |
| Market data | ps_mkt_* | localStorage (tiny, OK) | — |

### Result After All Phases

```
localStorage:  ~100-200 KB  (settings + records + UI state + small metadata)
IndexedDB:     ไม่จำกัด    (media cache + regeneratable caches)
Gist:          ~200-500 KB  (text metadata only — ไม่มี base64 blobs)
R2:            ≤10 GB free  (encrypted video clips + thumbnails)
```

---

## R2 Target Architecture

```
ก่อน (ปัจจุบัน):
  .MOV → trim → WebM blob → base64 → localStorage (5MB!) → Gist (10MB!)

หลัง:
  .MOV → trim → WebM blob → AES-256-GCM encrypt → R2 (10 GB free)
                                                      ↓
  localStorage: เก็บแค่ metadata (~200 bytes/clip)  → Gist: metadata only (<1 MB)
  IndexedDB:    cache decrypted blob สำหรับ offline
```

---

## Cloudflare Worker (external project)

Deploy separately. Holds R2 S3 credentials server-side. ~100 lines.

| Method | Path | Purpose |
|--------|------|---------|
| PUT | /upload | Receive encrypted blob → write to R2 |
| POST | /download | Return encrypted blob from R2 |
| POST | /delete | Delete objects from R2 |
| GET | /health | Connection test |

Auth: `Authorization: Bearer <R2_AUTH_TOKEN>` on every request.
R2 S3 credentials stay in Worker env only — never sent to client.

```
pslink-r2-worker/
├── wrangler.toml     ← R2 bucket binding + env vars
└── src/index.js      ← ~100 lines: route, validate auth, R2 ops
```

---

## New Clip Structure

```javascript
// R2 clip (~200 bytes metadata, blob in R2)
{ type: 'image', storage: 'r2', r2Key: 'muse/a/<hash>.enc.webm',
  r2ThumbKey: 'muse/a/<hash>.enc.jpg', contentHash: '<sha256>', sizeMB: 0.39, label: 'clip1' }

// TikTok clips — unchanged
{ url: 'https://tiktok.com/...', thumbnail: 'https://...', label: '...' }

// Legacy base64 clips — backward compatible
{ type: 'image', src: 'data:video/webm;base64,...', label: '...' }
```

---

## New Functions (add to PSLink with PWA.html)

| Function | Purpose |
|----------|---------|
| _r2InitIdb() | Open IndexedDB 'PSLinkMedia' |
| _r2IdbPut/Get/Delete(key, blob) | IndexedDB CRUD for blob cache |
| _r2DeriveKey(token) | HKDF derive AES key (salt: 'PSLink-R2-v1') |
| _r2EncryptBlob(token, blob) | AES-256-GCM encrypt → [IV 12 bytes][ciphertext] |
| _r2DecryptBlob(token, encBuf) | Decrypt ArrayBuffer → plaintext |
| _r2UploadClip(blob, thumbDataUrl, ...) | Full upload pipeline |
| _r2LoadVideoForElement(videoEl, r2Key) | IDB cache → fallback R2 download → decrypt → display |
| _r2TestConnection() | Test Worker /health endpoint |

## Modified Functions (with approximate line numbers)

| Function | ~Line | Change |
|----------|-------|--------|
| _museTrimConvert rec.onstop | 26275 | Branch: R2 config? → _r2UploadClip() : legacy base64 |
| _museRenderSlots | 24918 | Detect clip.storage==='r2' → `<video data-r2key>` + async loader |
| _buildExportData | 32351 | Strip base64 from R2 clips, add R2 creds to apiKeys |
| syncFromGist | 30859 | R2 clip count splash status + restore R2 credentials |
| _initMuseCard | 24720 | Add _r2InitIdb() call |
| switchSettingsTab | 31569 | Add 'storage' to tab list |
| openSettingsModal | 31603 | Populate R2 fields |
| saveAllSettings | 31645 | Save R2 config + refresh in-memory vars |
| _dataHash | 32519 | Add R2 config to hash |
| Clip deletion | multiple | Add _r2IdbDelete + Worker DELETE |

---

## Settings UI — Storage Tab

Add in Settings modal (~line 33455):
- Tab button "Storage" in tab bar
- Cloudflare R2 card: Worker URL input + Auth Token input + test button
- Local Cache card: IndexedDB size display + clear cache button
- localStorage keys: ps_r2_worker_url, ps_r2_auth_token

---

## Encryption Design

```
Gist Token (user's GitHub PAT)
     │
   HKDF derive (2 separate keys, domain-separated)
  ┌──┴──┐
  │     │
salt='PSLink-Gist-v1'   salt='PSLink-R2-v1'
  │                       │
AES-256-GCM              AES-256-GCM
(Gist JSON metadata)     (R2 video/image blobs)
```

R2 blob format: `[IV 12 bytes][AES-GCM ciphertext]` — self-contained, Worker never sees plaintext.

### Security Access Matrix

| ผู้โจมตีมี | เห็น metadata | Download blob | Decrypt video | ระดับ |
|------------|:---:|:---:|:---:|--------|
| ไม่มีอะไร | ✗ | ✗ | ✗ | ปลอดภัย |
| R2 auth token อย่างเดียว | ✗ | ✓ (encrypted) | ✗ | ปลอดภัย |
| Gist token อย่างเดียว | ✓ | ✗ | ✗ | ปลอดภัย |
| Cloudflare (R2 operator) | ✗ | ✓ (encrypted) | ✗ | ปลอดภัย |
| ยืมเครื่อง (DevTools) | ✓ | — | ✓ (IDB plaintext) | เหมือนปัจจุบัน |
| Gist token + R2 auth token | ✓ | ✓ | ✓ | Full access (เหมือนปัจจุบัน) |

### Security Rules

**Deletion must be thorough:**
- ลบ clip → ต้องลบจากทั้ง 4 ที่: memory, localStorage, IndexedDB, R2
- ถ้า R2 delete fail (offline) → mark `pendingDelete: true` → retry เมื่อ online
- ห้ามมี orphaned blob บน R2 หลังลบ

**Muse password protection:**
- ปัจจุบัน Muse password เป็นแค่ UI gate (ไม่ใช่ encryption)
- หลังใช้ R2 → เหมือนเดิม: ถ้ามี Gist token ก็ access ได้โดยไม่ต้องรู้ Muse password
- (Optional) เพิ่ม Muse password เป็น additional encryption layer ภายหลัง

**IndexedDB stores plaintext:**
- เหมือน localStorage ปัจจุบัน — ไม่ได้แย่ลง
- (Optional) encrypt ก่อนเก็บ IDB ด้วย สำหรับ defense-in-depth

**Gist token = single point of failure:**
- Gist token ใช้ทั้ง decrypt Gist + decrypt R2 + access R2 auth
- เหมือน security model เดิม — compromised token = full access
- ไม่มีทาง mitigate โดยไม่เปลี่ยน architecture ทั้งหมด (ต้อง separate auth)

---

## Data Sync Flow — ป้องกัน Conflict

### Boot Flow (เปิดแอป)

```
1. localStorage → render ทันที (theme, avatar thumb, last tab)
2. IndexedDB → โหลด cached video blobs → render Muse clips
3. syncFromGist() → ดึง metadata ล่าสุด
4. เปรียบเทียบ Gist.lastModifiedTs vs local.lastModifiedTs
   ├── Gist ใหม่กว่า → Gist ทับ local
   ├── Local ใหม่กว่า → push local ขึ้น Gist
   └── เท่ากัน → ไม่ทำอะไร
5. R2 clips ที่ Gist มีแต่ IDB ไม่มี → download จาก R2 → cache IDB
6. Retry pending uploads / pending deletes
```

### Sync Flow (เครื่องอื่น pull)

```
syncFromGist → ได้ metadata ใหม่
เทียบ local clips กับ Gist clips:
  ├── Gist มี clip ที่ local ไม่มี    → download จาก R2 → cache IDB (clip ใหม่จากเครื่องอื่น)
  ├── Local มี clip ที่ Gist ไม่มี   → ลบจาก IDB (clip ถูกลบจากเครื่องอื่น)
  └── ทั้งคู่มี (r2Key ตรงกัน)       → ไม่ต้องทำอะไร (blob เดียวกัน, content-addressed)
Re-render Muse slots
```

### Pending Queues (offline resilience)

```
clip.uploadPending = true   → blob อยู่ IDB แล้ว แต่ยัง upload R2 ไม่สำเร็จ
                               → retry เมื่อเปิดแอปครั้งหน้า + online
clip.deletePending = true   → metadata ลบแล้ว แต่ R2 blob ยังลบไม่สำเร็จ
                               → retry เมื่อ online
```

### Conflict Resolution

```
Strategy: last-write-wins (เหมือนปัจจุบัน) + pending queues + warnings

- ใช้ lastModifiedTs เปรียบเทียบ local vs Gist
- ถ้า Gist ใหม่กว่า → toast "ซิงค์จากเครื่องอื่น" แจ้งให้รู้
- ถ้าใช้สองเครื่องพร้อมกัน → เครื่องที่ push ทีหลังชนะ (last-write-wins)
- R2 blobs ใช้ content-addressed keys (SHA-256) → blob เดียวกันไม่ conflict
- Orphan cleanup (optional): scan R2 keys ที่ไม่มีใน Gist metadata → ลบ
```

### Potential Data Loss Scenarios

| สถานการณ์ | ผลลัพธ์ | ความรุนแรง |
|-----------|--------|-----------|
| สองเครื่องเพิ่ม clip พร้อมกัน | เครื่องที่ push ทีหลังชนะ, clip อีกเครื่องหาย (แต่ blob ยังอยู่ R2 เป็น orphan) | ปานกลาง |
| ลบ clip เครื่อง A, เครื่อง B ยังไม่ sync | B เห็น clip ชั่วคราว → หายหลัง sync | ต่ำ |
| Offline เพิ่ม clip → กลับ online → Gist มี data ใหม่กว่า | Gist ทับ local → clip ใหม่อาจหาย (แต่ blob อยู่ IDB + R2) | ปานกลาง |
| iOS ลบ IndexedDB (7 วัน) | Video หายจาก cache → download ใหม่จาก R2 | ไม่มี (R2 เป็น backup) |

**หมายเหตุ:** ปัญหา conflict ทั้งหมดมีอยู่แล้วใน PSLink ปัจจุบัน (last-write-wins) — R2 ไม่ได้ทำให้แย่ลง แต่ควรเพิ่ม pending queues และ warning toast

### Sync Triggers (เมื่อไหร่ sync)

```
1. เปิดแอป (ปัจจุบัน)           → syncFromGist() ตอน boot
2. Tab กลับมา focus (เพิ่มใหม่) → syncFromGist() เมื่อ visibilitychange
3. Manual (เพิ่มใหม่)           → ปุ่ม refresh ใน UI (optional)

ไม่ทำ:
✗ Poll ทุก N วินาที → ชน Gist rate limit (5,000/hr)
✗ WebSocket/real-time → ต้องเปลี่ยน backend ทั้งหมด
```

Implementation (3 บรรทัด):
```javascript
document.addEventListener('visibilitychange', function() {
    if (!document.hidden && getGistToken()) syncFromGist();
});
```

---

## Upload Flow (trim เสร็จกด "แปลง")

```
1. MediaRecorder → WebM blob
2. SHA-256(blob) → contentHash → R2 key: muse/<preset>/<hash>.enc.webm
3. _r2EncryptBlob → encrypted blob
4. fetch(Worker /upload) → R2
5. _r2IdbPut → local cache
6. _museClips.push(metadata) → localStorage → Gist
```

## Download Flow (render Muse Card)

```
1. _museRenderSlots → detect storage==='r2' → <video data-r2key poster>
2. _r2LoadVideoForElement:
   a. IDB hit → createObjectURL → done
   b. IDB miss → fetch Worker /download → decrypt → IDB cache → display
```

## Fresh Device Flow (sync จาก Gist)

```
1. syncFromGist → museData.presets มี clips ที่มี storage:'r2'
2. เขียน metadata ลง localStorage
3. _museRenderSlots → R2 clips → poster/placeholder
4. _r2LoadVideoForElement → IDB miss → R2 download → decrypt → cache → display
```

---

## Splash Screen + Fresh Device Impact

| Phase | Splash Screen | Fresh Device |
|-------|--------------|-------------|
| **Phase 1** (video clips → R2) | ไม่กระทบ — video ไม่แสดงตอน splash | ไม่กระทบ — video โหลดเมื่อเปิด Muse |
| **Phase 2** (avatar/photos → IDB) | ต้องแก้ — เก็บ thumbnail 64x64 ใน localStorage สำหรับ instant render, swap full-res จาก IDB หลัง boot | Placeholder avatar → download จาก R2 หรือ set ใหม่ |
| **Phase 3** (caches → IDB) | ไม่กระทบ — cache ไม่แสดงตอน splash | ไม่กระทบ — re-fetch จาก API |

### Phase 2 Splash Strategy

```
localStorage:  ps_avatar_thumb  (64x64 JPEG ~5 KB → แสดงทันที sync, ไม่ flash)
IndexedDB:     ps_avatar        (full-res ~500 KB → swap หลัง boot)

Boot sequence:
1. <script> อ่าน ps_avatar_thumb จาก localStorage (sync, ทันที)
2. Splash แสดง thumbnail avatar → ไม่มี white flash
3. Boot เสร็จ → อ่าน full-res จาก IndexedDB (async)
4. Swap thumbnail → full-res (ผู้ใช้ไม่รู้สึก)

Fresh device:
1. localStorage ว่าง → Splash แสดง placeholder icon
2. syncFromGist → ได้ metadata + R2 keys
3. Download avatar จาก R2 → decrypt → save IDB + สร้าง thumbnail → save localStorage
4. แสดง avatar ปกติ
```

---

## Backward Compatibility

| สถานการณ์ | ผลลัพธ์ |
|-----------|--------|
| Old base64 clips (ไม่มี `storage` field) | ทำงานเหมือนเดิม — render จาก `clip.src` |
| TikTok URL clips | ไม่เปลี่ยน — render จาก `clip.url` |
| R2 clips บนเครื่องที่ไม่มี R2 config | แสดง placeholder — video ไม่โหลด |
| R2 clips offline (ไม่มี internet) | IndexedDB cache → แสดงได้ / ไม่มี cache → placeholder |

---

## Implementation Order

### Phase 1: R2 Video Clips — ✅ COMPLETED (2026-04-16)
1. ✅ **Worker + R2 bucket** — deployed `pslink-r2` at `pslink-r2.pslink-r2.workers.dev`, bucket `pslink-media`
2. ✅ **IndexedDB + encryption helpers** — `_r2InitIdb`, `_r2IdbPut/Get/Delete`, `_r2DeriveKey`, `_r2EncryptBlob`, `_r2DecryptBlob`
3. ✅ **Settings UI** — Storage tab (`#stab-storage`) + R2 config + test connection
4. ✅ **Upload flow** — `_r2UploadClip()` + modified `_museTrimConvert` rec.onstop
5. ✅ **Render flow** — `_r2LoadVideoForElement()` + `_r2LoadThumbForImg()` + modified `_museRenderSlots`
6. ✅ **Gist integration** — `_buildExportData` strips base64, `syncFromGist` restores R2 vars unconditionally
7. ✅ **Cross-device sync** — verified in incognito mode, videos download from R2 and play

**Lessons learned (Phase 1):**
- R2 in-memory vars (`R2_WORKER_URL`, `R2_AUTH_TOKEN`) must be refreshed unconditionally after API keys block — wizard may pre-populate localStorage before syncFromGist runs (see CLAUDE.md Rule 21)
- Async video loading requires `target.play()` after setting src — autoplay doesn't re-trigger on async src set
- DOM elements may be rebuilt during async R2 download — must re-find element by ID before setting properties (see CLAUDE.md Rule 22)

### Phase 2: Avatar + Profile Photos → IDB + R2 — ✅ COMPLETED (2026-04-16)
8. ✅ Full-res → IndexedDB (`avatar:full`, `photo:full`, `preset-photo:N`) + R2 (`profile/avatar.enc.jpg`, `profile/photo.enc.jpg`, `profile/preset-N.enc.jpg`)
9. ✅ Gist export → thumbnails only (128px avatar, 400px photo) → ลดขนาดจาก ~MB เหลือ ~KB
10. ✅ **Splash/Boot:** thumbnail จาก localStorage แสดงทันที → async swap full-res จาก IDB → fallback R2 download
11. ✅ **Fresh device:** Gist sync → thumbnail preview → R2 download → full-res swap → cache IDB
12. ✅ **Auto-migration:** ครั้งแรกหลัง update ตรวจ localStorage > 10KB → ย้ายไป IDB + สร้าง thumbnail
13. ✅ **Worker regex:** อัปเดตรองรับ `profile/` prefix + redeploy

**New functions:** `_generateThumb()`, `_r2UploadPhoto()`, `_r2DownloadPhoto()`
**Modified:** `applyCrop()`, `_buildExportData()`, `syncFromGist()`, `_psPresetCaptureCurrent()`, `_psPresetApply()`, boot/DOMContentLoaded

### Phase 3: Caches + Splash Polish — ✅ COMPLETED (2026-04-16)
10. ✅ ลบ sparkline/logo caches ออกจาก `_buildExportData()` → Gist เล็กลง
11. ↩️ Caches ยังอยู่ใน localStorage (ย้ายไป IDB ทำให้ boot ช้า → revert, Rule 23)
12. ✅ `syncFromGist()` ยัง restore caches จาก Gist เก่าได้ (backward compat)
13. ✅ เพิ่ม `wlCache` (profileCache + wlDataCache) ใน Gist export → fresh device ได้ profiles ทันทีไม่ต้อง 78 API calls
14. ✅ Splash: รอ refreshWatchlist() + logo load/error ครบก่อนปิด (Rule 23)
15. ✅ Splash transition: Fade + Scale 1.2s, ไม่มีจอดำ (content อยู่ข้างหลัง splash)
16. ✅ Tab switch animation: Fade + Scale 0.7s
17. ✅ Finnhub throttle: concurrent 6→3 เพื่อไม่ชน rate limit 60/min
18. ✅ Gist size: 5,666 KB → 241 KB (ลด 95.7%)
19. ✅ Legacy base64 clips: strip จาก Gist export (เหลือแค่ metadata)

---

## Mobile Considerations

### iOS Safari Storage Eviction
- iOS อาจล้าง IndexedDB ของ PWA ที่ไม่ได้เปิดนาน 7+ วัน
- **ผลกระทบ:** ถ้าเก็บ video ใน IndexedDB อย่างเดียว (ไม่มี R2) → data หายได้
- **แก้:** ต้องทำ R2 upload ด้วยเสมอ — IndexedDB เป็นแค่ cache, R2 เป็น source of truth
- **ข้อสรุป:** บน iOS ห้ามพึ่ง IndexedDB เป็น primary storage → ต้อง R2 คู่กัน

### Upload Reliability บนเครือข่ายมือถือ
- 4G/5G ไม่เสถียร → upload อาจ fail กลางทาง
- ผู้ใช้ปิดแอป/ล็อคจอ → upload ค้าง (PWA ไม่มี background upload)
- **แก้:**
  - Save ลง IndexedDB ก่อน (instant, offline-first)
  - Upload R2 ทีหลัง พร้อม retry 3 ครั้งถ้า fail
  - ถ้า upload fail → mark clip เป็น `uploadPending: true`
  - เมื่อเปิดแอปครั้งหน้า → scan pending uploads → retry อัตโนมัติ
  - แสดง progress indicator ระหว่าง upload

### Memory Pressure ตอน Encrypt
- มือถือ RAM 3-4 GB (shared กับ OS)
- encrypt video 2 MB = ~6 MB ใน memory (original + ArrayBuffer + encrypted)
- **แก้:**
  - จำกัดขนาด clip ที่ trim ได้ (แนะนำ max 5 MB per clip)
  - หรือ stream encryption เป็น chunks (ทำทีละส่วน ไม่โหลดทั้งก้อน)

### iPhone .MOV (HEVC codec)
- iPhone ถ่าย .MOV เป็น HEVC (H.265) ซึ่งไม่รองรับทุก browser
- **ไม่กระทบ conversion** — PSLink trim แปลงเป็น WebM (VP9) อยู่แล้ว
- **กระทบ preview ก่อน trim** — บาง browser อาจไม่แสดง preview ได้
- **แก้:** แสดง warning ถ้า browser ไม่รองรับ codec ต้นฉบับ

### iOS PWA Storage Quota
- iOS: 1 GB per origin (IndexedDB) — เหลือเฟือสำหรับ video clips สั้นๆ
- Android: ~50% ของ disk ว่าง

### File Picker + Large Source Files
- มือถือเปิด camera roll → ไฟล์ 4K 60fps อาจ 100+ MB/min
- **แก้:**
  - แสดง file size ก่อน trim
  - Warning ถ้าไฟล์ต้นฉบับ > 50 MB
  - Suggest ลด resolution / duration ก่อน convert

### Mobile Verification Checklist
- [ ] iOS Safari: trim → convert → upload R2 → reload → video ยังอยู่
- [ ] iOS Safari: ไม่เปิดแอป 7 วัน → เปิดใหม่ → video re-download จาก R2
- [ ] Android Chrome: trim → convert → upload → cross-device sync
- [ ] 4G upload fail → retry สำเร็จเมื่อเปิดแอปใหม่
- [ ] iPhone .MOV (HEVC) → preview ใน trim modal → convert เป็น WebM สำเร็จ
- [ ] ไฟล์ใหญ่ > 50 MB → แสดง warning + suggest ลด settings

---

## Verification

1. ✅ **Trim + Convert:** เลือก video → trim → กดแปลง → toast "✓ WebM ... → R2" → clip ปรากฏใน Muse Card
2. ✅ **Offline:** ปิด WiFi → F5 reload → R2 WebM clips เล่นจาก IndexedDB cache ปกติ ราคาหยุด → ต่อ WiFi กลับ → ราคาวิ่งทันที
3. ✅ **Cross-device sync:** incognito mode → Gist token → sync → R2 clips download + แสดง + wlCache ทำให้ข้อมูลครบ 100%
4. ✅ **Backward compat:** old base64 clips + TikTok URL clips ยังทำงานปกติ
5. ✅ **Settings:** ตั้งค่า R2 URL + Token → กดทดสอบ → "เชื่อมต่อสำเร็จ ✓"
6. ✅ **Storage savings:** Gist 5,666 KB → 241 KB (ลด 95.7%) — wlCache ~100 KB เพิ่มมาแต่ยังต่ำกว่าเป้า 500 KB
7. ✅ **Security:** R2 blob ถูก encrypt ก่อน upload — Worker/R2 ไม่เห็น plaintext, verified `.enc.webm` files in bucket
8. ✅ **R2 Dashboard:** encrypted files visible in `pslink-media` bucket
9. ✅ **Fresh device splash:** ข้อมูลครบ 100% (profiles จาก wlCache + logos + sparklines) ก่อน splash ปิด
