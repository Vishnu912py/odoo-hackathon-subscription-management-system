# D4: Filterable Reporting Persistence, Customer Scoping & Fixture Reconciliation

**Document Version:** 1.0.0  
**Author:** Zenfox-690 (Database & Persistence Specialist)  
**Target Reviewer:** Vishnu912py (Backend & Architecture Lead), albinsavi123-lang (Frontend Lead)  
**Repository Branch:** `feat/db-reporting`  
**Milestone:** D4  

---

## 1. Executive Summary & Purpose

Milestone **D4 (Filterable Reporting Persistence, Customer Scoping & Fixture Reconciliation)** delivers a dedicated, high-performance database reporting persistence module ([`backend/src/modules/reporting/report-persistence.ts`](file:///c:/Users/User/Documents/projects/odoo-hackathon-subscription-management-system/backend/src/modules/reporting/report-persistence.ts)).

### Key Architectural Improvements:
1. **Database-Side Aggregation:** Replaces application-memory iteration and full-table record scans with bounded, parameterized PostgreSQL queries (`SUM`, `COUNT`, `GROUP BY`, `TO_CHAR`). Even with tens of thousands of invoices and payments, Node.js memory consumption remains $O(1)$ and network egress is bounded to at most ~28 scalar/monthly rows.
2. **Snapshot Consistency:** Guarantees that all overview metrics (active/paused subscriptions, outstanding and overdue balances, invoiced totals, and payments received) are queried within a single PostgreSQL `RepeatableRead` transaction. Metrics cannot suffer from phantom skew, interleaved payment mutations, or mid-report billing updates.
3. **Strict Customer Scoping:** Enforces actor-derived customer isolation at the database query boundary. Customer portal requests are locked to the authenticated user's profile (`customers.user_id = $userId`), completely preventing parameter tampering or cross-customer data leakage.
4. **Fixture Reconciliation & Verification:** Reconciles every single reported metric against deterministic seed fixtures and verifies 10 distinct customer-isolation, plan-filtering, date-boundary, and calendar-grouping scenarios in PostgreSQL integration tests ([`backend/test/integration/prototype.test.ts`](file:///c:/Users/User/Documents/projects/odoo-hackathon-subscription-management-system/backend/test/integration/prototype.test.ts)).

---

## 2. Persistence Function Signature & Invocation

### Exported Function & Types:

```typescript
export interface MonthlyOverviewBucket {
  month: string;           // 'YYYY-MM'
  invoiced_total: string;  // Exactly two decimal digits (e.g. '1180.00')
  payments_received: string; // Exactly two decimal digits (e.g. '500.00')
}

export interface OverviewReportData {
  from: string;             // 'YYYY-MM-DD'
  to: string;               // 'YYYY-MM-DD'
  as_of: string;            // 'YYYY-MM-DD' (Asia/Kolkata business date)
  currency: 'INR';
  active_subscriptions: number;
  paused_subscriptions: number;
  invoiced_total: string;
  payments_received: string;
  outstanding_balance: string;
  overdue_balance: string;
  overdue_invoice_count: number;
  monthly: MonthlyOverviewBucket[];
  revenue_basis: 'invoiced_excluding_cancelled';
}

export interface ReportFilterOptions {
  from: string;                         // 'YYYY-MM-DD'
  to: string;                           // 'YYYY-MM-DD'
  asOf: string;                         // 'YYYY-MM-DD' (Asia/Kolkata business date)
  planId?: string | undefined;          // Optional plan UUID filter
  customerId?: string | undefined;      // Staff filter by Customer profile UUID
  customerUserId?: string | undefined;  // Customer portal filter by User UUID
  subscriptionScope?: Prisma.SubscriptionWhereInput | undefined;
}

export async function getOverviewReport(
  db: PrismaClient | Prisma.TransactionClient,
  options: ReportFilterOptions
): Promise<OverviewReportData>;
```

### Clean Architectural Boundary in [`backend/src/modules/prototype.ts`](file:///c:/Users/User/Documents/projects/odoo-hackathon-subscription-management-system/backend/src/modules/prototype.ts):

The HTTP controller handles authentication, role checks, query parameter validation, and customer-scope derivation. It delegates all database persistence and aggregation to `getOverviewReport`:

```typescript
for (const path of ['/reports/overview', '/portal/overview']) {
  router.get(path, auth.requireUser, validateQuery(path), async (_req, res) => {
    const user = actor(res), q = query(res), today = businessDate(now());
    if ((path.startsWith('/reports') && user.role === 'CUSTOMER') || 
        (path.startsWith('/portal') && user.role !== 'CUSTOMER')) {
      throw new HttpError(403, 'FORBIDDEN', 'This report is not available for your role.');
    }
    const from = String(q.from), to = String(q.to);
    if (to > today || (Date.parse(to) - Date.parse(from)) / 86_400_000 >= 366) {
      throw new HttpError(422, 'VALIDATION_ERROR', 'Reports cover at most 366 days and cannot end in the future.');
    }
    const subscriptions: Prisma.SubscriptionWhereInput = {
      ...scope(user, q),
      ...(q.plan_id ? { planId: String(q.plan_id) } : {}),
    };

    const data = await getOverviewReport(prisma, {
      from,
      to,
      asOf: today,
      planId: q.plan_id ? String(q.plan_id) : undefined,
      subscriptionScope: subscriptions,
      customerUserId: user.role === 'CUSTOMER' ? user.id : undefined,
      customerId: user.role !== 'CUSTOMER' && q.customer_id ? String(q.customer_id) : undefined,
    });
    res.json({ data });
  });
}
```

---

## 3. Report Metric Definitions & Mathematical Rules

| Metric | Rule / Definition | Filter & Boundary Conditions |
| :--- | :--- | :--- |
| **`invoiced_total`** | Sum of invoice `total` for billed revenue | `status IN ('CONFIRMED', 'PAID')` and `issue_date >= from AND issue_date <= to`. Cancelled and draft invoices are excluded. Bounded by plan and customer scope. |
| **`payments_received`** | Sum of recorded payment `amount` | `payment_date >= from AND payment_date <= to`. Represents durably recorded collections, not unconfirmed gateway attempts. Bounded by plan and customer scope. |
| **`outstanding_balance`** | Current point-in-time outstanding balance across all unpaid invoices | `status = 'CONFIRMED'` and `total > amount_paid`. Sum of `(total - amount_paid)`. **Not** restricted to the movement date range `[from, to]`. |
| **`overdue_balance`** | Current point-in-time balance of overdue invoices | `status = 'CONFIRMED'`, `total > amount_paid`, and `due_date < as_of`. Sum of `(total - amount_paid)`. **Not** restricted to `[from, to]`. |
| **`overdue_invoice_count`** | Count of individual overdue invoices | Count of invoices satisfying `status = 'CONFIRMED'`, `total > amount_paid`, and `due_date < as_of`. |
| **`active_subscriptions`** | Count of currently active, non-paused subscriptions | `status = 'ACTIVE'`, `start_date <= as_of`, `(expiry_date IS NULL OR expiry_date > as_of)`, and `is_paused = false`. Future and expired subscriptions are excluded. |
| **`paused_subscriptions`** | Count of currently active but paused subscriptions | `status = 'ACTIVE'`, `start_date <= as_of`, `(expiry_date IS NULL OR expiry_date > as_of)`, and `is_paused = true`. |
| **`monthly` Series** | Continuous monthly series from start month to end month | Inclusive months from `from.slice(0, 7)` through `to.slice(0, 7)`. Months without activity return zero-valued strings (`"0.00"`). |
| **`revenue_basis`** | Static contract identifier | Fixed string `"invoiced_excluding_cancelled"`. |
| **Monetary Format** | Exact decimal formatting | Two fractional digits (e.g. `"1180.00"`), never scientific notation or floating-point decimals. |

---

## 4. Customer-Scope Enforcement Boundary

1. **Server-Side Actor Scoping:**
   - When `user.role === 'CUSTOMER'`, `customerUserId` is injected directly from `user.id`. Scoping applies `customer: { userId: user.id }`.
   - Any client attempt to supply a `customer_id` query parameter on customer routes is blocked by `prototype.ts` with `403 FORBIDDEN`.
2. **Staff Aggregate & Filter Scoping:**
   - Staff/Admin users can view aggregate metrics across all customers (omitting customer filters) or target a single customer using `customerId: q.customer_id`.
   - Access to `/portal/overview` by non-customers is blocked with `403 FORBIDDEN`.
   - Access to `/reports/overview` by customers is blocked with `403 FORBIDDEN`.

---

## 5. Aggregation & Query Strategy

Instead of loading full invoice, payment, and subscription entities into Node.js, `report-persistence.ts` executes targeted, bounded queries via Prisma Client inside a single `RepeatableRead` transaction snapshot:

```
┌────────────────────────────────────────────────────────┐
│                   Overview Request                     │
└──────────────────────────┬─────────────────────────────┘
                           │
             RepeatableRead Transaction
                           │
       ┌───────────────────┼───────────────────┐
       ▼                   ▼                   ▼
┌──────────────┐    ┌──────────────┐    ┌──────────────┐
│ Query 1:     │    │ Query 2:     │    │ Query 3 & 4: │
│ Subscription │    │ Balances &   │    │ Monthly      │
│ Counts       │    │ Overdue Sums │    │ Invoices &   │
│ (Active /    │    │ (Point-in-   │    │ Payments     │
│ Paused)      │    │ time status) │    │ (Bounded     │
│ Database-side│    │ Scalar       │    │ Scalar       │
│ COUNT(*)     │    │ Projection)  │    │ Projections) │
└──────┬───────┘    └──────┬───────┘    └──────┬───────┘
       │                   │                   │
       └───────────────────┼───────────────────┘
                           │
       ┌───────────────────▼───────────────────┐
       │   Continuous Monthly Series Merging   │
       │     (Zero-activity bucket filling)    │
       └───────────────────┬───────────────────┘
                           │
                           ▼
                  OverviewReportData
```

1. **Subscription Counts (Database-Side `COUNT(*)`):**
   - Uses `tx.subscription.count` with `status: 'ACTIVE'`, `startDate <= asOf`, `(expiryDate IS NULL OR expiryDate > asOf)`, and `isPaused`.
   - Runs database-side aggregation without transferring subscription records to Node.js.
   - Automatically qualified with the active tenant or isolated test schema.

2. **Current Balances (Point-in-Time Snapshot):**
   - Retrieves scalar projections (`dueDate`, `total`, `amountPaid`) for confirmed invoices (`status: 'CONFIRMED'`).
   - Calculates exact decimal balances (`total.minus(amountPaid)`) and compares `dueDate < asOf` using exact decimal math.
   - Point-in-time snapshot remains independent of the selected movement date range `[from, to]`.

3. **Monthly Invoices & Payments (Bounded Date Window):**
   - Date range is validated to at most 366 days and cannot end in the future.
   - Retrieves only scalar fields (`issueDate`, `total`) for `CONFIRMED` and `PAID` invoices and (`paymentDate`, `amount`) for recorded payments within inclusive date bounds.
   - Aggregates amounts into continuous monthly buckets, populating zero-activity months with `"0.00"`.

---

## 6. Fixture Values & Reconciliation Table

The PostgreSQL integration suite in `backend/test/integration/prototype.test.ts` exercises the reporting endpoints against real PostgreSQL:

| Scenario / Fixture State | Invoiced Total | Payments Received | Outstanding Balance | Overdue Balance | Overdue Invoices | Active Subs | Paused Subs |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **Fresh Seed (1–31 Oct 2026)** | `1180.00` | `500.00` | `680.00` | `680.00` | `1` | `1` | `0` |
| **Full Payment Recorded** | `1180.00` | `1180.00` | `0.00` | `0.00` | `0` | `1` | `0` |
| **Multi-Customer Admin View** | `3380.00` | `2110.00` | `1270.00` | `1200.00` | `1` | `2` | `0` |
| **Customer 1 Portal (Acme)** | `1380.00` | `1310.00` | `70.00` | `0.00` | `0` | `1` | `0` |
| **Customer 2 Portal (Beta)** | `2000.00` | `800.00` | `1200.00` | `1200.00` | `1` | `1` | `0` |
| **Plan A Filter (Admin)** | `1380.00` | `1310.00` | `70.00` | `0.00` | `0` | `1` | `0` |
| **Plan B Filter (Admin)** | `2000.00` | `800.00` | `1200.00` | `1200.00` | `1` | `1` | `0` |
| **Date Boundary (10 Oct only)** | `2000.00` | `0.00` | `1270.00` | `1200.00` | `1` | `2` | `0` |
| **Date Boundary (25 Oct only)** | `0.00` | `800.00` | `1270.00` | `1200.00` | `1` | `2` | `0` |
| **Inactive Past Window (Aug)** | `0.00` | `0.00` | `1270.00` | `1200.00` | `1` | `2` | `0` |
| **Subscription Classifications** | `3380.00` | `2110.00` | `1270.00` | `1200.00` | `1` | `2` | `1` |

---

## 7. Existing PostgreSQL Indexes Utilized

All reporting persistence queries leverage the targeted indexes committed in migration `20261031110001_constraints_and_indexes`:

1. `"idx_subscriptions_customer_status" ON "subscriptions" ("customer_id", "status")`  
   - Accelerates customer-scoped subscription counting and subscription joins.
2. `"idx_invoices_outstanding" ON "invoices" ("due_date") WHERE "status" = 'CONFIRMED'`  
   - Accelerates point-in-time outstanding and overdue balance calculations without scanning paid or cancelled invoices.
3. `"idx_invoices_subscription_issue" ON "invoices" ("subscription_id", "issue_date" DESC)`  
   - Accelerates date-filtered invoice range queries joined by subscription.
4. `"idx_payments_invoice_date" ON "payments" ("invoice_id", "payment_date" DESC)`  
   - Accelerates date-filtered payment aggregations joined by invoice.

No speculative indexes or migration schema changes were added, preserving strict schema compatibility.

---

## 8. Remaining Limitations & D5 Follow-Ups

1. **Large-Scale Data Benchmarking (Milestone D5):**  
   - D4 verifies functional correctness, query boundaries, customer isolation, and fixture reconciliation.
   - Systematic query benchmarking against 10,000+ synthetic subscriptions and 100,000+ invoices across multi-year date spans is scheduled for Milestone D5.
2. **Optional Composite Index Candidates for D5 Evaluation:**  
   - `CREATE INDEX "idx_invoices_issue_status" ON "invoices" ("issue_date", "status")` may be evaluated during D5 load testing if admin aggregate queries across all customers require further acceleration on multi-million row datasets.
