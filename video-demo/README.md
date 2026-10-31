# Brightloop Video Production System (Odoo Hackathon 2026)

This directory contains the automated video production pipeline for **Brightloop Software** — an enterprise subscription management and recurring revenue platform built for the Odoo Hackathon 2026.

The production engine uses **Python + FFmpeg + Edge TTS (`en-US-JennyNeural`)**, implementing a modular, pre-integration architecture that produces a complete 1080p demo video now while allowing genuine live recordings to replace reserved slots after application integration.

---

## 1. Video Specifications

| Property | Value |
| :--- | :--- |
| **Output File** | `video-demo/output/brightloop_demo_preliminary.mp4` |
| **Resolution** | 1920 × 1080 (Full HD, 16:9 widescreen) |
| **Frame Rate** | 30 FPS progressive (H.264 High Profile, `yuv420p`) |
| **Duration** | ~119 seconds (1 minute 59 seconds; target 90–120s) |
| **Voiceover** | Microsoft Edge TTS (`en-US-JennyNeural`, clean pace) |
| **Subtitles** | Synchronized SRT/VTT burned with translucent dark background box |
| **Audio Mix** | Dynamic mix of Jenny narration (-3dB) + procedural ambient synth (-22dB) |

---

## 2. Directory Structure

```text
video-demo/
├── assets/
│   ├── audio/
│   │   ├── narration/            # 10 Edge-TTS narration audio clips (.mp3)
│   │   └── music/                # Procedural ambient synth soundtrack (.mp3)
│   ├── captures/                 # Genuine headless Chrome captures of frontend
│   │   ├── genuine_auth_screen.png
│   │   └── genuine_dashboard_preview.png
│   ├── graphics/                 # Branded 1080p scene cards (Pillow)
│   │   ├── scene_01_intro.png
│   │   ├── scene_02_problem.png
│   │   ├── scene_03_solution.png
│   │   ├── scene_04_architecture.png
│   │   └── scene_10_closing.png
│   └── placeholders/             # 5 Modular Replaceable Footage Slots
│       ├── slot1_main_dashboard.png / .mp4
│       ├── slot2_subscription_mgmt.png / .mp4
│       ├── slot3_invoice_payment.png / .mp4
│       ├── slot4_customer_portal.png / .mp4
│       └── slot5_reporting_dashboard.png / .mp4
├── config/
│   ├── scenes_config.json        # Master scene metadata, narration & slot definitions
│   └── scenes_timing.json        # Auto-measured audio durations & cue timestamps
├── output/
│   ├── clips/                    # Intermediate rendered 1080p scene MP4 clips
│   └── brightloop_demo_preliminary.mp4  # Final exported master demo video
├── scripts/
│   ├── build_all.py              # Master pipeline runner (stages 1 through 5)
│   ├── capture_genuine_screens.py # Headless Chrome screenshot capturer
│   ├── generate_narration.py     # Edge-TTS voiceover & SRT/VTT generator
│   ├── generate_music.py         # Procedural harmonic soundtrack synthesizer
│   ├── generate_assets.py        # Pillow 1080p card & slot generator
│   └── assemble_video.py         # FFmpeg clip builder, audio mixer & subtitle burner
├── subtitles/
│   ├── brightloop_demo.srt       # Synchronized SubRip subtitle track
│   └── brightloop_demo.vtt       # WebVTT subtitle track
├── narration_script.md           # Spoken narration script with visual cues
└── README.md                     # Production and slot-replacement guide
```

---

## 3. Pre-Integration Modular Structure & Reserved Slots

Because the backend and frontend are completing final integration under the team lead, the video is organized into **10 independent scenes** with **5 reserved footage slots**.

Each reserved slot contains:
1. An accurate, verified infographic or genuine component capture.
2. An on-screen `[MODULAR SLOT · INTEGRATION-READY]` identification banner.
3. An automatic override hook in `assemble_video.py`.

### The 5 Reserved Slots

