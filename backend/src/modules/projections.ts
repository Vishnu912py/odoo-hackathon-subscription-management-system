import { Prisma } from '../generated/prisma/client.js';
Prisma.Decimal.set({ precision: 50, rounding: Prisma.Decimal.ROUND_HALF_UP });
export const Decimal = Prisma.Decimal;
export const day = (value: Date | null) => value?.toISOString().slice(0, 10) ?? null;
export const businessDate = (now = new Date()) => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(now);
const base = (row: { id: string; version: number; createdAt: Date; updatedAt: Date }) => ({
  id: row.id, version: row.version, created_at: row.createdAt.toISOString(), updated_at: row.updatedAt.toISOString(),
});
export const invoiceInclude = { subscription: true } satisfies Prisma.InvoiceInclude;
export type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof invoiceInclude }>;
export function invoiceSummary(row: InvoiceRow, role: string, today: string) {
  const balance = row.status === 'CANCELLED' ? new Decimal(0) : row.total.minus(row.amountPaid);
  return { ...base(row), number: row.number, subscription_id: row.subscriptionId,
    subscription_number: row.subscription.number, customer_id: row.subscription.customerId,
    customer_name: row.customerNameSnapshot, status: row.status.toLowerCase(), currency: row.currency,
    period_start: day(row.periodStart), period_end: day(row.periodEnd), issue_date: day(row.issueDate), due_date: day(row.dueDate),
    subtotal: row.subtotal.toFixed(2), discount_total: row.discountTotal.toFixed(2), tax_total: row.taxTotal.toFixed(2),
    total: row.total.toFixed(2), amount_paid: row.amountPaid.toFixed(2), balance_due: balance.toFixed(2),
    is_overdue: row.status === 'CONFIRMED' && balance.gt(0) && day(row.dueDate)! < today,
    capabilities: { can_confirm: role !== 'CUSTOMER' && row.status === 'DRAFT',
      can_cancel: role !== 'CUSTOMER' && ['DRAFT', 'CONFIRMED'].includes(row.status) && row.amountPaid.isZero(),
      can_send: role !== 'CUSTOMER' && ['CONFIRMED', 'PAID'].includes(row.status), can_print: true,
      can_record_payment: role !== 'CUSTOMER' && row.status === 'CONFIRMED' && balance.gt(0) },
  };
}
export const invoiceDetailInclude = { ...invoiceInclude, lines: { include: {
  taxes: true, discounts: { include: { redemption: true } },
}, orderBy: { id: 'asc' as const } } } satisfies Prisma.InvoiceInclude;
export function invoiceDetail(row: Prisma.InvoiceGetPayload<{ include: typeof invoiceDetailInclude }>, role: string, today: string) {
  return { ...invoiceSummary(row, role, today), billing_email: row.billingEmailSnapshot, billing_address: row.billingAddressSnapshot,
    sent_at: row.sentAt?.toISOString() ?? null, cancelled_at: row.cancelledAt?.toISOString() ?? null,
    lines: row.lines.map(line => ({ id: line.id, subscription_line_id: line.subscriptionLineId,
      description: line.descriptionSnapshot, quantity: line.quantity.toFixed(4), unit_price: line.unitPrice.toFixed(4),
      subtotal: line.subtotal.toFixed(2), discount_amount: line.discountAmount.toFixed(2), tax_amount: line.taxAmount.toFixed(2), total: line.total.toFixed(2),
      taxes: line.taxes.map(tax => ({ tax_id: tax.taxId, name: tax.nameSnapshot, rate_percent: tax.ratePercentSnapshot.toFixed(4),
        taxable_base: tax.taxableBase.toFixed(2), amount: tax.amount.toFixed(2) })),
      discounts: line.discounts.map(d => ({ discount_rule_id: d.redemption.discountRuleId, name: d.redemption.nameSnapshot,
        discount_type: d.redemption.typeSnapshot.toLowerCase(), value: d.redemption.valueSnapshot.toFixed(4), amount: d.amount.toFixed(2) })),
    })),
  };
}
export const paymentInclude = { invoice: { include: invoiceInclude } } satisfies Prisma.PaymentInclude;
export function paymentView(row: Prisma.PaymentGetPayload<{ include: typeof paymentInclude }>) {
  return { id: row.id, invoice_id: row.invoiceId, invoice_number: row.invoice.number, customer_id: row.invoice.subscription.customerId,
    amount: row.amount.toFixed(2), currency: row.invoice.currency, method: row.method, payment_date: day(row.paymentDate),
    note: row.note, recorded_by: row.recordedById, created_at: row.createdAt.toISOString() };
}
export const subscriptionInclude = { customer: true, plan: true, paymentTerm: true,
  lines: { include: { taxes: { include: { tax: true } } }, orderBy: { id: 'asc' as const } } } satisfies Prisma.SubscriptionInclude;
