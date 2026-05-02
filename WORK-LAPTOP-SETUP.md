# PSLink Hybrid — Work Laptop Setup Runbook

**Audience:** Claude (or human) sitting on a NEW work laptop, tasked with making PSLink's Hybrid local PDF mode work on this device while the home PC is off.

**Why this exists:** Home PC runs the primary `pslink-pdf` Docker stack via Tailscale Funnel for fast PDF rendering. But home PC is OFF during work hours, so a work laptop hitting `pslink-home.tailaec085.ts.net:10000` will time out → fallback to cloud Fly.io (5-10s cold start). Solution: install the same Docker stack on the work laptop, expose it via Tailscale Funnel under a different hostname, and tell PSLink's browser to prefer the laptop's URL via a per-device override.

**Architecture this lands you on:**

```
Browser (PSLink)
  ↓
  reads ps_psq_local_base_override (set on this laptop)
  ↓
  https://pslink-work.<tailnet>.ts.net:10000   ← laptop's own Tailscale Funnel URL
  ↓
  Tailscale Funnel (publicly resolvable, valid HTTPS via Let's Encrypt)
  ↓
  http://localhost:8082                         ← Docker port mapping (host:container = 8082:8080)
  ↓
  pslink-pdf container (LibreOffice headless + Node Express + Thai fonts)
```

The override key is **NOT** synced via Gist — it stays on this laptop only. The synced `ps_psq_local_base` (= home PC's URL) is preserved as fallback for other devices and as a safety net if the override is removed.

---

## Prerequisites — Verify First

Run these checks BEFORE installing anything. If a prerequisite fails, stop and ask the user.

| Check | Command (PowerShell) | Expected |
|---|---|---|
| Windows version | `winver` (GUI) or `[System.Environment]::OSVersion.Version` | Windows 10/11 |
| Internet | `Test-NetConnection google.com -Port 443` | TcpTestSucceeded : True |
| Admin rights | `(New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)` | True (needed for Docker + Tailscale install) |
| Disk space | `Get-PSDrive C` | ≥ 10 GB free |
| WSL 2 (Docker requirement) | `wsl --status` | Default Distribution exists, default version 2 |

If WSL 2 is not set up: `wsl --install` (reboot required).

---

## Step 1 — Install Tailscale

**Goal:** Get the laptop onto the user's Tailnet so it gets a hostname like `pslink-work.<tailnet>.ts.net`, then enable Funnel to expose port 10000 publicly with HTTPS.

```powershell
# Install via winget (preferred — auto-PATH)
winget install Tailscale.Tailscale --accept-source-agreements --accept-package-agreements

# Verify
tailscale version
```

**Login:** Open the Tailscale tray icon → "Log in" → use the SAME Google/GitHub/email account as the home PC. After login the system tray shows "Connected" and the laptop appears in the user's Tailscale admin console.

**Set the laptop's Tailnet hostname** (if it isn't already `pslink-work` or similar — default is the Windows machine name):

```powershell
tailscale up --hostname=pslink-work
```

Verify:
```powershell
tailscale status
# Expected: shows "pslink-work     <user>@   windows" along with other Tailnet devices
```

