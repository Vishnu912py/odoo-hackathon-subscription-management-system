import { PrismaClient, UserRole, BillingInterval, DiscountType, DiscountScope } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seeding Subscription Management System baseline database...');

  // 1. Core Users (Admin, Staff, Customer)
  // Password hash for 'P@ssword123!' (exceeds 8 characters, has uppercase, lowercase, number, special char)
  const defaultPasswordHash = '$2b$10$EixZaYVK1fsbw1ZfbX3OXePaWxn96p36WQmG6W56SuT86p2oA6nxe';

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@brightloop.io' },
    update: {},
    create: {
      email: 'admin@brightloop.io',
      passwordHash: defaultPasswordHash,
      role: UserRole.ADMIN,
      displayName: 'System Administrator',
      isActive: true,
    },
  });

  const staffUser = await prisma.user.upsert({
    where: { email: 'staff@brightloop.io' },
    update: {},
    create: {
      email: 'staff@brightloop.io',
      passwordHash: defaultPasswordHash,
      role: UserRole.STAFF,
      displayName: 'Billing Operations Staff',
      isActive: true,
    },
  });

  const customerUser = await prisma.user.upsert({
    where: { email: 'billing@acmestudio.com' },
    update: {},
    create: {
      email: 'billing@acmestudio.com',
      passwordHash: defaultPasswordHash,
      role: UserRole.CUSTOMER,
      displayName: 'Acme Studio Accounts',
      isActive: true,
    },
  });

  // 2. Customer Profile
  const customer = await prisma.customer.upsert({
    where: { userId: customerUser.id },
    update: {},
    create: {
      userId: customerUser.id,
      name: 'Acme Studio Pvt Ltd',
      companyName: 'Acme Studio',
      billingEmail: 'billing@acmestudio.com',
      billingAddress: '101 Tech Park, Indiranagar, Bangalore, KA 560038',
    },
  });

  // 3. Taxes
  const taxGst18 = await prisma.tax.create({
    data: {
      name: 'GST 18%',
      ratePercent: 18.0000,
      isActive: true,
    },
  });

  // 4. Products & Variants (including +560 variant requirement)
  const productCore = await prisma.product.create({
    data: {
      name: 'Brightloop Cloud ERP Base',
      productType: 'SERVICE',
      salesPrice: 940.0000,
      costPrice: 400.0000,
      notes: 'Core recurring cloud instance access',
      isActive: true,
    },
  });

  const productIntegration = await prisma.product.create({
    data: {
      name: 'Odoo Connector Addon',
      productType: 'SERVICE',
      salesPrice: 0.0000,
      costPrice: 150.0000,
      notes: 'Connector module for external ERP sync',
      isActive: true,
    },
  });

  const variantOdooEnterprise = await prisma.productVariant.create({
    data: {
      productId: productIntegration.id,
      name: 'Odoo Enterprise Connector',
      attributes: { brand: 'Odoo', edition: 'Enterprise' },
      priceAdjustment: 560.0000, // Explicit +560 variant requirement
      isActive: true,
    },
  });

  // Link products with tax
  await prisma.productTax.createMany({
    data: [
      { productId: productCore.id, taxId: taxGst18.id },
      { productId: productIntegration.id, taxId: taxGst18.id },
    ],
  });

  // 5. Payment Terms
  const paymentTermNet15 = await prisma.paymentTerm.create({
    data: {
      name: 'Net 15 Days',
      dueDays: 15,
      isActive: true,
    },
  });

  const paymentTermImmediate = await prisma.paymentTerm.create({
    data: {
      name: 'Immediate (Due on Receipt)',
      dueDays: 0,
      isActive: true,
    },
  });

  // 6. Plans
  const monthlyPlan = await prisma.plan.create({
    data: {
      name: 'Professional Monthly Plan',
      price: 1500.00,
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

  // Included products in plan
  await prisma.planProduct.createMany({
    data: [
      {
        planId: monthlyPlan.id,
        productId: productCore.id,
        defaultQuantity: 1.0000,
        isAddon: false,
        unitPriceOverride: 940.0000,
      },
      {
        planId: monthlyPlan.id,
        productId: productIntegration.id,
        defaultQuantity: 1.0000,
        isAddon: true,
        unitPriceOverride: 0.0000,
      },
    ],
  });

  // 7. Quotation Template
  const quoteTemplate = await prisma.quotationTemplate.create({
    data: {
      planId: monthlyPlan.id,
      name: 'Standard ERP Package Template',
      validityDays: 15,
      isActive: true,
      lines: {
        create: [
          {
            productId: productCore.id,
            quantity: 1.0000,
            unitPrice: 940.0000,
          },
          {
            productId: productIntegration.id,
            variantId: variantOdooEnterprise.id,
            quantity: 1.0000,
            unitPrice: 560.0000,
          },
        ],
      },
    },
  });

  // 8. Discount Rules
  const fixedDiscount = await prisma.discountRule.create({
    data: {
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

  const percentageDiscount = await prisma.discountRule.create({
    data: {
      name: 'Addon 10% Discount',
      discountType: DiscountType.PERCENTAGE,
      value: 10.0000,
      scope: DiscountScope.PRODUCT,
      usageLimit: 100,
      isActive: true,
      discountProducts: {
        create: [
          { productId: productIntegration.id },
        ],
      },
    },
  });

  console.log('Seed completed successfully:');
  console.log(`- Admin User: ${adminUser.email}`);
  console.log(`- Staff User: ${staffUser.email}`);
  console.log(`- Customer: ${customer.name} (${customer.billingEmail})`);
  console.log(`- Plan: ${monthlyPlan.name} (₹${monthlyPlan.price})`);
  console.log(`- Product with Variant: ${productIntegration.name} + ${variantOdooEnterprise.name} (+₹${variantOdooEnterprise.priceAdjustment})`);
  console.log(`- Quotation Template: ${quoteTemplate.name}`);
  console.log(`- Discounts: Fixed ₹${fixedDiscount.value}, Percentage ${percentageDiscount.value}%`);
}

main()
  .catch((e) => {
    console.error('Error during database seed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
