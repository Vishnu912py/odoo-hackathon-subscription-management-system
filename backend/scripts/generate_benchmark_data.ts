import 'dotenv/config';
import pg from 'pg';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Deterministic PRNG with fixed seed
export class SeededRandom {
  private s: number;
  constructor(seed: number = 0x42db5eed) {
    this.s = seed;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }
  pick<T>(arr: T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
}

export function formatUuid(prefix: string, index: number): string {
  // Generates valid RFC4122 v4-shaped deterministic UUID: xxxxxxxx-xxxx-4xxx-8xxx-xxxxxxxxxxxx
  const hex = index.toString(16).padStart(12, '0');
  const p = prefix.padEnd(8, '0').slice(0, 8);
  return `${p}-0000-4000-8000-${hex}`;
}

export interface DatasetCounts {
  customers: number;
  plans: number;
  subscriptions: number;
  invoices: number;
  payments: number;
  activeSubscriptions: number;
  pausedSubscriptions: number;
  confirmedInvoices: number;
  paidInvoices: number;
  overdueInvoices: number;
  outstandingBalance: string;
  overdueBalance: string;
}

export async function generateBenchmarkData(options?: {
  connectionString?: string;
  schema?: string;
  targetSubscriptions?: number;
  targetInvoices?: number;
  quiet?: boolean;
}): Promise<DatasetCounts> {
  const connectionString =
    options?.connectionString ||
    process.env.DIRECT_URL ||
    process.env.DATABASE_URL ||
    'postgresql://brightloop:brightloop_test_password@localhost:5432/subscription_management_test?schema=public';

  const parsedUrl = new URL(connectionString);
  const targetSchema =
    options?.schema ||
    process.env.BENCHMARK_SCHEMA ||
    (parsedUrl.searchParams.get('schema') && parsedUrl.searchParams.get('schema') !== 'public'
      ? parsedUrl.searchParams.get('schema')!
      : 'benchmark');

  const targetSubscriptions = options?.targetSubscriptions ?? 10_000;
  const targetInvoices = options?.targetInvoices ?? 100_000;
  const quiet = options?.quiet ?? false;

  const pool = new pg.Pool({ connectionString });
  const client = await pool.connect();

  const rng = new SeededRandom(0x42db5eed);

  try {
    if (!quiet) console.log(`[benchmark-gen] Initializing isolated benchmark schema: "${targetSchema}"...`);

    // 1. Prepare Schema & Apply DDL Migrations
    await client.query(`DROP SCHEMA IF EXISTS "${targetSchema}" CASCADE`);
    await client.query(`CREATE SCHEMA "${targetSchema}"`);
    await client.query(`SET search_path TO "${targetSchema}", public`);

    const migrationsDir = path.resolve(__dirname, '../prisma/migrations');
    const migrationFolders = fs
      .readdirSync(migrationsDir)
      .filter((dir) => fs.statSync(path.join(migrationsDir, dir)).isDirectory())
      .sort();

    for (const folder of migrationFolders) {
      const sqlFile = path.join(migrationsDir, folder, 'migration.sql');
      if (fs.existsSync(sqlFile)) {
        const sql = fs.readFileSync(sqlFile, 'utf-8');
        await client.query(sql);
      }
    }

    // Clean existing data in the benchmark schema to ensure exact deterministic counts
    await client.query(`TRUNCATE TABLE payments, invoices, subscriptions, customers, users, plans CASCADE`);

    if (!quiet) console.log(`[benchmark-gen] Schema ready. Generating deterministic fixtures...`);

    // 2. Generate Admin & Staff Users
    const adminUserId = formatUuid('admin', 1);
    const staffUserId = formatUuid('staff', 2);
    const demoPasswordHash = '$2b$10$EpRnTzVlqHNP0.fUbXUwSOyuiXe/QLSUG6x8ekEY588GIV9863v52'; // BrightloopDemo!2026

    await client.query(`
      INSERT INTO users (id, email, password_hash, role, display_name, is_active, version, created_at, updated_at)
      VALUES 
        ('${adminUserId}', 'admin@brightloop.io', '${demoPasswordHash}', 'ADMIN', 'System Administrator', true, 1, NOW(), NOW()),
        ('${staffUserId}', 'staff@brightloop.io', '${demoPasswordHash}', 'STAFF', 'Billing Specialist', true, 1, NOW(), NOW())
    `);

    // 3. Generate 4 Plans
    const plans = [
      { id: formatUuid('plan', 1), name: 'Standard Monthly', price: '1000.00', interval: 'MONTHLY' },
      { id: formatUuid('plan', 2), name: 'Pro Annual', price: '10000.00', interval: 'YEARLY' },
      { id: formatUuid('plan', 3), name: 'Enterprise Custom', price: '25000.00', interval: 'MONTHLY' },
      { id: formatUuid('plan', 4), name: 'Starter Weekly', price: '300.00', interval: 'WEEKLY' },
    ];

    for (const p of plans) {
      await client.query(`
        INSERT INTO plans (id, name, price, currency, billing_interval, minimum_quantity, auto_close, allow_early_close, allow_pause, allow_renewal, is_active, version, created_at, updated_at)
        VALUES ('${p.id}', '${p.name}', ${p.price}, 'INR', '${p.interval}', 1.0, false, true, true, true, true, 1, NOW(), NOW())
      `);
    }

    // 4. Generate 50 Customers with distinct volume weights:
    // Customer 1: Whale (owns ~15% of subscriptions)
    // Customers 2-10: Large (own ~35% of subscriptions)
    // Customers 11-50: Standard (own ~50% of subscriptions)
    const customerCount = 50;
    const customerIds: string[] = [];
    const customerNames: string[] = [];
    const customerEmails: string[] = [];
    const customerUserIds: string[] = [];

    const userRows: string[] = [];
    const customerRows: string[] = [];

    for (let i = 1; i <= customerCount; i++) {
      const uId = formatUuid('user', i + 10);
      const cId = formatUuid('cust', i);
      const cName = i === 1 ? 'Whale Enterprise Global' : i <= 10 ? `Enterprise Corp ${i}` : `Customer Studio ${i}`;
      const cEmail = `billing@cust${i}.test`;

      customerIds.push(cId);
      customerNames.push(cName);
      customerEmails.push(cEmail);
      customerUserIds.push(uId);

      userRows.push(`('${uId}', '${cEmail}', '${demoPasswordHash}', 'CUSTOMER', '${cName}', true, 1, NOW(), NOW())`);
      customerRows.push(`('${cId}', '${uId}', '${cName}', '${cName}', '${cEmail}', 'Address ${i}', 1, NOW(), NOW())`);
    }

    await client.query(`
      INSERT INTO users (id, email, password_hash, role, display_name, is_active, version, created_at, updated_at)
      VALUES ${userRows.join(',\n')}
    `);

    await client.query(`
      INSERT INTO customers (id, user_id, name, company_name, billing_email, billing_address, version, created_at, updated_at)
      VALUES ${customerRows.join(',\n')}
    `);

    if (!quiet) console.log(`[benchmark-gen] Generated ${customerCount} customers and 4 plans.`);

    // 5. Generate 10,000 Subscriptions
    // Distribution:
    // - Customer 1 (Whale): 1,500 subscriptions
    // - Customers 2-10 (Large): 9 * 388 = 3,492 subscriptions
    // - Customers 11-50 (Standard): 40 * 125 = 5,000 subscriptions
    // Remainder distributed to reach exactly 10,000
    const subscriptionCustMap: number[] = [];
    for (let s = 1; s <= targetSubscriptions; s++) {
      if (s <= 1500) {
        subscriptionCustMap.push(0); // Whale
      } else if (s <= 5000) {
        subscriptionCustMap.push(1 + ((s - 1501) % 9)); // Large (1..9)
      } else {
        subscriptionCustMap.push(10 + ((s - 5001) % 40)); // Standard (10..49)
      }
    }

    const subIds: string[] = [];
    const subPlanMap: number[] = [];
    const subStartDates: string[] = [];

    let activeSubs = 0;
    let pausedSubs = 0;

    const subBatchSize = 2000;
    for (let batch = 0; batch < targetSubscriptions; batch += subBatchSize) {
      const batchValues: string[] = [];
      const end = Math.min(batch + subBatchSize, targetSubscriptions);

      for (let i = batch + 1; i <= end; i++) {
        const subId = formatUuid('sub', i);
        subIds.push(subId);

        const custIdx = subscriptionCustMap[i - 1]!;
        const custId = customerIds[custIdx]!;

        const planIdx = rng.nextInt(0, plans.length - 1);
        subPlanMap.push(planIdx);
        const plan = plans[planIdx]!;

        // Subscription Status distribution:
        // 80% ACTIVE (72% non-paused, 8% paused)
        // 10% EXPIRED
        // 7% CLOSED
        // 3% DRAFT/QUOTATION
        let status = 'ACTIVE';
        let isPaused = false;
        let startDate = '2024-01-01';
        let expiryDate: string | null = null;

        const statusRoll = rng.next();
        if (statusRoll < 0.72) {
          status = 'ACTIVE';
          isPaused = false;
          startDate = `2024-0${rng.nextInt(1, 9)}-01`;
          activeSubs++;
        } else if (statusRoll < 0.80) {
          status = 'ACTIVE';
          isPaused = true;
          startDate = `2024-0${rng.nextInt(1, 9)}-01`;
          pausedSubs++;
        } else if (statusRoll < 0.90) {
          status = 'ACTIVE'; // Expired active contract
          isPaused = false;
          startDate = '2024-01-01';
          expiryDate = '2025-12-31'; // Expired as of 2026-10-31
        } else if (statusRoll < 0.97) {
          status = 'CLOSED';
          isPaused = false;
          startDate = '2024-01-01';
          expiryDate = '2025-06-30';
        } else {
          status = 'DRAFT';
          isPaused = false;
          startDate = '2026-11-01'; // Future start
        }

        subStartDates.push(startDate);
        const expSql = expiryDate ? `'${expiryDate}'` : 'NULL';

        batchValues.push(
          `('${subId}', 'SUB-${String(i).padStart(6, '0')}', '${custId}', '${plan.id}', '${status}', 'INR', '${plan.interval}', '${startDate}', ${expSql}, '${startDate}', ${isPaused}, 1, NOW(), NOW())`
        );
      }

      await client.query(`
        INSERT INTO subscriptions (id, number, customer_id, plan_id, status, currency, billing_interval, start_date, expiry_date, next_billing_date, is_paused, version, created_at, updated_at)
        VALUES ${batchValues.join(',\n')}
      `);
    }

    if (!quiet) console.log(`[benchmark-gen] Generated ${targetSubscriptions} subscriptions (${activeSubs} active, ${pausedSubs} paused).`);

    // 6. Generate 100,000 Invoices & ~80,000 Payments across 34 Months (2024-01-01 to 2026-10-31)
    // Exactly 10 invoices per subscription
    const invoicesPerSub = Math.floor(targetInvoices / targetSubscriptions); // 10
    let totalInvoices = 0;
    let totalPayments = 0;
    let confirmedCount = 0;
    let paidCount = 0;
    let overdueCount = 0;

    let outstandingSum = 0;
    let overdueSum = 0;

    const asOfDate = '2026-10-31';

    // We generate in chunks of 2,500 invoices
    const invChunkSize = 2500;
    let invBatch: string[] = [];
    let payBatch: string[] = [];

    const flushBatches = async () => {
      if (invBatch.length > 0) {
        await client.query(`
          INSERT INTO invoices (id, subscription_id, number, period_start, period_end, issue_date, due_date, status, currency, customer_name_snapshot, billing_email_snapshot, subtotal, discount_total, tax_total, total, amount_paid, version, created_at, updated_at)
          VALUES ${invBatch.join(',\n')}
        `);
        invBatch = [];
      }
      if (payBatch.length > 0) {
        await client.query(`
          INSERT INTO payments (id, invoice_id, recorded_by_id, idempotency_key, method, amount, payment_date, note, created_at)
          VALUES ${payBatch.join(',\n')}
        `);
        payBatch = [];
      }
    };

    let invCounter = 0;
    let payCounter = 0;

    for (let sIdx = 0; sIdx < targetSubscriptions; sIdx++) {
      const subId = subIds[sIdx]!;
      const custIdx = subscriptionCustMap[sIdx]!;
      const cName = customerNames[custIdx]!;
      const cEmail = customerEmails[custIdx]!;
      const planIdx = subPlanMap[sIdx]!;
      const plan = plans[planIdx]!;

      // 10 billing periods: start from 2024-01-01 to 2026-10-01
      // Monthly steps: Year 2024 (months 1..4), Year 2025 (months 1..3), Year 2026 (months 1..3)
      const periodDates = [
        { start: '2024-01-01', end: '2024-02-01', issue: '2024-01-01', due: '2024-01-15' },
        { start: '2024-04-01', end: '2024-05-01', issue: '2024-04-01', due: '2024-04-15' },
        { start: '2024-07-01', end: '2024-08-01', issue: '2024-07-01', due: '2024-07-15' },
        { start: '2024-10-01', end: '2024-11-01', issue: '2024-10-01', due: '2024-10-15' },
        { start: '2025-01-01', end: '2025-02-01', issue: '2025-01-01', due: '2025-01-15' },
        { start: '2025-05-01', end: '2025-06-01', issue: '2025-05-01', due: '2025-05-15' },
        { start: '2025-09-01', end: '2025-10-01', issue: '2025-09-01', due: '2025-09-15' },
        { start: '2026-02-01', end: '2026-03-01', issue: '2026-02-01', due: '2026-02-15' },
        { start: '2026-06-01', end: '2026-07-01', issue: '2026-06-01', due: '2026-06-15' },
        { start: '2026-10-01', end: '2026-11-01', issue: '2026-10-01', due: '2026-10-25' }, // Due before asOfDate
      ];

      for (let pIdx = 0; pIdx < invoicesPerSub; pIdx++) {
        invCounter++;
        totalInvoices++;
        const invId = formatUuid('inv', invCounter);
        const pDate = periodDates[pIdx]!;

        const subtotalNum = parseFloat(plan.price);
        const taxNum = Math.round(subtotalNum * 18) / 100; // 18% GST
        const totalNum = subtotalNum + taxNum;

        const subtotalStr = subtotalNum.toFixed(2);
        const taxStr = taxNum.toFixed(2);
        const totalStr = totalNum.toFixed(2);

        // Status distribution:
        // 75% PAID
        // 20% CONFIRMED (12% overdue due < asOf, 8% current)
        // 4% CANCELLED
        // 1% DRAFT
        const invRoll = rng.next();
        let status = 'PAID';
        let amountPaidNum = totalNum;

        if (invRoll < 0.75) {
          status = 'PAID';
          amountPaidNum = totalNum;
          paidCount++;
        } else if (invRoll < 0.95) {
          status = 'CONFIRMED';
          confirmedCount++;
          // 25% partially paid, 75% unpaid
          const partialRoll = rng.next();
          if (partialRoll < 0.25) {
            amountPaidNum = Math.round(totalNum * 0.4 * 100) / 100; // 40% paid
          } else {
            amountPaidNum = 0.0;
          }

          const bal = totalNum - amountPaidNum;
          outstandingSum += bal;

          if (pDate.due < asOfDate) {
            overdueCount++;
            overdueSum += bal;
          }
        } else if (invRoll < 0.99) {
          status = 'CANCELLED';
          amountPaidNum = 0.0;
        } else {
          status = 'DRAFT';
          amountPaidNum = 0.0;
        }

        const amountPaidStr = amountPaidNum.toFixed(2);

        invBatch.push(
          `('${invId}', '${subId}', 'INV-${String(invCounter).padStart(7, '0')}', '${pDate.start}', '${pDate.end}', '${pDate.issue}', '${pDate.due}', '${status}', 'INR', '${cName}', '${cEmail}', ${subtotalStr}, 0.00, ${taxStr}, ${totalStr}, ${amountPaidStr}, 1, NOW(), NOW())`
        );

        // Create Payment if amount_paid > 0
        if (amountPaidNum > 0) {
          payCounter++;
          totalPayments++;
          const payId = formatUuid('pay', payCounter);
          const payDate = pDate.issue; // recorded around issue date
          const method = payCounter % 3 === 0 ? 'upi' : payCounter % 3 === 1 ? 'bank_transfer' : 'credit_card';

          payBatch.push(
            `('${payId}', '${invId}', '${staffUserId}', 'IDEM-PAY-${payCounter}', '${method}', ${amountPaidStr}, '${payDate}', 'Benchmark payment ${payCounter}', NOW())`
          );
        }

        if (invBatch.length >= invChunkSize) {
          await flushBatches();
          if (!quiet && totalInvoices % 20000 === 0) {
            console.log(`[benchmark-gen] Progress: ${totalInvoices}/${targetInvoices} invoices inserted...`);
          }
        }
      }
    }

    // Flush any remaining
    await flushBatches();

    if (!quiet) console.log(`[benchmark-gen] Running ANALYZE on all tables...`);
    await client.query(`ANALYZE subscriptions, invoices, payments, customers, users, plans`);

    const result: DatasetCounts = {
      customers: customerCount,
      plans: plans.length,
      subscriptions: targetSubscriptions,
      invoices: totalInvoices,
      payments: totalPayments,
      activeSubscriptions: activeSubs,
      pausedSubscriptions: pausedSubs,
      confirmedInvoices: confirmedCount,
      paidInvoices: paidCount,
      overdueInvoices: overdueCount,
      outstandingBalance: outstandingSum.toFixed(2),
      overdueBalance: overdueSum.toFixed(2),
    };

    if (!quiet) {
      console.log(`================================================================================`);
      console.log(` BENCHMARK DATASET GENERATION COMPLETE`);
      console.log(`================================================================================`);
      console.log(` Schema:                 ${targetSchema}`);
      console.log(` Customers:              ${result.customers}`);
      console.log(` Plans:                  ${result.plans}`);
      console.log(` Subscriptions:          ${result.subscriptions} (Active: ${result.activeSubscriptions}, Paused: ${result.pausedSubscriptions})`);
      console.log(` Invoices:               ${result.invoices} (Paid: ${result.paidInvoices}, Confirmed: ${result.confirmedInvoices})`);
      console.log(` Payments:               ${result.payments}`);
      console.log(` Overdue Invoices:       ${result.overdueInvoices}`);
      console.log(` Outstanding Balance:    INR ${result.outstandingBalance}`);
      console.log(` Overdue Balance:        INR ${result.overdueBalance}`);
      console.log(`================================================================================`);
    }

    return result;
  } finally {
    client.release();
    await pool.end();
  }
}

// Allow CLI execution: tsx scripts/generate_benchmark_data.ts
if (process.argv[1] && process.argv[1].endsWith('generate_benchmark_data.ts')) {
  generateBenchmarkData().catch((err) => {
    console.error('[benchmark-gen] Fatal error:', err);
    process.exit(1);
  });
}
