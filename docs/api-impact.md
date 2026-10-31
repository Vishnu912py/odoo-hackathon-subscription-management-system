# API Impact & Schema Alignment Guide

Owner: **Zenfox-690** (Database Specialist)  
Reviewers: **Vishnu912py** (Backend Architect), **albinsavi123-lang** (Frontend Specialist)  
Baseline: Proposed API Contracts v0.1 (`docs/api-contracts.md`, `docs/api/openapi.json`) and Prisma Schema (`prisma/schema.prisma`)

> [!NOTE]
> The backend application server and frontend client are currently in the scaffolding/specification stage. No live endpoints exist in production. The impacts detailed below evaluate alignment between the refined database schema (`prisma/schema.prisma`), custom PostgreSQL migrations, and the proposed HTTP interface defined in `docs/api-contracts.md`.

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
| **`plans.price`** | External | `GET /plans`, `POST /plans` (`price`) | Advertised bundle fee | Fixed 2 decimals: `"1500.00"` | Compatible with v0.1 | **Backend:** Verify sum of included default plan products equals `plans.price` if bundle pricing rule is confirmed. |
| **`subscriptions.number`** | External | Subscription schemas (`number`) | Unique human identifier | Format: `"SUB-0001"` | Backward-compatible | **Backend:** Auto-generate sequence. |
| **`subscriptions.status`** | External | Subscription schemas (`status`) | `DRAFT`, `QUOTATION`, `CONFIRMED`, `ACTIVE`, `CLOSED` | String enum | Backward-compatible | **Backend:** State machine transitions enforced via service layer; logged to `subscription_events`. **Frontend:** Display badge and permitted action buttons. |
| **`subscriptions.auto_close_snapshot`**, etc. | Internal / External | Read-only in `GET /subscriptions/{id}` | Policy flags snapshotted from Plan | Boolean | Contract refinement | **Backend:** Snapshot plan policy flags at confirmation. Existing active subscriptions are shielded from later catalog changes. |
| **`invoices.period_start`**, **`period_end`** | External | Invoice schemas (`period_start`, `period_end`) | Canonical billing period | Date string: `"2026-10-01"` (exclusive end date) | Compatible with v0.1 | **Backend:** Canonical period arithmetic with month-end anchor. Uniqueness enforced by `(subscription_id, period_start)`. **Frontend:** Display inclusive human date on UI if requested. |
| **`invoices.status`** | External | Invoice schemas (`status`) | `DRAFT`, `CONFIRMED`, `PAID`, `CANCELLED` | String enum | Backward-compatible | **Backend:** Overdue is derived from `status == CONFIRMED AND due_date < TODAY AND balance > 0`, not a stored status. |
| **`invoices.subtotal`**, **`total`**, **`amount_paid`** | External | Invoice schemas (`subtotal`, `tax_total`, `discount_total`, `total`, `amount_paid`) | Header financial totals | Fixed 2 decimals: `"1180.00"` | Compatible with v0.1 | **Backend:** Sum of rounded lines; exact decimal math. Prohibit floating-point calculations. |
| **`payments.idempotency_key`** | External | Header: `Idempotency-Key` | Enforces unique payment execution | UUID string | Compatible with v0.1 | **Backend:** Reject duplicates with `409 IDEMPOTENCY_CONFLICT`; return original payment record on identical retry. |
| **`payments.amount`** | External | `POST /invoices/{id}/payments` (`amount`) | Settlement amount | Fixed 2 decimals: `"680.00"` | Compatible with v0.1 | **Backend:** Reject overpayments exceeding unpaid balance (`amount <= total - amount_paid`). Update invoice `amount_paid` and status to `PAID` atomically. |
| **`discount_redemptions`** | Internal / External | Applied discount on invoice | Unique `(discount_rule_id, invoice_id)` | UUID / Snapshotted values | Compatible with v0.1 | **Backend:** Row-level locking on `discount_rules` to verify usage cap (`usage_limit`) before creating redemption. |

---

## 2. Unresolved Business Decisions Analysis

The following decisions require explicit confirmation from Team Lead Vishnu912py. For each, we outline the model impact, recommended approach, and alternative trade-offs:

### Decision 1: Plan-Price Allocation vs. Line-Item Totals
- **Impact on Data Model:** Affects how `plan_products`, `quotation_template_lines`, and `subscription_lines` store `unit_price` relative to `plans.price`.
- **Recommended Approach:** Adopt the rule proposed in `docs/api-contracts.md`: `plans.price` is the advertised base bundle price. At plan creation, the sum of default included product lines ($\sum \text{quantity} \times \text{unit\_price}$) must equal `plans.price`. Add-ons are priced independently. Subscription lines store explicit unit prices.
- **Alternatives & Trade-offs:**
  - *Alternative A (Additive Pricing):* Charge `plans.price` as a separate header fee plus all individual lines. *Trade-off:* Causes customer double-charging unless line prices are zeroed out.
  - *Alternative B (Dynamic Proportional Allocation):* Auto-distribute `plans.price` proportionally across lines at quotation time. *Trade-off:* Introduces complex fractional rounding remainders across line items.
- **Status:** **Awaiting Vishnu's Approval.**

