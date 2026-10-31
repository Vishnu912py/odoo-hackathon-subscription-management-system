-- =============================================================================
-- Migration: 20261031170000_reporting_performance_indexes
-- Description: Composite, covering, and partial indexes for large-scale
--              reporting and persistence performance (Milestone D5).
-- =============================================================================

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
