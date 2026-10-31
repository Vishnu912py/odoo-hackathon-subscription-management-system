# Architecture and shared contracts

Status: proposed guidance, not an existing system. No application code or API exists yet.

The agreed architecture baseline is **React + Vite + TypeScript** on the frontend, **Node.js + Express** on the backend, **PostgreSQL** for relational persistence, and **Prisma** (with Prisma Migrate) as the proposed ORM.

The [ER diagram and schema handoff](er-diagram.md) develops the proposed entities below into a refined PostgreSQL schema and data integrity specification.

The newer [API contracts](api-contracts.md) define the HTTP/JSON interface baseline for Express REST operations. Sections 2 and 6 propose concrete defaults for the role matrix, currency/timezone, pricing, tax/discount order, scheduling and cancellation. Section 8 identifies schema additions (versioning, sessions, idempotency records, billing runs, and outbox). Treat the following register as the decision inventory; use the API guide's explicit defaults unless changed in a coordinated contract PR. Runtime versions and hosting remain unselected.

## Decisions register

The following 8 business and architectural decisions remain explicitly unresolved until team lead Vishnu912py confirms them:

| Decision | Status | Owner | Scope / Impact |
| --- | --- | --- | --- |
| 1. Plan-price allocation and line-total calculation | Unresolved | Vishnu | Confirm whether `plans.price` is an advertised bundle price that must equal the sum of default included product lines (as proposed in `api-contracts.md`), or whether line totals are calculated independently. |
| 2. Tax and discount calculation order | Unresolved | Vishnu | Confirm whether discounts apply before tax (reducing the taxable base) or after tax, with concrete worked examples. |
| 3. Discount stacking | Unresolved | Vishnu | Confirm whether multiple eligible discounts can stack on an invoice, or whether only the single highest-value discount applies (as proposed in `api-contracts.md`). |
| 4. Cancellation and rebilling | Unresolved | Vishnu + Zenfox | Confirm whether a cancelled invoice permanently reserves its billing period, permits rebilling via a partial unique index, or requires an explicit replacement/revision record. |
| 5. Pause/resume and billing-date arithmetic | Unresolved | Vishnu + Zenfox | Confirm whether resuming a paused subscription shifts the recurrence anchor or preserves the original anchor while skipping unbilled periods. |
| 6. Partial and overpayment handling | Unresolved | Vishnu + Zenfox | Confirm whether overpayment is strictly rejected at the database/API boundary or credited toward future invoices. |
| 7. Currency, timezone and rounding | Unresolved | Vishnu + Zenfox | Confirm baseline currency (INR), business timezone (Asia/Kolkata), and exact rounding rule (half-up to 2 decimals) before applying migrations. |
| 8. Prisma confirmation and database package location | Unresolved | Vishnu + Zenfox | Explicitly confirm Prisma as the production ORM/migration tool, and confirm the project repository layout (e.g. root `prisma/` vs monorepo `packages/database/`). |

## Proposed entities

Zenfox owns schema definitions and persistence integrity; Vishnu reviews backend behavior and lifecycle contracts.

| Entity | Required/proposed content |
| --- | --- |
| User/customer | Case-insensitive unique email (`LOWER(email)`), secure password hash, role, customer profile link; single-use reset token lifecycle |
| Product/variant | Name, type, sales/cost price, notes, price adjustment with variant composite uniqueness `(id, product_id)`, add-on association |
| Plan | Price, interval, minimum quantity, availability bounds and lifecycle policy flags |
| Quotation template/line | Plan, validity days, products, variant composite FK `(variant_id, product_id)`, quantity and price defaults |
| Subscription/line | Unique number, customer, plan, dates, payment terms, status; product/variant composite FK, quantity, price, taxes, and effective bounds |
| Invoice/line | Customer/subscription, billing period `(period_start, period_end)`, due date, status, totals and historical line/tax/discount snapshots |
| Tax/discount | Tax rules with 0–100% rate; discount type/value, scope, thresholds, validity and usage limit |
| Discount usage | `discount_redemptions` consumed atomically per invoice and protected against retry duplication |
| Payment | Invoice, method, positive amount, date, note, and unique `idempotency_key` |

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