**Get the FULL Tailscale Funnel-eligible URL** (you'll need this for PSLink config later):
```powershell
tailscale status --json | findstr /C:"DNSName"
# Expected: "DNSName": "pslink-work.<tailnet-name>.ts.net."
```

Save this hostname — call it `LAPTOP_TS_HOST` from here on. Example: `pslink-work.tailaec085.ts.net` (note: same tailnet name as home, different prefix).

**Enable Funnel for this device** (one-time per Tailnet, controlled in admin console):
1. Go to https://login.tailscale.com/admin/dns/funnel
2. Ensure the laptop hostname is allowed to use Funnel (toggle on if not).

---

## Step 2 — Install Docker Desktop

```powershell
winget install Docker.DockerDesktop --accept-source-agreements --accept-package-agreements
```

After install:
1. Launch Docker Desktop from Start menu (first launch initializes WSL 2 backend).
2. Settings → General → check **"Start Docker Desktop when you log in"** so the worker auto-starts at boot.
3. Wait for the whale icon in the tray to be solid (not animating) before proceeding.

Verify:
```powershell
docker --version
docker ps
# Expected: empty table (no containers yet) — but no error
```

---

## Step 3 — Copy Worker Files to Laptop

The laptop only needs **two things** from the project folder, not the full PSLink HTML:

1. `pslink-pdf-worker/` (entire folder — Dockerfile, server.js, package.json, bahttext.js, thai-fontconfig.xml, fonts/)
2. `docker-compose.yml` (entire file)

**Transfer methods (pick one):**

- **Tailscale send** (cleanest, no third party): on home PC `tailscale file cp pslink-pdf-worker/ pslink-work:` then on laptop `tailscale file get .`
- **OneDrive / Google Drive**: zip the two paths, share, download on laptop
- **USB / network share**: copy directly

Place them on the laptop at this layout (path can be anything — example below):

```
C:\Users\<you>\PSLink-Worker\
├── docker-compose.yml
└── pslink-pdf-worker\
    ├── Dockerfile
    ├── server.js
    ├── package.json
    ├── bahttext.js
    ├── thai-fontconfig.xml
    └── fonts\
        ├── THSarabun*.ttf
        ├── LeelawUI*.ttf
        └── ...
```

---

## Step 4 — Create `.env` File

In the same folder as `docker-compose.yml`, create `.env`:

```env
PDF_AUTH_TOKEN=<paste the same token as home PC's .env>
WOPI_AUTH_TOKEN=<not strictly needed for laptop — only PDF runs locally — but harmless to include>
COLLABORA_USER=admin
COLLABORA_PASS=admin
```

**Where to get the token value:** The home PC's `.env` file has it. Or open PSLink in a browser at any origin where the user has logged in, DevTools console: `localStorage.getItem('ps_pdf_auth_token')`.

**CRITICAL:** the token MUST match. Different token = laptop's Docker rejects PSLink's requests with 401 (the same symptom that prompted today's Gist sync work — easy to misdiagnose).

---

## Step 5 — Build + Start Docker

From the folder containing `docker-compose.yml`:

```powershell
docker compose build pdf
# First build downloads Ubuntu, LibreOffice, Node, fonts → ~5-10 min, ~2 GB image

docker compose up -d pdf
# Starts container in background; restart=unless-stopped means it auto-starts on Docker Desktop launch
```

**Verify container is healthy:**
```powershell
docker ps
# Expected: pslink-pdf  ... 0.0.0.0:8082->8080/tcp ... Up X seconds

# Hit the health endpoint locally
curl.exe http://localhost:8082/health
# Expected: 200 OK with body like {"ok":true,"service":"pslink-pdf",...}
```

If the curl returns 401, the auth token mismatch — re-check `.env`. The `/health` endpoint should NOT require auth though, so 401 here means something else is wrong. If 200 with `auth required`, that's the auth-protected route — try `/health` exactly (no path beyond it).

---

## Step 6 — Expose via Tailscale Funnel (Port 10000)

```powershell
# Run as admin (Funnel needs to bind a privileged port range internally)
tailscale funnel --bg --https=10000 http://localhost:8082
```

The flag explanation:
- `--bg` runs in background (survives PowerShell exit)
- `--https=10000` exposes Tailscale-managed HTTPS on port 10000 of the public Funnel hostname
- `http://localhost:8082` is the local backend (Docker maps 8082 → container 8080)

**Verify:**
```powershell
tailscale funnel status
# Expected: "https://pslink-work.<tailnet>.ts.net:10000 → http://localhost:8082"
```

**Test from outside the laptop** (use phone on cellular data, or another device):
```
https://pslink-work.<tailnet>.ts.net:10000/health
```
Should return the same 200 OK as the local curl above. If it does NOT respond:
- Confirm Funnel is enabled in admin console (Step 1 last paragraph).
- Confirm Docker container is up.
- Wait 30 seconds for DNS propagation.

---

## Step 7 — Configure PSLink Browser Override

This is the **per-device** key that wins over the Gist-synced home URL. Set it ONCE on this laptop in any Chrome/Edge profile that will use PSLink at work.

1. Open PSLink in the browser. Any URL works:
   - Production: `https://phaithoonsudjanakobkul-eng.github.io/pslink/`
   - Or local dev: `https://localhost:8443/PSLink%20with%20PWA.html` (if you set up the dev server here)
2. If first time on this browser/origin: enter the user's Gist token first → SyncFromGist → all settings restored.
3. Open DevTools → Console.
4. Paste:

```javascript
localStorage.setItem('ps_psq_local_base_override', 'https://pslink-work.<tailnet>.ts.net');
location.reload();
```

(Replace the URL with the actual `LAPTOP_TS_HOST` from Step 1.)

5. After reload, look at the PSLink nav bar. The badge should read **`PDF · LOCAL`** instead of `PDF · CLOUD`. If it still says CLOUD:
   - Check `_psqLocalBase` value in console: `console.log(_psqLocalBase)` — should match laptop URL.
   - Check the `/health` probe in DevTools Network tab — should be a 200 OK from the laptop hostname.
   - If probe times out in the browser but works from `curl` → Tailscale Funnel cert issue. Wait 5 min for cert issuance and try again.

---

## Verification — End-to-End Test

1. In PSLink, go to **PSQ tab** → pick any quotation → click **Prepare All**.
2. Watch DevTools Network tab. The PDF render request should go to `https://pslink-work.<tailnet>.ts.net:10000/render-pdf` (or similar path).
3. Response time should be under 3 seconds (vs cloud Fly.io cold start of 5-10s).
4. The generated PDF opens correctly with Thai fonts intact.

If all four pass: setup complete.

---

## Troubleshooting

**Docker container exits immediately**
```powershell
docker compose logs pdf
# Look for "Error: ..." or "EADDRINUSE" or font errors
```
Common causes: port 8082 already in use (kill the other process), `.env` PDF_AUTH_TOKEN missing.

**`tailscale funnel` says "this device is not allowed to use Funnel"**
- Tailnet admin console: https://login.tailscale.com/admin/dns/funnel → enable for this device.
- Or run with explicit reset: `tailscale funnel reset` then re-issue.

**PSLink badge stays `PDF · CLOUD` after reload**
- Override key may not be persisting. Verify: `localStorage.getItem('ps_psq_local_base_override')` in console.
- The synced value may have overwritten — check `localStorage.getItem('ps_psq_local_base')`. The override should win regardless because module-init reads override first.
- Check `_psqLocalBase` in-memory: `console.log(_psqLocalBase)`. If it doesn't match, the SyncFromGist refresh path (line ~48422) may not have run yet — try one more reload.

**Prepare All times out / 401**
- Token mismatch between PSLink's `ps_pdf_auth_token` and laptop's `.env PDF_AUTH_TOKEN`. Both must be IDENTICAL. Re-verify by comparing `localStorage.getItem('ps_pdf_auth_token')` with `.env` value.

**Latency is similar to cloud (~5+ seconds)**
- Funnel from outside the Tailnet routes through Tailscale's edge servers (public internet), not direct P2P. To get true low-latency, install Tailscale on the BROWSER device too (so it's also on the Tailnet) and the connection becomes direct WireGuard P2P.
- If you ARE on the Tailnet but it's still slow: check `tailscale ping pslink-work` — should show direct connection, not relay (`derp`).

---

## To Revert (back to cloud-only on this laptop)

```javascript
// In PSLink browser console:
localStorage.removeItem('ps_psq_local_base_override');
location.reload();
```

```powershell
# On the laptop:
tailscale funnel --https=10000 off
docker compose down
```

The home PC URL stays in Gist — other devices keep working unchanged.

---

## Reference — Where Things Live in the Main Codebase

For Claude reading this on the work laptop without access to the full project memory:

- **Override read in JS module init**: `PSLink with PWA.html:14857` — reads `ps_psq_local_base_override` first, falls back to `ps_psq_local_base`.
- **Override re-read after Gist sync**: `PSLink with PWA.html:48422` — refreshes `_psqLocalBase` post-sync (otherwise in-memory variable goes stale on fresh device boot, per CLAUDE.md Rule 21).
- **Tailscale clipboard limitation** (do NOT re-debug): `RUNBOOK-Hybrid-Setup.md` in the project root explains why ONLY PDF runs locally — Collabora + WOPI must stay on cloud Fly.io because Tailscale Funnel breaks Collabora's sub-cell text clipboard.
- **soffice headless recalc gotchas**: `NOTES-soffice-recalc.md` — important if PDF renders with stale SUM/BAHTTEXT cached values; affects worker server.js logic.
