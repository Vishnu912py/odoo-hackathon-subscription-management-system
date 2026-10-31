import 'dotenv/config';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../src/generated/prisma/client.js';
import { getOverviewReport, type OverviewReportData } from '../src/modules/reporting/report-persistence.js';
import { formatUuid } from './generate_benchmark_data.js';

export interface ScenarioMetric {
  id: string;
  name: string;
  scopeType: 'CUSTOMER' | 'STAFF' | 'PLAN' | 'WHALE';
  filterDescription: string;
  iterations: number[];
  medianMs: number;
  p95Ms: number;
  minMs: number;
  maxMs: number;
  data: OverviewReportData;
  queryPlans?: Array<{
    queryName: string;
    planningTimeMs: number;
    executionTimeMs: number;
    sharedHitBlocks: number;
    sharedReadBlocks: number;
    planSummary: string;
  }>;
}

export interface BenchmarkSuiteResult {
  schema: string;
  timestamp: string;
  datasetStats: {
    totalSubscriptions: number;
    totalInvoices: number;
    totalPayments: number;
  };
  scenarios: ScenarioMetric[];
}

function calculatePercentile(values: number[], percentile: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)]!;
}

export async function runBenchmarkSuite(options?: {
  connectionString?: string;
  schema?: string;
  repetitions?: number;
  explain?: boolean;
  quiet?: boolean;
}): Promise<BenchmarkSuiteResult> {
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

  const repetitions = options?.repetitions ?? 5;
  const explain = options?.explain ?? true;
  const quiet = options?.quiet ?? false;

  // Set search_path in connection for Prisma and pg
  parsedUrl.searchParams.set('schema', targetSchema);
  const dbUrl = parsedUrl.toString();

  const adapter = new PrismaPg({ connectionString: dbUrl }, { schema: targetSchema });
  const prisma = new PrismaClient({ adapter });

  const pgPool = new pg.Pool({ connectionString: dbUrl });
  const pgClient = await pgPool.connect();
  await pgClient.query(`SET search_path TO "${targetSchema}", public`);

  try {
    // 1. Verify Dataset
    const subCountRes = await pgClient.query(`SELECT COUNT(*)::int AS count FROM subscriptions`);
    const invCountRes = await pgClient.query(`SELECT COUNT(*)::int AS count FROM invoices`);
    const payCountRes = await pgClient.query(`SELECT COUNT(*)::int AS count FROM payments`);

    const totalSubs = subCountRes.rows[0]?.count ?? 0;
    const totalInvs = invCountRes.rows[0]?.count ?? 0;
    const totalPays = payCountRes.rows[0]?.count ?? 0;

    if (!quiet) {
      console.log(`================================================================================`);
      console.log(` D5 DATABASE PERFORMANCE BENCHMARK SUITE`);
      console.log(`================================================================================`);
      console.log(` Target Schema:     ${targetSchema}`);
      console.log(` Subscriptions:     ${totalSubs}`);
      console.log(` Invoices:          ${totalInvs}`);
      console.log(` Payments:          ${totalPays}`);
      console.log(` Repetitions:       ${repetitions} iterations per scenario (after 1 warmup)`);
      console.log(`================================================================================\n`);
    }

    // Customer IDs: Cust 1 is Whale, Cust 15 is Standard
    const whaleUserId = formatUuid('user', 11); // Customer 1
    const standardUserId = formatUuid('user', 25); // Customer 15
    const planMonthlyId = formatUuid('plan', 1);

    const asOf = '2026-10-31';

    // 8 Scenarios Defined
    const scenariosDef = [
      {
        id: 'SCENARIO_1',
        name: 'Customer-scoped 1-month report',
        scopeType: 'CUSTOMER' as const,
        filterDescription: 'from=2026-10-01 to=2026-10-31 (Standard Customer)',
        filter: {
          from: '2026-10-01',
          to: '2026-10-31',
          asOf,
          customerUserId: standardUserId,
          subscriptionScope: { customer: { userId: standardUserId } },
        },
      },
      {
        id: 'SCENARIO_2',
        name: 'Customer-scoped 1-year report',
        scopeType: 'CUSTOMER' as const,
        filterDescription: 'from=2026-01-01 to=2026-10-31 (Standard Customer)',
        filter: {
          from: '2026-01-01',
          to: '2026-10-31',
          asOf,
          customerUserId: standardUserId,
          subscriptionScope: { customer: { userId: standardUserId } },
        },
      },
      {
        id: 'SCENARIO_3',
        name: 'Customer-scoped multi-year report',
        scopeType: 'CUSTOMER' as const,
        filterDescription: 'from=2024-01-01 to=2026-10-31 (Standard Customer, 34 months)',
        filter: {
          from: '2024-01-01',
          to: '2026-10-31',
          asOf,
          customerUserId: standardUserId,
          subscriptionScope: { customer: { userId: standardUserId } },
        },
      },
      {
        id: 'SCENARIO_4',
        name: 'Staff-wide 1-month report',
        scopeType: 'STAFF' as const,
        filterDescription: 'from=2026-10-01 to=2026-10-31 (All 10,000 subscriptions)',
        filter: {
          from: '2026-10-01',
          to: '2026-10-31',
          asOf,
          subscriptionScope: {},
        },
      },
      {
        id: 'SCENARIO_5',
        name: 'Staff-wide 1-year report',
        scopeType: 'STAFF' as const,
        filterDescription: 'from=2026-01-01 to=2026-10-31 (All 10,000 subscriptions)',
        filter: {
          from: '2026-01-01',
          to: '2026-10-31',
          asOf,
          subscriptionScope: {},
        },
      },
      {
        id: 'SCENARIO_6',
        name: 'Staff-wide multi-year report',
        scopeType: 'STAFF' as const,
        filterDescription: 'from=2024-01-01 to=2026-10-31 (100,000 invoices across 34 months)',
        filter: {
          from: '2024-01-01',
          to: '2026-10-31',
          asOf,
          subscriptionScope: {},
        },
      },
      {
        id: 'SCENARIO_7',
        name: 'Plan-filtered 1-year report',
        scopeType: 'PLAN' as const,
        filterDescription: 'from=2026-01-01 to=2026-10-31 plan_id=Standard Monthly',
        filter: {
          from: '2026-01-01',
          to: '2026-10-31',
          asOf,
          planId: planMonthlyId,
          subscriptionScope: { planId: planMonthlyId },
        },
      },
      {
        id: 'SCENARIO_8',
        name: 'Enterprise Whale Customer multi-year report',
        scopeType: 'WHALE' as const,
        filterDescription: 'from=2024-01-01 to=2026-10-31 (Whale Customer, 1,500 subs, 15,000+ invs)',
        filter: {
          from: '2024-01-01',
          to: '2026-10-31',
          asOf,
          customerUserId: whaleUserId,
          subscriptionScope: { customer: { userId: whaleUserId } },
        },
      },
    ];

    const results: ScenarioMetric[] = [];

    for (const sc of scenariosDef) {
      if (!quiet) process.stdout.write(`Benchmarking [${sc.id}] ${sc.name}... `);

      // Warmup run
      const warmupReport = await getOverviewReport(prisma, sc.filter);

      // Repetitions
      const times: number[] = [];
      let latestData = warmupReport;

      for (let r = 0; r < repetitions; r++) {
        const start = performance.now();
        latestData = await getOverviewReport(prisma, sc.filter);
        const end = performance.now();
        times.push(end - start);
      }

      const median = calculatePercentile(times, 50);
      const p95 = calculatePercentile(times, 95);
      const min = Math.min(...times);
      const max = Math.max(...times);

      if (!quiet) console.log(`Done. Median: ${median.toFixed(2)}ms | p95: ${p95.toFixed(2)}ms`);

      // Deep Query Plan Profiling via EXPLAIN (ANALYZE, BUFFERS)
      const queryPlans: Array<{
        queryName: string;
        planningTimeMs: number;
        executionTimeMs: number;
        sharedHitBlocks: number;
        sharedReadBlocks: number;
        planSummary: string;
      }> = [];

      if (explain) {
        const parseExplain = (row: any, queryName: string) => {
          if (!row) return;
          const planData = row['QUERY PLAN'] || row['query plan'] || Object.values(row)[0];
          const rawPlan = Array.isArray(planData) ? planData[0] : planData;
          if (rawPlan && rawPlan.Plan) {
            const p = rawPlan.Plan;
            queryPlans.push({
              queryName,
              planningTimeMs: rawPlan['Planning Time'] ?? 0,
              executionTimeMs: rawPlan['Execution Time'] ?? 0,
              sharedHitBlocks: p['Shared Hit Blocks'] ?? 0,
              sharedReadBlocks: p['Shared Read Blocks'] ?? 0,
              planSummary: `${p['Node Type']} (Cost: ${p['Total Cost']}, Rows: ${p['Plan Rows']})`,
            });
          }
        };

        // Query A: Invoices Range Filter
        const invExplainSql = sc.filter.customerUserId
          ? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
             SELECT i.id, i.issue_date, i.total
             FROM invoices i
             JOIN subscriptions s ON i.subscription_id = s.id
             JOIN customers c ON s.customer_id = c.id
             WHERE c.user_id = '${sc.filter.customerUserId}'::uuid
               AND i.status IN ('CONFIRMED', 'PAID')
               AND i.issue_date >= '${sc.filter.from}'::date AND i.issue_date <= '${sc.filter.to}'::date`
          : sc.filter.planId
          ? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
             SELECT i.id, i.issue_date, i.total
             FROM invoices i
             JOIN subscriptions s ON i.subscription_id = s.id
             WHERE s.plan_id = '${sc.filter.planId}'::uuid
               AND i.status IN ('CONFIRMED', 'PAID')
               AND i.issue_date >= '${sc.filter.from}'::date AND i.issue_date <= '${sc.filter.to}'::date`
          : `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
             SELECT i.id, i.issue_date, i.total
             FROM invoices i
             WHERE i.status IN ('CONFIRMED', 'PAID')
               AND i.issue_date >= '${sc.filter.from}'::date AND i.issue_date <= '${sc.filter.to}'::date`;

        try {
          const invRes = await pgClient.query(invExplainSql);
          parseExplain(invRes.rows[0], 'Invoices Range Filter');
        } catch {
          // ignore explain parse error
        }

        // Query B: Payments Range Filter
        const payExplainSql = sc.filter.customerUserId
          ? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
             SELECT p.id, p.payment_date, p.amount
             FROM payments p
             JOIN invoices i ON p.invoice_id = i.id
             JOIN subscriptions s ON i.subscription_id = s.id
             JOIN customers c ON s.customer_id = c.id
             WHERE c.user_id = '${sc.filter.customerUserId}'::uuid
               AND p.payment_date >= '${sc.filter.from}'::date AND p.payment_date <= '${sc.filter.to}'::date`
          : sc.filter.planId
          ? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
             SELECT p.id, p.payment_date, p.amount
             FROM payments p
             JOIN invoices i ON p.invoice_id = i.id
             JOIN subscriptions s ON i.subscription_id = s.id
             WHERE s.plan_id = '${sc.filter.planId}'::uuid
               AND p.payment_date >= '${sc.filter.from}'::date AND p.payment_date <= '${sc.filter.to}'::date`
          : `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
             SELECT p.id, p.payment_date, p.amount
             FROM payments p
             WHERE p.payment_date >= '${sc.filter.from}'::date AND p.payment_date <= '${sc.filter.to}'::date`;

        try {
          const payRes = await pgClient.query(payExplainSql);
          parseExplain(payRes.rows[0], 'Payments Range Filter');
        } catch {
          // ignore explain parse error
        }

        // Query C: Outstanding Invoices Balance
        const outExplainSql = sc.filter.customerUserId
          ? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
             SELECT i.due_date, i.total, i.amount_paid
             FROM invoices i
             JOIN subscriptions s ON i.subscription_id = s.id
             JOIN customers c ON s.customer_id = c.id
             WHERE c.user_id = '${sc.filter.customerUserId}'::uuid
               AND i.status = 'CONFIRMED'`
          : sc.filter.planId
          ? `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
             SELECT i.due_date, i.total, i.amount_paid
             FROM invoices i
             JOIN subscriptions s ON i.subscription_id = s.id
             WHERE s.plan_id = '${sc.filter.planId}'::uuid
               AND i.status = 'CONFIRMED'`
          : `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
             SELECT i.due_date, i.total, i.amount_paid
             FROM invoices i
             WHERE i.status = 'CONFIRMED'`;

        try {
          const outRes = await pgClient.query(outExplainSql);
          parseExplain(outRes.rows[0], 'Outstanding Confirmed Filter');
        } catch {
          // ignore explain parse error
        }
      }

      results.push({
        id: sc.id,
        name: sc.name,
        scopeType: sc.scopeType,
        filterDescription: sc.filterDescription,
        iterations: times,
        medianMs: Math.round(median * 100) / 100,
        p95Ms: Math.round(p95 * 100) / 100,
        minMs: Math.round(min * 100) / 100,
        maxMs: Math.round(max * 100) / 100,
        data: latestData,
        queryPlans,
      });
    }

    if (!quiet) {
      console.log(`\n================================================================================`);
      console.log(` BENCHMARK RESULTS SUMMARY (10,000 SUBSCRIPTIONS, 100,000 INVOICES)`);
      console.log(`================================================================================`);
      console.log(`ID           | Scenario Name                           | Median   | p95      | Min      | Max      | Invoiced Total | Outstanding`);
      console.log(`-------------+-----------------------------------------+----------+----------+----------+----------+----------------+------------`);
      for (const r of results) {
        const idCol = r.id.padEnd(12);
        const nameCol = r.name.slice(0, 39).padEnd(39);
        const medCol = `${r.medianMs.toFixed(2)}ms`.padEnd(8);
        const p95Col = `${r.p95Ms.toFixed(2)}ms`.padEnd(8);
        const minCol = `${r.minMs.toFixed(2)}ms`.padEnd(8);
        const maxCol = `${r.maxMs.toFixed(2)}ms`.padEnd(8);
        const invCol = `INR ${r.data.invoiced_total}`.padEnd(14);
        const outCol = `INR ${r.data.outstanding_balance}`;
        console.log(`${idCol} | ${nameCol} | ${medCol} | ${p95Col} | ${minCol} | ${maxCol} | ${invCol} | ${outCol}`);
      }
      console.log(`================================================================================\n`);

      console.log(`================================================================================`);
      console.log(` EXPLAIN (ANALYZE, BUFFERS) QUERY PLAN DETAILS`);
      console.log(`================================================================================`);
      for (const r of results) {
        if (r.queryPlans && r.queryPlans.length > 0) {
          console.log(`--- [${r.id}] ${r.name} ---`);
          for (const qp of r.queryPlans) {
            console.log(`  Query:          ${qp.queryName}`);
            console.log(`  Plan:           ${qp.planSummary}`);
            console.log(`  Planning Time:  ${qp.planningTimeMs.toFixed(3)} ms`);
            console.log(`  Execution Time: ${qp.executionTimeMs.toFixed(3)} ms`);
            console.log(`  Shared Hit:     ${qp.sharedHitBlocks} blocks`);
            console.log(`  Shared Read:    ${qp.sharedReadBlocks} blocks`);
          }
        }
      }
      console.log(`================================================================================\n`);
    }

    return {
      schema: targetSchema,
      timestamp: new Date().toISOString(),
      datasetStats: {
        totalSubscriptions: totalSubs,
        totalInvoices: totalInvs,
        totalPayments: totalPays,
      },
      scenarios: results,
    };
  } finally {
    pgClient.release();
    await pgPool.end();
    await prisma.$disconnect();
  }
}

// Allow CLI execution: tsx scripts/benchmark_reporting.ts
if (process.argv[1] && process.argv[1].endsWith('benchmark_reporting.ts')) {
  runBenchmarkSuite().catch((err) => {
    console.error('[benchmark] Fatal error:', err);
    process.exit(1);
  });
}
