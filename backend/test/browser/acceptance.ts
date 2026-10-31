import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import type { Express } from 'express';
import type { PrismaClient } from '../../src/generated/prisma/client.js';
import type { Config } from '../../src/config.js';
import { processBilling } from '../../src/modules/billing/worker.js';

// Optional rendered acceptance using a caller-provided Playwright installation.
// Invoked only inside the isolated PostgreSQL integration suite.
export async function browserAcceptance(app: Express, prisma: PrismaClient, config: Config) {
  const { chromium } = createRequire(import.meta.url)(process.env.E2E_PLAYWRIGHT_MODULE!);
  const server = app.listen(3001, '127.0.0.1');
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors: string[] = [];
  page.on('pageerror', (error: Error) => errors.push(error.message));
  const output = new URL('../../../tmp/browser/', import.meta.url); mkdirSync(output, { recursive: true });
  try {
    await page.goto(process.env.BROWSER_ORIGIN);
    await page.getByLabel('Email address', { exact: true }).fill('admin@brightloop.io');
    await page.getByLabel('Password', { exact: true }).fill('BrightloopDemo!2026');
    await page.locator('button.auth-submit-btn').click();
    const nav = page.getByRole('navigation', { name: 'Authenticated navigation' });
    await nav.waitFor();
    await nav.getByRole('button', { name: 'Customers', exact: true }).click();
    await page.getByLabel('Name', { exact: true }).fill('Browser acceptance customer');
    await page.getByLabel('Billing email', { exact: true }).fill('browser@example.test');
    await page.getByRole('button', { name: 'Save', exact: true }).click();
    await page.getByText('Saved successfully.', { exact: true }).waitFor();
    await nav.getByRole('button', { name: 'Subscriptions', exact: true }).click();
    await page.getByRole('button', { name: '+ Create Quotation', exact: true }).click();
    await page.getByLabel('Customer', { exact: true }).selectOption({ label: 'Browser acceptance customer' });
    await page.getByLabel('Plan', { exact: true }).selectOption({ label: 'V3 Monthly' });
    await page.getByLabel('Payment term', { exact: true }).selectOption({ label: 'Net 14' });
    await page.locator('input[type=date]').first().fill('2026-10-31');
    await page.locator('input[type=date]').nth(1).fill('2027-10-31');
    await page.getByRole('button', { name: 'Create draft subscription', exact: true }).click();
    await page.getByRole('button', { name: 'Edit draft', exact: true }).click();
    await page.getByPlaceholder('Qty (e.g. 1.0000)').fill('2.0000');
    await page.getByRole('button', { name: 'Save draft changes', exact: true }).click();
    await page.getByRole('heading', { name: 'Edit draft subscription', exact: true }).waitFor({ state: 'hidden' });
    await page.getByRole('button', { name: 'Issue Quotation…', exact: true }).click();
    await page.getByRole('button', { name: 'Submit Quotation', exact: true }).click();
    await page.getByRole('button', { name: 'Confirm Quotation', exact: true }).click();
    await page.getByRole('button', { name: 'Activate Subscription', exact: true }).click();
    await page.getByText('Subscription activated.', { exact: true }).waitFor();
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: new URL('subscription.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
    await nav.getByRole('button', { name: 'Invoices', exact: true }).click();
    await page.getByRole('button', { name: 'Generate due invoices', exact: true }).click();
    await page.getByText(/Billing queued/).waitFor();
    await processBilling(prisma, config, new Date('2026-10-31T12:00:00Z'));
    await page.getByText(/Billing completed/).waitFor();
    const generated = await prisma.invoice.findFirstOrThrow({ where: { subscription: { customer: { name: 'Browser acceptance customer' } } } });
    await page.getByRole('button', { name: generated.number, exact: true }).click();
    await page.getByRole('button', { name: 'Confirm invoice', exact: true }).click();
    await page.getByLabel('Amount (INR, exact decimal)', { exact: true }).fill(generated.total.toFixed(2));
    await page.getByRole('button', { name: 'Record payment', exact: true }).click();
    await page.getByText(/Payment recorded successfully/).waitFor();
    const settled = await prisma.invoice.findUniqueOrThrow({ where: { id: generated.id } });
    if (settled.status !== 'PAID' || !settled.total.equals(settled.amountPaid)) throw new Error('Browser payment did not settle the persisted invoice.');

    const source = await prisma.subscription.findFirstOrThrow({ where: { status: 'ACTIVE' } });
    const sourceInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: settled.id } });
    const sourceLines = await prisma.invoiceLine.findMany({ where: { invoiceId: sourceInvoice.id }, include: { taxes: true } });
    const sourcePayment = await prisma.payment.findFirstOrThrow({ where: { invoiceId: sourceInvoice.id } });
    const line = await prisma.subscriptionLine.findFirstOrThrow({ where: { subscriptionId: source.id } });
    for (let batch = 0; batch < 10; batch++) {
      const subscriptions = Array.from({ length: 500 }, (_, i) => ({ ...source, id: randomUUID(), number: `PERF-SUB-${batch}-${i}`, nextBillingDate: new Date('2027-01-01') }));
      await prisma.subscription.createMany({ data: subscriptions });
      await prisma.subscriptionLine.createMany({ data: subscriptions.map(sub => ({ ...line, id: randomUUID(), logicalLineId: randomUUID(), subscriptionId: sub.id })) });
      const invoices = subscriptions.map((sub, i) => ({ ...sourceInvoice, id: randomUUID(), subscriptionId: sub.id, number: `PERF-INV-${batch}-${i}` }));
      await prisma.invoice.createMany({ data: invoices });
      const invoiceLines = invoices.flatMap(invoice => sourceLines.map(({ taxes, ...sourceLine }) => ({ ...sourceLine, id: randomUUID(), subscriptionLineId: null, invoiceId: invoice.id, taxes })));
      await prisma.invoiceLine.createMany({ data: invoiceLines.map(({ taxes: _taxes, ...item }) => item) });
      await prisma.invoiceLineTax.createMany({ data: invoiceLines.flatMap(item => item.taxes.map(tax => ({ ...tax, id: randomUUID(), invoiceLineId: item.id }))) });
      await prisma.payment.createMany({ data: invoices.map(invoice => ({ ...sourcePayment, id: randomUUID(), invoiceId: invoice.id, idempotencyKey: randomUUID() })) });
    }
    const measurements: Record<string, number[]> = {};
    for (const name of ['Overview', 'Subscriptions', 'Invoices']) {
      measurements[name] = [];
      for (let iteration = 0; iteration < 5; iteration++) {
        await nav.getByRole('button', { name: 'Payments', exact: true }).click();
        await page.locator('.live-records[aria-busy=false]').waitFor();
        const start = performance.now();
        await nav.getByRole('button', { name, exact: true }).click();
        if (name === 'Subscriptions') await page.getByRole('button', { name: 'View Details', exact: true }).first().waitFor();
        else await page.locator('.live-records[aria-busy=false]').waitFor();
        measurements[name]!.push(Math.round(performance.now() - start));
      }
    }
    await page.screenshot({ path: new URL('desktop.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.getByRole('button', { name: 'Open navigation', exact: true }).click();
    await page.getByRole('button', { name: 'Close navigation', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.sidebar')!.getBoundingClientRect().right <= 0);
    if (await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)) throw new Error('Mobile viewport overflows.');
    await page.screenshot({ path: new URL('mobile.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true, animations: 'disabled' });
    writeFileSync(new URL('results.json', output), JSON.stringify({ subscriptions: await prisma.subscription.count(), invoices: await prisma.invoice.count(), measurements, errors }, null, 2));
    if (errors.length) throw new Error(errors.join('\n'));
    console.info('Browser acceptance and timings:', measurements);
  } catch (error) {
    await page.screenshot({ path: new URL('failure.png', output).pathname.replace(/^\/([A-Za-z]:)/, '$1'), fullPage: true });
    console.info((await page.locator('body').innerText()).slice(-5000));
    throw error;
  } finally { await browser.close(); await new Promise<void>(resolve => server.close(() => resolve())); }
}