---

### Decision 2: Tax and Discount Calculation Order & Stacking
- **Impact on Data Model:** Governs the calculation of `invoice_lines.taxable_base`, `invoice_lines.tax_amount`, and `invoice_line_discounts.amount`.
- **Recommended Approach:**
  - Apply discounts **before** tax, so that tax is calculated on the discounted line base (`taxable_base = subtotal - discount_amount`).
  - Prohibit discount stacking in v1: select the single eligible rule producing the largest savings.
  - Round line subtotals, discount allocations, and line taxes to 2 decimals; invoice totals equal the sum of lines.
- **Alternatives & Trade-offs:**
  - *Alternative A (Discounts After Tax):* Calculate tax on gross subtotal, then deduct discount. *Trade-off:* Conflicts with standard GST / VAT accounting practices where sales tax applies to actual realized revenue.
  - *Alternative B (Compound / Additive Stacking):* Allow stacking multiple discount rules. *Trade-off:* High risk of negative line amounts and complex priority ordering.
- **Status:** **Awaiting Vishnu's Approval.**

---

### Decision 3: Invoice Cancellation & Rebilling Policy
- **Impact on Data Model:** Directly impacts the database uniqueness constraint `invoices(subscription_id, period_start)`.
- **Recommended Approach:** Keep `UNIQUE (subscription_id, period_start)` as an immutable period reservation. Cancellation is terminal; cancelled invoices reserve that period to ensure historical audit permanence. If rebilling of a period is required, handle it through explicit replacement/revision records.
- **Alternatives & Trade-offs:**
  - *Alternative A (Partial Unique Index):* `CREATE UNIQUE INDEX ... ON invoices(subscription_id, period_start) WHERE status != 'CANCELLED';`. *Trade-off:* Allows re-issuing an invoice for the cancelled period, but results in multiple invoice records for the same billing period, complicating revenue and collection reporting.
  - *Alternative B (Hard Deletion):* Delete cancelled invoices. *Trade-off:* Strictly forbidden; destroys financial audit history.
- **Status:** **Awaiting Vishnu's Approval.**

---

### Decision 4: Pause/Resume and Billing-Date Arithmetic
- **Impact on Data Model:** Affects `subscriptions.next_billing_date`, `is_paused`, and `recurrence_anchor_day`.
- **Recommended Approach:** Pausing takes effect at the next not-yet-started recurrence boundary. During an active pause, the scheduler generates no invoices. Upon resume, billing resumes on the next scheduled calendar boundary without altering the original day-of-month recurrence anchor.
- **Alternatives & Trade-offs:**
  - *Alternative A (Shifted Anchor):* Shift `next_billing_date` forward by the number of paused days. *Trade-off:* Drifts billing dates across months (e.g. from 1st of month to 17th of month), disrupting customer billing expectations.
  - *Alternative B (Mid-Cycle Proration):* Pause immediately mid-cycle and issue credit/proration notes. *Trade-off:* Requires complex proration accounting engine deferred from MVP.
- **Status:** **Awaiting Vishnu's Approval.**

---

### Decision 5: Partial Payments and Overpayment Handling
- **Impact on Data Model:** Governs `payments` insertion and `invoices.amount_paid` updates.
- **Recommended Approach:** Support multiple partial payments per invoice. Strictly reject overpayments at the API and database level (`SUM(payments.amount) <= invoice.total`).
- **Alternatives & Trade-offs:**
  - *Alternative A (Account Credit):* Allow overpayments and store excess in a customer credit ledger. *Trade-off:* Requires credit ledger tables, balance rollover, and debit application logic not present in MVP scope.
- **Status:** **Awaiting Vishnu's Approval.**

---

### Decision 6: Currency, Timezone & Monetary Precision
- **Impact on Data Model:** Confirmed in schema: Single currency `INR`, timezone `Asia/Kolkata`, settlement precision `NUMERIC(18,2)`, unit prices/quantities `NUMERIC(18,4)`, tax rates `NUMERIC(7,4)`.
- **Recommended Approach:** Use half-up rounding to 2 decimal places for all financial totals. Prohibit JavaScript floating-point math; use `Decimal.js` or database-level rounding.
- **Status:** **Awaiting Vishnu's Approval.**

---

## 3. Team Coordination Checklist

### For Vishnu912py (Backend Architect):
- [ ] Confirm baseline Prisma schema and migration structure (`prisma/schema.prisma`).
- [ ] Integrate transaction boundaries for billing runs using row-level locking (`SELECT ... FOR UPDATE` on `Subscription` and `DiscountRule`).
- [ ] Implement `If-Match` optimistic locking checks using model `version` integers.
- [ ] Implement case-insensitive email normalization on auth endpoints.

### For albinsavi123-lang (Frontend Specialist):
- [ ] Format all monetary inputs/outputs with 2 decimal places for totals and 4 decimal places for unit prices.
- [ ] Transmit `If-Match: "<version>"` header on all PATCH and action endpoints.
- [ ] Provide client-side validation for positive quantities and non-negative unit prices matching DB CHECK constraints.
- [ ] Note that date boundaries sent to the API for billing and expiry are exclusive.