export type SubscriptionRow = Prisma.SubscriptionGetPayload<{ include: typeof subscriptionInclude }>;
function lineView(line: SubscriptionRow['lines'][number]) {
  const subtotal = line.quantity.times(line.unitPrice).toDecimalPlaces(2);
  const taxes = line.taxes.map(({ tax }) => ({ tax_id: tax.id, name: tax.name, rate_percent: tax.ratePercent.toFixed(4),
    amount: subtotal.times(tax.ratePercent).div(100).toDecimalPlaces(2).toFixed(2) }));
  const taxTotal = taxes.reduce((sum, tax) => sum.plus(tax.amount), new Decimal(0));
  return { id: line.id, product_id: line.productId, variant_id: line.variantId, description: line.description,
    quantity: line.quantity.toFixed(4), unit_price: line.unitPrice.toFixed(4), tax_ids: taxes.map(t => t.tax_id),
    effective_from: day(line.effectiveFrom), effective_until: day(line.effectiveUntil), subtotal: subtotal.toFixed(2),
    tax_amount: taxTotal.toFixed(2), total: subtotal.plus(taxTotal).toFixed(2), taxes };
}
export function subscriptionSummary(row: SubscriptionRow, today: string, role = 'CUSTOMER') {
  const effective = row.startDate && day(row.startDate)! > today ? day(row.startDate)! : today;
  const lines = row.lines.filter(line => day(line.effectiveFrom)! <= effective && (!line.effectiveUntil || day(line.effectiveUntil)! > effective)).map(lineView);
  const subtotal = lines.reduce((sum, line) => sum.plus(line.subtotal), new Decimal(0));
  const tax = lines.reduce((sum, line) => sum.plus(line.tax_amount), new Decimal(0));
  const staff = role !== 'CUSTOMER', proposed = row.status === 'DRAFT' || row.status === 'QUOTATION';
  const active = row.status === 'ACTIVE' && !row.closeEffectiveDate;
  const unexpired = !row.expiryDate || day(row.expiryDate)! > today;
  return { ...base(row), number: row.number, customer_id: row.customerId, customer_name: row.customer.name,
    plan_id: row.planId, plan_name: row.plan.name, status: row.status.toLowerCase(), is_paused: row.isPaused,
    currency: proposed ? row.plan.currency : row.currency, billing_interval: (proposed ? row.plan.billingInterval : row.billingInterval).toLowerCase(), start_date: day(row.startDate),
    expiry_date: day(row.expiryDate), next_billing_date: day(row.nextBillingDate), recurring_subtotal: subtotal.toFixed(2),
    estimated_tax_total: tax.toFixed(2), estimated_total: subtotal.plus(tax).toFixed(2),
    pause_effective_date: day(row.pauseEffectiveDate), resume_effective_date: day(row.resumeEffectiveDate), close_effective_date: day(row.closeEffectiveDate),
    capabilities: { can_edit: staff && row.status === 'DRAFT', can_quote: staff && row.status === 'DRAFT' && lines.length > 0,
      can_confirm: staff && row.status === 'QUOTATION' && !!row.quotationValidUntil && day(row.quotationValidUntil)! >= today,
      can_activate: staff && row.status === 'CONFIRMED',
      can_pause: active && unexpired && !row.pauseEffectiveDate && !row.isPaused && (row.allowPauseSnapshot ?? row.plan.allowPause),
      can_resume: active && unexpired && row.isPaused && !row.resumeEffectiveDate && (row.allowPauseSnapshot ?? row.plan.allowPause),
      can_renew: active && !!row.expiryDate && (row.allowRenewalSnapshot ?? row.plan.allowRenewal),
      can_close: active && (row.allowEarlyCloseSnapshot ?? row.plan.allowEarlyClose), can_change_addons: active && unexpired },
  };
}
export function subscriptionDetail(row: SubscriptionRow, today: string, role = 'CUSTOMER') {
  return { ...subscriptionSummary(row, today, role), template_id: row.templateId, payment_term_id: row.paymentTermId,
    payment_term_name: row.paymentTerm?.name, quotation_valid_until: day(row.quotationValidUntil), paused_at: row.pausedAt?.toISOString() ?? null,
    closed_at: row.closedAt?.toISOString() ?? null, payment_due_days: row.dueDaysSnapshot ?? row.paymentTerm?.dueDays,
    policy_snapshot: { auto_close: row.autoCloseSnapshot ?? row.plan.autoClose, allow_early_close: row.allowEarlyCloseSnapshot ?? row.plan.allowEarlyClose,
      allow_pause: row.allowPauseSnapshot ?? row.plan.allowPause, allow_renewal: row.allowRenewalSnapshot ?? row.plan.allowRenewal },
    lines: row.lines.map(lineView) };
}
