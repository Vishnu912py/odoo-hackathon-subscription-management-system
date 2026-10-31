# Reporting module

Routes: `/reports/overview` and `/portal/overview`.

Current handlers are 501 placeholders in `../index.ts`. Zenfox owns query/index work; Vishnu owns authorization/response projection. Keep period-based invoiced/received totals distinct from current outstanding/overdue balances and active counts. Portal metrics must be scoped to the signed-in customer before aggregation. No manual summary table or sample-data fallback. Implement filtered aggregation and measure query/page performance against the agreed dataset.
