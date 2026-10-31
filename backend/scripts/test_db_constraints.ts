/**
 * PostgreSQL Database Constraints & Integrity Test Suite
 * =======================================================
 * Exercises PostgreSQL constraint enforcement, transactional invoice creation,
 * historical discount eligibility, atomic payment allocation, and recoverable billing runs
 * against a live PostgreSQL 16 instance.
 */

import 'dotenv/config';
import pg from 'pg';
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
  computeNextPeriod,
  getDaysInMonth,
  isLeapYear,
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

  const runId = Date.now().toString(36);

  // 1. Email uniqueness (case-insensitive functional index)
  const uniqueEmail = `test.unique.${runId}@example.com`;
  await assertResolves('Setup: create user with base email', async () => {
    return prisma.user.create({
      data: {
        email: uniqueEmail,
        passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyza',
        role: UserRole.STAFF,
      },
    });
  });

  await assertRejects(
    'Enforce case-insensitive email uniqueness (users_email_lower_idx)',
    async () => {
      return prisma.user.create({
        data: {
          email: uniqueEmail.toUpperCase(),
          passwordHash: '$2b$10$abcdefghijklmnopqrstuvwxyza',
          role: UserRole.CUSTOMER,
        },
      });
    },
    ['users_email_lower_idx', 'unique constraint']
  );

  // 2. Reject negative product unit price (CHECK constraint)
  await assertRejects(
    'Reject negative sales price on product (products_sales_price_check)',
    async () => {
      return prisma.product.create({
        data: {
          name: `Negative Price Item ${runId}`,
          productType: 'service',
          salesPrice: -25.50,
          costPrice: 0.00,
        },
      });
    },
    ['products_sales_price_check', 'check constraint']
  );

  // 3. Reject discount percentage exceeding 100% (CHECK constraint)
  await assertRejects(
    'Reject discount percentage > 100% (discount_rules_value_check)',
    async () => {
      return prisma.discountRule.create({
        data: {
          name: `Invalid Promo ${runId}`,
          discountType: DiscountType.PERCENTAGE,
          value: 120.0000,
          currency: 'INR',
          scope: DiscountScope.SUBSCRIPTION,
        },
      });
    },
    ['discount_rules_value_check', 'check constraint']
  );

  // 4. Reject negative plan price
  await assertRejects(
    'Reject negative price on plan (plans_price_check)',
    async () => {
      return prisma.plan.create({
        data: {
          name: `Negative Plan ${runId}`,
          price: -500.00,
          currency: 'INR',
          billingInterval: BillingInterval.MONTHLY,
        },
      });
    },
    ['plans_price_check', 'check constraint']
  );

  // 5. Reject negative tax rate percent
  await assertRejects(
    'Reject negative tax percentage (taxes_rate_percent_check)',
    async () => {
      return prisma.tax.create({
        data: {
          name: `Negative GST ${runId}`,
          ratePercent: -18.0000,
        },
      });
    },
    ['taxes_rate_percent_check', 'check constraint']
  );

  // 6. Enforce composite variant FK constraint
  await assertRejects(
    'Reject mismatched product/variant composite relationship on subscription line',
    async () => {
      const prodA = await prisma.product.create({
        data: { name: `Prod A ${runId}`, productType: 'service', salesPrice: 100.00, costPrice: 50.00 },
      });
      const prodB = await prisma.product.create({
        data: { name: `Prod B ${runId}`, productType: 'service', salesPrice: 200.00, costPrice: 100.00 },
      });
      const variantA = await prisma.productVariant.create({
        data: { productId: prodA.id, name: 'Variant A', attributes: { color: 'red' }, priceAdjustment: 10.00 },
      });

      const customer = await prisma.customer.findFirst();
      const plan = await prisma.plan.findFirst();
      if (!customer || !plan) throw new Error('Customer and Plan required for composite FK test');

      const sub = await prisma.subscription.create({
        data: {
          number: `SUB-TEST-${runId}`,
          customerId: customer.id,
          planId: plan.id,
          status: 'ACTIVE',
          billingInterval: BillingInterval.MONTHLY,
        },
      });

      // Erroneously assign prodB with variantA (which belongs to prodA)
      return prisma.subscriptionLine.create({
        data: {
          subscriptionId: sub.id,
          productId: prodB.id,
          variantId: variantA.id,
          description: 'Mismatched variant link',
          quantity: 1,
          unitPrice: 150.00,
        },
      });
    },
    ['foreign key', 'subscription_lines_variant_id_product_id_fkey', 'violates foreign key constraint']
  );

  // 7. Enforce invoice period bounds (period_end > period_start)
  await assertRejects(
    'Reject inverted invoice billing period (invoices_period_bounds_check)',
    async () => {
      const sub = await prisma.subscription.findFirst();
      if (!sub) throw new Error('Subscription required for period check');

      return prisma.invoice.create({
        data: {
          subscriptionId: sub.id,
          number: `INV-INVALID-${runId}`,
          periodStart: new Date('2026-12-01'),
          periodEnd: new Date('2026-11-01'), // Invalid: end before start
          issueDate: new Date('2026-11-01'),
          dueDate: new Date('2026-11-15'),
          status: 'DRAFT',
          currency: 'INR',
          customerNameSnapshot: 'Test Cust',
          billingEmailSnapshot: 'test@example.com',
          subtotal: 100.00,
          total: 100.00,
        },
      });
    },
    ['invoices_period_bounds_check', 'check constraint']
  );

  // 8. Enforce pause interval date consistency (end_date > start_date)
  await assertRejects(
    'Reject inverted pause interval dates (subscription_pause_intervals_bounds_check)',
    async () => {
      const sub = await prisma.subscription.findFirst();
      if (!sub) throw new Error('Subscription required for pause check');

      return prisma.subscriptionPauseInterval.create({
        data: {
          subscriptionId: sub.id,
          startDate: new Date('2026-10-15'),
          endDate: new Date('2026-10-01'), // Invalid: end before start
        },
      });
    },
    ['subscription_pause_intervals_bounds_check', 'check constraint']
  );

  // 9. Reject negative payment amount
  await assertRejects(
    'Reject negative payment amount (payments_amount_check)',
    async () => {
      const inv = await prisma.invoice.findFirst();
      if (!inv) throw new Error('Invoice required for payment amount check');

      return prisma.payment.create({
        data: {
          invoiceId: inv.id,
          idempotencyKey: `invalid-pay-${runId}`,
          method: 'bank_transfer',
          amount: -50.00,
          paymentDate: new Date(),
        },
      });
    },
    ['payments_amount_check', 'check constraint']
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
      throw new Error(`Subtotal mismatch: header ${inv.subtotal} vs lines ${expectedSubtotal}`);
    }
    if (Math.abs(Number(inv.total) - expectedTotal) > 0.01) {
      throw new Error(`Total mismatch: header ${inv.total} vs calculated ${expectedTotal}`);
    }
  });

  // 12. Repeated billing for identical period returns existing invoice (idempotent reuse)
  await assertResolves('D3-A: Repeated invoice creation for identical period returns existing invoice without error', async () => {
    const secondCallResult = await createSubscriptionInvoice(prisma, {
      subscriptionId: testSubscription.id,
      periodStart: p1Start,
      periodEnd: p1End,
    });

    if (!secondCallResult.isReused) throw new Error('Expected isReused: true for existing period');
    if (secondCallResult.invoice.id !== createdInvoiceResult.invoice.id) {
      throw new Error('Returned different invoice ID for identical period!');
    }
  });

  // 13. Concurrency race on identical subscription period
  await assertResolves('D3-A: Concurrent invoice generation for same period serializes cleanly (1 created, 1 reused)', async () => {
    const racePeriodStart = '2026-12-01';
    const racePeriodEnd = '2027-01-01';

    const [resA, resB] = await Promise.all([
      createSubscriptionInvoice(prisma, { subscriptionId: testSubscription.id, periodStart: racePeriodStart, periodEnd: racePeriodEnd }),
      createSubscriptionInvoice(prisma, { subscriptionId: testSubscription.id, periodStart: racePeriodStart, periodEnd: racePeriodEnd }),
    ]);

    const createdCount = (resA.isReused ? 0 : 1) + (resB.isReused ? 0 : 1);
    const reusedCount = (resA.isReused ? 1 : 0) + (resB.isReused ? 1 : 0);

    if (createdCount !== 1 || reusedCount !== 1) {
      throw new Error(`Expected exactly 1 created and 1 reused in concurrency race. Got ${createdCount} created, ${reusedCount} reused.`);
    }
    if (resA.invoice.id !== resB.invoice.id) {
      throw new Error('Concurrent executions generated duplicate invoices with different IDs!');
    }
  });

  console.log('\n================================================================================');
  console.log(' PART 3: D3-B HISTORICAL DISCOUNT ELIGIBILITY, TIMELINE & USAGE LOCKING TESTS');
  console.log('================================================================================');

  // 14. A rule active during a past period but inactive now IS eligible
  await assertResolves('D3-B: Rule active in past period but inactive now is eligible for historical period', async () => {
    const historicalRule = await prisma.discountRule.create({
      data: {
        name: `Historical Active Past Rule ${runId}`,
        discountType: DiscountType.FIXED,
        value: 50.00,
        currency: 'INR',
        scope: DiscountScope.SUBSCRIPTION,
        isActive: false, // Currently inactive!
        activities: {
          createMany: {
            data: [
              {
                isActive: true,
                effectiveFrom: new Date('2025-01-01T00:00:00.000Z'),
                effectiveUntil: new Date('2025-06-01T00:00:00.000Z'),
                reason: 'Promotional campaign active in H1 2025',
              },
              {
                isActive: false,
                effectiveFrom: new Date('2025-06-01T00:00:00.000Z'),
                effectiveUntil: null,
                reason: 'Campaign concluded',
              },
            ],
          },
        },
      },
    });

    await prisma.subscriptionDiscount.create({
      data: { subscriptionId: testSubscription.id, discountRuleId: historicalRule.id },
    });

    // Invoicing for a period inside the active interval [2025-02-01, 2025-03-01)
    const res = await createSubscriptionInvoice(prisma, {
      subscriptionId: testSubscription.id,
      periodStart: '2025-02-01',
      periodEnd: '2025-03-01',
    });

    if (Number(res.invoice.discountTotal) <= 0) {
      throw new Error('Expected historical discount to be applied, but discountTotal was 0');
    }
    const redemptions = await prisma.discountRedemption.findMany({ where: { invoiceId: res.invoice.id } });
    const applied = redemptions.some(r => r.discountRuleId === historicalRule.id);
    if (!applied) throw new Error('Historical discount was not redeemed on invoice');
  });

  // 15. A rule that became active after the historical period is excluded
  await assertResolves('D3-B: Rule that became active after the historical period is excluded', async () => {
    const futureRule = await prisma.discountRule.create({
      data: {
        name: `Future Active Rule ${runId}`,
        discountType: DiscountType.FIXED,
        value: 100.00,
        currency: 'INR',
        scope: DiscountScope.SUBSCRIPTION,
        isActive: true,
        activities: {
          create: {
            isActive: true,
            effectiveFrom: new Date('2026-05-01T00:00:00.000Z'),
            effectiveUntil: null,
            reason: 'Future promo',
          },
        },
      },
    });

    await prisma.subscriptionDiscount.create({
      data: { subscriptionId: testSubscription.id, discountRuleId: futureRule.id },
    });

    // Invoicing for 2025-03-01 to 2025-04-01 (before futureRule became active)
    const res = await createSubscriptionInvoice(prisma, {
      subscriptionId: testSubscription.id,
      periodStart: '2025-03-01',
      periodEnd: '2025-04-01',
    });

    const redemptions = await prisma.discountRedemption.findMany({ where: { invoiceId: res.invoice.id } });
    if (redemptions.some(r => r.discountRuleId === futureRule.id)) {
      throw new Error('Future active rule was erroneously redeemed for a past period!');
    }
  });

  // 16. A rule deactivated before the historical period is excluded
  await assertResolves('D3-B: Rule deactivated before the historical period is excluded', async () => {
    const pastDeactivatedRule = await prisma.discountRule.create({
      data: {
        name: `Past Deactivated Rule ${runId}`,
        discountType: DiscountType.FIXED,
        value: 100.00,
        currency: 'INR',
        scope: DiscountScope.SUBSCRIPTION,
        isActive: false,
        activities: {
          createMany: {
            data: [
              {
                isActive: true,
                effectiveFrom: new Date('2024-01-01T00:00:00.000Z'),
                effectiveUntil: new Date('2024-12-31T00:00:00.000Z'),
              },
              {
                isActive: false,
                effectiveFrom: new Date('2024-12-31T00:00:00.000Z'),
                effectiveUntil: null,
              },
            ],
          },
        },
      },
    });

    await prisma.subscriptionDiscount.create({
      data: { subscriptionId: testSubscription.id, discountRuleId: pastDeactivatedRule.id },
    });

    // Invoicing for 2025-04-01 to 2025-05-01 (after rule was deactivated)
    const res = await createSubscriptionInvoice(prisma, {
      subscriptionId: testSubscription.id,
      periodStart: '2025-04-01',
      periodEnd: '2025-05-01',
    });

    const redemptions = await prisma.discountRedemption.findMany({ where: { invoiceId: res.invoice.id } });
    if (redemptions.some(r => r.discountRuleId === pastDeactivatedRule.id)) {
      throw new Error('Deactivated rule was erroneously redeemed!');
    }
  });

  // 17. Activity intervals that do not cover the entire billing period are excluded
  await assertResolves('D3-B: Activity intervals that do not cover the entire billing period are excluded', async () => {
    const partialCoverageRule = await prisma.discountRule.create({
      data: {
        name: `Partial Coverage Rule ${runId}`,
        discountType: DiscountType.FIXED,
        value: 100.00,
        currency: 'INR',
        scope: DiscountScope.SUBSCRIPTION,
        isActive: true,
        activities: {
          create: {
            isActive: true,
            effectiveFrom: new Date('2025-05-15T00:00:00.000Z'),
            effectiveUntil: new Date('2025-07-01T00:00:00.000Z'),
          },
        },
      },
    });

    await prisma.subscriptionDiscount.create({
      data: { subscriptionId: testSubscription.id, discountRuleId: partialCoverageRule.id },
    });

    const res = await createSubscriptionInvoice(prisma, {
      subscriptionId: testSubscription.id,
      periodStart: '2025-05-01',
      periodEnd: '2025-06-01',
    });

    const redemptions = await prisma.discountRedemption.findMany({ where: { invoiceId: res.invoice.id } });
    if (redemptions.some(r => r.discountRuleId === partialCoverageRule.id)) {
      throw new Error('Partial coverage discount was erroneously redeemed!');
    }
  });

  // 18. Finite usage limit with concurrent redemption attempts
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
            effectiveFrom: new Date('2026-01-01T00:00:00.000Z'),
            effectiveUntil: null,
          },
        },
      },
    });

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

  // 19. Multiple partial payments allowed atomically
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

  // 20. Overpayment rejection
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

  // 21. Second partial payment settling the exact balance transitions status to PAID
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

  // 22. Idempotent replay: retrying original payment returns stored result even though version has changed
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

  // 23. Conflicting idempotency key reuse with different amount is rejected
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

  // 24. Genuinely concurrent competing payments exceeding balance
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
  console.log(' PART 5: D3-D RECOVERABLE BILLING PROGRESS & CONCURRENCY TESTS');
  console.log('================================================================================');

  let testRun: any = null;
  // 25. Durable BillingRun initialization persists inputs
  await assertResolves('D3-D: Initialize BillingRun with durable inputs before processing begins', async () => {
    testRun = await initializeBillingRun(prisma, {
      asOfDate: '2027-06-01',
      periodLimit: 10,
      subscriptionIdFilter: testSubscription.id,
    });

    if (testRun.status !== 'PENDING') throw new Error(`Expected PENDING status, got ${testRun.status}`);
    if (testRun.periodLimit !== 10) throw new Error(`Expected periodLimit 10, got ${testRun.periodLimit}`);
  });

  // 26. Concurrent execution of the same billing run even with competing allowResume: true
  await assertResolves('D3-D: Prevent concurrent execution of the same billing run even with competing allowResume: true', async () => {
    const concurrentRun = await initializeBillingRun(prisma, {
      asOfDate: '2027-06-01',
      periodLimit: 10,
      subscriptionIdFilter: testSubscription.id,
    });

    const [res1, res2] = await Promise.allSettled([
      executeBillingRun(prisma, concurrentRun.id, { connectionString }),
      executeBillingRun(prisma, concurrentRun.id, { connectionString, allowResume: true }),
    ]);

    const successes = [res1, res2].filter(r => r.status === 'fulfilled');
    const failures = [res1, res2].filter(r => r.status === 'rejected');

    if (successes.length !== 1 || failures.length !== 1) {
      throw new Error(`Expected exactly 1 success and 1 concurrency rejection, got ${successes.length} succ, ${failures.length} fail`);
    }

    const rejection = failures[0] as PromiseRejectedResult;
    if (!rejection.reason?.message?.includes('currently being executed') && !rejection.reason?.message?.includes('RUN_IN_PROGRESS')) {
      throw new Error(`Expected RUN_IN_PROGRESS rejection, got: ${rejection.reason}`);
    }
  });

  // 27. Connection-loss / crash recovery: terminated connection drops session lock and permits subsequent recovery
  await assertResolves('D3-D: Terminated worker connection drops session lock and permits subsequent recovery', async () => {
    const crashTestRun = await initializeBillingRun(prisma, {
      asOfDate: '2027-06-01',
      periodLimit: 10,
      subscriptionIdFilter: testSubscription.id,
    });

    // 1. Simulate worker A opening a dedicated connection and claiming the session lock
    const workerAClient = new pg.Client({ connectionString });
    await workerAClient.connect();

    const lockKey = `billing_run:${crashTestRun.id}`;
    const claimRes = await workerAClient.query<{ acquired: boolean }>(
      'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired',
      [lockKey]
    );
    if (!claimRes.rows[0]?.acquired) {
      await workerAClient.end();
      throw new Error('Worker A failed to acquire initial session lock');
    }

    await prisma.billingRun.update({
      where: { id: crashTestRun.id },
      data: { status: 'IN_PROGRESS', startedAt: new Date() },
    });

    // 2. While Worker A connection is still active, Worker B attempt with allowResume: true MUST FAIL
    let workerBFailedAsExpected = false;
    try {
      await executeBillingRun(prisma, crashTestRun.id, { connectionString, allowResume: true });
    } catch (err: any) {
      if (err?.message?.includes('currently being executed') || err?.errorCode === 'RUN_IN_PROGRESS') {
        workerBFailedAsExpected = true;
      }
    }
    if (!workerBFailedAsExpected) {
      await workerAClient.end();
      throw new Error('Worker B was erroneously allowed to execute while Worker A was actively holding the session lock!');
    }

    // 3. Simulate Worker A crashing abruptly by terminating its connection
    await workerAClient.end();

    // 4. Worker B resumes the abandoned run successfully now that the session lock was freed by PostgreSQL
    const recoveredResult = await executeBillingRun(prisma, crashTestRun.id, { connectionString, allowResume: true });
    if (recoveredResult.run.status !== 'COMPLETED') {
      throw new Error(`Expected recovered run to complete, got status ${recoveredResult.run.status}`);
    }
  });

  // 28. Historical pause interval skipping via SubscriptionPauseInterval
  await assertResolves('D3-D: Historical pause interval skips unbilled period without shifting recurrence anchor', async () => {
    await prisma.subscriptionPauseInterval.create({
      data: {
        subscriptionId: testSubscription.id,
        startDate: new Date('2027-06-01'),
        endDate: new Date('2027-07-01'),
        reason: 'Temporary suspension',
      },
    });

    await prisma.subscription.update({
      where: { id: testSubscription.id },
      data: { nextBillingDate: new Date('2027-06-01') },
    });

    const runResult = await executeBillingRun(prisma, testRun.id);

    const updatedSub = await prisma.subscription.findUniqueOrThrow({ where: { id: testSubscription.id } });
    const nextDateStr = updatedSub.nextBillingDate?.toISOString().split('T')[0];
    if (nextDateStr !== '2027-07-01') {
      throw new Error(`Expected nextBillingDate advanced to 2027-07-01, got ${nextDateStr}`);
    }

    const pausedInv = await prisma.invoice.findFirst({
      where: { subscriptionId: testSubscription.id, periodStart: new Date('2027-06-01') },
    });
    if (pausedInv) throw new Error('Invoice was erroneously created for paused interval!');
  });

  // 29. Simulated crash and durable recovery without double-counting
  await assertResolves('D3-D: Simulated crash and durable recovery correctly updates progress counters without duplicating invoices', async () => {
    const cust = await prisma.customer.findFirstOrThrow();
    const plan = await prisma.plan.findFirstOrThrow();
    const prod = await prisma.product.findFirstOrThrow();

    const subA = await prisma.subscription.create({
      data: {
        number: `SUB-RECOVER-A-${runId}`,
        customerId: cust.id,
        planId: plan.id,
        status: 'ACTIVE',
        billingInterval: BillingInterval.MONTHLY,
        startDate: new Date('2027-08-01T00:00:00.000Z'),
        nextBillingDate: new Date('2027-08-01T00:00:00.000Z'),
        lines: {
          create: {
            productId: prod.id,
            description: 'Recovery Test Item A',
            quantity: 1,
            unitPrice: 100.00,
          },
        },
      },
    });

    const subB = await prisma.subscription.create({
      data: {
        number: `SUB-RECOVER-B-${runId}`,
        customerId: cust.id,
        planId: plan.id,
        status: 'ACTIVE',
        billingInterval: BillingInterval.MONTHLY,
        startDate: new Date('2027-08-01T00:00:00.000Z'),
        nextBillingDate: new Date('2027-08-01T00:00:00.000Z'),
        lines: {
          create: {
            productId: prod.id,
            description: 'Recovery Test Item B',
            quantity: 1,
            unitPrice: 100.00,
          },
        },
      },
    });

    // Initialize run with periodLimit: 1 to simulate batch stopping after 1 subscription
    const crashRun = await initializeBillingRun(prisma, {
      asOfDate: '2027-08-01',
      periodLimit: 1,
    });

    const batch1 = await executeBillingRun(prisma, crashRun.id);
    if (batch1.processedCount !== 1) throw new Error(`Expected batch1 processedCount 1, got ${batch1.processedCount}`);
    if (!batch1.hasMore) throw new Error('Expected hasMore true after partial batch');

    // Resume execution of the run with allowResume: true
    const batch2 = await executeBillingRun(prisma, crashRun.id, { allowResume: true });

    // Verify subA was NOT billed twice
    const subAInvoices = await prisma.invoice.count({ where: { subscriptionId: subA.id } });
    if (subAInvoices > 1) throw new Error(`Subscription A was invoiced ${subAInvoices} times! Expected 1.`);

    // Verify cumulative durable counters
    const finalRun = await prisma.billingRun.findUniqueOrThrow({ where: { id: crashRun.id } });
    if (finalRun.subscriptionsProcessed < 2) {
      throw new Error(`Expected at least 2 processed subscriptions across batches, got ${finalRun.subscriptionsProcessed}`);
    }
  });

  console.log('\n================================================================================');
  console.log(' PART 6: RECURRENCE DATE ARITHMETIC & CALENDAR ANCHOR TESTS');
  console.log('================================================================================');

  // 30. January 31 to February 28 (common year 2026)
  await assertResolves('Calendar: January 31 to February 28 (common year 2026)', async () => {
    const res = computeNextPeriod({ periodStart: '2026-01-31', interval: 'MONTHLY' });
    if (res.periodEndStr !== '2026-02-28') throw new Error(`Expected 2026-02-28, got ${res.periodEndStr}`);
    if (res.anchorDay !== 31) throw new Error(`Expected anchorDay 31, got ${res.anchorDay}`);
  });

  // 31. January 31 to February 29 (leap year 2028)
  await assertResolves('Calendar: January 31 to February 29 (leap year 2028)', async () => {
    const res = computeNextPeriod({ periodStart: '2028-01-31', interval: 'MONTHLY' });
    if (res.periodEndStr !== '2028-02-29') throw new Error(`Expected 2028-02-29, got ${res.periodEndStr}`);
  });

  // 32. August 31 to September 30
  await assertResolves('Calendar: August 31 to September 30', async () => {
    const res = computeNextPeriod({ periodStart: '2026-08-31', interval: 'MONTHLY' });
    if (res.periodEndStr !== '2026-09-30') throw new Error(`Expected 2026-09-30, got ${res.periodEndStr}`);
  });

  // 33. Monthly recurrence across multiple months with anchorDay 31
  await assertResolves('Calendar: Monthly recurrence across multiple months preserves 31st anchor', async () => {
    const p1 = computeNextPeriod({ periodStart: '2026-01-31', interval: 'MONTHLY' }); // -> Feb 28
    const p2 = computeNextPeriod({ periodStart: p1.periodEnd, interval: 'MONTHLY', anchorDay: p1.anchorDay }); // -> Mar 31
    const p3 = computeNextPeriod({ periodStart: p2.periodEnd, interval: 'MONTHLY', anchorDay: p1.anchorDay }); // -> Apr 30
    const p4 = computeNextPeriod({ periodStart: p3.periodEnd, interval: 'MONTHLY', anchorDay: p1.anchorDay }); // -> May 31

    if (p1.periodEndStr !== '2026-02-28') throw new Error(`p1: expected 2026-02-28, got ${p1.periodEndStr}`);
    if (p2.periodEndStr !== '2026-03-31') throw new Error(`p2: expected 2026-03-31, got ${p2.periodEndStr}`);
    if (p3.periodEndStr !== '2026-04-30') throw new Error(`p3: expected 2026-04-30, got ${p3.periodEndStr}`);
    if (p4.periodEndStr !== '2026-05-31') throw new Error(`p4: expected 2026-05-31, got ${p4.periodEndStr}`);
  });

  // 34. Annual recurrence across leap-day boundaries
  await assertResolves('Calendar: Annual recurrence across leap-day boundaries (2024-02-29 -> 2025-02-28 -> 2028-02-29)', async () => {
    const y1 = computeNextPeriod({ periodStart: '2024-02-29', interval: 'YEARLY', anchorDay: 29, anchorMonth: 2 });
    const y2 = computeNextPeriod({ periodStart: y1.periodEnd, interval: 'YEARLY', anchorDay: 29, anchorMonth: 2 });
    const y3 = computeNextPeriod({ periodStart: y2.periodEnd, interval: 'YEARLY', anchorDay: 29, anchorMonth: 2 });
    const y4 = computeNextPeriod({ periodStart: y3.periodEnd, interval: 'YEARLY', anchorDay: 29, anchorMonth: 2 });

    if (y1.periodEndStr !== '2025-02-28') throw new Error(`y1: expected 2025-02-28, got ${y1.periodEndStr}`);
    if (y2.periodEndStr !== '2026-02-28') throw new Error(`y2: expected 2026-02-28, got ${y2.periodEndStr}`);
    if (y3.periodEndStr !== '2027-02-28') throw new Error(`y3: expected 2027-02-28, got ${y3.periodEndStr}`);
    if (y4.periodEndStr !== '2028-02-29') throw new Error(`y4 (leap year): expected 2028-02-29, got ${y4.periodEndStr}`);
  });

  // 35. Continuous and gapless exclusive period-end property
  await assertResolves('Calendar: Continuous and gapless exclusive period-end convention', async () => {
    const start = '2026-03-15';
    const period = computeNextPeriod({ periodStart: start, interval: 'MONTHLY' });
    if (period.periodStart.getTime() >= period.periodEnd.getTime()) {
      throw new Error('periodStart must be strictly before periodEnd');
    }
    const nextPeriod = computeNextPeriod({ periodStart: period.periodEnd, interval: 'MONTHLY', anchorDay: period.anchorDay });
    if (period.periodEndStr !== nextPeriod.periodStartStr) {
      throw new Error(`Gap detected between period 1 end (${period.periodEndStr}) and period 2 start (${nextPeriod.periodStartStr})`);
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
