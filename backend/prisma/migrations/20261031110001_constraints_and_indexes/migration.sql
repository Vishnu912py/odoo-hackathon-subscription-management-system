-- =============================================================================
-- Migration: 20261031110001_constraints_and_indexes
-- Description: PostgreSQL CHECK constraints, case-insensitive email index,
--              and targeted performance indexes for subscription billing.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. FUNCTIONAL / CASE-INSENSITIVE INDEXES
-- -----------------------------------------------------------------------------

-- Functional unique index for case-insensitive email authentication
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" (LOWER("email"));

-- -----------------------------------------------------------------------------
-- 2. TABLE-LEVEL CHECK CONSTRAINTS
-- -----------------------------------------------------------------------------

-- Products
ALTER TABLE "products"
  ADD CONSTRAINT "products_sales_price_check" CHECK ("sales_price" >= 0),
  ADD CONSTRAINT "products_cost_price_check" CHECK ("cost_price" >= 0);

-- Plans
ALTER TABLE "plans"
  ADD CONSTRAINT "plans_price_check" CHECK ("price" >= 0),
  ADD CONSTRAINT "plans_minimum_quantity_check" CHECK ("minimum_quantity" > 0),
  ADD CONSTRAINT "plans_available_bounds_check" CHECK ("available_until" IS NULL OR "available_until" >= "available_from");

-- Plan Products
ALTER TABLE "plan_products"
  ADD CONSTRAINT "plan_products_default_quantity_check" CHECK ("default_quantity" > 0),
  ADD CONSTRAINT "plan_products_unit_price_override_check" CHECK ("unit_price_override" IS NULL OR "unit_price_override" >= 0);

-- Taxes
ALTER TABLE "taxes"
  ADD CONSTRAINT "taxes_rate_percent_check" CHECK ("rate_percent" >= 0 AND "rate_percent" <= 100);

-- Payment Terms
ALTER TABLE "payment_terms"
  ADD CONSTRAINT "payment_terms_due_days_check" CHECK ("due_days" >= 0);

-- Quotation Templates
ALTER TABLE "quotation_templates"
  ADD CONSTRAINT "quotation_templates_validity_days_check" CHECK ("validity_days" > 0);

-- Quotation Template Lines
ALTER TABLE "quotation_template_lines"
  ADD CONSTRAINT "quotation_template_lines_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "quotation_template_lines_unit_price_check" CHECK ("unit_price" >= 0);

-- Subscriptions
ALTER TABLE "subscriptions"
  ADD CONSTRAINT "subscriptions_expiry_bounds_check" CHECK ("expiry_date" IS NULL OR "expiry_date" >= "start_date");

-- Subscription Pause Intervals
ALTER TABLE "subscription_pause_intervals"
  ADD CONSTRAINT "subscription_pause_intervals_bounds_check" CHECK ("end_date" IS NULL OR "end_date" >= "start_date");

-- Subscription Lines
ALTER TABLE "subscription_lines"
  ADD CONSTRAINT "subscription_lines_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "subscription_lines_unit_price_check" CHECK ("unit_price" >= 0),
  ADD CONSTRAINT "subscription_lines_effective_bounds_check" CHECK ("effective_until" IS NULL OR "effective_until" > "effective_from");

-- Invoices
ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_period_bounds_check" CHECK ("period_end" > "period_start"),
  ADD CONSTRAINT "invoices_subtotal_check" CHECK ("subtotal" >= 0),
  ADD CONSTRAINT "invoices_discount_total_check" CHECK ("discount_total" >= 0),
  ADD CONSTRAINT "invoices_tax_total_check" CHECK ("tax_total" >= 0),
  ADD CONSTRAINT "invoices_total_check" CHECK ("total" >= 0),
  ADD CONSTRAINT "invoices_amount_paid_check" CHECK ("amount_paid" >= 0);

