#!/usr/bin/env python3
"""
generate_assets.py
Renders high-definition (1920x1080) branded visual cards for Brightloop video production,
combining genuine application screenshots, architectural diagrams, and modular slot overlays.
"""

import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

BASE_DIR = Path(__file__).resolve().parent.parent
GRAPHICS_DIR = BASE_DIR / "assets" / "graphics"
PLACEHOLDERS_DIR = BASE_DIR / "assets" / "placeholders"
CAPTURES_DIR = BASE_DIR / "assets" / "captures"

WIDTH = 1920
HEIGHT = 1080

# Palette
BG_DARK = (15, 23, 42)        # Slate 900
BG_CARD = (30, 41, 59)        # Slate 800
BG_SURFACE = (23, 37, 84)     # Deep Blue
EMERALD_DEEP = (21, 61, 45)   # #153d2d
EMERALD_BRAND = (23, 107, 75) # #176b4b
EMERALD_ACCENT = (35, 134, 94)# #23865e
EMERALD_LIGHT = (231, 242, 235)
TEXT_WHITE = (248, 250, 252)
TEXT_MUTED = (148, 163, 184)
TEXT_DIM = (100, 116, 139)
ACCENT_BLUE = (59, 130, 246)
ACCENT_AMBER = (245, 158, 11)
ACCENT_PURPLE = (168, 85, 247)
BORDER_COLOR = (51, 65, 85)


def get_font(size: int, bold: bool = False):
    font_file = "segoeuib.ttf" if bold else "segoeui.ttf"
    path = os.path.join(r"C:\Windows\Fonts", font_file)
    if os.path.exists(path):
        return ImageFont.truetype(path, size)
    return ImageFont.load_default()


def create_base_canvas(title_tag: str, main_title: str) -> tuple[Image.Image, ImageDraw.ImageDraw]:
    im = Image.new("RGB", (WIDTH, HEIGHT), BG_DARK)
    draw = ImageDraw.Draw(im)

    # Gradient glow at top
    for y in range(300):
        alpha = int(35 * (1.0 - y / 300.0))
        color = (15 + int(alpha * 0.4), 23 + int(alpha * 1.5), 42 + int(alpha * 1.0))
        draw.line([(0, y), (WIDTH, y)], fill=color)

    # Top Brand Bar
    # Logo mark
    draw.rounded_rectangle([70, 45, 115, 90], radius=10, fill=EMERALD_BRAND)
    draw.text((82, 49), "R", fill=TEXT_WHITE, font=get_font(30, bold=True))

    draw.text((130, 48), "Brightloop", fill=TEXT_WHITE, font=get_font(26, bold=True))
    draw.text((255, 52), "SOFTWARE", fill=EMERALD_ACCENT, font=get_font(18, bold=True))
    draw.text((130, 76), "ENTERPRISE SUBSCRIPTION MANAGEMENT", fill=TEXT_MUTED, font=get_font(11, bold=True))

    # Event badge
    draw.rounded_rectangle([WIDTH - 320, 50, WIDTH - 70, 88], radius=8, fill=(30, 58, 45), outline=EMERALD_ACCENT)
    draw.text((WIDTH - 300, 58), "ODOO HACKATHON 2026", fill=EMERALD_LIGHT, font=get_font(13, bold=True))

    # Header Divider
    draw.line([(70, 110), (WIDTH - 70, 110)], fill=BORDER_COLOR, width=1)

    # Category Tag & Main Title
    draw.rounded_rectangle([70, 135, 70 + len(title_tag) * 11 + 25, 165], radius=6, fill=EMERALD_DEEP, outline=EMERALD_BRAND)
    draw.text((82, 140), title_tag.upper(), fill=EMERALD_LIGHT, font=get_font(13, bold=True))

    draw.text((70, 180), main_title, fill=TEXT_WHITE, font=get_font(42, bold=True))

    return im, draw


