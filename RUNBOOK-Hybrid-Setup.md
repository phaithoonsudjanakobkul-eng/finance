---
name: PSLink Hybrid (PDF-only local + Cloud Collabora) and Tailscale clipboard limitation
description: Live editor (Collabora + WOPI) runs cloud Fly.io always; only PDF rendering is local Tailscale. Tailscale Funnel + Collabora sub-cell text clipboard is fundamentally broken — documented here so we don't waste time re-debugging.
type: project
originSessionId: 8952ad1c-82f8-40d5-b8df-d7456ec50e27
---
PSQ Path E architecture as of 2026-04-30 (post-clipboard-investigation): Cloud Collabora always for the live editor; Local Tailscale for PDF rendering only.

**The Tailscale clipboard limitation (do NOT re-debug)**

Symptom: open xlsx in Path E with Local mode (Tailscale Funnel route), double-click into a cell to enter text-edit mode, select some text, Ctrl+X, click into another cell, Ctrl+V → the receiving cell shows raw Collabora multipart format dumped as text:
```
application/vnd.oasis.opendocument.text-flat-xml e40 (LED Binocular Microscope)…
text/plain;charset=utf-8 6f (LED Binocular Microscope)…
text/rtf 417 {\rtf...}
```

Hours of debugging tried (all failed): `--o:server_name`, `--o:net.proto=HTTPS`, `--o:net.proxy_prefix=true`, `<alias>` mapping for port 8443, Collabora `:latest` vs older tags, Tailscale Funnel HTTP backend vs `https+insecure://` passthrough, Collabora HTTPS self-signed, full `docker compose down` + Tailscale `funnel reset` + clean rebuild. Cloud Fly.io edge proxy never has the bug.

What we know:
- **Whole-cell** Ctrl+C/V (click cell, no double-click) works locally — Collabora's cell-paste path parses its own multipart format.
- **Sub-cell text** Ctrl+C/X/V (double-click → select word) breaks locally — uses `navigator.clipboard.writeText()` + plain-text paste path.
- Response headers from Collabora are byte-identical between Cloud and Tailscale routes (same CSP, same content-type, etc.). Difference is below the HTTP layer (likely wireguard MTU / chunked-encoding / WebSocket frame timing). Not fixable from Collabora config.
- A previous false-positive "fix" (`server_name + net.proto=HTTPS`) seemed to work but was either coincidence or only fixed whole-cell paste — sub-cell was never tested at that point.

**Don't waste time re-debugging this** unless someone in the Collabora project explicitly fixes Tailscale Funnel compat. Move straight to one of: (a) cloud Collabora always (current choice, ~$0.05–0.50/mo with auto-stop), (b) different reverse proxy (Caddy/Cloudflare Tunnel — untested but theoretically can set headers/framing differently), (c) different editor (OnlyOffice — unknown compat), (d) workaround: use whole-cell ops only.

**Current architecture (2026-04-30):**

| Service | Where | Why |
|---|---|---|
| `pslink-pdf` | Local Docker @ `:10000` via Tailscale Funnel | PDF render speed boost; clipboard not involved |
| `pslink-collabora` | Cloud Fly.io | sub-cell clipboard works |
| `pslink-wopi` | Cloud Fly.io | needed by cloud Collabora; whitelist already configured |
| Local `collabora` + `wopi` containers | Stopped, behind `profiles: ["legacy"]` in compose | unused but kept buildable for future tests |

**PSLink endpoint logic** (in `_psqApplyEndpoint`): WOPI + Collabora always cloud (hardcoded in the function — comment explains why). `_psqGetPdfWorkerConfig` is the only mode-aware accessor — uses `_psqLocalBase + ':10000'` when Hybrid local detected, falls back to `ps_pdf_worker_url` cloud value otherwise. `_psqDetectEndpoint` probe: `${_psqLocalBase}:10000/health` with 1.5s timeout; success = local PDF, timeout = cloud PDF.

**Hybrid badge** (`PDF · LOCAL` / `PDF · CLOUD`): only PDF endpoint mode is shown — wording chosen so user doesn't think Collabora itself is local. Hidden when `ps_psq_local_base` localStorage is empty (cloud-only users).

**Tailscale Funnel state** (post-cleanup):
- `https://pslink-home.tailaec085.ts.net:10000` → `http://localhost:8082` (PDF) — only one active
- 443 (collab) and 8443 (wopi) funnels turned off

**To re-enable local Collabora + WOPI for testing**:
```bash
docker compose --profile legacy up -d
tailscale funnel --bg --https=443 http://localhost:9980
tailscale funnel --bg --https=8443 http://localhost:8081
# In PSLink browser console: undo _psqApplyEndpoint hardcode by editing or
# stash a temp override.
```

**Cost reality (cloud Collabora always)**:
- Fly.io shared-cpu-1x 2GB: $0.0247/hour during use (~$18/mo if 24/7)
- With auto-stop + ~5 quotations/month × 15 min/session = 1.25 hours = ~$0.03/month
- WOPI 1GB always-on smaller: ~$0.015/mo
- PDF worker: also auto-stop, only billed when used = ~$0.005/mo
- Total realistic: **$0.05/month** for typical PSQ use; ceiling $1-2/month for heavy use
- Compare to time spent debugging Tailscale clipboard: not worth it

**How to apply:**
- Don't try to make local Collabora work with Tailscale unless something has materially changed (new Tailscale features, new Collabora version with proxy compat fix, or user willing to switch proxy).
- For new use of Hybrid: only consider local if the workload is server-side compute (PDF render, file conversion) — not anything that exercises Collabora's cross-origin client clipboard.
- localStorage knobs that matter: `ps_psq_local_base` (Tailscale base URL), `ps_psq_wopi_token` (cloud + local WOPI bearer — same value), `ps_pdf_auth_token` (cloud + local PDF bearer — same value).
- Backup tag at the time of this finalization: `backup223`.
