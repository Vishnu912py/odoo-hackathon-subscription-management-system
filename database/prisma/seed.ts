import { PrismaClient, UserRole, BillingInterval, DiscountType, DiscountScope, SubscriptionStatus, InvoiceStatus } from '@prisma/client';

const prisma = new PrismaClient();

// Deterministic synthetic fixture IDs aligned with docs/api-contracts.md and docs/api/examples/
export const FIXTURES = {
  ADMIN_USER_ID: '00000000-0000-4000-8000-000000000001',
  STAFF_USER_ID: '00000000-0000-4000-8000-000000000002',
  CUSTOMER_USER_ID: '00000000-0000-4000-8000-000000000003',
  CUSTOMER_PROFILE_ID: '00000000-0000-4000-8000-000000000010',
  PRODUCT_CORE_ID: '00000000-0000-4000-8000-000000000020',
  PRODUCT_CONNECTOR_ID: '00000000-0000-4000-8000-000000000021',
  VARIANT_ODOO_ID: '00000000-0000-4000-8000-000000000022',
  PLAN_MONTHLY_ID: '00000000-0000-4000-8000-000000000030',
  PLAN_PRODUCT_CORE_ID: '00000000-0000-4000-8000-000000000031',
  PLAN_PRODUCT_CONNECTOR_ID: '00000000-0000-4000-8000-000000000032',
  PAYMENT_TERM_NET15_ID: '00000000-0000-4000-8000-000000000040',
  PAYMENT_TERM_IMMEDIATE_ID: '00000000-0000-4000-8000-000000000041',
  TAX_GST18_ID: '00000000-0000-4000-8000-000000000050',
  TEMPLATE_ID: '00000000-0000-4000-8000-000000000060',
  TEMPLATE_LINE_CORE_ID: '00000000-0000-4000-8000-000000000061',
  TEMPLATE_LINE_CONNECTOR_ID: '00000000-0000-4000-8000-000000000062',
  DISCOUNT_FIXED_ID: '00000000-0000-4000-8000-000000000070',
  DISCOUNT_PERCENT_ID: '00000000-0000-4000-8000-000000000071',
  SUBSCRIPTION_ID: '00000000-0000-4000-8000-000000000100',
  SUBSCRIPTION_LINE_ID: '00000000-0000-4000-8000-000000000101',
  INVOICE_ID: '00000000-0000-4000-8000-000000000200',
  INVOICE_LINE_ID: '00000000-0000-4000-8000-000000000201',
  INVOICE_LINE_TAX_ID: '00000000-0000-4000-8000-000000000202',
  PAYMENT_ID: '00000000-0000-4000-8000-000000000700',
};

