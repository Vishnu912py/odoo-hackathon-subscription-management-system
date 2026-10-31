# Database & Persistence Layer Handoff (D3)

- **Author:** Zenfox-690 (Database Specialist)
- **Target:** Vishnu912py (Backend Lead & Architect)
- **Date:** October 31, 2026
- **Branch:** `feat/db-persistence`
- **PR:** [#9](https://github.com/Vishnu912py/odoo-hackathon-subscription-management-system/pull/9)

---

## 1. Overview & Architectural Boundaries

This document defines the persistence operations, transaction boundaries, concurrency controls, recurrence date arithmetic, and invocation signatures provided for Phase D3 (**Transactional Billing Persistence and Reliability**).

### Separation of Concerns:
- **Zenfox-690 (Database Layer):** Data access queries, transactional boundaries, PostgreSQL row-level and advisory locking, exact decimal calculations, calendar recurrence arithmetic, idempotent writes, historical snapshots, and database integration tests.
- **Vishnu912py (Backend / Express Layer):** HTTP route handlers, authentication, role and customer ownership authorization, request body/header parsing (`If-Match`, `Idempotency-Key`), error mapping, and background workflow triggers.

All persistence modules are located in `backend/src/modules/billing/` and exported via `backend/src/modules/billing/index.js`.

---

## 2. Implemented Persistence Operations

### A. Transactional Invoice Creation (`createSubscriptionInvoice`)
**Module:** [`backend/src/modules/billing/invoice-persistence.ts`](../backend/src/modules/billing/invoice-persistence.ts)

Generates recurring invoices with lines, taxes, and discounts atomically.

```typescript
export async function createSubscriptionInvoice(
  prismaOrTx: PrismaClient | Prisma.TransactionClient,
  params: CreateInvoiceParams
): Promise<CreateInvoiceResult>
```

#### Concurrency & Transaction Guarantees:
1. **Advisory Lock:** Acquires `pg_advisory_xact_lock(hashtextextended('sub_inv:' || subId || ':' || periodStartStr, 0))` within the transaction connection.
2. **Idempotent Identity:** Enforces `UNIQUE (subscription_id, period_start)`. Concurrent duplicate billing attempts return the existing invoice with `isReused: true`.
3. **Atomic Snapshots:** Captures immutable point-in-time snapshots of `customer_name_snapshot`, `billing_email_snapshot`, `billing_address_snapshot`, `rate_percent_snapshot`, `taxable_base`, and discount values.
4. **Exact Decimal Arithmetic:** Per-line subtotals, pre-tax discount deductions, exclusive additive taxes, and final totals calculated using exact decimal arithmetic with half-up 2-decimal rounding (`ROUND_HALF_UP`).

---

### B. Historical Discount Eligibility & Usage Locking (`evaluateAndLockEligibleDiscount`)
**Module:** [`backend/src/modules/billing/discount-persistence.ts`](../backend/src/modules/billing/discount-persistence.ts)

Evaluates candidate discounts, enforces historical activity timelines, and locks finite usage limits under concurrency.

```typescript
export async function evaluateAndLockEligibleDiscount(
  tx: Prisma.TransactionClient,
  input: EvaluateDiscountInput
): Promise<EligibleDiscountAllocation | null>
```

#### Corrected Historical Activity Evaluation:
1. **Historical Activity Coverage:** Does **not** filter by current `isActive: true` on the rule row. A rule that is deactivated today remains eligible for historical billing if its `DiscountRuleActivity` interval proves it was active throughout `[periodStart, periodEnd)`.
2. **Exclusion Rules:**
   - A rule that became active *after* `periodStart` is excluded (`effectiveFrom > periodStart`).
   - A rule that was deactivated *before* `periodEnd` is excluded (`effectiveUntil < periodEnd`).
   - Rules with activity intervals that cover only part of the billing period are excluded.
   - If no activity log exists, falls back to `rule.isActive === true`.
3. **Finite Usage Locking:** If `usageLimit !== null`, acquires row lock `SELECT "id" FROM "discount_rules" WHERE "id" = $1 FOR UPDATE` within the transaction and verifies `redemptionCount < rule.usageLimit`.
4. **Single Discount Rule (No Stacking in v1):** Selects the single rule providing the greatest monetary saving; tie-breaks deterministically using `rule.id.toLowerCase()`.
5. **Pre-Tax Deduction:** Deducts discount from line subtotal before applying exclusive additive taxes.

---

### C. Calendar Recurrence Date Arithmetic (`computeNextPeriod`)
**Module:** [`backend/src/modules/billing/recurrence.ts`](../backend/src/modules/billing/recurrence.ts)

Computes continuous, gapless billing periods respecting calendar month-ends, leap years, and anchor days.

```typescript
export function computeNextPeriod(params: ComputePeriodParams): ComputedPeriod
```

#### Behavior & Guarantees:
1. **Anchor Day Preservation:** A subscription starting on the 31st (e.g. `2026-01-31`) generates:
   - Period 1: `[2026-01-31, 2026-02-28)` (Feb clamped to 28 days in common year)
   - Period 2: `[2026-02-28, 2026-03-31)` (March restored to 31 days!)
   - Period 3: `[2026-03-31, 2026-04-30)` (April clamped to 30 days)
   - Period 4: `[2026-04-30, 2026-05-31)` (May restored to 31 days)
2. **Leap Year Handling:** In leap years (e.g. 2028), Jan 31 clamps to Feb 29 (`2028-02-29`). For leap-day annual renewals (`2024-02-29`), non-leap years clamp to Feb 28 (`2025-02-28`), while leap years restore to Feb 29 (`2028-02-29`).
3. **Exclusive Period-End Convention:** Period end is strictly exclusive; `periodEnd` of period $k$ serves as the exact `periodStart` for period $k+1$.

---

### D. Durable Billing Runs (`initializeBillingRun` & `executeBillingRun`)
**Module:** [`backend/src/modules/billing/billing-run-persistence.ts`](../backend/src/modules/billing/billing-run-persistence.ts)

Durable, recoverable execution of recurring billing across due subscriptions.

```typescript
export async function initializeBillingRun(
  prisma: PrismaClient,
  params: InitializeBillingRunParams
): Promise<BillingRun>

export async function executeBillingRun(
  prisma: PrismaClient,
  runId: string,
  options?: ExecuteBillingRunOptions
): Promise<BillingRunResult>
```

#### Concurrency & Recovery Guarantees:
1. **Session-Level Advisory Lock on Dedicated Connection:** Acquired on a dedicated PostgreSQL connection (`pg.Client`) via `SELECT pg_try_advisory_lock(hashtextextended('billing_run:' || runId, 0))`. Held continuously for the entire duration of the batch, preventing any second worker from executing concurrently.
2. **Protection Against Concurrent Resume:** Even when `allowResume: true` is passed, a competing worker cannot bypass an active worker's session lock; it is immediately rejected with `409 RUN_IN_PROGRESS`.
3. **Automatic Crash Recovery via Socket Closure:** When a worker process crashes, is killed, or drops its connection, PostgreSQL automatically releases all session-level advisory locks tied to that connection. A subsequent worker can immediately acquire the lock and resume the run.
4. **Abandoned vs Active Discrimination:**
   - Active worker: Session lock acquisition fails (`acquired = false`) -> rejects with `409 RUN_IN_PROGRESS`.
   - Abandoned run (worker died): Session lock acquisition succeeds (`acquired = true`) and `status === 'IN_PROGRESS'` -> requires `allowResume: true` to resume cleanly.
5. **Transactional Subscription Processing:** Each due subscription is processed within its own interactive database transaction:
   - Acquires `pg_try_advisory_xact_lock(hashtextextended('sub_run:' || sub.id || ':' || periodStartStr, 0))`.
   - Creates invoice via `createSubscriptionInvoice(tx, ...)`.
   - Advances `subscription.nextBillingDate = periodEnd`.
   - Incrementally and durably updates `BillingRun` counters (`subscriptionsProcessed`, `invoicesGenerated`, `invoicesReused`, `totalAmountBilled`) within that exact same transaction.
6. **Crash Recovery Without Double-Counting:**
   - If a crash occurs at subscription $N$, subscriptions $1 \dots N-1$ have their invoices, schedule advancements, and billing-run progress committed together.
   - Subscription $N$ rolls back cleanly.
   - Resuming the run via `executeBillingRun(prisma, runId, { allowResume: true })` queries due subscriptions whose `nextBillingDate <= asOfDate`. Subscriptions $1 \dots N-1$ are already advanced and skipped; subscription $N$ resumes cleanly.
7. **Remaining Due & Pagination:** `hasMore` is evaluated directly by counting remaining subscriptions in PostgreSQL matching `nextBillingDate <= asOfDate` after the batch, eliminating counter-subtraction errors.

---

## 3. Payment Persistence Reconciliation

### Comparison of Implementations:
1. **V1 Route Handler (`backend/src/modules/billing/payments.ts`):**
   - Owned by Vishnu as part of the authenticated Express V1 prototype.
   - Handles HTTP-specific validation (`If-Match` parsing, UUID checks, `Retry-After: 1`, `428 Precondition Required`).
   - Formats and stores the full HTTP response envelope `{ data: { payment: paymentView(payment), invoice: invoiceSummary(...) } }` in `IdempotencyRecord.responseBody`.
   - Replays return the full HTTP payload directly to the client.
2. **Persistence Helper (`backend/src/modules/billing/payment-persistence.ts`):**
   - Owned by Zenfox as a programmatic persistence service.
   - Accepts generic parameters, enforces row locks (`updateMany({ version: increment: 0 })`), checks optimistic versions, checks overpayments, and returns `{ payment, invoice, isReplay }`.

### Canonical Integration Recommendation for Vishnu:
To maintain single-source-of-truth persistence without altering the approved HTTP V1 contract:
1. Keep `backend/src/modules/billing/payments.ts` as the Express HTTP controller.
2. When ready to eliminate internal duplication, `recordPayment()` in `payments.ts` can delegate its database mutations to `applyInvoicePayment()` by providing a custom response builder:
   ```typescript
   const { payment, invoice, isReplay } = await applyInvoicePayment(tx, {
     invoiceId,
     recordedById: user.id,
     idempotencyKey: key,
     expectedVersion: parseInt(version.replace(/"/g, ''), 10),
     amount: req.body.amount,
     method: req.body.method,
     paymentDate: req.body.payment_date,
     note: req.body.note,
     scope,
     requestPayload: { body: req.body, version },
   });
   ```
3. In Milestone V1, `payments.ts` is already fully tested and compliant with the OpenAPI contract. No breaking changes have been introduced.

---

## 4. PR Scope & Merge Coordination

### Open Pull Requests:
- **PR #7 (`feat/prototype-v1` -> `main`):** Contains Vishnu's authenticated prototype V1 (commit `ebbf0fe`).
- **PR #9 (`feat/db-persistence` -> `main`):** Contains the D3 transactional database persistence implementation, built on top of `feat/prototype-v1`.

### Recommended Merge Sequence:
1. **Step 1:** Vishnu reviews and merges **PR #7** (`feat/prototype-v1` into `main`).
2. **Step 2:** Once PR #7 is merged, GitHub will automatically update PR #9's base diff against `main`, leaving only the database persistence additions (`backend/src/modules/billing/`, recurrence, tests, and documentation).
3. **Step 3:** Vishnu reviews and merges **PR #9** (`feat/db-persistence` into `main`).

---

## 5. Summary of Verification Checks

- **Prisma Schema Validation:** `prisma validate` passed.
- **Client Generation:** `prisma generate` (7.10.1) passed.
- **TypeScript Compilation:** `npm run typecheck` passed with 0 errors.
- **Backend Check Suite:** `npm run check` passed 15/15 unit and integration tests.
- **Static Schema & DDL Integrity:** `python scripts/verify_schema_integrity.py` passed (32 models, 13 checks, 6 indexes).
- **PostgreSQL 16 Integration Suite:** All 34 tests in `test_db_constraints.ts` pass against live PostgreSQL 16 Alpine in CI.
