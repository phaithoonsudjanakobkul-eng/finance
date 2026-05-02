# PS AI Studio — ComfyUI Setup Guide

> Setup guide สำหรับพี่เก่ง — ทำตามลำดับเพื่อเตรียม ComfyUI ก่อนจูนเริ่มเขียน PSLink integration
>
> **เวลาที่ใช้รวม**: ~60-90 นาที (ขึ้นกับเน็ต — โหลดรวม ~18-19GB)
> **Disk space ที่ใช้**: ~18-19GB
> **Hardware ปัจจุบัน**: RTX 3060 Laptop 6GB (ทำงานได้แต่ tight) → RTX 5070 Laptop 8GB (smooth)

---

## ภาพรวมที่จะติดตั้ง

| ประเภท | ตัว | ขนาดรวม |
|--------|-----|---------|
| Custom nodes (ComfyUI Manager) | 6 ตัว | minimal |
| Diffusion model + encoders | 4 ไฟล์ | ~12.5GB |
| Reference / segmentation | IP-Adapter (982MB) + Florence-2 (1.55GB, auto) + SAM2 (184MB) | ~2.7GB |
| LoRAs | 4 ตัว (179 + ~300 + ~300 + 613 MB) | ~1.4GB |
| **รวม** | | **~16.6GB downloads** |

ComfyUI Desktop เองที่ติดตั้งอยู่แล้ว ใช้พื้นที่ ~3-4GB เพิ่ม → **รวมทั้งโปรเจกต์ ~20GB**

> หมายเหตุ: Florence-2 จะถูก auto-download โดย custom node ของ kijai ตอนรัน workflow ครั้งแรก (1.55GB) — ถ้าพี่เก่งอยาก setup offline ทั้งหมดก็ download manual ตาม Step 3.2 ได้

---

## Prerequisites — ตรวจสอบก่อนเริ่ม

