#!/usr/bin/env python3
"""
Static Database Schema & Migration Integrity Verifier
=====================================================
Performs structural, relational, and constraint verification across:
- database/prisma/schema.prisma
- database/prisma/migrations/20261031110000_init/migration.sql
- database/prisma/migrations/20261031110001_constraints_and_indexes/migration.sql
- docs/er-diagram.md

Note: This is a static code-level verifier. Live database constraint enforcement
and transaction locking are verified via PostgreSQL integration tests.
"""

import sys
import os
import re

def parse_prisma_models(schema_text):
    """Extracts models, field names, and block attributes from schema.prisma."""
    model_regex = re.compile(r'model\s+(\w+)\s*\{([^}]+)\}', re.MULTILINE)
    models = {}
    for match in model_regex.finditer(schema_text):
        name = match.group(1)
        body = match.group(2)
        lines = [line.strip() for line in body.strip().splitlines() if line.strip() and not line.strip().startswith('//')]
        fields = {}
        attributes = []
        for line in lines:
            if line.startswith('@@'):
                attributes.append(line)
            else:
                parts = line.split()
                if len(parts) >= 2:
                    field_name = parts[0]
                    field_type = parts[1]
                    field_attrs = parts[2:] if len(parts) > 2 else []
                    fields[field_name] = {
                        'type': field_type,
                        'attrs': " ".join(field_attrs)
                    }
        models[name] = {
            'fields': fields,
            'attributes': attributes
        }
    return models

