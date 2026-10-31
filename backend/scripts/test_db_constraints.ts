/**
 * PostgreSQL Database Constraints & Integrity Test Suite
 * =======================================================
 * Exercises PostgreSQL constraint enforcement against a live test database.
 * Run in CI with DATABASE_URL pointing to an isolated PostgreSQL instance.
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  UserRole,
  DiscountType,
  DiscountScope,
  BillingInterval,
} from '../src/generated/prisma/client.js';

const connectionString =
  process.env.DIRECT_URL ||
  process.env.DATABASE_URL ||
  'postgresql://brightloop:brightloop_test_password@localhost:5432/subscription_management_test?schema=public';

const schema = new URL(connectionString).searchParams.get('schema') ?? 'public';
const adapter = new PrismaPg({ connectionString }, { schema });
const prisma = new PrismaClient({ adapter });

let testsPassed = 0;
let testsFailed = 0;

async function assertRejects(
  testName: string,
  operation: () => Promise<any>,
  expectedSnippets?: string | string[]
) {
  try {
    await operation();
    console.error(` [FAIL] ${testName} - Expected error but operation succeeded!`);
    testsFailed++;
  } catch (error: any) {
    const fullErrorStr = `${error?.message || ''} ${JSON.stringify(error?.meta || {})} ${String(error)}`;
    const snippets = Array.isArray(expectedSnippets)
      ? expectedSnippets
      : (expectedSnippets ? [expectedSnippets] : []);
    const matched = snippets.length === 0 || snippets.some(s => fullErrorStr.toLowerCase().includes(s.toLowerCase()));

    if (!matched) {
      console.error(` [FAIL] ${testName} - Expected error matching any of ${JSON.stringify(snippets)} but got: ${fullErrorStr}`);
      testsFailed++;
    } else {
      console.log(` [PASS] ${testName}`);
      testsPassed++;
    }
  }
}

async function assertResolves(testName: string, operation: () => Promise<any>) {
  try {
    await operation();
    console.log(` [PASS] ${testName}`);
    testsPassed++;
  } catch (error: any) {
    console.error(` [FAIL] ${testName} - Unexpected error:`, error?.message || error);
    testsFailed++;
  }
}

async function runConstraintTests() {
  console.log('================================================================================');
  console.log(' RUNNING POSTGRESQL CONSTRAINT & RELATIONAL INTEGRITY TEST SUITE');
  console.log('================================================================================');

  const runId = Math.floor(Math.random() * 1000000);
  const baseEmail = `test.worker.${runId}@brightloop.test`;
  const upperEmail = `TEST.WORKER.${runId}@BRIGHTLOOP.TEST`;

  // 1. Case-insensitive email uniqueness
  await assertResolves('Insert baseline test user', async () => {
    return prisma.user.create({
      data: {
        email: baseEmail,
        passwordHash: '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W56SuT86p2oA6nxe',
        role: UserRole.CUSTOMER,
        displayName: 'Test User',
      },
    });
  });

  await assertRejects(
    'Reject duplicate email with different casing (users_email_lower_idx)',
    async () => {
      return prisma.user.create({
        data: {
          email: upperEmail,
          passwordHash: '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W56SuT86p2oA6nxe',
          role: UserRole.CUSTOMER,
          displayName: 'Test User Duplicate',
        },
      });
    },
    ['users_email_lower_idx', 'email']
  );

  // 2. Negative price rejection
  await assertRejects(
    'Reject product with negative sales price (products_sales_price_check)',
    async () => {
      return prisma.$executeRawUnsafe(
        `INSERT INTO "products" ("id", "name", "product_type", "sales_price", "cost_price", "is_active", "version", "created_at", "updated_at")
         VALUES (gen_random_uuid(), 'Invalid Product', 'SERVICE', -10.0000, 5.0000, true, 1, NOW(), NOW());`
      );
    },
    'products_sales_price_check'
  );

  // 3. Non-positive quantity rejection
  await assertRejects(
    'Reject quotation template line with zero quantity (quotation_template_lines_quantity_check)',
    async () => {
      // Find or create test plan & template
      const plan = await prisma.plan.findFirst();
      const product = await prisma.product.findFirst();
      if (!plan || !product) throw new Error('Fixtures required for quantity test');

      return prisma.$executeRawUnsafe(
        `INSERT INTO "quotation_template_lines" ("id", "template_id", "product_id", "quantity", "unit_price")
         VALUES (gen_random_uuid(), (SELECT "id" FROM "quotation_templates" LIMIT 1), '${product.id}', 0.0000, 100.0000);`
      );
    },
    'quotation_template_lines_quantity_check'
  );

  // 4. Tax percentage upper bound (> 100)
  await assertRejects(
    'Reject tax rate exceeding 100% (taxes_rate_percent_check)',
    async () => {
      return prisma.$executeRawUnsafe(
        `INSERT INTO "taxes" ("id", "name", "rate_percent", "is_active", "version", "created_at", "updated_at")
         VALUES (gen_random_uuid(), 'Excessive Tax', 125.0000, true, 1, NOW(), NOW());`
      );
    },
    'taxes_rate_percent_check'
  );

  // 5. Conditional discount rule upper bound for PERCENTAGE (> 100)
  await assertRejects(
    'Reject percentage discount exceeding 100% (discount_rules_value_check)',
    async () => {
      return prisma.$executeRawUnsafe(
        `INSERT INTO "discount_rules" ("id", "name", "discount_type", "value", "currency", "scope", "is_active", "version", "created_at", "updated_at")
         VALUES (gen_random_uuid(), 'Invalid 150% Discount', 'PERCENTAGE', 150.0000, 'INR', 'PRODUCT', true, 1, NOW(), NOW());`
      );
    },
    'discount_rules_value_check'
  );

  await assertResolves(
    'Accept fixed discount exceeding 100 (valid flat amount savings)',
    async () => {
      return prisma.discountRule.create({
        data: {
          name: `Valid Fixed Discount ${runId}`,
          discountType: DiscountType.FIXED,
          value: 500.0000,
          currency: 'INR',
          scope: DiscountScope.SUBSCRIPTION,
          usageLimit: 10,
        },
      });
    }
  );

  // 6. Invalid billing period bounds (period_end <= period_start)
  await assertRejects(
    'Reject invoice with inverted period bounds (invoices_period_bounds_check)',
    async () => {
      const sub = await prisma.subscription.findFirst();
      if (!sub) throw new Error('Subscription required for invoice test');

      return prisma.$executeRawUnsafe(
        `INSERT INTO "invoices" ("id", "subscription_id", "number", "period_start", "period_end", "issue_date", "due_date", "status", "currency", "customer_name_snapshot", "billing_email_snapshot", "subtotal", "total", "version", "created_at", "updated_at")
         VALUES (gen_random_uuid(), '${sub.id}', 'INV-TEST-ERR-${runId}', '2026-11-01', '2026-10-01', '2026-11-01', '2026-11-15', 'DRAFT', 'INR', 'Snapshot', 'snap@test.com', 100.00, 100.00, 1, NOW(), NOW());`
      );
    },
    'invoices_period_bounds_check'
  );

  // 7. Duplicate payment idempotency key
  const idemKey = `idempotency-key-${runId}`;
  await assertResolves('Insert initial payment with idempotency key', async () => {
    // Look up an invoice
    const inv = await prisma.invoice.findFirst();
    if (!inv) throw new Error('Invoice required for payment test');

    return prisma.payment.create({
      data: {
        invoiceId: inv.id,
        idempotencyKey: idemKey,
        method: 'bank_transfer',
        amount: 100.00,
        paymentDate: new Date('2026-10-31'),
        note: 'First payment attempt',
      },
    });
  });

  await assertRejects(
    'Reject duplicate payment with identical idempotency key',
    async () => {
      const inv = await prisma.invoice.findFirst();
      if (!inv) throw new Error('Invoice required for payment test');

      return prisma.payment.create({
        data: {
          invoiceId: inv.id,
          idempotencyKey: idemKey,
          method: 'bank_transfer',
          amount: 100.00,
          paymentDate: new Date('2026-10-31'),
          note: 'Duplicate payment attempt',
        },
      });
    },
    ['payments_idempotency_key_key', 'idempotency_key', 'idempotencykey']
  );

  // 8. Product–variant cross-assignment rejection
  await assertRejects(
    'Reject quotation template line with variant belonging to another product',
    async () => {
      const products = await prisma.product.findMany({ take: 2 });
      const variant = await prisma.productVariant.findFirst();
      const template = await prisma.quotationTemplate.findFirst();
      if (products.length < 2 || !variant || !template) throw new Error('Prerequisites missing for variant test');

      // Product 0 is NOT the parent of variant (variant belongs to Product 1)
      const wrongProductId = products.find(p => p.id !== variant.productId)?.id;
      if (!wrongProductId) throw new Error('Could not find mismatched product');

      return prisma.$executeRawUnsafe(
        `INSERT INTO "quotation_template_lines" ("id", "template_id", "product_id", "variant_id", "quantity", "unit_price")
         VALUES (gen_random_uuid(), '${template.id}', '${wrongProductId}', '${variant.id}', 1.0000, 500.0000);`
      );
    },
    ['quotation_template_lines_variant_id_product_id_fkey', 'variant_id', 'product_id', 'violates foreign key']
  );

  // 9. Duplicate subscription billing period
  await assertRejects(
    'Reject duplicate invoice for same subscription and period_start',
    async () => {
      const existingInv = await prisma.invoice.findFirst();
      if (!existingInv) throw new Error('Invoice required for period test');

      const pStart = existingInv.periodStart.toISOString().split('T')[0];
      const pEnd = existingInv.periodEnd.toISOString().split('T')[0];

      return prisma.$executeRawUnsafe(
        `INSERT INTO "invoices" ("id", "subscription_id", "number", "period_start", "period_end", "issue_date", "due_date", "status", "currency", "customer_name_snapshot", "billing_email_snapshot", "subtotal", "total", "version", "created_at", "updated_at")
         VALUES (gen_random_uuid(), '${existingInv.subscriptionId}', 'INV-DUP-PERIOD-${runId}', '${pStart}', '${pEnd}', '${pStart}', '${pEnd}', 'DRAFT', 'INR', 'Snapshot', 'snap@test.com', 100.00, 100.00, 1, NOW(), NOW());`
      );
    },
    ['invoices_subscription_id_period_start_key', 'subscription_id', 'period_start', 'unique constraint']
  );

  // 10. Duplicate discount redemption on same invoice
  await assertRejects(
    'Reject duplicate discount redemption on same invoice',
    async () => {
      const existingRedemption = await prisma.discountRedemption.findFirst();
      if (!existingRedemption) {
        // Create one first
        const rule = await prisma.discountRule.findFirst();
        const inv = await prisma.invoice.findFirst();
        if (!rule || !inv) throw new Error('Rule and Invoice required');
        await prisma.discountRedemption.create({
          data: {
            discountRuleId: rule.id,
            invoiceId: inv.id,
            nameSnapshot: rule.name,
            typeSnapshot: rule.discountType,
            valueSnapshot: rule.value,
            amount: 50.00,
          },
        });
        return prisma.discountRedemption.create({
          data: {
            discountRuleId: rule.id,
            invoiceId: inv.id,
            nameSnapshot: rule.name,
            typeSnapshot: rule.discountType,
            valueSnapshot: rule.value,
            amount: 50.00,
          },
        });
      }

      return prisma.discountRedemption.create({
        data: {
          discountRuleId: existingRedemption.discountRuleId,
          invoiceId: existingRedemption.invoiceId,
          nameSnapshot: 'Duplicate Attempt',
          typeSnapshot: 'FIXED',
          valueSnapshot: 10.0000,
          amount: 10.00,
        },
      });
    },
    ['discount_redemptions_discount_rule_id_invoice_id_key', 'discount_rule_id', 'invoice_id', 'unique constraint']
  );

  console.log('================================================================================');
  console.log(` RESULTS: ${testsPassed} passed, ${testsFailed} failed.`);
  console.log('================================================================================');

  if (testsFailed > 0) {
    process.exit(1);
  }
}

runConstraintTests()
  .catch((e) => {
    console.error('Fatal test error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

