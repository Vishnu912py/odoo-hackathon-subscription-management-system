import { Prisma, type PrismaClient, type Invoice, type InvoiceStatus } from '../../generated/prisma/client.js';
import { evaluateAndLockEligibleDiscount, type DiscountableLine } from './discount-persistence.js';

const Decimal = Prisma.Decimal;

export interface CreateInvoiceParams {
  subscriptionId: string;
  periodStart: Date | string;
  periodEnd: Date | string;
  issueDate?: Date | string;
  dueDate?: Date | string;
  invoiceNumber?: string;
  actorUserId?: string | null;
  advanceSchedule?: boolean;
}

export interface CreateInvoiceResult {
  invoice: any;
  isReused: boolean;
  isSkippedPaused?: boolean;
}

export const fullInvoiceInclude = {
  lines: {
    include: {
      taxes: true,
      discounts: true,
    },
  },
  redemptions: {
    include: {
      discountRule: true,
      lineDiscounts: true,
    },
  },
  payments: true,
  subscription: {
    include: {
      customer: true,
      plan: true,
    },
  },
} satisfies Prisma.InvoiceInclude;

/**
 * Transactional Invoice Creation Service
 * 
 * Enforces:
 * 1. Concurrency protection via PostgreSQL transactional advisory lock.
 * 2. Idempotent period identity via UNIQUE (subscription_id, period_start).
 * 3. Historical snapshots (customer profile, line prices, tax rates, discount value).
 * 4. Exact decimal arithmetic with half-up 2-decimal rounding for currency amounts.
 * 5. Pre-tax discount deduction and exclusive additive taxes.
 * 6. Historical pause interval evaluation via SubscriptionPauseInterval.
 */