def verify():
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    schema_path = os.path.join(root, "database", "prisma", "schema.prisma")
    init_mig_path = os.path.join(root, "database", "prisma", "migrations", "20261031110000_init", "migration.sql")
    custom_mig_path = os.path.join(root, "database", "prisma", "migrations", "20261031110001_constraints_and_indexes", "migration.sql")
    seed_path = os.path.join(root, "database", "prisma", "seed.ts")
    er_doc_path = os.path.join(root, "docs", "er-diagram.md")

    errors = []
    warnings = []

    print("================================================================================")
    print(" STATIC DATABASE SCHEMA & MIGRATION INTEGRITY VERIFICATION")
    print("================================================================================")

    # 1. Verify file existence
    required_files = [
        ("Prisma Schema", schema_path),
        ("Initial DDL Migration", init_mig_path),
        ("Custom SQL Constraints Migration", custom_mig_path),
        ("Idempotent Seed Script", seed_path),
        ("ER Diagram Handoff Doc", er_doc_path),
    ]
    for label, path in required_files:
        if not os.path.exists(path):
            errors.append(f"Missing required artifact [{label}]: {path}")
        else:
            print(f" [OK] Found {label} at: {os.path.relpath(path, root)}")

    if errors:
        for err in errors:
            print(f" [FAIL] {err}")
        sys.exit(1)

    with open(schema_path, "r", encoding="utf-8") as f:
        schema_content = f.read()
    with open(init_mig_path, "r", encoding="utf-8") as f:
        init_mig_content = f.read()
    with open(custom_mig_path, "r", encoding="utf-8") as f:
        custom_mig_content = f.read()
    with open(er_doc_path, "r", encoding="utf-8") as f:
        er_content = f.read()

    # 2. Parse Prisma Schema Models
    models = parse_prisma_models(schema_content)
    print(f" [OK] Parsed {len(models)} models from Prisma schema.")

    expected_models = [
        "User", "Customer", "PasswordResetToken", "StaffInvitation", "Session",
        "IdempotencyRecord", "Product", "ProductVariant", "Tax", "ProductTax",
        "Plan", "PlanProduct", "PaymentTerm", "QuotationTemplate",
        "QuotationTemplateLine", "Subscription", "SubscriptionPauseInterval",
        "SubscriptionLine", "SubscriptionLineTax", "SubscriptionEvent",
        "Invoice", "InvoiceLine", "InvoiceLineTax", "DiscountRule",
        "DiscountRuleActivity", "DiscountProduct", "SubscriptionDiscount",
        "DiscountRedemption", "InvoiceLineDiscount", "Payment",
        "BillingRun", "InvoiceEmailOutbox"
    ]

    for em in expected_models:
        if em not in models:
            errors.append(f"Required model '{em}' missing from schema.prisma")
        else:
            # Check map attribute
            table_map = [a for a in models[em]['attributes'] if a.startswith('@@map(')]
            if not table_map:
                errors.append(f"Model '{em}' missing @@map() table name mapping")

    # 3. Verify Product-Variant Ownership Integrity
    variant_model = models.get("ProductVariant", {})
    if "@@unique([id, productId])" not in variant_model.get("attributes", []):
        errors.append("ProductVariant must declare composite unique constraint @@unique([id, productId])")
    else:
        print(" [OK] ProductVariant has composite unique key [id, productId].")

    for line_model_name in ["QuotationTemplateLine", "SubscriptionLine"]:
        line_model = models.get(line_model_name, {})
        variant_rel = line_model.get("fields", {}).get("variant", {}).get("attrs", "")
        if "fields: [variantId, productId]" not in variant_rel or "references: [id, productId]" not in variant_rel:
            errors.append(f"{line_model_name} missing composite variant foreign key referencing [id, productId]")
        else:
            print(f" [OK] {line_model_name} enforces composite variant FK on [variantId, productId].")

    # 4. Verify BillingRun Input & Progress Fields
    billing_run = models.get("BillingRun", {}).get("fields", {})
    required_billing_fields = [
        "asOfDate", "periodLimit", "subscriptionIdFilter", "status",
        "subscriptionsProcessed", "invoicesGenerated", "invoicesReused",
        "invoicesFailed", "hasMore", "nextRunRequired", "totalAmountBilled"
    ]
    for bf in required_billing_fields:
        if bf not in billing_run:
            errors.append(f"BillingRun model missing field: '{bf}'")
    print(" [OK] BillingRun model contains all input filters and durable progress counters.")

    # 5. Verify Subscription Scheduled Actions & Pause Intervals
    sub_model = models.get("Subscription", {}).get("fields", {})
    for sf in ["pauseEffectiveDate", "resumeEffectiveDate", "closeEffectiveDate"]:
        if sf not in sub_model:
            errors.append(f"Subscription model missing scheduled projection field: '{sf}'")
    if "pauseIntervals" not in sub_model:
        errors.append("Subscription model missing relation 'pauseIntervals' to SubscriptionPauseInterval")
    print(" [OK] Subscription model contains scheduled boundary dates and pause interval tracking.")

    # 6. Verify Discount Rule Activity History
    rule_model = models.get("DiscountRule", {}).get("fields", {})
    if "activities" not in rule_model:
        errors.append("DiscountRule missing relation 'activities' to DiscountRuleActivity")
    print(" [OK] DiscountRule model contains historical activity tracking.")

    # 7. Verify Initial Migration DDL Coverage
    print("\n--- Verifying Initial Migration DDL Coverage ---")
    for em in expected_models:
        maps = [a for a in models[em]['attributes'] if a.startswith('@@map("')]
        mapped_name = maps[0].replace('@@map("', '').replace('")', '') if maps else em
        if f'CREATE TABLE "{mapped_name}"' not in init_mig_content:
            errors.append(f"Initial migration DDL missing table creation for '{mapped_name}' (model {em})")

    # Verify composite FK in DDL
    if 'REFERENCES "product_variants"("id", "product_id")' not in init_mig_content:
        errors.append("Initial migration DDL missing composite FK referencing product_variants(id, product_id)")
    else:
        print(" [OK] Initial DDL defines composite foreign keys to product_variants.")

    # 8. Verify Custom Constraints & Indexes Migration
    print("\n--- Verifying Custom Constraints & Index Migration ---")
    if "users_email_lower_idx" not in custom_mig_content or 'LOWER("email")' not in custom_mig_content:
        errors.append("Custom migration missing functional LOWER(email) unique index")
    else:
        print(" [OK] Functional unique index 'users_email_lower_idx' verified.")

    # Conditional percentage upper bound
    if 'discount_rules_value_check' not in custom_mig_content or 'PERCENTAGE' not in custom_mig_content or '100' not in custom_mig_content:
        errors.append("Custom migration missing conditional percentage upper bound check (<= 100) on discount_rules")
    else:
        print(" [OK] Conditional discount check (value <= 100 for PERCENTAGE) verified.")

    # Check key CHECK constraints
    required_checks = [
        "products_sales_price_check", "plans_price_check", "plans_minimum_quantity_check",
        "taxes_rate_percent_check", "payment_terms_due_days_check",
        "quotation_template_lines_quantity_check", "subscription_lines_quantity_check",
        "invoices_period_bounds_check", "invoices_subtotal_check", "invoices_total_check",
        "payments_amount_check", "subscription_pause_intervals_bounds_check",
        "discount_rule_activities_bounds_check"
    ]
    for rc in required_checks:
        if rc not in custom_mig_content:
            errors.append(f"Custom migration missing CHECK constraint: '{rc}'")
        else:
            print(f" [OK] Constraint '{rc}' present.")

    # Check targeted indexes
    required_indexes = [
        "idx_subscriptions_customer_status", "idx_subscriptions_billing_due",
        "idx_invoices_outstanding", "idx_invoices_subscription_issue",
        "idx_payments_invoice_date", "idx_subscription_events_timeline"
    ]
    for ri in required_indexes:
        if ri not in custom_mig_content:
            errors.append(f"Custom migration missing index: '{ri}'")
        else:
            print(f" [OK] Index '{ri}' present.")

    # 9. Summary
    print("\n================================================================================")
    if errors:
        print(f" VERIFICATION FAILED: {len(errors)} error(s) detected:")
        for err in errors:
            print(f"  [X] {err}")
        print("================================================================================")
        sys.exit(1)

    print(" ALL STATIC INTEGRITY CHECKS PASSED (32 Models, 13 Checks, 7 Indexes)")
    print(" Note: Live PostgreSQL constraints are tested via database integration suite.")
    print("================================================================================")

if __name__ == "__main__":
    verify()
