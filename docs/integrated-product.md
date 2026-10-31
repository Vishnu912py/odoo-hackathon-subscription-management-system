# Integrated Brightloop product — 31 October 2026

This checkout integrates the catalog, subscription lifecycle, billing persistence, invoice actions, payments, reports and customer portal. All **75 OpenAPI operations** have concrete handlers. The earlier prototype documents and dated team checklists describe historical increments; this guide records the current implementation.

Hosted application: https://brightloop-subscriptions-alpha.vercel.app. The database is the free Supabase project `brightloop-subscriptions` in VishnuTeam (Mumbai). Vercel runs the frontend and API; the private `brightloop` schema uses a dedicated server database role and a certificate-verified session pooler. Anonymous/authenticated Supabase API roles have no schema privileges; RLS is enabled without public policies intentionally. Application roles and customer ownership are enforced by Express.

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

Customer records created by staff are billing profiles, not automatically verified login accounts. Staff can send a single-use, 30-minute portal invitation. Acceptance verifies possession of the link and, for an existing account, its password; it refuses staff accounts and customers with another populated billing profile. Customer signup creates its own linked profile; email equality alone never links identities.

Draft subscriptions support editing lines, prices, taxes, terms and dates. Details show paginated lifecycle history, related invoices, payment history and delivery attempts. Lists expose date/status/search filters; reports support plan filtering, including customer-owned plans. Administrators can inspect persisted billing runs and retry failed runs. Staff can retry failed invoice deliveries.

The customer-facing UI omits API/database health badges and permission-inspection labels. Available actions still follow server permissions. Account identity and sign-out remain in the sidebar; billing history expands on demand.

## Worker and delivery operation

- `npm --prefix backend run billing:watch` runs a processing pass every 30 seconds. `billing:run` runs one pass. The root development command includes the watcher.
- A pass creates an automatic run for the business date and picks up newly due subscriptions after an earlier completed pass. It processes up to ten pending/resumable runs. Each batch is bounded by its period limit. Failed subscriptions are excluded from later batches of that same run, allowing it to finish with errors; their due cursor remains recoverable through an explicit retry after repair.
- A run uses a dedicated PostgreSQL connection for its session advisory lock. Use a direct/session-capable database connection; transaction-pooling proxies are unsuitable for that lock.
- Supabase pg_cron calls `GET /api/internal/billing-maintenance` every minute using pg_net. Its bearer secret is stored in Supabase Vault. Successful scheduled HTTP 200 responses were observed. Vercel also invokes auth maintenance daily. The maintenance worker processes billing, invoice delivery and authentication email retries.
- Email requests create durable outbox rows addressed only to the invoice billing-email snapshot. The worker uses configured Gmail transport and retries failures after five minutes. Missing mail configuration returns 503 when queueing; no delivery success is fabricated.
- `sent_at` is recorded after provider acceptance, not queue time. Same-key HTTP retries queue once. Gmail cannot guarantee exactly-once delivery after an ambiguous provider response/process crash, so a rare duplicate delivery remains possible. An intentional resend uses a fresh key.
- Invoice PDFs use PDFKit, preserve decimal strings, paginate line items and enforce ownership. Embedded OFL Noto fonts support Latin, Devanagari, Bengali, Gurmukhi, Gujarati, Oriya, Tamil, Telugu, Kannada and Malayalam; a multilingual invoice was rendered and visually checked. Font licenses are alongside the files in `backend/src/assets/fonts`.
- Existing direct calls to `createSubscriptionInvoice` retain their prior confirmed-invoice default for persistence compatibility. Scheduled/API billing explicitly requests draft invoices.

## Verification recorded

- Backend `npm run check`: Prisma validation/generation, TypeScript, 17 unit/foundation tests and compilation passed.
- PostgreSQL `npm run test:integration`: 21 tests including enclosing tests passed in temporary schemas. Covers auth/ownership, catalog writes, lifecycle policies, payment concurrency, reporting, draft billing, confirm/cancel, PDF access, invitation acceptance, email failure/retry, billing failure/recovery, late activation and idempotency. Normal runs inject transport; real mail is opt-in only.
- Frontend `npm run check`: generated contract types, 33 tests, lint, TypeScript and production build passed.
- Browser acceptance: all 12 V3 checks passed with headless Edge, desktop 1440×1000, customer creation → draft editing → quotation → confirmation → activation → queued billing → worker → invoice confirmation → payment. Persisted invoice was paid with its exact total. No JavaScript page errors. Mobile 390×844 navigation opens/closes and document width stays within the viewport. The backdrop close target is limited to its visible area beside the drawer. PDF and desktop/mobile screenshots were rendered and visually reviewed.
- All 75 shared operations are registered. The Python OpenAPI validator passed: 75 operations, 111 schemas, 10 valid examples and 8 rejected invalid cases. Response-contract checks and generated frontend types passed.
- Hosted HTTP acceptance passed against persisted Supabase data: authenticated catalog creation → customer → quotation → confirmation → activation → billing → confirmed invoice → exact payment → PDF → report. The synthetic subscription was scheduled to close; its financial records are clearly labelled acceptance tests, not actual revenue.
- Real invitation, invoice and password-reset messages to the authorized inbox were confirmed in Gmail. The invitation was accepted and its customer login returned the owned hosted invoice. Invoice outbox status reached SENT. The administrator password-setup link remains for the owner to use.

### Local page timing sample

The browser test creates 5,000 additional subscriptions and invoices, with copied line, tax and payment records, in the temporary database. This is a list/dashboard rendering workload; detailed accounting reconciliation also uses the integration fixtures.

Environment: Windows, AMD Ryzen AI 5 340, local PostgreSQL, Node.js 24, Vite development server, headless Edge, no CPU/network throttling. Five authenticated in-app navigation samples per page, timed from navigation click until loaded content is rendered. Latest recorded sample before the final documentation pass:

| Page | Samples (ms) | Maximum |
| --- | --- | --- |
| Overview | 522, 272, 310, 385, 332 | 522 ms |
| Subscriptions | 190, 147, 199, 141, 156 | 199 ms |
| Invoices | 264, 110, 106, 143, 147 | 264 ms |

These local samples meet the two-second target for the measured pages. They do not establish cold-load, hosted-network, concurrent-user or production performance.

To repeat the optional rendered suite, start Vite on port 5174 with `BACKEND_PROXY_TARGET=http://127.0.0.1:3001`. From `backend`, set `BROWSER_ORIGIN=http://localhost:5174` and `E2E_PLAYWRIGHT_MODULE` to an installed Playwright package path, then run `node node_modules/tsx/dist/cli.mjs --test test/integration/v3.test.ts`. Edge must be installed. The suite serves the isolated test API on 3001 and writes ignored screenshots/timings under `tmp/`, then removes its test schema. Normal integration runs do not require Playwright.

## Deployment and operational notes

`vercel.json` uses Vercel Services with a root backend entrypoint. Its build command runs typechecking so Vercel packages source and traces dependencies instead of treating standalone `dist` as a dependency-complete bundle. `prepare_build.mjs` generates the runtime OpenAPI module and copies runtime assets for local compiled builds. Supabase CA certificates remain verified. Services is a Vercel beta capability.

Payment recording is an accounting workflow; this product does not charge cards or connect a payment gateway. Hosted concurrent-load/cold-start performance has not been benchmarked. Free-tier service limits still apply. No paid plan was enabled. The owner sets their administrator password through the delivered reset email; expired links can be requested using Forgot password.