# ==============================================================================
# SCENE 1: OPENING & BRANDING
# ==============================================================================
def render_scene_01(out_path: Path):
    im = Image.new("RGB", (WIDTH, HEIGHT), (10, 18, 30))
    draw = ImageDraw.Draw(im)

    # Radial ambient emerald gradient
    cx, cy = WIDTH // 2, HEIGHT // 2 - 40
    for r in range(500, 0, -10):
        factor = (500 - r) / 500.0
        c = (int(10 + factor * 25), int(18 + factor * 80), int(30 + factor * 45))
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c)

    # Large Center Logo
    box = [cx - 65, cy - 140, cx + 65, cy - 10]
    draw.rounded_rectangle(box, radius=24, fill=EMERALD_BRAND, outline=(50, 180, 120), width=3)
    draw.text((cx - 30, cy - 130), "R", fill=TEXT_WHITE, font=get_font(95, bold=True))

    # Title
    draw.text((cx - 240, cy + 20), "Brightloop", fill=TEXT_WHITE, font=get_font(68, bold=True))
    draw.text((cx + 100, cy + 30), "SOFTWARE", fill=EMERALD_ACCENT, font=get_font(44, bold=True))

    # Subtitle
    sub = "Enterprise Subscription & Recurring Revenue Management Platform"
    draw.text((cx - 430, cy + 115), sub, fill=TEXT_MUTED, font=get_font(26))

    # Feature Badges
    badges = [
        ("Atomic State Transitions", ACCENT_BLUE),
        ("Advisory-Locked Billing Runs", EMERALD_ACCENT),
        ("Isolated Customer Portals", ACCENT_PURPLE),
        ("PostgreSQL 16 Performance", ACCENT_AMBER),
    ]
    bx = cx - 480
    for text, color in badges:
        bw = len(text) * 11 + 32
        draw.rounded_rectangle([bx, cy + 180, bx + bw, cy + 225], radius=20, fill=BG_CARD, outline=color, width=2)
        draw.text((bx + 16, cy + 192), text, fill=TEXT_WHITE, font=get_font(15, bold=True))
        bx += bw + 20

    # Hackathon ribbon at bottom
    draw.rounded_rectangle([cx - 260, HEIGHT - 130, cx + 260, HEIGHT - 80], radius=12, fill=(20, 35, 55), outline=BORDER_COLOR)
    draw.text((cx - 220, HEIGHT - 117), "Built with Node.js 24 · Express 5 · React 19 · PostgreSQL 16", fill=TEXT_MUTED, font=get_font(15, bold=True))

    im.save(out_path, quality=95)


# ==============================================================================
# SCENE 2: PROBLEM STATEMENT
# ==============================================================================
def render_scene_02(out_path: Path):
    im, draw = create_base_canvas("Problem Statement", "The Recurring Revenue Dilemma")

    problems = [
        ("Concurrency Race Conditions", "Simultaneous billing jobs executing against due subscriptions create duplicate invoices or skipped intervals.", ACCENT_AMBER, "⚠"),
        ("Silent Billing Leakage", "Unverified discount exhaustion, uncalculated GST taxes, and unhandled retry failures bleed recurring revenue.", (239, 68, 68), "✕"),
        ("Unreconciled Balances", "Disconnect between subscription status, payment methods, partial payments, and overdue aging records.", ACCENT_PURPLE, "⇄"),
        ("Weak Customer Scoping", "Client-side filtering vulnerabilities expose cross-customer contract data without true database-level isolation.", ACCENT_BLUE, "🛡"),
    ]

    card_w = 410
    card_h = 360
    card_y = 290
    spacing = 35
    start_x = 70

    for idx, (title, desc, color, icon) in enumerate(problems):
        x = start_x + idx * (card_w + spacing)
        # Card Background
        draw.rounded_rectangle([x, card_y, x + card_w, card_y + card_h], radius=14, fill=BG_CARD, outline=BORDER_COLOR, width=2)

        # Header accent bar
        draw.rounded_rectangle([x, card_y, x + card_w, card_y + 8], radius=4, fill=color)

        # Icon circle
        draw.rounded_rectangle([x + 25, card_y + 35, x + 75, card_y + 85], radius=12, fill=(20, 25, 40), outline=color, width=2)
        draw.text((x + 40, card_y + 44), icon, fill=color, font=get_font(26, bold=True))

        # Title
        draw.text((x + 25, card_y + 115), title, fill=TEXT_WHITE, font=get_font(20, bold=True))

        # Description (wrapped)
        words = desc.split()
        lines = []
        cur = []
        for w in words:
            cur.append(w)
            if len(" ".join(cur)) > 28:
                lines.append(" ".join(cur[:-1]))
                cur = [w]
        if cur:
            lines.append(" ".join(cur))

        ly = card_y + 165
        for l in lines:
            draw.text((x + 25, ly), l, fill=TEXT_MUTED, font=get_font(16))
            ly += 26

    # Bottom Callout
    draw.rounded_rectangle([70, HEIGHT - 160, WIDTH - 70, HEIGHT - 85], radius=12, fill=(35, 20, 25), outline=(239, 68, 68), width=2)
    draw.text((100, HEIGHT - 145), "CORE RISK:", fill=(248, 113, 113), font=get_font(18, bold=True))
    draw.text((220, HEIGHT - 145), "Without ACID transaction boundaries and monotonic schedules, recurring billing is inherently non-deterministic.", fill=TEXT_WHITE, font=get_font(18))

    im.save(out_path, quality=95)