async function main() {
  if (process.env.NODE_ENV === 'production' && !process.env.ALLOW_DEV_SEED) {
    console.error('ERROR: Development seed cannot be executed in production environment!');
    process.exit(1);
  }

  console.log('Seeding Subscription Management System baseline database with idempotent fixtures...');

  // 1. Users (Admin, Staff, Customer)
  const defaultPasswordHash = '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W56SuT86p2oA6nxe';

  const adminUser = await prisma.user.upsert({
    where: { id: FIXTURES.ADMIN_USER_ID },
    update: {
      email: 'admin@brightloop.io',
      role: UserRole.ADMIN,
      displayName: 'System Administrator',
      isActive: true,
    },
    create: {
      id: FIXTURES.ADMIN_USER_ID,
      email: 'admin@brightloop.io',
      passwordHash: defaultPasswordHash,
      role: UserRole.ADMIN,
      displayName: 'System Administrator',
      isActive: true,
    },
  });

  const staffUser = await prisma.user.upsert({
    where: { id: FIXTURES.STAFF_USER_ID },
    update: {
      email: 'staff@brightloop.io',
      role: UserRole.STAFF,
      displayName: 'Billing Operations Staff',
      isActive: true,
    },
    create: {
      id: FIXTURES.STAFF_USER_ID,
      email: 'staff@brightloop.io',
      passwordHash: defaultPasswordHash,
      role: UserRole.STAFF,
      displayName: 'Billing Operations Staff',
      isActive: true,
    },
  });

  const customerUser = await prisma.user.upsert({
    where: { id: FIXTURES.CUSTOMER_USER_ID },
    update: {
      email: 'billing@acmestudio.com',
      role: UserRole.CUSTOMER,
      displayName: 'Acme Studio Accounts',
      isActive: true,
    },
    create: {
      id: FIXTURES.CUSTOMER_USER_ID,
      email: 'billing@acmestudio.com',
      passwordHash: defaultPasswordHash,
      role: UserRole.CUSTOMER,
      displayName: 'Acme Studio Accounts',
      isActive: true,
    },
  });

  // 2. Customer Profile (Acme Studio)
  const customer = await prisma.customer.upsert({
    where: { id: FIXTURES.CUSTOMER_PROFILE_ID },
    update: {
      userId: customerUser.id,
      name: 'Acme Studio Pvt Ltd',
      companyName: 'Acme Studio',
      billingEmail: 'billing@acmestudio.com',
      billingAddress: '101 Tech Park, Indiranagar, Bangalore, KA 560038',
    },
    create: {
      id: FIXTURES.CUSTOMER_PROFILE_ID,
      userId: customerUser.id,
      name: 'Acme Studio Pvt Ltd',
      companyName: 'Acme Studio',
      billingEmail: 'billing@acmestudio.com',
      billingAddress: '101 Tech Park, Indiranagar, Bangalore, KA 560038',
    },
  });

  // 3. Taxes
  const taxGst18 = await prisma.tax.upsert({
    where: { id: FIXTURES.TAX_GST18_ID },
    update: {
      name: 'GST 18%',
      ratePercent: 18.0000,
      isActive: true,
    },
    create: {
      id: FIXTURES.TAX_GST18_ID,
      name: 'GST 18%',
      ratePercent: 18.0000,
      isActive: true,
    },
  });

  // 4. Products & Variants (incorporating R03: variant with +560 adjustment)
  const productCore = await prisma.product.upsert({
    where: { id: FIXTURES.PRODUCT_CORE_ID },
    update: {
      name: 'Brightloop Cloud ERP Standard',
      productType: 'SERVICE',
      salesPrice: 500.0000,
      costPrice: 200.0000,
      notes: 'Standard cloud instance recurring user seat',
      isActive: true,
    },
    create: {
      id: FIXTURES.PRODUCT_CORE_ID,
      name: 'Brightloop Cloud ERP Standard',
      productType: 'SERVICE',
      salesPrice: 500.0000,
      costPrice: 200.0000,
      notes: 'Standard cloud instance recurring user seat',
      isActive: true,
    },
  });

  const productConnector = await prisma.product.upsert({
    where: { id: FIXTURES.PRODUCT_CONNECTOR_ID },
    update: {
      name: 'Odoo Connector Addon',
      productType: 'SERVICE',
      salesPrice: 0.0000,
      costPrice: 150.0000,
      notes: 'Connector addon module for external ERP sync',
      isActive: true,
    },
    create: {
      id: FIXTURES.PRODUCT_CONNECTOR_ID,
      name: 'Odoo Connector Addon',
      productType: 'SERVICE',
      salesPrice: 0.0000,
      costPrice: 150.0000,
      notes: 'Connector addon module for external ERP sync',
      isActive: true,
    },
  });

  const variantOdoo = await prisma.productVariant.upsert({
    where: { id: FIXTURES.VARIANT_ODOO_ID },
    update: {
      productId: productConnector.id,
      name: 'Odoo Enterprise Edition Connector',
      attributes: { brand: 'Odoo', edition: 'Enterprise' },
      priceAdjustment: 560.0000, // Explicit requirement R03
      isActive: true,
    },
    create: {
      id: FIXTURES.VARIANT_ODOO_ID,
      productId: productConnector.id,
      name: 'Odoo Enterprise Edition Connector',
      attributes: { brand: 'Odoo', edition: 'Enterprise' },
      priceAdjustment: 560.0000, // Explicit requirement R03
      isActive: true,
    },
  });

  // Tax assignments
  await prisma.productTax.upsert({
    where: { productId_taxId: { productId: productCore.id, taxId: taxGst18.id } },
    update: {},
    create: { productId: productCore.id, taxId: taxGst18.id },
  });

  await prisma.productTax.upsert({
    where: { productId_taxId: { productId: productConnector.id, taxId: taxGst18.id } },
    update: {},
    create: { productId: productConnector.id, taxId: taxGst18.id },
  });

  // 5. Payment Terms
  const paymentTermNet15 = await prisma.paymentTerm.upsert({
    where: { id: FIXTURES.PAYMENT_TERM_NET15_ID },
    update: {
      name: 'Net 15 Days',
      dueDays: 15,
      isActive: true,
    },
    create: {
      id: FIXTURES.PAYMENT_TERM_NET15_ID,
      name: 'Net 15 Days',
      dueDays: 15,
      isActive: true,
    },
  });

  const paymentTermImmediate = await prisma.paymentTerm.upsert({
    where: { id: FIXTURES.PAYMENT_TERM_IMMEDIATE_ID },
    update: {
      name: 'Due on Receipt (Net 0)',
      dueDays: 0,
      isActive: true,
    },
    create: {
      id: FIXTURES.PAYMENT_TERM_IMMEDIATE_ID,
      name: 'Due on Receipt (Net 0)',
      dueDays: 0,
      isActive: true,
    },
  });

  // 6. Plans & Bundle Pricing (Confirming rule: plans.price == sum(default included lines))
  const monthlyPlan = await prisma.plan.upsert({
    where: { id: FIXTURES.PLAN_MONTHLY_ID },
    update: {
      name: 'Professional Cloud ERP Monthly',
      price: 1000.00,
      currency: 'INR',
      billingInterval: BillingInterval.MONTHLY,
      minimumQuantity: 1.0000,
      availableFrom: new Date('2026-01-01'),
      autoClose: false,
      allowEarlyClose: true,
      allowPause: true,
      allowRenewal: true,
      isActive: true,
    },
    create: {
      id: FIXTURES.PLAN_MONTHLY_ID,
      name: 'Professional Cloud ERP Monthly',
      price: 1000.00,
      currency: 'INR',
      billingInterval: BillingInterval.MONTHLY,
      minimumQuantity: 1.0000,
      availableFrom: new Date('2026-01-01'),
      autoClose: false,
      allowEarlyClose: true,
      allowPause: true,
      allowRenewal: true,
      isActive: true,
    },
  });

  await prisma.planProduct.upsert({
    where: { planId_productId: { planId: monthlyPlan.id, productId: productCore.id } },
    update: {
      defaultQuantity: 2.0000,
      isAddon: false,
      unitPriceOverride: 500.0000,
    },
    create: {
      id: FIXTURES.PLAN_PRODUCT_CORE_ID,
      planId: monthlyPlan.id,
      productId: productCore.id,
      defaultQuantity: 2.0000,
      isAddon: false,
      unitPriceOverride: 500.0000,
    },
  });

  await prisma.planProduct.upsert({
    where: { planId_productId: { planId: monthlyPlan.id, productId: productConnector.id } },
    update: {
      defaultQuantity: 1.0000,
      isAddon: true,
      unitPriceOverride: 0.0000,
    },
    create: {
      id: FIXTURES.PLAN_PRODUCT_CONNECTOR_ID,
      planId: monthlyPlan.id,
      productId: productConnector.id,
      defaultQuantity: 1.0000,
      isAddon: true,
      unitPriceOverride: 0.0000,
    },
  });

  // 7. Quotation Template
  const quoteTemplate = await prisma.quotationTemplate.upsert({
    where: { id: FIXTURES.TEMPLATE_ID },
    update: {
      planId: monthlyPlan.id,
      name: 'Standard ERP Package Template',
      validityDays: 15,
      isActive: true,
    },
    create: {
      id: FIXTURES.TEMPLATE_ID,
      planId: monthlyPlan.id,
      name: 'Standard ERP Package Template',
      validityDays: 15,
      isActive: true,
    },
  });

  await prisma.quotationTemplateLine.upsert({
    where: { id: FIXTURES.TEMPLATE_LINE_CORE_ID },
    update: {
      templateId: quoteTemplate.id,
      productId: productCore.id,
      quantity: 2.0000,
      unitPrice: 500.0000,
    },
    create: {
      id: FIXTURES.TEMPLATE_LINE_CORE_ID,
      templateId: quoteTemplate.id,
      productId: productCore.id,
      quantity: 2.0000,
      unitPrice: 500.0000,
    },
  });

  await prisma.quotationTemplateLine.upsert({
    where: { id: FIXTURES.TEMPLATE_LINE_CONNECTOR_ID },
    update: {
      templateId: quoteTemplate.id,
      productId: productConnector.id,
      variantId: variantOdoo.id,
      quantity: 1.0000,
      unitPrice: 560.0000,
    },
    create: {
      id: FIXTURES.TEMPLATE_LINE_CONNECTOR_ID,
      templateId: quoteTemplate.id,
      productId: productConnector.id,
      variantId: variantOdoo.id,
      quantity: 1.0000,
      unitPrice: 560.0000,
    },
  });

  // 8. Discount Rules
  const fixedDiscount = await prisma.discountRule.upsert({
    where: { id: FIXTURES.DISCOUNT_FIXED_ID },
    update: {
      name: 'Early Adopter ₹200 Off',
      discountType: DiscountType.FIXED,
      value: 200.0000,
      currency: 'INR',
      scope: DiscountScope.SUBSCRIPTION,
      minimumPurchase: 1000.00,
      usageLimit: 50,
      isActive: true,
    },
    create: {
      id: FIXTURES.DISCOUNT_FIXED_ID,
      name: 'Early Adopter ₹200 Off',
      discountType: DiscountType.FIXED,
      value: 200.0000,
      currency: 'INR',
      scope: DiscountScope.SUBSCRIPTION,
      minimumPurchase: 1000.00,
      usageLimit: 50,
      isActive: true,
    },
  });

  const percentageDiscount = await prisma.discountRule.upsert({
    where: { id: FIXTURES.DISCOUNT_PERCENT_ID },
    update: {
      name: 'Connector 10% Discount',
      discountType: DiscountType.PERCENTAGE,
      value: 10.0000,
      scope: DiscountScope.PRODUCT,
      usageLimit: 100,
      isActive: true,
    },
    create: {
      id: FIXTURES.DISCOUNT_PERCENT_ID,
      name: 'Connector 10% Discount',
      discountType: DiscountType.PERCENTAGE,
      value: 10.0000,
      scope: DiscountScope.PRODUCT,
      usageLimit: 100,
      isActive: true,
    },
  });

  await prisma.discountProduct.upsert({
    where: { discountRuleId_productId: { discountRuleId: percentageDiscount.id, productId: productConnector.id } },
    update: {},
    create: { discountRuleId: percentageDiscount.id, productId: productConnector.id },
  });

  // 9. Integration Subscription & Invoice Fixtures (matching docs/api/examples/invoice-partial.json)
  const subscription = await prisma.subscription.upsert({
    where: { id: FIXTURES.SUBSCRIPTION_ID },
    update: {
      number: 'SUB-0001',
      customerId: customer.id,
      planId: monthlyPlan.id,
      paymentTermId: paymentTermNet15.id,
      status: SubscriptionStatus.ACTIVE,
      currency: 'INR',
      billingInterval: BillingInterval.MONTHLY,
      startDate: new Date('2026-10-01'),
      expiryDate: new Date('2027-10-01'),
      nextBillingDate: new Date('2026-11-01'),
    },
    create: {
      id: FIXTURES.SUBSCRIPTION_ID,
      number: 'SUB-0001',
      customerId: customer.id,
      planId: monthlyPlan.id,
      paymentTermId: paymentTermNet15.id,
      status: SubscriptionStatus.ACTIVE,
      currency: 'INR',
      billingInterval: BillingInterval.MONTHLY,
      startDate: new Date('2026-10-01'),
      expiryDate: new Date('2027-10-01'),
      nextBillingDate: new Date('2026-11-01'),
    },
  });

  const subLine = await prisma.subscriptionLine.upsert({
    where: { id: FIXTURES.SUBSCRIPTION_LINE_ID },
    update: {
      subscriptionId: subscription.id,
      productId: productCore.id,
      description: 'Brightloop Cloud ERP Standard',
      quantity: 2.0000,
      unitPrice: 500.0000,
    },
    create: {
      id: FIXTURES.SUBSCRIPTION_LINE_ID,
      subscriptionId: subscription.id,
      productId: productCore.id,
      description: 'Brightloop Cloud ERP Standard',
      quantity: 2.0000,
      unitPrice: 500.0000,
    },
  });

  const invoice = await prisma.invoice.upsert({
    where: { id: FIXTURES.INVOICE_ID },
    update: {
      number: 'INV-0001',
      subscriptionId: subscription.id,
      periodStart: new Date('2026-10-01'),
      periodEnd: new Date('2026-11-01'),
      issueDate: new Date('2026-10-01'),
      dueDate: new Date('2026-10-16'),
      status: InvoiceStatus.CONFIRMED,
      currency: 'INR',
      customerNameSnapshot: customer.name,
      billingEmailSnapshot: customer.billingEmail,
      billingAddressSnapshot: customer.billingAddress,
      subtotal: 1000.00,
      discountTotal: 0.00,
      taxTotal: 180.00,
      total: 1180.00,
      amountPaid: 500.00,
    },
    create: {
      id: FIXTURES.INVOICE_ID,
      number: 'INV-0001',
      subscriptionId: subscription.id,
      periodStart: new Date('2026-10-01'),
      periodEnd: new Date('2026-11-01'),
      issueDate: new Date('2026-10-01'),
      dueDate: new Date('2026-10-16'),
      status: InvoiceStatus.CONFIRMED,
      currency: 'INR',
      customerNameSnapshot: customer.name,
      billingEmailSnapshot: customer.billingEmail,
      billingAddressSnapshot: customer.billingAddress,
      subtotal: 1000.00,
      discountTotal: 0.00,
      taxTotal: 180.00,
      total: 1180.00,
      amountPaid: 500.00,
    },
  });

  const invLine = await prisma.invoiceLine.upsert({
    where: { id: FIXTURES.INVOICE_LINE_ID },
    update: {
      invoiceId: invoice.id,
      subscriptionLineId: subLine.id,
      descriptionSnapshot: subLine.description,
      quantity: 2.0000,
      unitPrice: 500.0000,
      subtotal: 1000.00,
      discountAmount: 0.00,
      taxAmount: 180.00,
      total: 1180.00,
    },
    create: {
      id: FIXTURES.INVOICE_LINE_ID,
      invoiceId: invoice.id,
      subscriptionLineId: subLine.id,
      descriptionSnapshot: subLine.description,
      quantity: 2.0000,
      unitPrice: 500.0000,
      subtotal: 1000.00,
      discountAmount: 0.00,
      taxAmount: 180.00,
      total: 1180.00,
    },
  });

  await prisma.invoiceLineTax.upsert({
    where: { id: FIXTURES.INVOICE_LINE_TAX_ID },
    update: {
      invoiceLineId: invLine.id,
      taxId: taxGst18.id,
      nameSnapshot: taxGst18.name,
      ratePercentSnapshot: taxGst18.ratePercent,
      taxableBase: 1000.00,
      amount: 180.00,
    },
    create: {
      id: FIXTURES.INVOICE_LINE_TAX_ID,
      invoiceLineId: invLine.id,
      taxId: taxGst18.id,
      nameSnapshot: taxGst18.name,
      ratePercentSnapshot: taxGst18.ratePercent,
      taxableBase: 1000.00,
      amount: 180.00,
    },
  });

  await prisma.payment.upsert({
    where: { id: FIXTURES.PAYMENT_ID },
    update: {
      invoiceId: invoice.id,
      recordedById: staffUser.id,
      idempotencyKey: '00000000-0000-4000-8000-000000000700',
      method: 'bank_transfer',
      amount: 500.00,
      paymentDate: new Date('2026-10-15'),
      note: 'Initial partial payment',
    },
    create: {
      id: FIXTURES.PAYMENT_ID,
      invoiceId: invoice.id,
      recordedById: staffUser.id,
      idempotencyKey: '00000000-0000-4000-8000-000000000700',
      method: 'bank_transfer',
      amount: 500.00,
      paymentDate: new Date('2026-10-15'),
      note: 'Initial partial payment',
    },
  });

  console.log('Seed completed successfully (100% idempotent run verified):');
  console.log(`- Admin: ${adminUser.email} [${adminUser.id}]`);
  console.log(`- Staff: ${staffUser.email} [${staffUser.id}]`);
  console.log(`- Customer: ${customer.name} [${customer.id}]`);
  console.log(`- Product Core: ${productCore.name} [${productCore.id}] (₹${productCore.salesPrice})`);
  console.log(`- Product Variant: ${variantOdoo.name} [${variantOdoo.id}] (+₹${variantOdoo.priceAdjustment})`);
  console.log(`- Plan: ${monthlyPlan.name} [${monthlyPlan.id}] (₹${monthlyPlan.price})`);
  console.log(`- Subscription: ${subscription.number} [${subscription.id}]`);
  console.log(`- Invoice: ${invoice.number} [${invoice.id}] (Total: ₹${invoice.total}, Balance Due: ₹680.00)`);
}

main()
  .catch((e) => {
    console.error('Error during database seed execution:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
