#!/usr/bin/env python3
"""
Static Database Schema & Migration Integrity Verifier
=====================================================
Performs structural, relational, and constraint verification across:
- backend/prisma/schema.prisma
- backend/prisma/migrations/20261031110000_init/migration.sql
- backend/prisma/migrations/20261031110001_constraints_and_indexes/migration.sql
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
    schema_path = os.path.join(root, "backend", "prisma", "schema.prisma")
    init_mig_path = os.path.join(root, "backend", "prisma", "migrations", "20261031110000_init", "migration.sql")
    custom_mig_path = os.path.join(root, "backend", "prisma", "migrations", "20261031110001_constraints_and_indexes", "migration.sql")
    seed_path = os.path.join(root, "backend", "prisma", "seed.ts")
    er_doc_path = os.path.join(root, "docs", "er-diagram.md")

    errors = []
    warnings = []

    print("================================================================================")
    print(" STATIC DATABASE SCHEMA & MIGRATION INTEGRITY VERIFICATION (PRISMA 7)")
    print("================================================================================")

    for p, name in [
        (schema_path, "Prisma Schema"),
        (init_mig_path, "Initial DDL Migration"),
        (custom_mig_path, "Custom SQL Constraints Migration"),
        (seed_path, "Idempotent Seed Script"),
        (er_doc_path, "ER Diagram Handoff Doc")
    ]:
        if not os.path.isfile(p):
            errors.append(f"Missing required file: {p}")
        else:
            print(f" [OK] Found {name} at: {os.path.relpath(p, root)}")

    if errors:
        for err in errors:
            print(f" [FAIL] {err}")
        return 1

    with open(schema_path, "r", encoding="utf-8") as f:
        schema_text = f.read()

    with open(init_mig_path, "r", encoding="utf-8") as f:
        init_sql = f.read()

    with open(custom_mig_path, "r", encoding="utf-8") as f:
        custom_sql = f.read()

    models = parse_prisma_models(schema_text)
    print(f" [OK] Parsed {len(models)} models from Prisma schema.")

    if len(models) < 30:
        errors.append(f"Expected at least 30 domain models in schema, found {len(models)}")

    # 1. ProductVariant composite unique check
    pv = models.get('ProductVariant')
    if not pv:
        errors.append("ProductVariant model missing in schema")
    else:
        pv_attrs = pv.get('attributes', [])
        has_composite = any("@@unique([id, productId])" in a for a in pv_attrs)
        if not has_composite:
            errors.append("ProductVariant must declare @@unique([id, productId]) for composite variant FK enforcement")
        else:
            print(" [OK] ProductVariant has composite unique key [id, productId].")

    # 2. QuotationTemplateLine composite FK check
    qtl = models.get('QuotationTemplateLine')
    if qtl:
        variant_attrs = qtl.get('fields', {}).get('variant', {}).get('attrs', '')
        has_rel = "fields: [variantId, productId]" in variant_attrs and "references: [id, productId]" in variant_attrs
        if not has_rel:
            errors.append("QuotationTemplateLine must enforce composite variant FK on [variantId, productId]")
        else:
            print(" [OK] QuotationTemplateLine enforces composite variant FK on [variantId, productId].")

    # 3. SubscriptionLine composite FK check
    sl = models.get('SubscriptionLine')
    if sl:
        variant_attrs = sl.get('fields', {}).get('variant', {}).get('attrs', '')
        has_rel = "fields: [variantId, productId]" in variant_attrs and "references: [id, productId]" in variant_attrs
        if not has_rel:
            errors.append("SubscriptionLine must enforce composite variant FK on [variantId, productId]")
        else:
            print(" [OK] SubscriptionLine enforces composite variant FK on [variantId, productId].")

    # 4. Check BillingRun durable recovery fields
    br = models.get('BillingRun')
    if br:
        fields = br.get('fields', {})
        req_inputs = ['periodLimit', 'subscriptionIdFilter', 'invoicesReused', 'invoicesFailed', 'hasMore', 'nextRunRequired']
        for rf in req_inputs:
            if rf not in fields:
                errors.append(f"BillingRun model missing durable recovery field: {rf}")
        if not any(rf not in fields for rf in req_inputs):
            print(" [OK] BillingRun model contains all input filters and durable progress counters.")

    # 5. Check Subscription boundary and pause interval fields
    sub = models.get('Subscription')
    if sub:
        fields = sub.get('fields', {})
        req_sub_fields = ['pauseEffectiveDate', 'resumeEffectiveDate', 'closeEffectiveDate', 'pauseIntervals']
        for rf in req_sub_fields:
            if rf not in fields:
                errors.append(f"Subscription model missing boundary field: {rf}")
        if not any(rf not in fields for rf in req_sub_fields):
            print(" [OK] Subscription model contains scheduled boundary dates and pause interval tracking.")

    # 6. Check DiscountRuleActivity model exists
    dra = models.get('DiscountRuleActivity')
    if not dra:
        errors.append("DiscountRuleActivity model missing in schema")
    else:
        print(" [OK] DiscountRule model contains historical activity tracking.")

    print("\n--- Verifying Initial Migration DDL Coverage ---")
    if 'REFERENCES "product_variants"("id", "product_id")' not in init_sql:
        errors.append("Initial migration DDL is missing composite foreign keys to product_variants(id, product_id)")
    else:
        print(" [OK] Initial DDL defines composite foreign keys to product_variants.")

    print("\n--- Verifying Custom Constraints & Index Migration ---")
    if 'users_email_lower_idx' not in custom_sql:
        errors.append("Missing functional unique index 'users_email_lower_idx' in custom migration")
    else:
        print(" [OK] Functional unique index 'users_email_lower_idx' verified.")

    if '("discount_type" != \'PERCENTAGE\' OR "value" <= 100)' not in custom_sql:
        errors.append("Missing conditional discount percentage check ('value' <= 100) in discount_rules_value_check")
    else:
        print(" [OK] Conditional discount check (value <= 100 for PERCENTAGE) verified.")

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
        "payments_amount_check",
        "subscription_pause_intervals_bounds_check",
        "discount_rule_activities_bounds_check"
    ]
    for chk in expected_checks:
        if chk not in custom_sql:
            errors.append(f"Missing expected CHECK constraint: {chk}")
        else:
            print(f" [OK] Constraint '{chk}' present.")

    expected_indexes = [
        "idx_subscriptions_customer_status",
        "idx_subscriptions_billing_due",
        "idx_invoices_outstanding",
        "idx_invoices_subscription_issue",
        "idx_payments_invoice_date",
        "idx_subscription_events_timeline"
    ]
    for idx in expected_indexes:
        if idx not in custom_sql:
            errors.append(f"Missing expected index: {idx}")
        else:
            print(f" [OK] Index '{idx}' present.")

    print("\n================================================================================")
    if errors:
        print(f" VERIFICATION FAILED: {len(errors)} error(s) detected.")
        for err in errors:
            print(f"  [ERROR] {err}")
        print("================================================================================")
        return 1

    print(f" ALL STATIC INTEGRITY CHECKS PASSED ({len(models)} Models, {len(expected_checks)} Checks, {len(expected_indexes)} Indexes)")
    print(" Note: Live PostgreSQL constraints are tested via database integration suite.")
    print("================================================================================")
    return 0

if __name__ == "__main__":
    sys.exit(verify())
