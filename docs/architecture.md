# Architecture and shared contracts

Status: the Express/TypeScript backend foundation, domain schema, two migrations and synthetic seed fixtures are implemented in `backend/`. Health checks and shared infrastructure are implemented; business contract operations return explicit 501 responses. Transactional persistence operations and reporting queries remain pending.

The agreed architecture baseline is **React + Vite + TypeScript** on the frontend, **Node.js 24 + Express 5 + TypeScript** on the backend, **PostgreSQL 16** for relational persistence, and **Prisma ORM 7.10.1 with Prisma Migrate**, as confirmed by Vishnu. Backend package location is `backend/`; schema and migrations live in `backend/prisma`. Pinned packages are specified in `backend/package.json` and `backend/package-lock.json`.

The [ER diagram and schema handoff](er-diagram.md) develops the proposed entities below into a refined PostgreSQL schema and data integrity specification.

The newer [API contracts](api-contracts.md) define the HTTP/JSON interface baseline for Express REST operations. Sections 2 and 6 propose concrete defaults for the role matrix, currency/timezone, pricing, tax/discount order, scheduling and cancellation. Section 8 identifies schema additions (versioning, sessions, idempotency records, billing runs, and outbox).

## Decisions register

The core billing policies and engineering choices have been formally confirmed by Team Lead Vishnu912py in the [PR #4 review](https://github.com/Vishnu912py/odoo-hackathon-subscription-management-system/pull/4#pullrequestreview-5721556703):

| Decision | Status | Confirmed Policy / Implementation |
| --- | --- | --- |
| 1. Plan-price allocation and line totals | **Confirmed** | `plans.price` is the advertised base bundle price. The sum of default included product lines equals `plans.price`. Add-ons are priced separately. |
| 2. Tax and discount calculation order | **Confirmed** | Discounts apply before tax (reducing the taxable base); taxes are exclusive and additive. Rounding is half-up to 2 decimals per line. |
| 3. Discount stacking | **Confirmed** | No discount stacking in v1. Select the single eligible rule producing the greatest savings (ties resolved deterministically by rule UUID). |
| 4. Cancellation and rebilling | **Confirmed** | Terminal cancellation permanently reserves the `(subscription_id, period_start)` identity. No same-period rebilling in v1. Requires 0 payments. |
| 5. Pause/resume recurrence arithmetic | **Confirmed** | Preserve the original calendar recurrence anchor. Skip unbilled periods within effective pause intervals; resume on next original boundary without extending expiry. |
| 6. Partial and overpayment handling | **Confirmed** | Multiple partial payments permitted; overpayments strictly rejected (`amount <= total - amount_paid`). Atomic balance updates. |
| 7. Currency, timezone and rounding | **Confirmed** | Currency `INR`, business timezone `Asia/Kolkata`, exact decimal types (`NUMERIC(18,2)` totals, `NUMERIC(18,4)` unit prices/quantities, `NUMERIC(7,4)` rates). |
| 8. Tooling and schema location | **Confirmed** | Prisma ORM 7.10.1 + Prisma Migrate; database schema and migrations located in `backend/prisma`, generated client in `backend/src/generated/prisma`. |

## Proposed entities

Zenfox owns schema definitions and persistence integrity; Vishnu reviews backend behavior and lifecycle contracts.

| Entity | Required/proposed content |
| --- | --- |
| User/customer | Case-insensitive unique email (`LOWER(email)`), secure password hash, role, customer profile link; single-use reset token lifecycle |
| Product/variant | Name, type, sales/cost price, notes, price adjustment with variant composite uniqueness `(id, product_id)`, add-on association |
| Plan | Price, interval, minimum quantity, availability bounds and lifecycle policy flags |
| Quotation template/line | Plan, validity days, products, variant composite FK `(variant_id, product_id)`, quantity and price defaults |
| Subscription/line | Unique number, customer, plan, dates, payment terms, status; product/variant composite FK, quantity, price, taxes, and effective bounds |
| Subscription pause intervals | Tracks historical effective pause intervals (`start_date`, `end_date`) for catch-up billing |
| Invoice/line | Customer/subscription, billing period `(period_start, period_end)`, due date, status, totals and historical line/tax/discount snapshots |
| Tax/discount | Tax rules with 0–100% rate; discount type/value, scope, thresholds, validity and usage limit (percentages $\le 100$) |
| Discount rule activities | Historical activation and archival audit trail |
| Discount usage | `discount_redemptions` consumed atomically per invoice and protected against retry duplication |
| Payment | Invoice, method, positive amount, date, note, and unique `idempotency_key` |
| Billing run | Batch recurring run execution state, parameters, and progress counters |
| Invoice email outbox | Durable outbox for asynchronous email notification dispatch |

## Integration contract checklist

Express REST/JSON operations are formalized in `docs/api-contracts.md` and `docs/api/openapi.json`.

Each operation defines permissions/ownership, inputs/outputs, UUID format, states, error codes, date/time and exact money encoding (`NUMERIC(18,2)` strings for totals, `NUMERIC(18,4)` for unit prices/quantities), filters, sorting and pagination. Browser clients communicate through the backend API and must not connect directly to the database.

## Consistency boundaries

- Enforce case-insensitive email uniqueness via `LOWER(email)`, subscription number uniqueness, invoice period uniqueness, and variant ownership in PostgreSQL constraints as well as application validation.
- Proposed invoice transaction: claim a due period, compute/snapshot lines and totals, write invoice, record discount usage, advance schedule only after success. Concurrent workers and retries resolve to the same persisted result.
- Failed periods stay discoverable for retry. Process missed historical periods sequentially using calendar arithmetic with an agreed month-end anchor.
- Payment writes and balance/status changes remain consistent; lock target invoice rows (`SELECT ... FOR UPDATE`), enforce `idempotency_key` uniqueness, and reject duplicate or overpayment submissions.
- Historical invoices retain original amounts when catalog, tax, or discount rules change.
- Customer ownership applies to every read/write including lists and print/download routes; server authorization is mandatory.
- Use exact decimal arithmetic with documented rounding; floating-point types are strictly forbidden.

## Performance verification proposal

Seed at least 5,000 subscriptions and representative invoices/payments (chosen benchmark size, not a number specified by the PDF). Record environment, dataset, filters and browser page response times. Query timings alone do not prove the under-two-second page requirement. Use measured bottlenecks to guide pagination, query plans and targeted indexes on ownership, status, due dates and relationships.
