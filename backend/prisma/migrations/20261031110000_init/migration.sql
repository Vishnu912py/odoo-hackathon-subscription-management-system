-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'STAFF', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "BillingInterval" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY');

-- CreateEnum
CREATE TYPE "SubscriptionStatus" AS ENUM ('DRAFT', 'QUOTATION', 'CONFIRMED', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'CONFIRMED', 'PAID', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DiscountType" AS ENUM ('FIXED', 'PERCENTAGE');

-- CreateEnum
CREATE TYPE "DiscountScope" AS ENUM ('PRODUCT', 'SUBSCRIPTION');

-- CreateTable
CREATE TABLE "users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'CUSTOMER',
    "display_name" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customers" (
    "id" UUID NOT NULL,
    "user_id" UUID,
    "name" TEXT NOT NULL,
    "company_name" TEXT,
    "billing_email" TEXT NOT NULL,
    "billing_address" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "password_reset_tokens" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "used_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "password_reset_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "staff_invitations" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "token_hash" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "accepted_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_invitations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "session_token_hash" TEXT NOT NULL,
    "user_id" UUID,
    "csrf_token" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status_code" INTEGER,
    "response_body" JSONB,
    "locked_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "products" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "product_type" TEXT NOT NULL,
    "sales_price" DECIMAL(18,4) NOT NULL,
    "cost_price" DECIMAL(18,4) NOT NULL,
    "notes" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_variants" (
    "id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "attributes" JSONB NOT NULL,
    "price_adjustment" DECIMAL(18,4) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "product_variants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "taxes" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "rate_percent" DECIMAL(7,4) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_taxes" (
    "product_id" UUID NOT NULL,
    "tax_id" UUID NOT NULL,

    CONSTRAINT "product_taxes_pkey" PRIMARY KEY ("product_id","tax_id")
);

-- CreateTable
CREATE TABLE "plans" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "price" DECIMAL(18,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "billing_interval" "BillingInterval" NOT NULL,
    "minimum_quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "available_from" DATE,
    "available_until" DATE,
    "auto_close" BOOLEAN NOT NULL DEFAULT false,
    "allow_early_close" BOOLEAN NOT NULL DEFAULT true,
    "allow_pause" BOOLEAN NOT NULL DEFAULT true,
    "allow_renewal" BOOLEAN NOT NULL DEFAULT true,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "plan_products" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "default_quantity" DECIMAL(18,4) NOT NULL DEFAULT 1,
    "is_addon" BOOLEAN NOT NULL DEFAULT false,
    "unit_price_override" DECIMAL(18,4),

    CONSTRAINT "plan_products_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_terms" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "due_days" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "payment_terms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_templates" (
    "id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "validity_days" INTEGER NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "quotation_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quotation_template_lines" (
    "id" UUID NOT NULL,
    "template_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,

    CONSTRAINT "quotation_template_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "customer_id" UUID NOT NULL,
    "plan_id" UUID NOT NULL,
    "template_id" UUID,
    "payment_term_id" UUID,
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "billing_interval" "BillingInterval" NOT NULL,
    "quotation_valid_until" DATE,
    "start_date" DATE,
    "expiry_date" DATE,
    "next_billing_date" DATE,
    "is_paused" BOOLEAN NOT NULL DEFAULT false,
    "paused_at" TIMESTAMPTZ(6),
    "closed_at" TIMESTAMPTZ(6),
    "pause_effective_date" DATE,
    "resume_effective_date" DATE,
    "close_effective_date" DATE,
    "recurrence_anchor_day" INTEGER,
    "auto_close_snapshot" BOOLEAN,
    "allow_early_close_snapshot" BOOLEAN,
    "allow_pause_snapshot" BOOLEAN,
    "allow_renewal_snapshot" BOOLEAN,
    "due_days_snapshot" INTEGER,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_pause_intervals" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE,
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_pause_intervals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_lines" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,
    "variant_id" UUID,
    "description" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "effective_from" DATE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effective_until" DATE,
    "logical_line_id" UUID,

    CONSTRAINT "subscription_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_line_taxes" (
    "subscription_line_id" UUID NOT NULL,
    "tax_id" UUID NOT NULL,

    CONSTRAINT "subscription_line_taxes_pkey" PRIMARY KEY ("subscription_line_id","tax_id")
);

-- CreateTable
CREATE TABLE "subscription_events" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "actor_user_id" UUID,
    "event_type" TEXT NOT NULL,
    "previous_status" TEXT,
    "new_status" TEXT,
    "details" JSONB,
    "occurred_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "number" TEXT NOT NULL,
    "period_start" DATE NOT NULL,
    "period_end" DATE NOT NULL,
    "issue_date" DATE NOT NULL,
    "due_date" DATE NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "customer_name_snapshot" TEXT NOT NULL,
    "billing_email_snapshot" TEXT NOT NULL,
    "billing_address_snapshot" TEXT,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "discount_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_total" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL,
    "amount_paid" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "sent_at" TIMESTAMPTZ(6),
    "cancelled_at" TIMESTAMPTZ(6),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_lines" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "subscription_line_id" UUID,
    "description_snapshot" TEXT NOT NULL,
    "quantity" DECIMAL(18,4) NOT NULL,
    "unit_price" DECIMAL(18,4) NOT NULL,
    "subtotal" DECIMAL(18,2) NOT NULL,
    "discount_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "tax_amount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_taxes" (
    "id" UUID NOT NULL,
    "invoice_line_id" UUID NOT NULL,
    "tax_id" UUID,
    "name_snapshot" TEXT NOT NULL,
    "rate_percent_snapshot" DECIMAL(7,4) NOT NULL,
    "taxable_base" DECIMAL(18,2) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "invoice_line_taxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_rules" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "discount_type" "DiscountType" NOT NULL,
    "value" DECIMAL(18,4) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'INR',
    "scope" "DiscountScope" NOT NULL,
    "minimum_purchase" DECIMAL(18,2),
    "minimum_quantity" DECIMAL(18,4),
    "valid_from" DATE,
    "valid_until" DATE,
    "usage_limit" INTEGER,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "discount_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_rule_activities" (
    "id" UUID NOT NULL,
    "discount_rule_id" UUID NOT NULL,
    "is_active" BOOLEAN NOT NULL,
    "effective_from" TIMESTAMPTZ(6) NOT NULL,
    "effective_until" TIMESTAMPTZ(6),
    "reason" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_rule_activities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discount_products" (
    "discount_rule_id" UUID NOT NULL,
    "product_id" UUID NOT NULL,

    CONSTRAINT "discount_products_pkey" PRIMARY KEY ("discount_rule_id","product_id")
);

-- CreateTable
CREATE TABLE "subscription_discounts" (
    "subscription_id" UUID NOT NULL,
    "discount_rule_id" UUID NOT NULL,

    CONSTRAINT "subscription_discounts_pkey" PRIMARY KEY ("subscription_id","discount_rule_id")
);

-- CreateTable
CREATE TABLE "discount_redemptions" (
    "id" UUID NOT NULL,
    "discount_rule_id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "name_snapshot" TEXT NOT NULL,
    "type_snapshot" TEXT NOT NULL,
    "value_snapshot" DECIMAL(18,4) NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "redeemed_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "discount_redemptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_line_discounts" (
    "redemption_id" UUID NOT NULL,
    "invoice_line_id" UUID NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,

    CONSTRAINT "invoice_line_discounts_pkey" PRIMARY KEY ("redemption_id","invoice_line_id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "recorded_by_id" UUID,
    "idempotency_key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "payment_date" DATE NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "billing_runs" (
    "id" UUID NOT NULL,
    "initiated_by_id" UUID,
    "as_of_date" DATE NOT NULL,
    "period_limit" INTEGER,
    "subscription_id_filter" UUID,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "subscriptions_processed" INTEGER NOT NULL DEFAULT 0,
    "invoices_generated" INTEGER NOT NULL DEFAULT 0,
    "invoices_reused" INTEGER NOT NULL DEFAULT 0,
    "invoices_failed" INTEGER NOT NULL DEFAULT 0,
    "has_more" BOOLEAN NOT NULL DEFAULT false,
    "next_run_required" BOOLEAN NOT NULL DEFAULT false,
    "total_amount_billed" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "errors" JSONB,
    "started_at" TIMESTAMPTZ(6),
    "completed_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "billing_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_email_outbox" (
    "id" UUID NOT NULL,
    "invoice_id" UUID NOT NULL,
    "recipient_email" TEXT NOT NULL,
    "idempotency_key" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(6),
    "sent_at" TIMESTAMPTZ(6),
    "error" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_email_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

-- CreateIndex
CREATE UNIQUE INDEX "customers_user_id_key" ON "customers"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "password_reset_tokens_token_hash_key" ON "password_reset_tokens"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "staff_invitations_user_id_key" ON "staff_invitations"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "staff_invitations_token_hash_key" ON "staff_invitations"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_session_token_hash_key" ON "sessions"("session_token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_scope_idempotency_key_key" ON "idempotency_records"("scope", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "product_variants_id_product_id_key" ON "product_variants"("id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "plan_products_plan_id_product_id_key" ON "plan_products"("plan_id", "product_id");

-- CreateIndex
CREATE UNIQUE INDEX "subscriptions_number_key" ON "subscriptions"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_number_key" ON "invoices"("number");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_subscription_id_period_start_key" ON "invoices"("subscription_id", "period_start");

-- CreateIndex
CREATE UNIQUE INDEX "discount_redemptions_discount_rule_id_invoice_id_key" ON "discount_redemptions"("discount_rule_id", "invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_idempotency_key_key" ON "payments"("idempotency_key");

-- AddForeignKey
ALTER TABLE "customers" ADD CONSTRAINT "customers_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_invitations" ADD CONSTRAINT "staff_invitations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_variants" ADD CONSTRAINT "product_variants_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_taxes" ADD CONSTRAINT "product_taxes_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_taxes" ADD CONSTRAINT "product_taxes_tax_id_fkey" FOREIGN KEY ("tax_id") REFERENCES "taxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_products" ADD CONSTRAINT "plan_products_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "plan_products" ADD CONSTRAINT "plan_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_templates" ADD CONSTRAINT "quotation_templates_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_template_lines" ADD CONSTRAINT "quotation_template_lines_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "quotation_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_template_lines" ADD CONSTRAINT "quotation_template_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quotation_template_lines" ADD CONSTRAINT "quotation_template_lines_variant_id_product_id_fkey" FOREIGN KEY ("variant_id", "product_id") REFERENCES "product_variants"("id", "product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_plan_id_fkey" FOREIGN KEY ("plan_id") REFERENCES "plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "quotation_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_payment_term_id_fkey" FOREIGN KEY ("payment_term_id") REFERENCES "payment_terms"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_pause_intervals" ADD CONSTRAINT "subscription_pause_intervals_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_lines" ADD CONSTRAINT "subscription_lines_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_lines" ADD CONSTRAINT "subscription_lines_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_lines" ADD CONSTRAINT "subscription_lines_variant_id_product_id_fkey" FOREIGN KEY ("variant_id", "product_id") REFERENCES "product_variants"("id", "product_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_line_taxes" ADD CONSTRAINT "subscription_line_taxes_subscription_line_id_fkey" FOREIGN KEY ("subscription_line_id") REFERENCES "subscription_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_line_taxes" ADD CONSTRAINT "subscription_line_taxes_tax_id_fkey" FOREIGN KEY ("tax_id") REFERENCES "taxes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_events" ADD CONSTRAINT "subscription_events_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_subscription_line_id_fkey" FOREIGN KEY ("subscription_line_id") REFERENCES "subscription_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_taxes" ADD CONSTRAINT "invoice_line_taxes_invoice_line_id_fkey" FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_taxes" ADD CONSTRAINT "invoice_line_taxes_tax_id_fkey" FOREIGN KEY ("tax_id") REFERENCES "taxes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_rule_activities" ADD CONSTRAINT "discount_rule_activities_discount_rule_id_fkey" FOREIGN KEY ("discount_rule_id") REFERENCES "discount_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_products" ADD CONSTRAINT "discount_products_discount_rule_id_fkey" FOREIGN KEY ("discount_rule_id") REFERENCES "discount_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_products" ADD CONSTRAINT "discount_products_product_id_fkey" FOREIGN KEY ("product_id") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_discounts" ADD CONSTRAINT "subscription_discounts_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_discounts" ADD CONSTRAINT "subscription_discounts_discount_rule_id_fkey" FOREIGN KEY ("discount_rule_id") REFERENCES "discount_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_discount_rule_id_fkey" FOREIGN KEY ("discount_rule_id") REFERENCES "discount_rules"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discount_redemptions" ADD CONSTRAINT "discount_redemptions_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_discounts" ADD CONSTRAINT "invoice_line_discounts_redemption_id_fkey" FOREIGN KEY ("redemption_id") REFERENCES "discount_redemptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_line_discounts" ADD CONSTRAINT "invoice_line_discounts_invoice_line_id_fkey" FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_lines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_recorded_by_id_fkey" FOREIGN KEY ("recorded_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_email_outbox" ADD CONSTRAINT "invoice_email_outbox_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