# ==============================================================================
# SCENE 3: SOLUTION OVERVIEW
# ==============================================================================
def render_scene_03(out_path: Path):
    im, draw = create_base_canvas("Solution Overview", "Brightloop: Financial Integrity by Design")

    pillars = [
        ("Atomic State Transitions", "Draft -> Quotation -> Confirmed -> Active -> Closed state machine enforced strictly by PostgreSQL CHECK constraints.", EMERALD_ACCENT),
        ("Advisory-Locked Billing", "Session-level pg_try_advisory_lock and durable recovery leases prevent overlapping workers from double-billing.", ACCENT_BLUE),
        ("Monotonic Advancements", "next_billing_date never advances backwards. Skipped pause periods and reused invoices are idempotency-safe.", ACCENT_PURPLE),
        ("Unified Reporting", "RepeatableRead transaction snapshots guarantee accurate point-in-time metrics with zero memory bloat.", ACCENT_AMBER),
    ]

    card_w = 410
    card_h = 360
    card_y = 290
    spacing = 35
    start_x = 70

    for idx, (title, desc, color) in enumerate(pillars):
        x = start_x + idx * (card_w + spacing)
        draw.rounded_rectangle([x, card_y, x + card_w, card_y + card_h], radius=14, fill=BG_CARD, outline=BORDER_COLOR, width=2)
        draw.rounded_rectangle([x, card_y, x + card_w, card_y + 8], radius=4, fill=color)

        # Pillar Number
        draw.text((x + 25, card_y + 35), f"PILLAR 0{idx+1}", fill=color, font=get_font(14, bold=True))
        draw.text((x + 25, card_y + 75), title, fill=TEXT_WHITE, font=get_font(22, bold=True))

        words = desc.split()
        lines = []
        cur = []
        for w in words:
            cur.append(w)
            if len(" ".join(cur)) > 26:
                lines.append(" ".join(cur[:-1]))
                cur = [w]
        if cur:
            lines.append(" ".join(cur))

        ly = card_y + 160
        for l in lines:
            draw.text((x + 25, ly), l, fill=TEXT_MUTED, font=get_font(17))
            ly += 28

    # Bottom banner
    draw.rounded_rectangle([70, HEIGHT - 160, WIDTH - 70, HEIGHT - 85], radius=12, fill=EMERALD_DEEP, outline=EMERALD_BRAND, width=2)
    draw.text((100, HEIGHT - 145), "BRIGHTLOOP GUARANTEE:", fill=EMERALD_LIGHT, font=get_font(18, bold=True))
    draw.text((340, HEIGHT - 145), "Zero duplicate invoices · 100% discount usage auditability · Database-level customer scoping.", fill=TEXT_WHITE, font=get_font(18))

    im.save(out_path, quality=95)