-- Invoice Lines
ALTER TABLE "invoice_lines"
  ADD CONSTRAINT "invoice_lines_quantity_check" CHECK ("quantity" > 0),
  ADD CONSTRAINT "invoice_lines_unit_price_check" CHECK ("unit_price" >= 0),
  ADD CONSTRAINT "invoice_lines_subtotal_check" CHECK ("subtotal" >= 0),
  ADD CONSTRAINT "invoice_lines_discount_amount_check" CHECK ("discount_amount" >= 0),
  ADD CONSTRAINT "invoice_lines_tax_amount_check" CHECK ("tax_amount" >= 0),
  ADD CONSTRAINT "invoice_lines_total_check" CHECK ("total" >= 0);

-- Invoice Line Taxes
ALTER TABLE "invoice_line_taxes"
  ADD CONSTRAINT "invoice_line_taxes_rate_percent_check" CHECK ("rate_percent_snapshot" >= 0 AND "rate_percent_snapshot" <= 100),
  ADD CONSTRAINT "invoice_line_taxes_taxable_base_check" CHECK ("taxable_base" >= 0),
  ADD CONSTRAINT "invoice_line_taxes_amount_check" CHECK ("amount" >= 0);

-- Discount Rules: value > 0 AND conditional upper bound of 100 for PERCENTAGE
ALTER TABLE "discount_rules"
  ADD CONSTRAINT "discount_rules_value_check" CHECK ("value" > 0 AND ("discount_type" != 'PERCENTAGE' OR "value" <= 100)),
  ADD CONSTRAINT "discount_rules_minimum_purchase_check" CHECK ("minimum_purchase" IS NULL OR "minimum_purchase" >= 0),
  ADD CONSTRAINT "discount_rules_minimum_quantity_check" CHECK ("minimum_quantity" IS NULL OR "minimum_quantity" > 0),
  ADD CONSTRAINT "discount_rules_valid_bounds_check" CHECK ("valid_until" IS NULL OR "valid_until" >= "valid_from"),
  ADD CONSTRAINT "discount_rules_usage_limit_check" CHECK ("usage_limit" IS NULL OR "usage_limit" > 0);

-- Discount Rule Activities
ALTER TABLE "discount_rule_activities"
  ADD CONSTRAINT "discount_rule_activities_bounds_check" CHECK ("effective_until" IS NULL OR "effective_until" >= "effective_from");

-- Discount Redemptions
ALTER TABLE "discount_redemptions"
  ADD CONSTRAINT "discount_redemptions_amount_check" CHECK ("amount" >= 0);

-- Invoice Line Discounts
ALTER TABLE "invoice_line_discounts"
  ADD CONSTRAINT "invoice_line_discounts_amount_check" CHECK ("amount" >= 0);

-- Payments
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_check" CHECK ("amount" > 0);

-- -----------------------------------------------------------------------------
-- 3. TARGETED PERFORMANCE & PARTIAL INDEXES
-- -----------------------------------------------------------------------------

-- Customer ownership lookup for customer portal queries
CREATE INDEX "idx_subscriptions_customer_status" ON "subscriptions" ("customer_id", "status");

-- Scheduler index: quickly find active, unpaused subscriptions ready for recurring billing
CREATE INDEX "idx_subscriptions_billing_due" ON "subscriptions" ("next_billing_date")
  WHERE "status" = 'ACTIVE' AND "is_paused" = false;

-- Overdue / Collections index: find unpaid confirmed invoices past due date
CREATE INDEX "idx_invoices_outstanding" ON "invoices" ("due_date")
  WHERE "status" = 'CONFIRMED';

-- Invoices sorted by issue date for a subscription
CREATE INDEX "idx_invoices_subscription_issue" ON "invoices" ("subscription_id", "issue_date" DESC);

-- Payments lookup by invoice
CREATE INDEX "idx_payments_invoice_date" ON "payments" ("invoice_id", "payment_date" DESC);

-- Subscription event audit trail timeline
CREATE INDEX "idx_subscription_events_timeline" ON "subscription_events" ("subscription_id", "occurred_at" DESC);

-- Session expiry cleanup index
CREATE INDEX "idx_sessions_user_expires" ON "sessions" ("user_id", "expires_at");

