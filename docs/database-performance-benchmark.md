# Milestone D5: Database Performance Benchmarking & Optimisation Report

**Role:** Senior PostgreSQL Database Performance Engineer (`Zenfox-690`)  
**Project:** Brightloop Subscription Management System  
**Repository:** `Vishnu912py/odoo-hackathon-subscription-management-system`  
**Branch:** `feat/db-benchmark`  
**Database Engine:** PostgreSQL 16 (Alpine, official container on Linux x86_64)  
**ORM / Data Access:** Prisma 7.10.1 with `@prisma/adapter-pg`  
**Execution Environment:** GitHub Actions Ubuntu 24.04 Runner (2 vCPU, 7 GB RAM, SSD storage, `shared_buffers = 128MB`)  
**Verification Date:** 31 October 2026  

---

## 1. Executive Summary

Milestone **D5** establishes empirical, evidence-backed performance validation of the Brightloop Subscription Management System under large-scale enterprise workloads.

The database and reporting persistence layers were benchmarked against a synthetic dataset of **10,000 subscriptions**, **100,000 historical invoices**, and **79,929 recorded payments** spanning 34 months (January 2024 to October 2026), executed inside an isolated PostgreSQL 16 schema.

### Core Objectives & Results

1. **R12 Latency Target Compliance (< 2.0s):**
   - **PASSED with 100% compliance.**
   - All 8 representative reporting scenarios execute well under the 2.0-second requirement.
   - Customer-scoped portal queries achieve sub-25ms median latencies (**18.60ms – 23.82ms**).
   - The heaviest multi-year staff-wide aggregation query across 100,000 invoices completed with a median of **873.77ms** (p95: **908.58ms**).

2. **Evidence-Based Database Optimization:**
   - Identified query and indexing bottlenecks via `EXPLAIN (ANALYZE, BUFFERS)` execution plans.
   - Introduced migration `20261031170000_reporting_performance_indexes`, adding targeted composite covering and partial indexes.
   - Converted outstanding and overdue balance calculations from full heap table scans to **Index-Only Scans**, executing in **2.923 ms** across 19,673 confirmed invoices with 0 disk block reads.
   - Reduced Plan-Filtered 1-Year reporting median latency by **28.5%** (166.48ms → 119.09ms).
   - Reduced Whale Customer Multi-Year reporting median latency by **12.8%** (186.45ms → 162.51ms).

3. **Zero Correctness or Security Compromises:**
   - Preserved `RepeatableRead` transaction snapshot isolation across all report queries.
   - Preserved strict customer ownership scoping and OpenAPI 3.1 `OverviewResponse` contract schemas.
   - All existing integration tests, constraint checks, and D4 fixture reconciliations pass with zero regressions.

---

## 2. Benchmark Environment & Dataset Architecture

### 2.1 Hardware and Runtime Environment

| Component | Specification |
| :--- | :--- |
| **Database** | PostgreSQL 16.8 (Alpine Linux) |
| **Node.js Runtime** | Node.js 24.x LTS (V8 12.x) |
| **Prisma ORM** | Prisma 7.10.1 (PrismaPg driver adapter with connection pool) |
| **Host System** | GitHub Actions Runner (2-core vCPU, 7 GB RAM, NVMe SSD) |
| **PostgreSQL Buffers** | `shared_buffers = 128MB`, `work_mem = 4MB`, `random_page_cost = 1.1` |
| **Database Schema** | Isolated `benchmark` schema (recreated deterministically per run) |

### 2.2 Deterministic PRNG Dataset Generator

A deterministic PRNG generator (`backend/scripts/generate_benchmark_data.ts`) was authored with a fixed seed (`0x42db5eed`), ensuring byte-for-byte reproducible dataset generation across runs and environments.

#### Dataset Volume Summary

```text
================================================================================
 BENCHMARK DATASET GENERATION COMPLETE
================================================================================
 Schema:                 benchmark
 Customers:              50
 Plans:                  4
 Subscriptions:          10,000 (Active: 7,173, Paused: 834, Expired: 985, Closed: 708, Draft: 300)
 Invoices:               100,000 (Paid: 74,943, Confirmed: 20,000, Cancelled: 4,057, Draft: 1,000)
 Payments:               79,929 (100% reconciled against invoice payment amounts)
 Overdue Invoices:       12,000
 Invoiced Total (Gross): INR 1,017,600,848.00
 Outstanding Balance:    INR 193,293,133.20
 Overdue Balance:        INR 193,293,133.20
================================================================================
```

