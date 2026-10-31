# API Impact & Schema Alignment Guide

Owner: **Zenfox-690** (Database Specialist)  
Reviewers: **Vishnu912py** (Backend Architect), **albinsavi123-lang** (Frontend Specialist)  
Baseline: Proposed API Contracts v0.1 (`docs/api-contracts.md`, `docs/api/openapi.json`) and Prisma Schema (`database/prisma/schema.prisma`)

> [!NOTE]
> The backend application server and frontend client are currently in the scaffolding/specification stage. No live endpoints exist in production. The impacts detailed below evaluate alignment between the refined database schema (`database/prisma/schema.prisma`), custom PostgreSQL migrations, and the proposed HTTP interface defined in `docs/api-contracts.md`.

---

## 1. Database-to-API Impact Matrix

| Entity & DB Field | Visibility | Proposed API Contract Field | Relationships & Status Values | Serialization Format | Contract Compatibility | Coordination Needed (Backend / Frontend) |
|---|---|---|---|---|---|---|
| **`users.email`** | External | `POST /auth/register`, `POST /auth/login` (`email`) | Normalized lowercase lookup | String (trimmed, lowercase) | Backward-compatible | **Backend:** Normalize email with `.trim().toLowerCase()` before query/insert; functional unique index `users_email_lower_idx` prevents duplicates. **Frontend:** Client-side lowercase formatting on submit. |
| **`users.role`** | External | `GET /auth/me` (`role`) | Enum: `ADMIN`, `STAFF`, `CUSTOMER` | String enum | Backward-compatible | **Backend:** Enforce role matrix server-side. **Frontend:** Role-based route gating. |
| **`users.version`**, **`customers.version`** | External | Headers: `If-Match`, `ETag` | Aggregate versioning | Integer string (e.g. `"1"`) | Compatible with v0.1 | **Backend:** Check `If-Match` against aggregate `version`; return `412 Precondition Failed` on mismatch. **Frontend:** Send current version in `If-Match` on mutations. |
| **`sessions` table** | Internal | Cookie: `brightloop_session` | Mapped to `User` | Opaque cookie string | Compatible with v0.1 | **Backend:** Session token hashed with SHA-256 before storage; CSRF token rotation. **Frontend:** Send `credentials: "include"`, `X-CSRF-Token` header. |
| **`product_variants.(id, product_id)`** | External | `POST /products/{id}/variants`, `lines[].variant_id` | Composite unique on variant; Composite FK on lines | UUID string | Compatible with v0.1 | **Backend:** Validate `variant_id` belongs to `product_id` (enforced at DB level by composite FK `(variant_id, product_id)`). **Frontend:** Variant select dropdown filtered by selected product. |
| **`products.sales_price`**, **`cost_price`** | External | Product schemas (`sales_price`, `cost_price`) | Base product pricing | Fixed 4 decimals: `"1000.0000"` | Compatible with v0.1 | **Backend:** Omit `cost_price` in responses to Staff/Customer roles. **Frontend:** Render with currency symbol. |
| **`plans.price`** | External | `GET /plans`, `POST /plans` (`price`) | Advertised bundle fee | Fixed 2 decimals: `"1000.00"` | Confirmed | **Backend:** Verified rule: sum of included default plan products equals `plans.price`. Add-ons are priced independently. |
| **`subscriptions.number`** | External | Subscription schemas (`number`) | Unique human identifier | Format: `"SUB-0001"` | Backward-compatible | **Backend:** Auto-generate sequence. |
| **`subscriptions.status`** | External | Subscription schemas (`status`) | `DRAFT`, `QUOTATION`, `CONFIRMED`, `ACTIVE`, `CLOSED` | String enum | Backward-compatible | **Backend:** State machine transitions enforced via service layer; logged to `subscription_events`. **Frontend:** Display badge and permitted action buttons. |
| **`subscriptions.pause_effective_date`**, etc. | External | `GET /subscriptions/{id}` | Scheduled lifecycle dates | Date string (`YYYY-MM-DD`) | Compatible with v0.1 | **Backend:** Scheduled pause/resume/close boundaries take effect at the next not-yet-started recurrence boundary. |
| **`subscription_pause_intervals`** | Internal | Pause history | Tracks effective pause intervals | Table relation | Backward-compatible | **Backend:** Used during historical catch-up billing to accurately skip periods within effective pause intervals. |
| **`invoices.period_start`**, **`period_end`** | External | Invoice schemas (`period_start`, `period_end`) | Canonical billing period | Date string: `"2026-10-01"` (exclusive end date) | Compatible with v0.1 | **Backend:** Canonical period arithmetic with month-end anchor. Uniqueness enforced by `(subscription_id, period_start)`. **Frontend:** Display inclusive human date on UI if requested. |
| **`invoices.status`** | External | Invoice schemas (`status`) | `DRAFT`, `CONFIRMED`, `PAID`, `CANCELLED` | String enum | Backward-compatible | **Backend:** Overdue is derived from `status == CONFIRMED AND due_date < TODAY AND balance > 0`, not a stored status. |
| **`invoices.subtotal`**, **`total`**, **`amount_paid`** | External | Invoice schemas (`subtotal`, `tax_total`, `discount_total`, `total`, `amount_paid`) | Header financial totals | Fixed 2 decimals: `"1180.00"` | Confirmed | **Backend:** Sum of rounded lines; exact decimal math. Prohibit floating-point calculations. |
| **`payments.idempotency_key`** | External | Header: `Idempotency-Key` | Enforces unique payment execution | UUID string | Compatible with v0.1 | **Backend:** Reject duplicates with `409 IDEMPOTENCY_CONFLICT`; return original payment record on identical retry. |
| **`payments.amount`** | External | `POST /invoices/{id}/payments` (`amount`) | Settlement amount | Fixed 2 decimals: `"680.00"` | Confirmed | **Backend:** Reject overpayments exceeding unpaid balance (`amount <= total - amount_paid`). Update invoice `amount_paid` and status to `PAID` atomically. |
| **`discount_rules.value`** | External | Discount schemas (`value`) | Discount percentage or flat amount | Fixed 4 decimals (or percentage $\le 100$) | Confirmed | **DB CHECK:** Enforced `value > 0 AND (discount_type != 'PERCENTAGE' OR value <= 100)`. |
| **`discount_rule_activities`** | Internal | Activation timeline | Tracks rule activation/archival | Table relation | Backward-compatible | **Backend:** Used to evaluate discount eligibility as of historical billing period starts without retrospective leakage. |
| **`billing_runs` inputs & progress** | External | `POST /billing-runs`, `GET /billing-runs/{id}` | Batch execution job | Counters & progress flags | Confirmed | **Backend:** Persists `period_limit`, `subscription_id_filter`, `invoices_reused`, `invoices_failed`, `has_more`, and `next_run_required`. |

