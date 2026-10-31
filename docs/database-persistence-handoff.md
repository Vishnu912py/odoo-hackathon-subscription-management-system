# Database & Persistence Layer Handoff (D3)

**Author:** Zenfox-690 (Database Specialist)  
**Target:** Vishnu912py (Backend Lead & Architect)  
**Date:** October 31, 2026  
**Branch:** `feat/db-persistence`

---

## 1. Overview & Architectural Boundaries

This document defines the persistence operations, transaction boundaries, concurrency controls, and invocation signatures provided for Phase D3 (**Transactional Billing Persistence and Reliability**).

### Separation of Concerns:
- **Zenfox-690 (Database Layer):** Data access queries, transactional boundaries, PostgreSQL row-level and advisory locking, exact decimal calculations, idempotent writes, historical snapshots, and database integration tests.
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

#### Parameters (`CreateInvoiceParams`):
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `subscriptionId` | `string` (UUID) | Yes | Target subscription ID |
| `periodStart` | `Date \| string` | Yes | Billing period start (inclusive) |
| `periodEnd` | `Date \| string` | Yes | Billing period end (exclusive) |
| `issueDate` | `Date \| string` | No | Invoice issue date (defaults to `periodStart`) |
| `dueDate` | `Date \| string` | No | Due date (computed from payment term if omitted) |
| `invoiceNumber` | `string` | No | Explicit invoice number (generated if omitted) |
| `actorUserId` | `string \| null` | No | ID of user initiating the creation |
| `advanceSchedule` | `boolean` | No | If `true`, advances `subscription.nextBillingDate` to `periodEnd` |

#### Return Value (`CreateInvoiceResult`):
- `invoice`: Full `Invoice` record with nested lines, line taxes, line discounts, and redemptions.
- `isReused`: `boolean` — `true` if an invoice already existed for `(subscription_id, period_start)`, `false` if newly created.
- `isSkippedPaused`: `boolean` — `true` if the billing period overlaps with an effective `SubscriptionPauseInterval`.

#### Concurrency & Transaction Guarantees:
1. **Advisory Lock:** Acquires `pg_advisory_xact_lock(hashtextextended('sub_inv:' || subId || ':' || periodStart, 0))`.
2. **Idempotent Identity:** Enforces `UNIQUE (subscription_id, period_start)`. Concurrent duplicate billing attempts return the existing invoice with `isReused: true`.
3. **Atomic Snapshots:** Captures `customer_name_snapshot`, `billing_email_snapshot`, `billing_address_snapshot`, `rate_percent_snapshot`, `taxable_base`, and discount snapshots.
4. **Exact Decimal Arithmetic:** Per-line subtotals, pre-tax discount deductions, exclusive additive taxes, and final totals calculated using exact decimal arithmetic with half-up 2-decimal rounding.

---

### B. Discount Eligibility & Usage Locking (`evaluateAndLockEligibleDiscount`)
**Module:** [`backend/src/modules/billing/discount-persistence.ts`](../backend/src/modules/billing/discount-persistence.ts)

Evaluates candidate discounts, enforces historical activity, and locks usage limits.

```typescript
export async function evaluateAndLockEligibleDiscount(
  tx: Prisma.TransactionClient,
  input: EvaluateDiscountInput
): Promise<EligibleDiscountAllocation | null>
```

#### Enforced Business Rules:
1. **Historical Timeline:** Checks `DiscountRuleActivity` to ensure the rule had an active interval covering the specific billing period `[periodStart, periodEnd]`. Future discount changes cannot retroactively affect past invoices.
2. **Finite Usage Locking:** If `usageLimit !== null`, acquires row lock `SELECT "id" FROM "discount_rules" WHERE "id" = $1 FOR UPDATE` and checks count against `discount_redemptions`. Prevents race conditions across concurrent workers.
3. **Single Discount Rule (No Stacking in v1):** Selects the single rule providing the greatest monetary saving; tie-breaks deterministically using `rule.id.toLowerCase()`.
4. **Pre-Tax Deduction:** Deducts discount from line subtotal before applying exclusive additive taxes.
5. **Percentage Upper Bound:** Respects database `CHECK ("value" <= 100)` for percentage discounts.

---

### C. Payment Allocation & Idempotency (`applyInvoicePayment`)
**Module:** [`backend/src/modules/billing/payment-persistence.ts`](../backend/src/modules/billing/payment-persistence.ts)

Records payments against confirmed invoices with optimistic concurrency and idempotent replay.

```typescript
export async function applyInvoicePayment(
  prismaOrTx: PrismaClient | Prisma.TransactionClient,
  params: ApplyPaymentParams
): Promise<ApplyPaymentResult>
```