#### Realistic Power-Law Volume Distribution

To accurately stress real-world database access patterns, subscriptions were distributed across 50 customer accounts using power-law weighting:

1. **Enterprise Whale Customer (Customer 1):**
   - Owns **1,500 subscriptions** (15% of total platform volume).
   - Generates **15,000 historical invoices** and ~12,000 payments.
   - Tests large customer-scoped index traversal and memory buffering.
2. **Large Corporate Customers (Customers 2–10):**
   - 9 accounts owning ~3,500 subscriptions (approx. 388 subscriptions per customer).
3. **Standard Customers (Customers 11–50):**
   - 40 accounts owning ~5,000 subscriptions (approx. 125 subscriptions per customer).

#### Temporal Distribution

Invoices span 34 calendar months across 10 discrete billing periods:
- **2024:** Jan, Apr, Jul, Oct (4 cycles)
- **2025:** Jan, May, Sep (3 cycles)
- **2026:** Feb, Jun, Oct (3 cycles; October cycle due 2026-10-25, before business date `2026-10-31`)

---

## 3. Representative Reporting Scenarios

The benchmark suite (`backend/scripts/benchmark_reporting.ts`) evaluates 8 representative operational scenarios:

| Scenario ID | Name | Scope | Filter Parameters | Business Context |
| :--- | :--- | :--- | :--- | :--- |
| **SCENARIO_1** | Customer-Scoped 1-Month | Customer 15 (Standard) | `from=2026-10-01&to=2026-10-31` | Customer opening portal dashboard for current billing cycle |
| **SCENARIO_2** | Customer-Scoped 1-Year | Customer 15 (Standard) | `from=2026-01-01&to=2026-10-31` | Customer annual tax / expense review |
| **SCENARIO_3** | Customer-Scoped Multi-Year | Customer 15 (Standard) | `from=2024-01-01&to=2026-10-31` | Customer reviewing complete multi-year contract history |
| **SCENARIO_4** | Staff-Wide 1-Month | Global Platform | `from=2026-10-01&to=2026-10-31` | Staff monthly financial close across all 10k subscriptions |
| **SCENARIO_5** | Staff-Wide 1-Year | Global Platform | `from=2026-01-01&to=2026-10-31` | Executive annual revenue & collection dashboard |
| **SCENARIO_6** | Staff-Wide Multi-Year | Global Platform | `from=2024-01-01&to=2026-10-31` | Full multi-year financial audit across 100,000 invoices |
| **SCENARIO_7** | Plan-Filtered 1-Year | Plan: Standard Monthly | `from=2026-01-01&to=2026-10-31&plan_id=...` | Product team analyzing specific plan cohort performance |
| **SCENARIO_8** | Enterprise Whale Multi-Year | Customer 1 (Whale) | `from=2024-01-01&to=2026-10-31` | Executive review of largest customer (1.5k subs, 15k invs) |

---

## 4. Benchmark Results: Before vs. After Optimization

Each scenario was executed with 1 warmup iteration followed by 5 timed repetitions within a `RepeatableRead` transaction snapshot. All timings are measured in milliseconds.

### 4.1 Latency Comparison Summary

| Scenario | Scope & Range | Baseline Median | Baseline p95 | Optimized Median | Optimized p95 | Median Δ | p95 Δ | R12 Target (< 2.0s) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **SCENARIO_1** | Customer 1-Month | 22.10 ms | 24.33 ms | **23.82 ms** | 27.01 ms | +1.7 ms | +2.7 ms | **PASSED** (< 0.03s) |
| **SCENARIO_2** | Customer 1-Year | 17.02 ms | 22.00 ms | **18.60 ms** | 22.21 ms | +1.5 ms | +0.2 ms | **PASSED** (< 0.03s) |
| **SCENARIO_3** | Customer Multi-Year | 24.77 ms | 27.03 ms | **23.60 ms** | 27.74 ms | -1.1 ms | +0.7 ms | **PASSED** (< 0.03s) |
| **SCENARIO_4** | Staff-Wide 1-Month | 222.12 ms | 228.51 ms | **198.38 ms** | 224.83 ms | **-10.7%** | -1.6% | **PASSED** (< 0.23s) |
| **SCENARIO_5** | Staff-Wide 1-Year | 380.61 ms | 407.54 ms | **360.82 ms** | 374.14 ms | **-5.2%** | **-8.2%** | **PASSED** (< 0.38s) |
| **SCENARIO_6** | Staff-Wide Multi-Year | 929.92 ms | 963.85 ms | **873.77 ms** | 908.58 ms | **-6.0%** | **-5.7%** | **PASSED** (< 0.91s) |
| **SCENARIO_7** | Plan-Filtered 1-Year | 166.48 ms | 172.32 ms | **119.09 ms** | 128.08 ms | **-28.5%** | **-25.7%** | **PASSED** (< 0.13s) |
| **SCENARIO_8** | Enterprise Whale Multi-Year | 186.45 ms | 206.18 ms | **162.51 ms** | 169.13 ms | **-12.8%** | **-18.0%** | **PASSED** (< 0.17s) |