export async function createSubscriptionInvoice(
  prismaOrTx: PrismaClient | Prisma.TransactionClient,
  params: CreateInvoiceParams
): Promise<CreateInvoiceResult> {
  const {
    subscriptionId,
    periodStart: pStartRaw,
    periodEnd: pEndRaw,
    issueDate: pIssueRaw,
    dueDate: pDueRaw,
    invoiceNumber,
    actorUserId,
    advanceSchedule = false,
  } = params;

  const pStart = new Date(pStartRaw);
  const pEnd = new Date(pEndRaw);

  if (pEnd <= pStart) {
    throw new Error(`Invalid billing period bounds: periodEnd (${pEnd.toISOString()}) must be strictly after periodStart (${pStart.toISOString()}).`);
  }

  const executeInTransaction = async (tx: Prisma.TransactionClient): Promise<CreateInvoiceResult> => {
    // 1. Acquire transaction-scoped advisory lock for this subscription and period
    const lockKey = `sub_inv:${subscriptionId}:${pStart.toISOString().split('T')[0]}`;
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`;

    // 2. Idempotency Check: if invoice already exists for (subscription_id, period_start), return it
    const existing = await tx.invoice.findUnique({
      where: {
        subscriptionId_periodStart: {
          subscriptionId,
          periodStart: pStart,
        },
      },
      include: fullInvoiceInclude,
    });

    if (existing) {
      if (advanceSchedule) {
        const nextDate = new Date(pEnd);
        const subForSched = await tx.subscription.findUnique({
          where: { id: subscriptionId },
          select: { nextBillingDate: true },
        });
        if (subForSched && (!subForSched.nextBillingDate || subForSched.nextBillingDate < nextDate)) {
          await tx.subscription.update({
            where: { id: subscriptionId },
            data: { nextBillingDate: nextDate },
          });
        }
      }
      return { invoice: existing, isReused: true };
    }

    // 3. Fetch Subscription with related models
    const sub = await tx.subscription.findUnique({
      where: { id: subscriptionId },
      include: {
        customer: true,
        plan: {
          include: {
            planProducts: {
              include: { product: true },
            },
          },
        },
        paymentTerm: true,
        lines: {
          include: {
            taxes: {
              include: { tax: true },
            },
          },
        },
        pauseIntervals: true,
      },
    });

    if (!sub) {
      throw new Error(`Subscription ${subscriptionId} not found.`);
    }

    if (sub.status !== 'ACTIVE' && sub.status !== 'CONFIRMED') {
      throw new Error(`Subscription ${subscriptionId} has status ${sub.status}; only ACTIVE or CONFIRMED subscriptions can be billed.`);
    }

    // 4. Check Historical Pause Intervals: skip billing if period start is paused
    const isPausedPeriod = sub.pauseIntervals.some(interval => {
      const startMatch = interval.startDate <= pStart;
      const endMatch = interval.endDate === null || interval.endDate >= pEnd;
      return startMatch && endMatch;
    });

    if (isPausedPeriod) {
      return {
        invoice: null,
        isReused: false,
        isSkippedPaused: true,
      };
    }

    // 5. Build line items and calculate subtotals
    const activeLines = sub.lines.filter(line => {
      const fromMatch = line.effectiveFrom <= pStart;
      const untilMatch = line.effectiveUntil === null || line.effectiveUntil > pStart;
      return fromMatch && untilMatch;
    });

    if (activeLines.length === 0) {
      throw new Error(`Subscription ${subscriptionId} has no active subscription lines for period ${pStart.toISOString()}`);
    }

    const discountableLines: DiscountableLine[] = [];
    let subtotalAcc = new Decimal('0.00');

    for (const line of activeLines) {
      const qty = new Decimal(line.quantity.toString());
      const price = new Decimal(line.unitPrice.toString());
      const lineSubtotal = qty.times(price).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      subtotalAcc = subtotalAcc.plus(lineSubtotal);

      discountableLines.push({
        subscriptionLineId: line.id,
        productId: line.productId,
        quantity: qty,
        unitPrice: price,
        lineSubtotal,
      });
    }

    // 6. Evaluate and lock discounts before calculating taxes (discounts reduce taxable base)
    const discountResult = await evaluateAndLockEligibleDiscount(tx, {
      subscriptionId: sub.id,
      periodStart: pStart,
      periodEnd: pEnd,
      lines: discountableLines,
      subtotal: subtotalAcc,
    });

    const discountTotal = discountResult ? discountResult.discountAmount : new Decimal('0.00');

    // 7. Calculate taxes on line level (taxes apply to discounted taxable base, exclusive & additive)
    let taxTotalAcc = new Decimal('0.00');
    const preparedLines: Array<{
      line: typeof activeLines[0];
      quantity: Prisma.Decimal;
      unitPrice: Prisma.Decimal;
      subtotal: Prisma.Decimal;
      discountAmount: Prisma.Decimal;
      taxAmount: Prisma.Decimal;
      lineTotal: Prisma.Decimal;
      taxes: Array<{
        taxId: string;
        name: string;
        ratePercent: Prisma.Decimal;
        taxableBase: Prisma.Decimal;
        amount: Prisma.Decimal;
      }>;
    }> = [];

    for (const l of discountableLines) {
      const originalLine = activeLines.find(al => al.id === l.subscriptionLineId)!;
      const lineDiscount = discountResult?.lineAllocations.get(l.subscriptionLineId!) ?? new Decimal('0.00');
      const taxableBase = Decimal.max(new Decimal('0.00'), l.lineSubtotal.minus(lineDiscount));

      let lineTaxAcc = new Decimal('0.00');
      const lineTaxesList: Array<{
        taxId: string;
        name: string;
        ratePercent: Prisma.Decimal;
        taxableBase: Prisma.Decimal;
        amount: Prisma.Decimal;
      }> = [];

      for (const lt of originalLine.taxes) {
        if (!lt.tax.isActive) continue;
        const rate = new Decimal(lt.tax.ratePercent.toString());
        const taxAmount = taxableBase.times(rate.dividedBy(100)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        lineTaxAcc = lineTaxAcc.plus(taxAmount);

        lineTaxesList.push({
          taxId: lt.tax.id,
          name: lt.tax.name,
          ratePercent: rate,
          taxableBase,
          amount: taxAmount,
        });
      }

      const lineTotal = l.lineSubtotal.minus(lineDiscount).plus(lineTaxAcc);
      taxTotalAcc = taxTotalAcc.plus(lineTaxAcc);

      preparedLines.push({
        line: originalLine,
        quantity: l.quantity,
        unitPrice: l.unitPrice,
        subtotal: l.lineSubtotal,
        discountAmount: lineDiscount,
        taxAmount: lineTaxAcc,
        lineTotal,
        taxes: lineTaxesList,
      });
    }

    const total = subtotalAcc.minus(discountTotal).plus(taxTotalAcc);

    // 8. Determine Dates & Invoice Number
    const issueDate = pIssueRaw ? new Date(pIssueRaw) : pStart;
    const dueDays = sub.dueDaysSnapshot ?? sub.paymentTerm?.dueDays ?? 15;
    const dueDate = pDueRaw ? new Date(pDueRaw) : new Date(issueDate.getTime() + dueDays * 86_400_000);

    const generatedNumber = invoiceNumber || `INV-${Date.now().toString().slice(-7)}-${Math.floor(Math.random() * 900 + 100)}`;

    // 9. Snapshot customer details
    const customerNameSnapshot = sub.customer.name;
    const billingEmailSnapshot = sub.customer.billingEmail;
    const billingAddressSnapshot = sub.customer.billingAddress;

    // 10. Persist Invoice atomically
    const createdInvoice = await tx.invoice.create({
      data: {
        subscriptionId: sub.id,
        number: generatedNumber,
        periodStart: pStart,
        periodEnd: pEnd,
        issueDate,
        dueDate,
        status: 'CONFIRMED',
        currency: sub.currency,
        customerNameSnapshot,
        billingEmailSnapshot,
        billingAddressSnapshot,
        subtotal: subtotalAcc,
        discountTotal,
        taxTotal: taxTotalAcc,
        total,
        amountPaid: new Decimal('0.00'),
      },
    });

    // 11. Persist Invoice Lines and Taxes
    for (const pl of preparedLines) {
      const invLine = await tx.invoiceLine.create({
        data: {
          invoiceId: createdInvoice.id,
          subscriptionLineId: pl.line.id,
          descriptionSnapshot: pl.line.description,
          quantity: pl.quantity,
          unitPrice: pl.unitPrice,
          subtotal: pl.subtotal,
          discountAmount: pl.discountAmount,
          taxAmount: pl.taxAmount,
          total: pl.lineTotal,
        },
      });

      for (const t of pl.taxes) {
        await tx.invoiceLineTax.create({
          data: {
            invoiceLineId: invLine.id,
            taxId: t.taxId,
            nameSnapshot: t.name,
            ratePercentSnapshot: t.ratePercent,
            taxableBase: t.taxableBase,
            amount: t.amount,
          },
        });
      }
    }

    // 12. Persist Discount Redemption if applicable
    if (discountResult && discountTotal.gt(0)) {
      const redemption = await tx.discountRedemption.create({
        data: {
          discountRuleId: discountResult.rule.id,
          invoiceId: createdInvoice.id,
          nameSnapshot: discountResult.rule.name,
          typeSnapshot: discountResult.rule.discountType,
          valueSnapshot: discountResult.rule.value,
          amount: discountTotal,
        },
      });

      // Link InvoiceLineDiscounts
      const createdLines = await tx.invoiceLine.findMany({
        where: { invoiceId: createdInvoice.id },
      });

      for (const cl of createdLines) {
        if (cl.discountAmount.gt(0)) {
          await tx.invoiceLineDiscount.create({
            data: {
              redemptionId: redemption.id,
              invoiceLineId: cl.id,
              amount: cl.discountAmount,
            },
          });
        }
      }
    }

    // 13. Advance Next Billing Date if requested
    if (advanceSchedule) {
      const nextDate = new Date(pEnd);
      await tx.subscription.update({
        where: { id: sub.id },
        data: { nextBillingDate: nextDate },
      });
    }

    // Return the freshly created invoice with full relations
    const fullInvoice = await tx.invoice.findUniqueOrThrow({
      where: { id: createdInvoice.id },
      include: fullInvoiceInclude,
    });

    return { invoice: fullInvoice, isReused: false };
  };

  if ('$transaction' in prismaOrTx) {
    return prismaOrTx.$transaction(executeInTransaction, { isolationLevel: 'ReadCommitted' });
  } else {
    return executeInTransaction(prismaOrTx);
  }
}