# ==============================================================================
# SCENE 4: ARCHITECTURE & TECH STACK
# ==============================================================================
def render_scene_04(out_path: Path):
    im, draw = create_base_canvas("Architecture & Stack", "End-to-End Type-Safe Architecture")

    # Draw 4 Horizontal Architecture Layers
    layers = [
        ("1. PRESENTATION LAYER", "React 19 · Vite 8 · TypeScript · Responsive Admin & Customer Portal", ACCENT_BLUE, 260),
        ("2. API & CONTRACT LAYER", "Express 5 · Node.js 24 · OpenAPI 3.1 Strict Ajv Schema Validation · CSRF Security", EMERALD_ACCENT, 410),
        ("3. PERSISTENCE & TRANSACTION LAYER", "Prisma ORM 7.10.1 · RepeatableRead Snapshots · Session-Level Advisory Locks", ACCENT_PURPLE, 560),
        ("4. DATABASE ENGINE", "PostgreSQL 16 (Alpine) · 34 Relational Models · Covering Indexes · Custom CHECK Constraints", ACCENT_AMBER, 710),
    ]

    for title, desc, color, y in layers:
        draw.rounded_rectangle([70, y, WIDTH - 70, y + 115], radius=12, fill=BG_CARD, outline=color, width=2)
        # Left color pill
        draw.rounded_rectangle([70, y, 90, y + 115], radius=6, fill=color)

        draw.text((120, y + 25), title, fill=color, font=get_font(18, bold=True))
        draw.text((120, y + 60), desc, fill=TEXT_WHITE, font=get_font(22, bold=True))

        # Arrow down connecting layers
        if y < 710:
            arrow_y = y + 117
            draw.text((WIDTH // 2 - 10, arrow_y), "▼", fill=TEXT_DIM, font=get_font(16))

    # Bottom summary tag
    draw.rounded_rectangle([70, HEIGHT - 150, WIDTH - 70, HEIGHT - 85], radius=10, fill=(20, 30, 45), outline=BORDER_COLOR)
    draw.text((100, HEIGHT - 130), "STANDARDS COMPLIANCE:", fill=TEXT_MUTED, font=get_font(16, bold=True))
    draw.text((320, HEIGHT - 130), "OpenAPI 3.1 REST JSON · RFC4122 v4 UUIDs · Exact Decimal Money (INR) · Node 24 Native Test Suite", fill=TEXT_WHITE, font=get_font(16))

    im.save(out_path, quality=95)


# ==============================================================================
# MODULAR SLOT 1: MAIN DASHBOARD & AUTHENTICATION
# ==============================================================================
def render_slot_01(out_path: Path):
    im, draw = create_base_canvas("Feature 01: Workspace & Security", "Role-Based Workspaces & Session Security")

    # Check if genuine capture exists
    auth_capture_path = CAPTURES_DIR / "genuine_auth_screen.png"

    # Slot Banner
    draw.rounded_rectangle([70, 250, WIDTH - 70, 300], radius=8, fill=(35, 45, 20), outline=ACCENT_AMBER, width=2)
    draw.text((95, 264), "[MODULAR SLOT 01 · INTEGRATION-READY]", fill=ACCENT_AMBER, font=get_font(16, bold=True))
    draw.text((490, 264), "Displaying Genuine Live Workspace AuthView (Session Authentication & Password Security)", fill=TEXT_WHITE, font=get_font(16))

    # Render Frame containing capture
    frame_x, frame_y = 70, 320
    frame_w, frame_h = 1200, 680

    if auth_capture_path.exists():
        auth_img = Image.open(auth_capture_path)
        auth_resized = auth_img.resize((frame_w, frame_h), Image.Resampling.LANCZOS)
        im.paste(auth_resized, (frame_x, frame_y))
        draw.rectangle([frame_x, frame_y, frame_x + frame_w, frame_y + frame_h], outline=BORDER_COLOR, width=2)

    # Right side feature callouts
    rx = 1310
    ry = 320
    callouts = [
        ("Session-Based Auth", "HTTP-only secure cookies with automatic CSRF token rotation on every login and mutation.", ACCENT_BLUE),
        ("Strict Password Policy", "Enforces > 8 characters with uppercase, lowercase, numbers, and special symbols.", EMERALD_ACCENT),
        ("Role Segregation", "Three isolated tiers: Admin (full system), Staff (billing & operations), Customer (self-service).", ACCENT_PURPLE),
        ("Brute-Force Protection", "Rate-limiting on login and reset token requests with distributed lock expiration.", ACCENT_AMBER),
    ]

    for title, desc, color in callouts:
        draw.rounded_rectangle([rx, ry, WIDTH - 70, ry + 150], radius=10, fill=BG_CARD, outline=BORDER_COLOR, width=2)
        draw.rounded_rectangle([rx, ry, rx + 8, ry + 150], radius=4, fill=color)
        draw.text((rx + 25, ry + 20), title, fill=color, font=get_font(18, bold=True))

        words = desc.split()
        lines = []
        cur = []
        for w in words:
            cur.append(w)
            if len(" ".join(cur)) > 30:
                lines.append(" ".join(cur[:-1]))
                cur = [w]
        if cur:
            lines.append(" ".join(cur))

        ly = ry + 55
        for l in lines:
            draw.text((rx + 25, ly), l, fill=TEXT_MUTED, font=get_font(15))
            ly += 22
        ry += 175

    im.save(out_path, quality=95)


# ==============================================================================
# MODULAR SLOT 2: SUBSCRIPTION LIFECYCLE MANAGEMENT
# ==============================================================================
def render_slot_02(out_path: Path):
    im, draw = create_base_canvas("Feature 02: Lifecycle Management", "Deterministic Subscription State Machine")

    draw.rounded_rectangle([70, 250, WIDTH - 70, 300], radius=8, fill=(35, 45, 20), outline=ACCENT_AMBER, width=2)
    draw.text((95, 264), "[MODULAR SLOT 02 · INTEGRATION-READY]", fill=ACCENT_AMBER, font=get_font(16, bold=True))
    draw.text((490, 264), "Replaceable with live screen recording of subscription authoring, quotation, and activation", fill=TEXT_WHITE, font=get_font(16))

    # Diagram of 5 States
    states = [
        ("DRAFT", "Initial contract creation", (100, 116, 139), 100),
        ("QUOTATION", "Template lines & pricing", (59, 130, 246), 460),
        ("CONFIRMED", "Customer approval", (168, 85, 247), 820),
        ("ACTIVE", "Recurring billing running", (16, 185, 129), 1180),
        ("CLOSED", "Terminated or expired", (239, 68, 68), 1540),
    ]

    card_y = 350
    for name, desc, color, x in states:
        draw.rounded_rectangle([x, card_y, x + 280, card_y + 140], radius=14, fill=BG_CARD, outline=color, width=3)
        draw.text((x + 25, card_y + 30), name, fill=color, font=get_font(22, bold=True))
        draw.text((x + 25, card_y + 75), desc, fill=TEXT_MUTED, font=get_font(15))

        if x < 1540:
            draw.text((x + 310, card_y + 50), "➔", fill=TEXT_WHITE, font=get_font(30, bold=True))

    # Policy Enforcement Cards
    policies = [
        ("Pause Intervals", "Plan policy allow_pause regulates pauseEffectiveDate and resumeEffectiveDate. During pauses, scheduled invoices are skipped deterministically.", EMERALD_ACCENT),
        ("Monotonic Schedule Advancement", "next_billing_date is updated atomically with WHERE next_billing_date <= period_end. Processing old runs can never rewind schedules.", ACCENT_BLUE),
        ("Closure & Expiry Rules", "allow_early_close and auto_close determine contract termination upon invoice overdue status or manual cancellation.", ACCENT_PURPLE),
    ]

    py = 540
    pw = 550
    for idx, (title, desc, color) in enumerate(policies):
        px = 70 + idx * (pw + 55)
        draw.rounded_rectangle([px, py, px + pw, py + 420], radius=12, fill=BG_CARD, outline=BORDER_COLOR, width=2)
        draw.rounded_rectangle([px, py, px + pw, py + 8], radius=4, fill=color)
        draw.text((px + 25, py + 30), title, fill=color, font=get_font(20, bold=True))

        words = desc.split()
        lines = []
        cur = []
        for w in words:
            cur.append(w)
            if len(" ".join(cur)) > 32:
                lines.append(" ".join(cur[:-1]))
                cur = [w]
        if cur:
            lines.append(" ".join(cur))

        ly = py + 85
        for l in lines:
            draw.text((px + 25, ly), l, fill=TEXT_WHITE, font=get_font(17))
            ly += 28

    im.save(out_path, quality=95)


# ==============================================================================
# MODULAR SLOT 3: TRANSACTIONAL BILLING & INVOICES
# ==============================================================================
def render_slot_03(out_path: Path):
    im, draw = create_base_canvas("Feature 03: Transactional Billing", "Automated Billing Runs & Idempotent Payments")

    draw.rounded_rectangle([70, 250, WIDTH - 70, 300], radius=8, fill=(35, 45, 20), outline=ACCENT_AMBER, width=2)
    draw.text((95, 264), "[MODULAR SLOT 03 · INTEGRATION-READY]", fill=ACCENT_AMBER, font=get_font(16, bold=True))
    draw.text((490, 264), "Replaceable with live screen recording of recurring invoice runs, GST calculation, and payments", fill=TEXT_WHITE, font=get_font(16))

    # Architecture Flow Box
    fx = 70
    fy = 330
    draw.rounded_rectangle([fx, fy, WIDTH - 70, fy + 260], radius=14, fill=BG_CARD, outline=EMERALD_ACCENT, width=2)
    draw.text((fx + 30, fy + 25), "CRASH-RESILIENT BILLING RUN PIPELINE", fill=EMERALD_LIGHT, font=get_font(18, bold=True))

    steps = [
        ("1. Advisory Lock Claim", "Acquires session-level advisory lock on dedicated DB connection", ACCENT_BLUE, 100),
        ("2. Candidate Selection", "Finds ACTIVE non-paused subs where next_billing_date <= as_of", EMERALD_ACCENT, 520),
        ("3. Atomic Generation", "Creates invoice + GST lines + discount redemptions in 1 tx", ACCENT_PURPLE, 940),
        ("4. Idempotent Payment", "Records payment with unique key, updating balance atomically", ACCENT_AMBER, 1360),
    ]

    for title, desc, color, sx in steps:
        draw.rounded_rectangle([sx, fy + 70, sx + 390, fy + 220], radius=10, fill=(20, 28, 45), outline=color, width=2)
        draw.text((sx + 15, fy + 90), title, fill=color, font=get_font(17, bold=True))

        words = desc.split()
        lines = []
        cur = []
        for w in words:
            cur.append(w)
            if len(" ".join(cur)) > 26:
                lines.append(" ".join(cur[:-1]))
                cur = [w]
        if cur:
            lines.append(" ".join(cur))

        ly = fy + 130
        for l in lines:
            draw.text((sx + 15, ly), l, fill=TEXT_MUTED, font=get_font(14))
            ly += 22

    # Bottom metrics & verification
    cards = [
        ("GST & Tax Calculation", "18% GST (CGST + SGST) accurately calculated with exact integer minor units or decimal money, avoiding floating-point rounding bugs.", EMERALD_ACCENT),
        ("Double-Billing Immunity", "Unique composite index on (subscription_id, period_start) prevents duplicate periods even during concurrent worker races.", ACCENT_BLUE),
        ("Partial Payments & Aging", "Supports multiple partial payments per invoice, with automatic balance_due calculation and overdue aging classification.", ACCENT_PURPLE),
    ]

    cy = 620
    cw = 550
    for idx, (title, desc, color) in enumerate(cards):
        cx = 70 + idx * (cw + 55)
        draw.rounded_rectangle([cx, cy, cx + cw, cy + 380], radius=12, fill=BG_CARD, outline=BORDER_COLOR, width=2)
        draw.rounded_rectangle([cx, cy, cx + cw, cy + 8], radius=4, fill=color)
        draw.text((cx + 25, cy + 30), title, fill=color, font=get_font(20, bold=True))

        words = desc.split()
        lines = []
        cur = []
        for w in words:
            cur.append(w)
            if len(" ".join(cur)) > 32:
                lines.append(" ".join(cur[:-1]))
                cur = [w]
        if cur:
            lines.append(" ".join(cur))

        ly = cy + 80
        for l in lines:
            draw.text((cx + 25, ly), l, fill=TEXT_WHITE, font=get_font(17))
            ly += 28

    im.save(out_path, quality=95)


# ==============================================================================
# MODULAR SLOT 4: CUSTOMER PORTAL
# ==============================================================================
def render_slot_04(out_path: Path):
    im, draw = create_base_canvas("Feature 04: Customer Portal", "Self-Service Management with Server-Side Scoping")

    dash_capture_path = CAPTURES_DIR / "genuine_dashboard_preview.png"

    draw.rounded_rectangle([70, 250, WIDTH - 70, 300], radius=8, fill=(35, 45, 20), outline=ACCENT_AMBER, width=2)
    draw.text((95, 264), "[MODULAR SLOT 04 · INTEGRATION-READY]", fill=ACCENT_AMBER, font=get_font(16, bold=True))
    draw.text((490, 264), "Displaying Genuine Overview Dashboard Prototype & Revenue Operations Interface", fill=TEXT_WHITE, font=get_font(16))

    frame_x, frame_y = 70, 320
    frame_w, frame_h = 1200, 680

    if dash_capture_path.exists():
        dash_img = Image.open(dash_capture_path)
        dash_resized = dash_img.resize((frame_w, frame_h), Image.Resampling.LANCZOS)
        im.paste(dash_resized, (frame_x, frame_y))
        draw.rectangle([frame_x, frame_y, frame_x + frame_w, frame_y + frame_h], outline=BORDER_COLOR, width=2)

    # Right side feature list
    rx = 1310
    ry = 320
    features = [
        ("Strict Scoping Isolation", "Portal routes /portal/* enforce customer_id = session.customer_id at the DB layer, rejecting tampering attempts with 400/403.", EMERALD_ACCENT),
        ("Live Contract Status", "Customers review active plans, next renewal dates, active pause intervals, and downloadable PDF invoices.", ACCENT_BLUE),
        ("Payment History Ledger", "Complete transparency on all recorded payments, payment methods (UPI, Bank Transfer, Card), and balances.", ACCENT_PURPLE),
        ("Self-Service Actions", "Customers can request pause, renewal, or closure per plan policies without waiting for manual support.", ACCENT_AMBER),
    ]

    for title, desc, color in features:
        draw.rounded_rectangle([rx, ry, WIDTH - 70, ry + 150], radius=10, fill=BG_CARD, outline=BORDER_COLOR, width=2)
        draw.rounded_rectangle([rx, ry, rx + 8, ry + 150], radius=4, fill=color)
        draw.text((rx + 25, ry + 20), title, fill=color, font=get_font(18, bold=True))

        words = desc.split()
        lines = []
        cur = []
        for w in words:
            cur.append(w)
            if len(" ".join(cur)) > 30:
                lines.append(" ".join(cur[:-1]))
                cur = [w]
        if cur:
            lines.append(" ".join(cur))

        ly = ry + 55
        for l in lines:
            draw.text((rx + 25, ly), l, fill=TEXT_MUTED, font=get_font(15))
            ly += 22
        ry += 175

    im.save(out_path, quality=95)


# ==============================================================================
# MODULAR SLOT 5: REPORTING PERSISTENCE & BENCHMARKING (D5)
# ==============================================================================
def render_slot_05(out_path: Path):
    im, draw = create_base_canvas("Feature 05: Reporting & Performance", "Enterprise Performance Benchmark (100k Invoices)")

    draw.rounded_rectangle([70, 250, WIDTH - 70, 300], radius=8, fill=(35, 45, 20), outline=ACCENT_AMBER, width=2)
    draw.text((95, 264), "[MODULAR SLOT 05 · INTEGRATION-READY]", fill=ACCENT_AMBER, font=get_font(16, bold=True))
    draw.text((490, 264), "Verified Milestone D5 PostgreSQL 16 Benchmark (10,000 Subscriptions · 100,000 Invoices)", fill=TEXT_WHITE, font=get_font(16))

    # Benchmark Results Table Frame
    tx = 70
    ty = 330
    tw = WIDTH - 140
    th = 400
    draw.rounded_rectangle([tx, ty, tx + tw, ty + th], radius=12, fill=BG_CARD, outline=BORDER_COLOR, width=2)

    # Table Header
    draw.rounded_rectangle([tx, ty, tx + tw, ty + 50], radius=8, fill=EMERALD_DEEP)
    headers = [("SCENARIO ID", 100), ("BENCHMARK SCENARIO", 300), ("SCOPE & VOLUME", 800), ("MEDIAN LATENCY", 1250), ("R12 SPEC (< 2.0s)", 1550)]
    for h, hx in headers:
        draw.text((hx, ty + 15), h, fill=EMERALD_LIGHT, font=get_font(15, bold=True))

    rows = [
        ("SCENARIO 1", "Customer 1-Month Overview", "Standard Customer (Current Month)", "23.82 ms", "PASSED (0.02s)"),
        ("SCENARIO 2", "Customer 1-Year Overview", "Standard Customer (Full Year)", "18.60 ms", "PASSED (0.02s)"),
        ("SCENARIO 4", "Staff Platform 1-Month", "Global Platform (10,000 subs)", "198.38 ms", "PASSED (0.20s)"),
        ("SCENARIO 6", "Staff Multi-Year Audit", "100,000 Invoices · 34 Months", "873.77 ms", "PASSED (0.87s)"),
        ("SCENARIO 7", "Plan-Filtered 1-Year Cohort", "Plan ID Filter · Covered Index", "119.09 ms", "PASSED (0.12s)"),
        ("SCENARIO 8", "Enterprise Whale Multi-Year", "Whale Customer (1,500 subs, 15k invs)", "162.51 ms", "PASSED (0.16s)"),
    ]

    ry = ty + 65
    for sid, name, vol, lat, status in rows:
        draw.text((100, ry), sid, fill=ACCENT_BLUE, font=get_font(15, bold=True))
        draw.text((300, ry), name, fill=TEXT_WHITE, font=get_font(15, bold=True))
        draw.text((800, ry), vol, fill=TEXT_MUTED, font=get_font(15))
        draw.text((1250, ry), lat, fill=EMERALD_ACCENT, font=get_font(16, bold=True))
        draw.text((1550, ry), status, fill=(34, 197, 94), font=get_font(15, bold=True))
        draw.line([(tx + 20, ry + 38), (tx + tw - 20, ry + 38)], fill=(45, 55, 75), width=1)
        ry += 52

    # Bottom Highlights
    hl_y = 760
    hl_w = 550
    highlights = [
        ("Index-Only Balance Scans", "Migration 20261031170000 added partial covering index idx_invoices_confirmed_due_covering, scanning 19,673 rows in 2.923 ms with 0 disk reads.", ACCENT_BLUE),
        ("Snapshot RepeatableRead Isolation", "Every reporting query runs under an isolated transaction snapshot, guaranteeing that moving balances never suffer phantom reads.", EMERALD_ACCENT),
        ("R12 Compliance Confirmed", "100% of reporting queries execute under 1.0 second (well under the 2.0s hackathon threshold) on standard GitHub Actions runners.", ACCENT_PURPLE),
    ]

    for idx, (title, desc, color) in enumerate(highlights):
        hx = 70 + idx * (hl_w + 55)
        draw.rounded_rectangle([hx, hl_y, hx + hl_w, hl_y + 240], radius=12, fill=BG_CARD, outline=BORDER_COLOR, width=2)
        draw.rounded_rectangle([hx, hl_y, hx + hl_w, hl_y + 8], radius=4, fill=color)
        draw.text((hx + 25, hl_y + 25), title, fill=color, font=get_font(18, bold=True))

        words = desc.split()
        lines = []
        cur = []
        for w in words:
            cur.append(w)
            if len(" ".join(cur)) > 32:
                lines.append(" ".join(cur[:-1]))
                cur = [w]
        if cur:
            lines.append(" ".join(cur))

        ly = hl_y + 65
        for l in lines:
            draw.text((hx + 25, ly), l, fill=TEXT_MUTED, font=get_font(15))
            ly += 24

    im.save(out_path, quality=95)


# ==============================================================================
# SCENE 10: CLOSING & CREDITS
# ==============================================================================
def render_scene_10(out_path: Path):
    im = Image.new("RGB", (WIDTH, HEIGHT), (10, 18, 30))
    draw = ImageDraw.Draw(im)

    cx, cy = WIDTH // 2, HEIGHT // 2 - 30

    # Ambient glow
    for r in range(500, 0, -10):
        factor = (500 - r) / 500.0
        c = (int(10 + factor * 25), int(18 + factor * 80), int(30 + factor * 45))
        draw.ellipse([cx - r, cy - r, cx + r, cy + r], fill=c)

    # Logo mark
    draw.rounded_rectangle([cx - 50, cy - 160, cx + 50, cy - 60], radius=20, fill=EMERALD_BRAND, outline=(50, 180, 120), width=3)
    draw.text((cx - 22, cy - 150), "R", fill=TEXT_WHITE, font=get_font(75, bold=True))

    draw.text((cx - 200, cy - 40), "Brightloop", fill=TEXT_WHITE, font=get_font(56, bold=True))
    draw.text((cx + 80, cy - 32), "SOFTWARE", fill=EMERALD_ACCENT, font=get_font(36, bold=True))

    draw.text((cx - 280, cy + 35), "Enterprise Subscription & Recurring Revenue Platform", fill=TEXT_MUTED, font=get_font(22))

    # Team Credits Cards
    team = [
        ("Vishnu912py", "Team Lead & Architecture", "API Contracts, Auth & Orchestration", ACCENT_BLUE),
        ("Zenfox-690", "Database Specialist", "Schema, Persistence, Locks & D5 Benchmarking", EMERALD_ACCENT),
        ("albinsavi123-lang", "Frontend Specialist", "Admin UI, Live Workspace & Customer Portal", ACCENT_PURPLE),
    ]

    card_w = 460
    card_h = 170
    card_y = cy + 100
    spacing = 40
    start_x = cx - (3 * card_w + 2 * spacing) // 2

    for idx, (name, role, details, color) in enumerate(team):
        tx = start_x + idx * (card_w + spacing)
        draw.rounded_rectangle([tx, card_y, tx + card_w, card_y + card_h], radius=14, fill=BG_CARD, outline=color, width=2)
        draw.text((tx + 25, card_y + 25), name, fill=TEXT_WHITE, font=get_font(22, bold=True))
        draw.text((tx + 25, card_y + 65), role, fill=color, font=get_font(16, bold=True))
        draw.text((tx + 25, card_y + 105), details, fill=TEXT_MUTED, font=get_font(14))

    # Repo Link
    draw.rounded_rectangle([cx - 380, HEIGHT - 130, cx + 380, HEIGHT - 80], radius=12, fill=(20, 35, 55), outline=BORDER_COLOR)
    draw.text((cx - 340, HEIGHT - 117), "GitHub: Vishnu912py/odoo-hackathon-subscription-management-system", fill=EMERALD_LIGHT, font=get_font(16, bold=True))

    im.save(out_path, quality=95)


def main():
    print("=" * 80)
    print(" BRIGHTLOOP VIDEO PRODUCTION: GRAPHICS & ASSETS GENERATOR")
    print("=" * 80)

    GRAPHICS_DIR.mkdir(parents=True, exist_ok=True)
    PLACEHOLDERS_DIR.mkdir(parents=True, exist_ok=True)

    print("Generating Scene 01: Opening Title...")
    render_scene_01(GRAPHICS_DIR / "scene_01_intro.png")

    print("Generating Scene 02: Problem Statement...")
    render_scene_02(GRAPHICS_DIR / "scene_02_problem.png")

    print("Generating Scene 03: Solution Overview...")
    render_scene_03(GRAPHICS_DIR / "scene_03_solution.png")

    print("Generating Scene 04: System Architecture...")
    render_scene_04(GRAPHICS_DIR / "scene_04_architecture.png")

    print("Generating Slot 01: Main Dashboard / Auth...")
    render_slot_01(PLACEHOLDERS_DIR / "slot1_main_dashboard.png")

    print("Generating Slot 02: Subscription Lifecycle...")
    render_slot_02(PLACEHOLDERS_DIR / "slot2_subscription_mgmt.png")

    print("Generating Slot 03: Invoices & Payments...")
    render_slot_03(PLACEHOLDERS_DIR / "slot3_invoice_payment.png")

    print("Generating Slot 04: Customer Portal...")
    render_slot_04(PLACEHOLDERS_DIR / "slot4_customer_portal.png")

    print("Generating Slot 05: Reporting & Analytics...")
    render_slot_05(PLACEHOLDERS_DIR / "slot5_reporting_dashboard.png")

    print("Generating Scene 10: Closing Credits...")
    render_scene_10(GRAPHICS_DIR / "scene_10_closing.png")

    print("\nAll 10 video scene assets successfully generated at 1920x1080!")
    print("=" * 80)


if __name__ == "__main__":
    main()

