#!/usr/bin/env python3
"""
Database Schema & Migration Integrity Verifier
Validates structural and relational consistency between:
- docs/er-diagram.md
- prisma/schema.prisma
- prisma/migrations/20261031110000_init/migration.sql
- prisma/migrations/20261031110001_constraints_and_indexes/migration.sql
"""

import sys
import os
import re

def verify():
    root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    schema_path = os.path.join(root, "prisma", "schema.prisma")
    init_mig_path = os.path.join(root, "prisma", "migrations", "20261031110000_init", "migration.sql")
    custom_mig_path = os.path.join(root, "prisma", "migrations", "20261031110001_constraints_and_indexes", "migration.sql")
    er_doc_path = os.path.join(root, "docs", "er-diagram.md")

    errors = []

    # 1. Read files
    if not os.path.exists(schema_path):
        errors.append(f"Missing schema file: {schema_path}")
    if not os.path.exists(init_mig_path):
        errors.append(f"Missing initial migration: {init_mig_path}")
    if not os.path.exists(custom_mig_path):
        errors.append(f"Missing custom constraints migration: {custom_mig_path}")
    if not os.path.exists(er_doc_path):
        errors.append(f"Missing ER documentation: {er_doc_path}")

    if errors:
        for e in errors:
            print(f"FAIL: {e}")
        sys.exit(1)

    with open(schema_path, "r", encoding="utf-8") as f:
        schema_content = f.read()
    with open(init_mig_path, "r", encoding="utf-8") as f:
        init_content = f.read()
    with open(custom_mig_path, "r", encoding="utf-8") as f:
        custom_content = f.read()
    with open(er_doc_path, "r", encoding="utf-8") as f:
        er_content = f.read()

    print("Verifying database schema models and constraints...")

    # 2. Check Core Models in Prisma Schema
    core_models = [
        "User", "Customer", "PasswordResetToken", "StaffInvitation", "Session",
        "IdempotencyRecord", "Product", "ProductVariant", "Tax", "ProductTax",
        "Plan", "PlanProduct", "PaymentTerm", "QuotationTemplate",
        "QuotationTemplateLine", "Subscription", "SubscriptionLine",
        "SubscriptionLineTax", "SubscriptionEvent", "Invoice", "InvoiceLine",
        "InvoiceLineTax", "DiscountRule", "DiscountProduct",
        "SubscriptionDiscount", "DiscountRedemption", "InvoiceLineDiscount",
        "Payment", "BillingRun", "InvoiceEmailOutbox"
    ]
    for model in core_models:
        if f"model {model} " not in schema_content:
            errors.append(f"Model '{model}' missing from prisma/schema.prisma")

    # 3. Check Variant Composite Uniqueness & FK Integrity
    if "@@unique([id, productId])" not in schema_content:
        errors.append("ProductVariant missing composite unique constraint @@unique([id, productId])")

    if 'variantId, productId' not in schema_content:
        errors.append("Composite foreign key for variant ownership missing from line models")

    if 'REFERENCES "product_variants"("id", "product_id")' not in init_content:
        errors.append("Initial migration missing composite FK referencing product_variants(id, product_id)")

    # 4. Check Monetary Precisions
    if "@db.Decimal(18, 2)" not in schema_content:
        errors.append("Missing @db.Decimal(18, 2) in schema.prisma for settlement amounts")
    if "@db.Decimal(18, 4)" not in schema_content:
        errors.append("Missing @db.Decimal(18, 4) in schema.prisma for unit prices / quantities")
    if "@db.Decimal(7, 4)" not in schema_content:
        errors.append("Missing @db.Decimal(7, 4) in schema.prisma for tax rates")

    # 5. Check Custom SQL Migration
    # Case-insensitive email index
    if "users_email_lower_idx" not in custom_content or "LOWER" not in custom_content:
        errors.append("Custom migration missing functional LOWER(email) index")

    # Required CHECK constraints
    expected_checks = [
        "products_sales_price_check",
        "plans_price_check",
        "plans_minimum_quantity_check",
        "taxes_rate_percent_check",
        "payment_terms_due_days_check",
        "quotation_template_lines_quantity_check",
        "subscription_lines_quantity_check",
        "invoices_period_bounds_check",
        "invoices_subtotal_check",
        "invoices_total_check",
        "discount_rules_value_check",
        "payments_amount_check"
    ]
    for chk in expected_checks:
        if chk not in custom_content:
            errors.append(f"Custom migration missing CHECK constraint: {chk}")

    # Required Indexes
    expected_indexes = [
        "idx_subscriptions_customer_status",
        "idx_subscriptions_billing_due",
        "idx_invoices_outstanding",
        "idx_invoices_subscription_issue",
        "idx_payments_invoice_date",
        "idx_subscription_events_timeline"
    ]
    for idx in expected_indexes:
        if idx not in custom_content:
            errors.append(f"Custom migration missing index: {idx}")

    # 6. Check ER Diagram consistency
    if "product_variants" not in er_content or "UNIQUE (id, product_id)" not in er_content:
        errors.append("docs/er-diagram.md missing documented variant composite constraint")

    if errors:
        print(f"FAILED with {len(errors)} error(s):")
        for e in errors:
            print(f"  - {e}")
        sys.exit(1)

    print("SUCCESS: All models, composite keys, precisions, migrations, and CHECK constraints verified.")

if __name__ == "__main__":
    verify()