#### Parameters (`ApplyPaymentParams`):
| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `invoiceId` | `string` (UUID) | Yes | Target invoice ID |
| `recordedById` | `string \| null` | No | ID of user recording the payment |
| `idempotencyKey` | `string` (UUID) | Yes | Unique idempotency key |
| `method` | `string` | Yes | Payment method (`bank_transfer`, `card`, etc.) |
| `amount` | `string \| number \| Decimal` | Yes | Payment amount (positive) |
| `paymentDate` | `Date \| string` | Yes | Date of payment (cannot be in the future) |
| `note` | `string \| null` | No | Optional payment note |
| `expectedVersion` | `number` | No | Expected optimistic version of the invoice |
| `scope` | `string` | No | Idempotency scope (default: `invoice:{id}:payment`) |
| `requestPayload` | `unknown` | No | Raw request payload used for hash validation |

#### Return Value (`ApplyPaymentResult`):
- `payment`: Persisted `Payment` record.
- `invoice`: Updated `Invoice` record (with updated `amountPaid`, `status`, and `version`).
- `isReplay`: `boolean` — `true` if replaying a previous identical submission.

#### Error Types (`PaymentPersistenceError`):
- `422 VALIDATION_ERROR`: Non-positive amount or future payment date.
- `404 NOT_FOUND`: Invoice ID not found.
- `409 INVALID_TRANSITION`: Invoice is not in `CONFIRMED` status (e.g. `PAID`, `CANCELLED`, `DRAFT`).
- `409 PAYMENT_EXCEEDS_BALANCE`: Payment amount exceeds `invoice.total - invoice.amountPaid`.
- `409 IDEMPOTENCY_CONFLICT`: The key was used previously with different request contents.
- `412 VERSION_CONFLICT`: `invoice.version !== expectedVersion` (when `expectedVersion` is provided).

#### Idempotency Replay Invariant:
A retry with an identical key and matching payload returns the original stored result **even after the invoice version or status has subsequently changed** (e.g. subsequent payments arrived or invoice marked PAID).

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
  runId: string
): Promise<BillingRunResult>
```

#### Guarantees:
1. **Crash Recovery:** Job parameters (`periodLimit`, `subscriptionIdFilter`, `asOfDate`) are persisted before execution begins in state `PENDING`. If a worker dies, `executeBillingRun(prisma, runId)` resumes progress without duplicating invoices.
2. **Durable Counters:** Tracks `subscriptionsProcessed`, `invoicesGenerated`, `invoicesReused`, `invoicesFailed`, `hasMore`, and `nextRunRequired`.
3. **Advisory Locks:** Each subscription is locked during billing via `pg_try_advisory_xact_lock(hashtextextended('sub_run:' || subId, 0))` to prevent concurrent billing runs from overlapping.
4. **Historical Pause Intervals:** Skips unbilled periods overlapping `SubscriptionPauseInterval` and advances `nextBillingDate` without shifting the recurrence anchor.

---

## 3. How Vishnu Should Invoke Each Operation

### In Express Payment Route (`POST /api/v1/invoices/:id/payments`):
Vishnu's existing handler in `backend/src/modules/billing/payments.ts` already satisfies the HTTP contracts. For shared background worker or batch reconciliations, invoke `applyInvoicePayment`:

```typescript
import { applyInvoicePayment } from '../billing/payment-persistence.js';

const result = await applyInvoicePayment(prisma, {
  invoiceId: req.params.id,
  recordedById: user.id,
  idempotencyKey: req.get('Idempotency-Key')!,
  expectedVersion: parseIfMatch(req.get('If-Match')),
  amount: req.body.amount,
  method: req.body.method,
  paymentDate: req.body.payment_date,
  note: req.body.note,
  requestPayload: { body: req.body, version: req.get('If-Match') },
});
```

### In Recurring Billing Worker / Route (`POST /api/v1/billing-runs`):

```typescript
import { initializeBillingRun, executeBillingRun } from '../billing/billing-run-persistence.js';

// 1. In HTTP controller: create job and return 202 Accepted
const run = await initializeBillingRun(prisma, {
  asOfDate: req.body.as_of_date,
  periodLimit: req.body.period_limit,
  subscriptionIdFilter: req.body.subscription_id,
  initiatedById: user.id,
});

// 2. In background worker: execute and track progress
const summary = await executeBillingRun(prisma, run.id);
```

### In Manual / Scheduled Invoice Generation:

```typescript
import { createSubscriptionInvoice } from '../billing/invoice-persistence.js';

const { invoice, isReused, isSkippedPaused } = await createSubscriptionInvoice(prisma, {
  subscriptionId: '...',
  periodStart: new Date('2026-11-01'),
  periodEnd: new Date('2026-12-01'),
  advanceSchedule: true,
});
```

---

## 4. Remaining Integration Work

1. **Email Outbox Dispatcher:** Invoices are persisted with status `CONFIRMED`. When background email dispatch is implemented, consume `invoice_email_outbox` outside transaction boundaries.
2. **Reporting Queries (D4):** Overview report queries in `prototype.ts` are functional. Future performance optimizations (materialized views, aggregated date range queries) will be addressed in D4.
3. **Cancellation Semantics:** Subscriptions and invoices support terminal `CANCELLED` status; schedule rewinds and discount restorations remain prohibited per confirmed MVP policy.
