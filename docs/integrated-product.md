# Integrated Brightloop product — 31 October 2026

This checkout integrates the catalog, subscription lifecycle, billing persistence, invoice actions, payments, reports and customer portal. All **68 OpenAPI operations** have concrete handlers. The earlier prototype documents and dated team checklists describe historical increments; this guide records the current local implementation. Deployment and real email acceptance are separate release checks.

## Run the product

Use Node.js 24 and PostgreSQL. Keep the existing `backend/.env`; for a new checkout, copy `backend/.env.example` and configure `DATABASE_URL` and `FRONTEND_ORIGIN=http://localhost:5173`. Never replace an existing environment file with example values.

From the repository root:

```powershell
npm --prefix backend ci
npm --prefix frontend ci
npm --prefix backend run db:deploy
npm --prefix backend run prisma:generate
# Optional, only for a dedicated synthetic demo database:
$env:ALLOW_DEV_SEED='true'
npm --prefix backend run prisma:seed
npm run dev
```

`npm run dev` starts the API, frontend and billing worker together. Open `http://localhost:5173`. Ctrl+C stops the processes. The demo accounts and seed-preservation rules are in [prototype setup](prototype-v1.md). `npm run build` builds both applications; `npm run check` runs both check suites. The illustrative design preview remains available explicitly at `/?preview=design` and is not the default product.

## Main workflow

1. Admin configures taxes, products/variants, plans, payment terms, discounts and quotation templates. Searchable selectors connect related records. A plan's included lines must sum to its advertised base price.
2. Admin/staff creates a customer billing profile, then a draft subscription using a plan or template. Custom lines inherit server catalog prices, variant adjustments and taxes unless explicitly overridden.
3. Issue the quotation, confirm it and activate the subscription. Plan policies govern pause, resume, renewal and closure. Available add-ons can be enabled/disabled from subscription details and take effect at the allowed recurrence boundary.
4. The worker processes due periods automatically. Admin can also choose **Generate due invoices** on Invoices. The UI polls the persisted run. Generated invoices are **draft**, dated to the billed period start, with snapshotted payment deadlines. Confirm an invoice before taking payment; zero-total confirmation marks it paid without a fake receipt.
5. Confirm, cancel, email or print an invoice from its detail view. Cancellation requires a reason and no payments, reserves the period permanently, and does not restore discount usage.
6. Record actual payment receipts. Exact decimal balances, row locks, version preconditions and idempotent replay protect against stale and repeated submissions. Reports reflect persisted invoices and payments. Customers see only their owned records and cannot record payments or run billing.

Customer records created by staff are billing profiles, not automatically verified login accounts. Customer signup creates its own linked profile; the server does not link identities merely because a staff-entered billing email matches a login email.

## Worker and delivery operation

- `npm --prefix backend run billing:watch` runs a processing pass every 30 seconds. `billing:run` runs one pass. The root development command includes the watcher.
- A pass creates one automatic run per business date and processes up to ten pending/resumable runs. Each persistence batch is bounded by its period limit, and further passes continue catch-up. Failed periods retain their due cursor and expose sanitized errors. Investigate repeated failures rather than assuming a running job is complete.
- A run uses a dedicated PostgreSQL connection for its session advisory lock. Use a direct/session-capable database connection; transaction-pooling proxies are unsuitable for that lock.
- Hosted schedulers can call `GET /api/internal/billing-maintenance` with `Authorization: Bearer <CRON_SECRET>`. Schedule repeated passes at a cadence appropriate for volume. The existing auth-maintenance endpoint remains separate. A hosted billing schedule has **not** been enabled by this change.
- Email requests create durable outbox rows addressed only to the invoice billing-email snapshot. The worker uses configured Gmail transport and retries failures after five minutes. Missing mail configuration returns 503 when queueing; no delivery success is fabricated.
- `sent_at` is recorded after provider acceptance, not queue time. Same-key HTTP retries queue once. Gmail cannot guarantee exactly-once delivery after an ambiguous provider response/process crash, so a rare duplicate delivery remains possible. An intentional resend uses a fresh key.
- Invoice PDFs use PDFKit, preserve decimal strings, paginate line items and require the same ownership checks as invoice details. The current standard-font layout targets Latin-script billing data; additional script fonts require embedding and rendering validation.
- Existing direct calls to `createSubscriptionInvoice` retain their prior confirmed-invoice default for persistence compatibility. Scheduled/API billing explicitly requests draft invoices.

## Verification recorded

- Backend `npm run check`: Prisma validation/generation, TypeScript, 17 unit/foundation tests and compilation passed.
- PostgreSQL `npm run test:integration`: 18 tests including enclosing tests passed in temporary schemas. Covers auth/ownership, catalog writes, lifecycle policies, payment concurrency, reporting, draft billing, confirm/cancel, PDF access, email failure/retry and idempotent outbox behavior. External transport is injected; no test invoice email is sent to a real recipient.
- Frontend `npm run check`: generated contract types, 33 tests, lint, TypeScript and production build passed.
- Browser acceptance: headless Edge, desktop 1440×1000, customer creation → draft → quotation → confirmation → activation → queued billing → worker → invoice confirmation → payment. Persisted invoice was paid with its exact total. No JavaScript page errors. Mobile 390×844 navigation opens/closes and document width stays within the viewport. PDF and desktop/mobile screenshots were rendered and visually reviewed.
- All 68 shared operations are registered. No schema/field/role/money-format contract changes were introduced. The standalone Python OpenAPI validator requires `openapi-spec-validator==0.7.2`, absent from the current Python environment; it was not reported as passing. Response-contract checks and generated frontend types passed.

### Local page timing sample

The browser test creates 5,000 additional subscriptions, one line each, and 5,000 invoice summaries in the temporary database, on top of the integration fixtures. Invoice clones intentionally do not include corresponding historical payment/line records, so this is a **list/dashboard rendering workload**, not an accounting reconciliation dataset. Reconciliation uses the separate integration fixtures.

Environment: Windows, AMD Ryzen AI 5 340, local PostgreSQL, Node.js 24, Vite development server, headless Edge, no CPU/network throttling. Five authenticated in-app navigation samples per page, timed from navigation click until loaded content is rendered. Latest recorded sample before the final documentation pass:

| Page | Samples (ms) | Maximum |
| --- | --- | --- |
| Overview | 303, 214, 282, 217, 280 | 303 ms |
| Subscriptions | 153, 145, 136, 153, 141 | 153 ms |
| Invoices | 87, 87, 89, 81, 86 | 89 ms |

These local samples meet the two-second target for the measured pages. They do not establish cold-load, hosted-network, concurrent-user or production performance.

To repeat the optional rendered suite, start Vite on port 5174 with `BACKEND_PROXY_TARGET=http://127.0.0.1:3001`. From `backend`, set `BROWSER_ORIGIN=http://localhost:5174` and `E2E_PLAYWRIGHT_MODULE` to an installed Playwright package path, then run `node node_modules/tsx/dist/cli.mjs --test test/integration/v3.test.ts`. Edge must be installed. The suite serves the isolated test API on 3001 and writes ignored screenshots/timings under `tmp/`, then removes its test schema. Normal integration runs do not require Playwright.

## External release checks

Hosted database provisioning/migrations, secrets, HTTPS deployment, scheduler enablement, real reset/invoice inbox delivery, and production performance acceptance remain to be verified in the target environment. Do not present this local integration as an already deployed service.