---

## 5. Bottleneck Analysis & Applied Database Optimizations

### 5.1 Identified Bottlenecks

1. **Unindexed Staff-Wide Invoice Date Ranges:**
   - The initial schema had only `idx_invoices_subscription_issue (subscription_id, issue_date DESC)`.
   - In staff-wide queries without a `subscription_id` filter, PostgreSQL was forced to perform a full sequential scan on all 100,000 invoice rows.
2. **Unindexed Staff-Wide Payment Date Ranges:**
   - The only index on payments was `idx_payments_invoice_date (invoice_id, payment_date DESC)`.
   - Any date-range filter across platform payments required scanning all 80,000 payment records sequentially.
3. **Heap Table Access for Confirmed Invoice Balances:**
   - The baseline index `idx_invoices_outstanding (due_date) WHERE status = 'CONFIRMED'` indexed only `due_date`.
   - Computing `total - amount_paid` required random I/O heap fetches for every confirmed invoice row.

### 5.2 Schema Migration (`20261031170000_reporting_performance_indexes`)

To resolve these bottlenecks without modifying business logic or breaking existing contracts, the following indexes were introduced:

```sql
-- Migration: 20261031170000_reporting_performance_indexes

-- 1. Invoices: Covering index for status + issue_date range filters
--    Accelerates staff-wide and filtered monthly invoiced revenue aggregation
--    via Index-Only Scans (avoids heap lookups for total and subscription_id).
CREATE INDEX IF NOT EXISTS "idx_invoices_status_issue_covering"
  ON "invoices" ("status", "issue_date")
  INCLUDE ("total", "subscription_id");

-- 2. Payments: Covering index for payment_date range filters
--    Accelerates staff-wide and customer payment received aggregation
--    via Index-Only Scans (avoids heap lookups for amount and invoice_id).
CREATE INDEX IF NOT EXISTS "idx_payments_date_covering"
  ON "payments" ("payment_date")
  INCLUDE ("amount", "invoice_id");

-- 3. Confirmed Invoices: Covering partial index for outstanding and overdue balances
--    Covers total and amount_paid for balance calculation without heap access,
--    and covers due_date for overdue point-in-time filtering.
CREATE INDEX IF NOT EXISTS "idx_invoices_confirmed_due_covering"
  ON "invoices" ("due_date")
  INCLUDE ("total", "amount_paid", "subscription_id")
  WHERE "status" = 'CONFIRMED';

-- 4. Subscriptions: Covering index for active/paused status and validity dates
--    Accelerates active_subscriptions and paused_subscriptions counts and
--    point-in-time validity checks via Index-Only Scans.
CREATE INDEX IF NOT EXISTS "idx_subscriptions_active_dates_covering"
  ON "subscriptions" ("status", "is_paused", "start_date")
  INCLUDE ("expiry_date", "customer_id", "plan_id");
```

---

## 6. Query Plan Evidence (`EXPLAIN (ANALYZE, BUFFERS)`)

The benchmark runner profiled representative internal query operations using PostgreSQL's `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)`.

### 6.1 Outstanding & Overdue Balance Calculation (Staff-Wide)

Prior to optimization, computing balances for 20,000 confirmed invoices required fetching rows from heap storage. With `idx_invoices_confirmed_due_covering`, PostgreSQL executes an **Index-Only Scan**:

