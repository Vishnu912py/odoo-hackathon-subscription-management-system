import { Prisma, type DiscountRule } from '../../generated/prisma/client.js';

const Decimal = Prisma.Decimal;

export interface DiscountableLine {
  subscriptionLineId?: string;
  productId: string;
  quantity: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  lineSubtotal: Prisma.Decimal;
}

export interface EvaluateDiscountInput {
  subscriptionId: string;
  periodStart: Date;
  periodEnd: Date;
  lines: DiscountableLine[];
  subtotal: Prisma.Decimal;
}

export interface EligibleDiscountAllocation {
  rule: DiscountRule;
  discountAmount: Prisma.Decimal;
  lineAllocations: Map<string, Prisma.Decimal>; // key: productId or subscriptionLineId -> discount amount
}

/**
 * Evaluates discount eligibility and calculates the single highest-savings discount.
 * 
 * Rules enforced:
 * 1. Activation and archival history verified via DiscountRuleActivity for the target billing period:
 *    - A rule currently deactivated is eligible if historical activity proves it was active throughout [periodStart, periodEnd).
 *    - A rule that became active after periodStart is excluded.
 *    - A rule deactivated before periodEnd is excluded.
 *    - Rules without activity records fall back to current isActive status.
 * 2. Scope matching (PRODUCT vs SUBSCRIPTION).
 * 3. Minimum purchase and minimum quantity thresholds.
 * 4. Usage limit verification with row-level locking (FOR UPDATE) within the transaction to prevent race conditions.
 * 5. No stacking in v1: select single highest savings; deterministic tie-breaker by rule UUID.
 * 6. Percentage discounts strictly capped at <= 100%.
 */
export async function evaluateAndLockEligibleDiscount(
  tx: Prisma.TransactionClient,
  input: EvaluateDiscountInput
): Promise<EligibleDiscountAllocation | null> {
  const { subscriptionId, periodStart, periodEnd, lines, subtotal } = input;
  const pStart = new Date(periodStart);
  const pEnd = new Date(periodEnd);

  // 1. Fetch potential discount rules linked to this subscription OR in catalog
  const subDiscounts = await tx.subscriptionDiscount.findMany({
    where: { subscriptionId },
    select: { discountRuleId: true },
  });
  const linkedRuleIds = subDiscounts.map(sd => sd.discountRuleId);

  // Notice: Do NOT filter on `isActive: true` here.
  // Historical billing periods evaluate the rule's historical DiscountRuleActivity interval.
  const candidateRules = await tx.discountRule.findMany({
    where: {
      ...(linkedRuleIds.length > 0 ? { id: { in: linkedRuleIds } } : {}),
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: pStart } }] },
        { OR: [{ validUntil: null }, { validUntil: { gte: pEnd } }] },
      ],
    },
    include: {
      discountProducts: true,
      activities: {
        orderBy: { effectiveFrom: 'asc' },
      },
    },
  });

  if (candidateRules.length === 0) {
    return null;
  }

  const eligibleCandidates: Array<{
    rule: DiscountRule;
    savings: Prisma.Decimal;
    lineAllocations: Map<string, Prisma.Decimal>;
  }> = [];

  for (const rule of candidateRules) {
    // 2. Validate historical activity timeline via DiscountRuleActivity
    if (rule.activities.length > 0) {
      // Find an active interval that completely covers [pStart, pEnd)
      const coversEntirePeriod = rule.activities.some(act => {
        if (!act.isActive) return false;
        const startsBeforeOrAt = new Date(act.effectiveFrom) <= pStart;
        const endsAfterOrAt = act.effectiveUntil === null || new Date(act.effectiveUntil) >= pEnd;
        return startsBeforeOrAt && endsAfterOrAt;
      });

      if (!coversEntirePeriod) {
        continue;
      }
    } else {
      // If no activity records exist, fall back to current rule.isActive status
      if (!rule.isActive) {
        continue;
      }
    }

    // 3. Minimum purchase threshold check
    if (rule.minimumPurchase && subtotal.lt(rule.minimumPurchase)) {
      continue;
    }

    // 4. Calculate savings based on scope and discount type
    let totalSavings = new Decimal('0.00');
    const allocations = new Map<string, Prisma.Decimal>();

    if (rule.scope === 'PRODUCT') {
      const applicableProductIds = new Set(rule.discountProducts.map(p => p.productId));
      let minQtySatisfied = rule.minimumQuantity === null;

      for (const line of lines) {
        if (!applicableProductIds.has(line.productId)) continue;

        if (rule.minimumQuantity && line.quantity.gte(rule.minimumQuantity)) {
          minQtySatisfied = true;
        }

        let lineSaving = new Decimal('0.00');
        if (rule.discountType === 'PERCENTAGE') {
          const pct = Decimal.min(rule.value, new Decimal('100.00'));
          lineSaving = line.lineSubtotal.times(pct.dividedBy(100)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        } else {
          lineSaving = Decimal.min(rule.value, line.lineSubtotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
        }

        if (lineSaving.gt(0)) {
          totalSavings = totalSavings.plus(lineSaving);
          const key = line.subscriptionLineId || line.productId;
          allocations.set(key, lineSaving);
        }
      }

      if (!minQtySatisfied || totalSavings.lte(0)) {
        continue;
      }
    } else {
      // SUBSCRIPTION Scope
      if (rule.discountType === 'PERCENTAGE') {
        const pct = Decimal.min(rule.value, new Decimal('100.00'));
        totalSavings = subtotal.times(pct.dividedBy(100)).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      } else {
        totalSavings = Decimal.min(rule.value, subtotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
      }

      if (totalSavings.lte(0)) {
        continue;
      }

      // Distribute proportionally across lines for line item breakdown
      let distributed = new Decimal('0.00');
      lines.forEach((line, index) => {
        const key = line.subscriptionLineId || line.productId;
        if (index === lines.length - 1) {
          allocations.set(key, totalSavings.minus(distributed));
        } else {
          const share = totalSavings.times(line.lineSubtotal).dividedBy(subtotal).toDecimalPlaces(2, Decimal.ROUND_HALF_UP);
          distributed = distributed.plus(share);
          allocations.set(key, share);
        }
      });
    }

    // 5. Concurrency control for usageLimit: acquire row-level lock on DiscountRule
    if (rule.usageLimit !== null && rule.usageLimit !== undefined) {
      await tx.$queryRaw`SELECT "id" FROM "discount_rules" WHERE "id" = ${rule.id}::uuid FOR UPDATE`;

      const usageCount = await tx.discountRedemption.count({
        where: { discountRuleId: rule.id },
      });

      if (usageCount >= rule.usageLimit) {
        continue;
      }
    }

    eligibleCandidates.push({
      rule,
      savings: totalSavings,
      lineAllocations: allocations,
    });
  }

  if (eligibleCandidates.length === 0) {
    return null;
  }

  // 6. Select single highest-value discount; tie-break deterministically by rule UUID
  eligibleCandidates.sort((a, b) => {
    const diff = b.savings.minus(a.savings);
    if (!diff.isZero()) {
      return diff.gt(0) ? 1 : -1;
    }
    return a.rule.id.toLowerCase().localeCompare(b.rule.id.toLowerCase());
  });

  const best = eligibleCandidates[0];
  if (!best || best.savings.lte(0)) {
    return null;
  }

  return {
    rule: best.rule,
    discountAmount: best.savings,
    lineAllocations: best.lineAllocations,
  };
}