---

## 2. Confirmed MVP Business Defaults (Approved by Team Lead Vishnu912py)

The following core business and billing policies have been formally confirmed by Team Lead Vishnu912py:

### 1. Bundle Pricing Policy: **CONFIRMED**
- **Rule:** `plans.price` is the advertised base bundle price, not an extra line charge.
- **Implementation:** The rounded sum of default included product quantities $\times$ applicable unit prices equals `plans.price`. Add-ons are priced separately.
- **Seed Fixture:** Monthly plan price is ₹1,000.00 with 2 included user seats @ ₹500.00 ($2 \times 500 = 1000$). The Odoo connector is an add-on (+₹560.00).

### 2. Tax and Discount Calculation Order: **CONFIRMED**
- **Rule:** Discounts reduce the taxable base first; tax is exclusive and assigned tax percentages are additive, not compounded.
- **Implementation:** For each line: `taxable_base = subtotal - discount_amount`; `tax_amount = round(taxable_base * rate_percent / 100, 2)`. Line amounts and tax amounts round half-up to 2 decimals.

### 3. Discount Stacking Policy: **CONFIRMED**
- **Rule:** No discount stacking in v1.
- **Implementation:** If multiple discounts qualify, the billing engine selects the single eligible rule producing the greatest savings. Ties are resolved deterministically by rule UUID. Rule usage limits are protected by row-level locking.

### 4. Cancellation & Rebilling Policy: **CONFIRMED**
- **Rule:** Terminal cancellation permanently reserves the subscription/period identity `(subscription_id, period_start)`.
- **Implementation:** No same-period rebilling, schedule rewind, or restoration of discount usage in v1. Cancellation requires zero payments. Cancelled invoices retain audit history and have `balance_due = 0`.

### 5. Pause/Resume Recurrence Arithmetic: **CONFIRMED**
- **Rule:** Preserve the original recurrence anchor.
- **Implementation:** Pause and early close take effect at the next not-yet-started recurrence boundary. Already-started debt remains billable. The scheduler skips periods falling within effective pause intervals (`subscription_pause_intervals`). Resume activates at the next original anchor on or after business today without shifting calendar anchors or extending expiry.

### 6. Partial Payments and Overpayment Handling: **CONFIRMED**
- **Rule:** Multiple partial payments are permitted on confirmed invoices; overpayments are strictly rejected.
- **Implementation:** `SUM(payments.amount) <= invoice.total`. Insertion of payment, balance update, version increment, and status transition to `PAID` execute atomically with row locks.

### 7. Currency, Timezone & Monetary Precision: **CONFIRMED**
- **Rule:** Currency `INR`, business timezone `Asia/Kolkata`.
- **Implementation:** Exact PostgreSQL decimal types: `NUMERIC(18,2)` for settlement amounts and totals, `NUMERIC(18,4)` for unit prices, quantities, and price adjustments, and `NUMERIC(7,4)` for percentage rates. Floating-point calculations are prohibited.

---

## 3. Team Coordination Checklist

### For Vishnu912py (Backend Architect):
- [x] Schema and migrations centralized under `database/prisma/`.
- [x] Persisted complete billing-run inputs (`period_limit`, `subscription_id_filter`) and result counters (`invoices_reused`, `invoices_failed`, `has_more`, `next_run_required`).
- [x] Added `SubscriptionPauseInterval` and `DiscountRuleActivity` for historical catch-up billing.
- [x] Enforced conditional percentage discount upper bound (`value <= 100` for `PERCENTAGE`) in DB constraint.
- [x] Made `database/prisma/seed.ts` 100% idempotent using deterministic synthetic fixtures.

### For albinsavi123-lang (Frontend Specialist):
- [x] Send monetary values as fixed strings with 2 decimals (totals) or 4 decimals (unit prices).
- [x] Transmit `If-Match: "<version>"` header on all PATCH and action endpoints.
- [x] Note that date boundaries sent to the API for billing and expiry are exclusive.
- [x] Product variant selector is filtered by the selected parent product.