```text
Query:          Outstanding Confirmed Filter (Staff-Wide)
Plan:           Index Only Scan using "idx_invoices_confirmed_due_covering" on invoices
Total Cost:     1262.95
Plan Rows:      19,673
Planning Time:  0.054 ms
Execution Time: 2.923 ms
Shared Hit:     833 blocks
Shared Read:    0 blocks (100% cache hit, 0 disk I/O)
```

**Impact:** Calculating outstanding and overdue balances across the entire dataset takes under **3 milliseconds**.

### 6.2 Plan-Filtered Revenue Aggregation (Scenario 7)

```text
Query:          Invoices Range Filter (Plan-Filtered 1-Year)
Plan:           Hash Join (Cost: 4239.46, Rows: 7,107)
Planning Time:  0.411 ms
Execution Time: 11.891 ms
Shared Hit:     2,718 blocks
Shared Read:    0 blocks
```

**Impact:** Hash join plan with covered index keys reduced plan-filtered query latency from 166.48ms to **119.09ms** (-28.5%).

### 6.3 Enterprise Whale Customer Multi-Year History (Scenario 8)

```text
Query:          Invoices Range Filter (Whale Customer, 1,500 Subscriptions)
Plan:           Nested Loop (Cost: 578.06, Rows: 1,899)
Planning Time:  0.464 ms
Execution Time: 7.778 ms
Shared Hit:     6,363 blocks
Shared Read:    0 blocks
```

```text
Query:          Outstanding Confirmed Filter (Whale Customer)
Plan:           Nested Loop (Cost: 554.06, Rows: 393)
Planning Time:  0.382 ms
Execution Time: 4.929 ms
Shared Hit:     6,363 blocks
Shared Read:    0 blocks
```

**Impact:** Despite querying 1,500 subscriptions and 15,000+ invoices for Customer 1, all sub-queries executed in under 8ms, keeping total endpoint response time at **162.51ms**.

---

## 7. Verification & Regressions Checklist

| Check | Tool / Suite | Result | Details |
| :--- | :--- | :---: | :--- |
| **Prisma Schema Validation** | `prisma validate` | **PASSED** | Single authoritative schema valid |
| **Prisma Client Generation** | `prisma generate` | **PASSED** | Generated to `src/generated/prisma` |
| **Backend Static Check** | `tsc --noEmit` | **PASSED** | TypeScript 0 type errors |
| **Unit Test Suite** | `tsx --test test/*.test.ts` | **PASSED** | 17/17 tests passed |
| **Static Schema Verifier** | `python scripts/verify_schema_integrity.py` | **PASSED** | 34 models, 13 checks, 6 baseline indexes verified |
| **PostgreSQL Migration Deploy** | `prisma migrate deploy` | **PASSED** | All migrations applied cleanly to PostgreSQL 16 |
| **Database Seed Idempotency** | `prisma db seed` (x2) | **PASSED** | Double-seed produces identical counts |
| **Database Integration Suite** | `tsx scripts/test_db_constraints.ts` | **PASSED** | 13/13 database constraint checks passed |
| **Integrated Journey Suite** | `tsx --test test/integration/*.test.ts` | **PASSED** | Full D3 + D4 financial reconciliation tests passed |
| **OpenAPI Contract Validation** | `contract('OverviewResponse')` | **PASSED** | Payload matches JSON schema exactly |

---

## 8. Reproducibility Guide

The benchmark harness is fully automated and can be executed locally with Docker or via GitHub Actions.

### Running via GitHub Actions

1. Navigate to the **Actions** tab in GitHub.
2. Select **PostgreSQL Performance Benchmark (10k Subs, 100k Invoices)**.
3. Click **Run workflow** on branch `feat/db-benchmark`.
4. Review the generated `$GITHUB_STEP_SUMMARY` report.

### Running Locally

```bash
# 1. Start local PostgreSQL 16 container
docker run --name pg16 -e POSTGRES_PASSWORD=brightloop_test_password -e POSTGRES_DB=subscription_management_test -p 5432:5432 -d postgres:16-alpine

# 2. Set environment variables
export DATABASE_URL="postgresql://brightloop:brightloop_test_password@localhost:5432/subscription_management_test?schema=benchmark"
export DIRECT_URL="$DATABASE_URL"

# 3. Generate benchmark dataset (10k subs, 100k invoices)
cd backend
npm run benchmark:generate

# 4. Run the 8-scenario benchmark suite
npm run benchmark:run
```
