/**
 * PostgreSQL Database Constraints & Integrity Test Suite
 * =======================================================
 * Exercises PostgreSQL constraint enforcement, transactional invoice creation,
 * discount usage locking, atomic payment allocation, and recoverable billing runs
 * against a live PostgreSQL 16 instance.
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import {
  PrismaClient,
  UserRole,
  DiscountType,
  DiscountScope,
  BillingInterval,
  type Invoice,
} from '../src/generated/prisma/client.js';
import {
  createSubscriptionInvoice,
  applyInvoicePayment,
  initializeBillingRun,
  executeBillingRun,
  PaymentPersistenceError,
} from '../src/modules/billing/index.js';

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
  console.log(' PART 1: POSTGRESQL CONSTRAINT & RELATIONAL INTEGRITY TESTS');
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

  console.log('\n================================================================================');
  console.log(' PART 2: D3-A TRANSACTIONAL INVOICE CREATION & CONCURRENCY TESTS');
  console.log('================================================================================');

  const testSubscription = await prisma.subscription.findFirst({
    where: { status: 'ACTIVE' },
    include: { customer: true, plan: true, lines: true },
  });
  if (!testSubscription) throw new Error('Active subscription required for invoice tests');

  let createdInvoiceResult: any = null;
  const p1Start = '2026-11-01';
  const p1End = '2026-12-01';

  // 11. Transactional creation of subscription invoice with correct totals and snapshots
  await assertResolves('D3-A: Create subscription invoice atomically with snapshots and lines', async () => {
    createdInvoiceResult = await createSubscriptionInvoice(prisma, {
      subscriptionId: testSubscription.id,
      periodStart: p1Start,
      periodEnd: p1End,
      issueDate: '2026-11-01',
      advanceSchedule: true,
    });

    if (createdInvoiceResult.isReused) throw new Error('Expected new invoice, got reused');
    const inv = createdInvoiceResult.invoice;
    if (!inv || !inv.lines || inv.lines.length === 0) throw new Error('Invoice lines missing');
    if (!inv.customerNameSnapshot) throw new Error('Customer snapshot missing');
    
    // Header vs line totals consistency
    const expectedSubtotal = inv.lines.reduce((acc: number, l: any) => acc + Number(l.subtotal), 0);
    const expectedTax = inv.lines.reduce((acc: number, l: any) => acc + Number(l.taxAmount), 0);
    const expectedTotal = expectedSubtotal - Number(inv.discountTotal) + expectedTax;

    if (Math.abs(Number(inv.subtotal) - expectedSubtotal) > 0.01) {
      throw new Error(`Subtotal mismatch: ${inv.subtotal} vs sum(${expectedSubtotal})`);
    }
    if (Math.abs(Number(inv.total) - expectedTotal) > 0.01) {
      throw new Error(`Total mismatch: ${inv.total} vs sum(${expectedTotal})`);
    }
  });

  // 12. Repeated billing request returns existing invoice without duplicates
  await assertResolves('D3-A: Repeated billing request returns existing invoice (isReused: true)', async () => {
    const repeatResult = await createSubscriptionInvoice(prisma, {
      subscriptionId: testSubscription.id,
      periodStart: p1Start,
      periodEnd: p1End,
    });

    if (!repeatResult.isReused) throw new Error('Expected isReused: true on repeated billing');
    if (repeatResult.invoice.id !== createdInvoiceResult.invoice.id) {
      throw new Error('Expected identical invoice ID on repeat');
    }

    const count = await prisma.invoice.count({
      where: {
        subscriptionId: testSubscription.id,
        periodStart: new Date(p1Start),
      },
    });
    if (count !== 1) throw new Error(`Expected exactly 1 invoice record in DB, found ${count}`);
  });

  // 13. Genuinely concurrent invoice generation race
  const p2Start = '2026-12-01';
  const p2End = '2027-01-01';
  await assertResolves('D3-A: Concurrent invoice creation race resolves to exactly 1 invoice', async () => {
    const [resA, resB] = await Promise.all([
      createSubscriptionInvoice(prisma, { subscriptionId: testSubscription.id, periodStart: p2Start, periodEnd: p2End }),
      createSubscriptionInvoice(prisma, { subscriptionId: testSubscription.id, periodStart: p2Start, periodEnd: p2End }),
    ]);

    const oneNew = (!resA.isReused && resB.isReused) || (resA.isReused && !resB.isReused);
    if (!oneNew) throw new Error(`Expected one new and one reused invoice, got resA: ${resA.isReused}, resB: ${resB.isReused}`);
    if (resA.invoice.id !== resB.invoice.id) throw new Error('Expected matching invoice IDs from concurrent race');

    const count = await prisma.invoice.count({
      where: {
        subscriptionId: testSubscription.id,
        periodStart: new Date(p2Start),
      },
    });
    if (count !== 1) throw new Error(`Concurrent race created duplicate invoices! Count: ${count}`);
  });

  console.log('\n================================================================================');
  console.log(' PART 3: D3-B DISCOUNT ELIGIBILITY, TIMELINE & USAGE LOCKING TESTS');
  console.log('================================================================================');

  // 14. Inactive discount activity is not applied
  await assertResolves('D3-B: Inactive discount interval via DiscountRuleActivity is excluded', async () => {
    const inactiveRule = await prisma.discountRule.create({
      data: {
        name: `Inactive Period Discount ${runId}`,
        discountType: DiscountType.FIXED,
        value: 100.00,
        currency: 'INR',
        scope: DiscountScope.SUBSCRIPTION,
        isActive: true,
        activities: {
          create: {
            isActive: false, // Explicitly marked inactive for historical period
            effectiveFrom: new Date('2026-01-01'),
            effectiveUntil: new Date('2026-05-01'),
            reason: 'Historical promotional pause',
          },
        },
      },
    });

    // Invoicing for a period inside the inactive interval
    const res = await createSubscriptionInvoice(prisma, {
      subscriptionId: testSubscription.id,
      periodStart: '2026-02-01',
      periodEnd: '2026-03-01',
    });

    if (Number(res.invoice.discountTotal) > 0) {
      const redemptions = await prisma.discountRedemption.findMany({ where: { invoiceId: res.invoice.id } });
      const usedInactive = redemptions.some(r => r.discountRuleId === inactiveRule.id);
      if (usedInactive) throw new Error('Inactive discount rule was erroneously redeemed!');
    }
  });

  // 15. Finite usage limit with concurrent redemption attempts
  await assertResolves('D3-B: Concurrent discount redemption does not exceed usageLimit = 1', async () => {
    const singleUseRule = await prisma.discountRule.create({
      data: {
        name: `Single Use Flash Discount ${runId}`,
        discountType: DiscountType.FIXED,
        value: 50.00,
        currency: 'INR',
        scope: DiscountScope.SUBSCRIPTION,
        usageLimit: 1, // Only 1 redemption allowed
        isActive: true,
        activities: {
          create: {
            isActive: true,
            effectiveFrom: new Date('2026-01-01'),
            effectiveUntil: null,
          },
        },
      },
    });

    // Link discount to subscription
    await prisma.subscriptionDiscount.create({
      data: { subscriptionId: testSubscription.id, discountRuleId: singleUseRule.id },
    });

    // Run two concurrent invoice generations for different billing periods
    const [raceInv1, raceInv2] = await Promise.all([
      createSubscriptionInvoice(prisma, { subscriptionId: testSubscription.id, periodStart: '2027-01-01', periodEnd: '2027-02-01' }),
      createSubscriptionInvoice(prisma, { subscriptionId: testSubscription.id, periodStart: '2027-02-01', periodEnd: '2027-03-01' }),
    ]);

    const totalRedeemed = await prisma.discountRedemption.count({
      where: { discountRuleId: singleUseRule.id },
    });

    if (totalRedeemed > 1) {
      throw new Error(`Usage limit violated! Redeemed count: ${totalRedeemed}, limit: 1`);
    }
  });

  console.log('\n================================================================================');
  console.log(' PART 4: D3-C PAYMENT ALLOCATION, ATOMIC UPDATES & IDEMPOTENCY TESTS');
  console.log('================================================================================');

  // Create isolated test invoice for payment tests
  const paymentTestInvoice = await prisma.invoice.create({
    data: {
      subscriptionId: testSubscription.id,
      number: `INV-PAY-TEST-${runId}`,
      periodStart: new Date('2027-03-01'),
      periodEnd: new Date('2027-04-01'),
      issueDate: new Date('2027-03-01'),
      dueDate: new Date('2027-03-16'),
      status: 'CONFIRMED',
      currency: 'INR',
      customerNameSnapshot: 'Test Customer',
      billingEmailSnapshot: 'test@customer.com',
      subtotal: 1000.00,
      discountTotal: 0.00,
      taxTotal: 0.00,
      total: 1000.00,
      amountPaid: 0.00,
    },
  });

  const payKey1 = `idem-pay1-${runId}`;

  // 16. Multiple partial payments allowed atomically
  await assertResolves('D3-C: First partial payment (₹400 on ₹1000 invoice) updates balance to ₹400', async () => {
    const res = await applyInvoicePayment(prisma, {
      invoiceId: paymentTestInvoice.id,
      idempotencyKey: payKey1,
      method: 'bank_transfer',
      amount: 400.00,
      paymentDate: '2027-03-05',
      note: 'Partial payment 1',
      expectedVersion: paymentTestInvoice.version,
    });

    if (res.isReplay) throw new Error('Expected new payment, got replay');
    if (Number(res.invoice.amountPaid) !== 400.00) throw new Error(`Expected amountPaid 400, got ${res.invoice.amountPaid}`);
    if (res.invoice.status !== 'CONFIRMED') throw new Error(`Expected status CONFIRMED, got ${res.invoice.status}`);
  });

  // 17. Overpayment rejection
  await assertRejects(
    'D3-C: Reject overpayment exceeding outstanding balance (attempt ₹700 on ₹600 balance)',
    async () => {
      return applyInvoicePayment(prisma, {
        invoiceId: paymentTestInvoice.id,
        idempotencyKey: `idem-overpay-${runId}`,
        method: 'card',
        amount: 700.00, // Balance is 600.00, so 700.00 exceeds
        paymentDate: '2027-03-06',
      });
    },
    ['payment_exceeds_balance', 'exceeds']
  );

  // 18. Second partial payment settling the exact balance transitions status to PAID
  const payKey2 = `idem-pay2-${runId}`;
  await assertResolves('D3-C: Second partial payment (₹600) fully settles invoice to PAID status', async () => {
    const currentInv = await prisma.invoice.findUniqueOrThrow({ where: { id: paymentTestInvoice.id } });
    const res = await applyInvoicePayment(prisma, {
      invoiceId: paymentTestInvoice.id,
      idempotencyKey: payKey2,
      method: 'bank_transfer',
      amount: 600.00,
      paymentDate: '2027-03-07',
      expectedVersion: currentInv.version,
    });

    if (Number(res.invoice.amountPaid) !== 1000.00) throw new Error(`Expected amountPaid 1000, got ${res.invoice.amountPaid}`);
    if (res.invoice.status !== 'PAID') throw new Error(`Expected status PAID, got ${res.invoice.status}`);
  });

  // 19. Idempotent replay: retrying original payment returns stored result even though version has changed
  await assertResolves('D3-C: Idempotent replay of first payment returns original result after invoice version increased', async () => {
    const replayRes = await applyInvoicePayment(prisma, {
      invoiceId: paymentTestInvoice.id,
      idempotencyKey: payKey1,
      method: 'bank_transfer',
      amount: 400.00,
      paymentDate: '2027-03-05',
      note: 'Partial payment 1',
    });

    if (!replayRes.isReplay) throw new Error('Expected isReplay: true on identical retry');
    if (replayRes.payment.idempotencyKey !== payKey1) throw new Error('Replayed wrong payment record');
  });

  // 20. Conflicting idempotency key reuse with different amount is rejected
  await assertRejects(
    'D3-C: Reject reuse of same idempotency key with conflicting request payload',
    async () => {
      return applyInvoicePayment(prisma, {
        invoiceId: paymentTestInvoice.id,
        idempotencyKey: payKey1,
        method: 'bank_transfer',
        amount: 500.00, // Changed payload amount
        paymentDate: '2027-03-05',
      });
    },
    ['idempotency_conflict', 'different request contents']
  );

  // 21. Genuinely concurrent competing payments exceeding balance
  const raceInvoice = await prisma.invoice.create({
    data: {
      subscriptionId: testSubscription.id,
      number: `INV-RACE-${runId}`,
      periodStart: new Date('2027-04-01'),
      periodEnd: new Date('2027-05-01'),
      issueDate: new Date('2027-04-01'),
      dueDate: new Date('2027-04-16'),
      status: 'CONFIRMED',
      currency: 'INR',
      customerNameSnapshot: 'Race Customer',
      billingEmailSnapshot: 'race@test.com',
      subtotal: 500.00,
      total: 500.00,
      amountPaid: 0.00,
    },
  });

  await assertResolves('D3-C: Concurrent payments competing for balance: exactly 1 succeeds, 1 rejected', async () => {
    const [resP1, resP2] = await Promise.allSettled([
      applyInvoicePayment(prisma, {
        invoiceId: raceInvoice.id,
        idempotencyKey: `race-p1-${runId}`,
        method: 'card',
        amount: 400.00,
        paymentDate: '2027-04-05',
        expectedVersion: raceInvoice.version,
      }),
      applyInvoicePayment(prisma, {
        invoiceId: raceInvoice.id,
        idempotencyKey: `race-p2-${runId}`,
        method: 'card',
        amount: 400.00,
        paymentDate: '2027-04-05',
        expectedVersion: raceInvoice.version,
      }),
    ]);

    const successes = [resP1, resP2].filter(r => r.status === 'fulfilled');
    const failures = [resP1, resP2].filter(r => r.status === 'rejected');

    if (successes.length !== 1 || failures.length !== 1) {
      throw new Error(`Expected exactly 1 success and 1 failure in balance race! Got ${successes.length} successes, ${failures.length} failures.`);
    }

    const finalRaceInv = await prisma.invoice.findUniqueOrThrow({ where: { id: raceInvoice.id } });
    if (Number(finalRaceInv.amountPaid) !== 400.00) {
      throw new Error(`Race condition corrupted balance: amountPaid is ${finalRaceInv.amountPaid}, expected 400.00`);
    }
  });

  console.log('\n================================================================================');
  console.log(' PART 5: D3-D RECOVERABLE BILLING PROGRESS & PAUSE INTERVAL TESTS');
  console.log('================================================================================');

  // 22. Durable BillingRun initialization persists inputs
  let testRun: any = null;
  await assertResolves('D3-D: Initialize BillingRun with durable inputs before processing begins', async () => {
    testRun = await initializeBillingRun(prisma, {
      asOfDate: '2027-06-01',
      periodLimit: 10,
      subscriptionIdFilter: testSubscription.id,
    });

    if (testRun.status !== 'PENDING') throw new Error(`Expected PENDING status, got ${testRun.status}`);
    if (testRun.periodLimit !== 10) throw new Error(`Expected periodLimit 10, got ${testRun.periodLimit}`);
  });

  // 23. Historical pause interval skipping via SubscriptionPauseInterval
  await assertResolves('D3-D: Historical pause interval skips unbilled period without shifting recurrence anchor', async () => {
    // Record pause interval covering 2027-06-01 to 2027-07-01
    await prisma.subscriptionPauseInterval.create({
      data: {
        subscriptionId: testSubscription.id,
        startDate: new Date('2027-06-01'),
        endDate: new Date('2027-07-01'),
        reason: 'Temporary suspension',
      },
    });

    // Update nextBillingDate to paused period
    await prisma.subscription.update({
      where: { id: testSubscription.id },
      data: { nextBillingDate: new Date('2027-06-01') },
    });

    const runResult = await executeBillingRun(prisma, testRun.id);

    // Should skip paused period and advance schedule to 2027-07-01
    const updatedSub = await prisma.subscription.findUniqueOrThrow({ where: { id: testSubscription.id } });
    const nextDateStr = updatedSub.nextBillingDate?.toISOString().split('T')[0];
    if (nextDateStr !== '2027-07-01') {
      throw new Error(`Expected nextBillingDate advanced to 2027-07-01, got ${nextDateStr}`);
    }

    // Verify no invoice was generated for the paused period
    const pausedInv = await prisma.invoice.findFirst({
      where: { subscriptionId: testSubscription.id, periodStart: new Date('2027-06-01') },
    });
    if (pausedInv) throw new Error('Invoice was erroneously created for paused interval!');
  });

  // 24. Repeat execution of BillingRun is idempotent and resumes safely
  await assertResolves('D3-D: Re-running BillingRun is idempotent and updates durable progress counters', async () => {
    const resumeResult = await executeBillingRun(prisma, testRun.id);
    if (resumeResult.run.status !== 'COMPLETED') {
      throw new Error(`Expected COMPLETED status, got ${resumeResult.run.status}`);
    }
  });

  console.log('\n================================================================================');
  console.log(` TOTAL RESULTS: ${testsPassed} passed, ${testsFailed} failed.`);
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