1. **ComfyUI Desktop ติดตั้งอยู่แล้ว** (พี่เก่งมีแล้ว ที่ `C:\Users\kumic\AppData\Local\Programs\ComfyUI\`)
2. **HuggingFace account** — บางไฟล์เป็น gated model (ae.safetensors ของ Flux) ต้อง login + accept license
   - สมัครฟรีที่: https://huggingface.co/join
   - ไป accept Flux license ที่: https://huggingface.co/black-forest-labs/FLUX.1-dev (กด "Agree" เพื่อปลดล็อก ae.safetensors)
3. **Disk space**: เช็คให้มี **อย่างน้อย 25GB ว่าง** (เผื่อ cache + workspace)
4. **เปิด ComfyUI Desktop** อย่างน้อยหนึ่งครั้งให้มัน initialize folder structure

---

## Path ที่จะใช้

ComfyUI Desktop บน Windows มี 2 paths สำคัญ:

```
C:\Users\kumic\AppData\Local\Programs\ComfyUI\          ← installation (อย่าแตะ)
C:\Users\kumic\Documents\ComfyUI\                       ← user data (วาง model ที่นี่)
```

**โฟลเดอร์ที่จะวางไฟล์**:
```
C:\Users\kumic\Documents\ComfyUI\
├── models\
│   ├── unet\                    ← Flux Kontext GGUF
│   ├── text_encoders\           ← clip_l + t5xxl
│   ├── vae\                     ← ae.safetensors
│   ├── loras\                   ← 4 LoRAs
│   ├── ipadapter\               ← Flux IP-Adapter
│   ├── LLM\                     ← Florence-2
│   └── sam2\                    ← SAM2 Small
└── custom_nodes\                ← Manager จัดการเองตอนติด custom nodes
```

ถ้าโฟลเดอร์ย่อยไหนยังไม่มี — สร้างใหม่ได้เลย

---

## Step 1 — ติดตั้ง 6 Custom Nodes ผ่าน ComfyUI Manager

### 1.1 เปิด ComfyUI Manager

- เปิด ComfyUI Desktop
- รอจน workflow canvas โหลดเสร็จ
- คลิกปุ่ม **"Manager"** (มุมขวาบน หรือใน menu)

### 1.2 ติดตั้งทีละตัว

ในหน้า Manager → คลิก **"Custom Nodes Manager"** → ในช่อง search ใส่ชื่อต่อไปนี้ทีละตัว → กด **Install** → รอเสร็จ:

| # | ชื่อค้นหา | Author | บทบาท |
|---|---------|--------|--------|
| 1 | `ComfyUI-GGUF` | city96 | รัน Flux Kontext GGUF |
| 2 | `ComfyUI-Detail-Daemon` | Jonseed | Preserve fine details ระหว่าง edit |
| 3 | `ComfyUI_IPAdapter_plus` | cubiq | L2 reference-guided regen (ลวดลายโซ่ใกล้เดิม) |
| 4 | `ComfyUI-Kontext-Inpainting` | ZenAI-Vietnam | Mask-based inpaint |
| 5 | `ComfyUI-Florence2` | kijai | Auto-detect "amulet/pendant/necklace/glasses/watch" |
| 6 | `ComfyUI-segment-anything-2` | kijai | Fine segmentation (SAM2) |

### 1.3 Restart ComfyUI Desktop

หลังติดทุกตัวแล้ว → ปิด ComfyUI Desktop → เปิดใหม่ → รอ initialize เสร็จ

**ทดสอบ**: ใน workflow canvas → double-click → search "UnetLoaderGGUF" — ถ้าเจอ = ติด GGUF สำเร็จ

---

## Step 2 — Download Flux Kontext Models (~12.5GB)

### 2.1 Flux Kontext GGUF Q4_K_S (6.8GB) — main engine

**URL**: https://huggingface.co/QuantStack/FLUX.1-Kontext-dev-GGUF/tree/main

**ไฟล์ที่โหลด**: `flux1-kontext-dev-Q4_K_S.gguf`

**วางที่**: `C:\Users\kumic\Documents\ComfyUI\models\unet\`

> **Note**: ถ้า RTX 5070 มาแล้ว (8GB) สามารถลอง Q5_K_S (~7.5GB) แทนเพื่อคุณภาพดีกว่าได้ — แต่ตอนนี้ใช้ Q4_K_S ก่อน

### 2.2 T5-XXL FP8 (5.2GB) — text encoder

**URL**: https://huggingface.co/comfyanonymous/flux_text_encoders/tree/main

**ไฟล์ที่โหลด**: `t5xxl_fp8_e4m3fn_scaled.safetensors`

**วางที่**: `C:\Users\kumic\Documents\ComfyUI\models\text_encoders\`

### 2.3 CLIP-L (246MB) — text encoder

**URL**: https://huggingface.co/comfyanonymous/flux_text_encoders/tree/main

**ไฟล์ที่โหลด**: `clip_l.safetensors`

**วางที่**: `C:\Users\kumic\Documents\ComfyUI\models\text_encoders\`

### 2.4 Flux VAE (335MB)

**URL**: https://huggingface.co/black-forest-labs/FLUX.1-dev/tree/main

> **Gated model** — ต้อง login HF + accept license ที่หน้านี้ก่อน (ดู Prerequisites)

**ไฟล์ที่โหลด**: `ae.safetensors`

**วางที่**: `C:\Users\kumic\Documents\ComfyUI\models\vae\`

---

## Step 3 — Download IP-Adapter, Florence-2, SAM2 (~1.6GB)

### 3.1 Flux IP-Adapter (982MB) — สำหรับ L2 reference guide

**URL**: https://huggingface.co/XLabs-AI/flux-ip-adapter/tree/main

**ไฟล์ที่โหลด**: `ip_adapter.safetensors` (982MB)

**วางที่**: `C:\Users\kumic\Documents\ComfyUI\models\ipadapter\`

### 3.2 Florence-2 Large (~1.55GB) — auto-detect jewelry/amulet

**URL**: https://huggingface.co/microsoft/Florence-2-large/tree/main

> **ทางลัดที่แนะนำ — ปล่อยให้ ComfyUI-Florence2 (kijai) จัดการให้:**
> custom node ของ kijai จะ auto-download model จาก HF cache ตอนรัน workflow ครั้งแรก พี่เก่งไม่ต้อง download manual ก่อนค่ะ — ข้ามไป Step 3.3 ได้เลย รอบแรกที่รัน Smart/Lock mode มันจะดาวน์โหลดอัตโนมัติประมาณ 1.5GB

**ถ้าอยาก download manual ล่วงหน้า** (เช่น offline setup):

**โหลดเฉพาะไฟล์เหล่านี้** (ผ่าน "Files and versions"):
- `model.safetensors` (1.55GB) — ใช้แทน pytorch_model.bin (modern format, ขนาดเท่ากัน)
- `config.json`
- `generation_config.json`
- `preprocessor_config.json`
- `processor_config.json`
- `tokenizer.json`
- `tokenizer_config.json`
- `vocab.json`

**วางที่**: `C:\Users\kumic\Documents\ComfyUI\models\LLM\Florence-2-large\`

> **ทางลัดด้วย git clone** (จะโหลดทั้ง repo ~3.12GB เพราะมีทั้ง pytorch_model.bin และ model.safetensors — ใหญ่ขึ้น 2 เท่า):
> ```powershell
> cd C:\Users\kumic\Documents\ComfyUI\models\LLM\
> git clone https://huggingface.co/microsoft/Florence-2-large
> ```
> ถ้าอยากประหยัด disk → ลบ `pytorch_model.bin` ออกหลัง clone เสร็จ

### 3.3 SAM2 Small (184MB)

**URL**: https://huggingface.co/facebook/sam2-hiera-small/tree/main

**ไฟล์ที่โหลด**: `sam2_hiera_small.pt`

**วางที่**: `C:\Users\kumic\Documents\ComfyUI\models\sam2\`

---

## Step 4 — Download 4 LoRAs (~1.2GB)

### 4.1 `kontext_hires` — MUST HAVE detail preservation

**URL**: https://huggingface.co/chflame163/kontext_hires/tree/main

**ไฟล์**: `kontext_hires-25620.safetensors` (179MB — เลข `25620` = training step ของ release นี้)

**วางที่**: `C:\Users\kumic\Documents\ComfyUI\models\loras\`

**Recommended strength**: 0.6 - 1.0
**Trigger**: prepend `"high quality, detailed,"` ใน prompt

> **Bonus**: ใน repo เดียวกันมี `kontext_hires_example.json` (367KB) — example workflow ของ author — drag-and-drop ใน ComfyUI เพื่อดู reference setup ได้ค่ะ

### 4.2 `Body_Adjuster_kontext` — body morph (Civitai)

**URL**: https://civitai.com/models/1820122/bodyadjusterkontext

**วางที่**: `C:\Users\kumic\Documents\ComfyUI\models\loras\`

**Recommended strength**: 0.5 - 0.8

> **Civitai download**: ต้อง login Civitai ก่อนโหลด — สมัครฟรีที่ https://civitai.com/login

### 4.3 `Kontext make her slim` — body morph (Civitai)

**URL**: https://civitai.com/models/1833641/kontext-make-her-slim

**วางที่**: `C:\Users\kumic\Documents\ComfyUI\models\loras\`

**Recommended strength**: 0.5 - 0.8
**Trigger**: `"make her slim"` หรือ `"make him slim"`

### 4.4 `Realism-Detailer-Kontext-Dev-LoRA` — skin texture cleanup

**URL**: https://huggingface.co/fal/Realism-Detailer-Kontext-Dev-LoRA/tree/main

**ไฟล์**: `high_detail.safetensors` (613MB)

**วางที่**: `C:\Users\kumic\Documents\ComfyUI\models\loras\`

**Recommended strength**: 0.5 - 1.5

---

## Step 5 — เปิด CORS ใน ComfyUI Desktop

> **CRITICAL** — ถ้าไม่เปิด PSLink จะเชื่อมต่อ ComfyUI ไม่ได้

1. เปิด ComfyUI Desktop
2. กด **Ctrl+,** หรือคลิก **Settings** (ไอคอน gear)
3. ไปที่แท็บ **"Server Config"**
4. หาช่อง **"Enable CORS Header"**
5. ใส่ค่า: `*`
6. กด **Save**
7. **Restart ComfyUI Desktop**

**ทดสอบ**: หลัง restart ลองเปิด browser → URL bar พิมพ์ `http://127.0.0.1:8188/system_stats` → ควรเห็น JSON response

---

## Step 6 — ทดสอบ Flux Kontext Workflow

### 6.1 Download test workflow

ดาวน์โหลด workflow JSON ตัวอย่าง:

**URL**: https://huggingface.co/calcuis/kontext-gguf/blob/main/workflow-kontext-gguf.json

หรือใช้ workflow official:
**URL**: https://docs.comfy.org/tutorials/flux/flux-1-kontext-dev

### 6.2 Import + รัน

1. เปิด ComfyUI Desktop
2. Drag-and-drop ไฟล์ `.json` ลงใน canvas
3. ใน node `UnetLoaderGGUF` → เลือก `flux1-kontext-dev-Q4_K_S.gguf`
4. ใน node `DualCLIPLoader` → เลือก `clip_l.safetensors` + `t5xxl_fp8_e4m3fn_scaled.safetensors`
5. ใน node `VAELoader` → เลือก `ae.safetensors`
6. ใน node `LoadImage` → upload รูปทดสอบ (รูปคน 1 คน, มีเครื่องประดับเล็กๆ)
7. ใน node `CLIPTextEncode` → ใส่ prompt: `"change the background to a beach scene, keep the same person, clothing, and accessories"`
8. กด **Queue Prompt** (ปุ่มสีฟ้า)
9. รอ ~2-3 นาที (รูปแรกจะช้าเพราะโหลด model เข้า VRAM)

### 6.3 ตรวจสอบผลลัพธ์

✅ **ถ้าได้รูป output** = ทุกอย่าง setup ถูกต้อง → บอกจูนได้เลย

❌ **ถ้า error**:
- `OOM` / `CUDA out of memory` → เปิด `Settings → ComfyUI → Extra args` → เพิ่ม `--lowvram` → restart
- `Module not found` → ตรวจ Step 1 ว่าติดทุก custom node แล้วหรือยัง
- `File not found` → ตรวจว่า path ของ model ถูกต้อง (ดู Step 2-4)

---

## Step 7 — ทดสอบเชื่อมต่อจาก browser (optional)

ถ้าอยาก confirm ว่า CORS ทำงาน ก่อน PSLink มา → เปิด browser DevTools Console:

```javascript
fetch('http://127.0.0.1:8188/system_stats')
  .then(r => r.json())
  .then(console.log);
```

ถ้าได้ JSON object กลับมา (ไม่ใช่ CORS error) = ผ่าน

---

## Recipe ตัวอย่างสำหรับใช้ใน PSLink (จูนจะเอาไปใส่ใน workflow JSON)

### Recipe A — "ขยายหน้าอกพอประมาณ + รักษาสร้อย" (use case หลักของพี่เก่ง)

```
LoRA stack:
  Body_Adjuster_kontext  @ 0.55
  kontext_hires          @ 0.85

Prompt:
"make her breasts slightly larger, while preserving the necklace,
 chain links, jewelry position, clothing details, and skin texture.
 high quality, detailed,"

Settings:
  Guidance: 2.0
  Steps: 24
  Denoise: 0.7
```

### Recipe B — "ทำให้ผอมลง"

```
LoRA stack:
  Kontext make her slim  @ 0.7
  kontext_hires          @ 0.8

Prompt:
"make her slim, while preserving the necklace, clothing,
 hairstyle, and background, high quality, detailed,"
```

### Recipe C — "Lock pendant" (Phase 2 — สำหรับพระเครื่อง/จี้ลาย unique)

> Phase 2 จะมี UI ให้ user toggle "Lock pendant" → ระบบจะ:
> 1. Florence-2 auto-detect "amulet/pendant" → ได้ bounding box
> 2. SAM2 fine-segment ตัวจี้
> 3. Edit body + resynth โซ่ ตาม Recipe A
> 4. Composite ตัวจี้พระเครื่องเดิม pixel-perfect ใส่ตำแหน่งใหม่
> 5. Detail Daemon blend edges

---

## Troubleshooting

### ComfyUI Desktop ไม่เปิด / ค้าง

ลบ `C:\Users\kumic\AppData\Roaming\ComfyUI\` ถ้า config เสีย — แต่จะเสีย settings เดิมหมด (CORS ต้องตั้งใหม่)

### Manager หา custom node ไม่เจอ

อัพเดต Manager database: ใน Manager → คลิก **"Update DB"** หรือ **"Fetch updates"**

### Civitai โหลดช้ามาก

Civitai มี rate limit สำหรับ free user — ใช้ Civitai's own client หรือ download manager เช่น JDownloader2 อาจเร็วกว่า

### Florence-2 ใช้พื้นที่เยอะกว่า 700MB

ปกติ — ต้องโหลดทั้งโฟลเดอร์ (มี config + tokenizer files หลายตัว) บางตัวอาจรวม ~1.5GB ก็ปกติ

### Flux Kontext OOM บน 6GB

- เพิ่ม `--lowvram` หรือ `--novram` ใน Extra args
- ลด resolution → 768x1024 หรือ 768x768
- ลด stack LoRA เหลือ 1 ตัว (kontext_hires อย่างเดียว)
- ปิด browser tab อื่นๆ ที่ใช้ GPU memory

### หลังอัพเกรด RTX 5070 (8GB)

- ลอง Q5_K_S GGUF (~7.5GB) แทน Q4_K_S → คุณภาพดีกว่า
- ปิด `--lowvram` flag
- เพิ่ม steps จาก 24 → 30 → คุณภาพดีขึ้น

---

## Checklist ก่อนแจ้งจูน

- [ ] Step 1: ติด 6 custom nodes ครบ + restart ComfyUI
- [ ] Step 2: โหลด Flux Kontext GGUF + T5 + CLIP + VAE ครบ 4 ไฟล์
- [ ] Step 3: โหลด IP-Adapter + Florence-2 + SAM2
- [ ] Step 4: โหลด 4 LoRAs
- [ ] Step 5: เปิด CORS = `*` + restart
- [ ] Step 6: รัน test workflow ได้รูป output สำเร็จ
- [ ] Step 7 (optional): ทดสอบ fetch จาก browser ผ่าน

เมื่อทำครบ → บอกจูน **"setup เสร็จแล้ว"** จูนจะเริ่ม backup PSLink HTML แล้วลงมือเขียน Phase 1 integration ทันทีค่ะ

---

## References

- [ComfyUI Routes (HTTP API)](https://docs.comfy.org/development/comfyui-server/comms_routes)
- [ComfyUI Server Config docs](https://docs.comfy.org/interface/settings/server-config)
- [Flux.1 Kontext Dev official tutorial](https://docs.comfy.org/tutorials/flux/flux-1-kontext-dev)
- [QuantStack/FLUX.1-Kontext-dev-GGUF (HF)](https://huggingface.co/QuantStack/FLUX.1-Kontext-dev-GGUF)
- [city96/ComfyUI-GGUF (GitHub)](https://github.com/city96/ComfyUI-GGUF)
- [chflame163/kontext_hires (HF)](https://huggingface.co/chflame163/kontext_hires)
- [Civitai Body_Adjuster_kontext](https://civitai.com/models/1820122/bodyadjusterkontext)
- [Civitai Kontext make her slim](https://civitai.com/models/1833641/kontext-make-her-slim)
- [fal/Realism-Detailer-Kontext-Dev-LoRA (HF)](https://huggingface.co/fal/Realism-Detailer-Kontext-Dev-LoRA)