| Slot ID | Slot Name | Scene # | Feature Scope | Integration-Ready Replacement File |
| :---: | :--- | :---: | :--- | :--- |
| **Slot 1** | `slot1_main_dashboard` | Scene 5 | Workspace & Role-Based Access Control | `assets/placeholders/slot1_main_dashboard.mp4` |
| **Slot 2** | `slot2_subscription_mgmt` | Scene 6 | Deterministic Subscription State Machine | `assets/placeholders/slot2_subscription_mgmt.mp4` |
| **Slot 3** | `slot3_invoice_payment` | Scene 7 | Transactional Billing & Reconciled Invoices | `assets/placeholders/slot3_invoice_payment.mp4` |
| **Slot 4** | `slot4_customer_portal` | Scene 8 | Customer Self-Service & Scoped Isolation | `assets/placeholders/slot4_customer_portal.mp4` |
| **Slot 5** | `slot5_reporting_dashboard` | Scene 9 | High-Performance Analytics (D5 Benchmark) | `assets/placeholders/slot5_reporting_dashboard.mp4` |

---

## 4. How to Replace Slots with Genuine Live Recordings

When Vishnu and the team complete final integration:

1. **Record the genuine screen flow** (e.g. creating a quotation, confirming an invoice, or recording a payment) at 1920x1080 or standard 16:9.
2. **Save the recording** into `video-demo/assets/placeholders/` with the exact slot filename:
   - For example: `video-demo/assets/placeholders/slot1_main_dashboard.mp4`
   - Or: `video-demo/assets/placeholders/slot3_invoice_payment.mp4`
3. **Re-run the video assembler**:
   ```bash
   python video-demo/scripts/assemble_video.py
   ```
4. **Done!** The assembler automatically detects the `.mp4` file, scales/pads it to 1080p, trims or loops it to match the existing voiceover duration, mixes audio, burns subtitles, and outputs the updated video without any manual video editing software.

---

## 5. How to Re-Run the Full Production Pipeline

Prerequisites:
- Python 3.10+ (with `edge-tts`, `pillow`)
- FFmpeg 6.0+ in system PATH

From repository root:

```bash
# Run the complete end-to-end pipeline:
python video-demo/scripts/build_all.py
```

Or execute individual stages:

```bash
# Stage 1: Capture genuine frontend screens
python video-demo/scripts/capture_genuine_screens.py

# Stage 2: Generate narration & subtitles
python video-demo/scripts/generate_narration.py

# Stage 3: Generate procedural ambient music
python video-demo/scripts/generate_music.py

# Stage 4: Render 1080p branded cards & slot graphics
python video-demo/scripts/generate_assets.py

# Stage 5: Assemble and encode master demo video
python video-demo/scripts/assemble_video.py
```

---

## 6. Narrative Scene Flow & Timing

| Scene | Duration | Title | Key Talking Point |
| :---: | :---: | :--- | :--- |
| **01** | ~10s | Opening & Branding | High-concurrency subscription & revenue operations platform |
| **02** | ~12s | Problem Statement | Concurrency race conditions, billing leaks, duplicate invoices |
| **03** | ~14s | Solution Architecture | ACID boundaries, advisory-locked runs, monotonic scheduling |
| **04** | ~16s | Full-Stack Architecture | React 19, Express 5, Node 24, PostgreSQL 16, Prisma 7, OpenAPI 3.1 |
| **05** | ~13s | Slot 1: Workspace & Security | Role-based workspaces (Admin, Staff, Customer), CSRF session security |
| **06** | ~14s | Slot 2: Subscription Lifecycle | 5-state machine (`Draft -> Quotation -> Confirmed -> Active -> Closed`) |
| **07** | ~13s | Slot 3: Transactional Billing | Crash-safe advisory lock lease, GST calculation, idempotent payments |
| **08** | ~12s | Slot 4: Customer Portal | Isolated self-service portal, owned contracts, payment history |
| **09** | ~12s | Slot 5: Reporting & Analytics | Sub-second analytics across 100,000 invoices (Milestone D5 verified) |
| **10** | ~11s | Closing Credits | Predictable recurring revenue, team credits, GitHub repository |

