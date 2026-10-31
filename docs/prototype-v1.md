# Prototype v1: frontend → Express → PostgreSQL

> Current checkout update (31 October 2026): all 68 API operations are integrated. See [the product guide](integrated-product.md) for setup, current behavior and actual checks. Prototype-only status statements below describe earlier increments; deployment and real-email acceptance remain separate checks.

Branch: `feat/prototype-v1`. This preserves the earlier frontend integration work and includes Zenfox's merged Prisma 7 schema/migrations. It does not modify `main` or rewrite migration history.

## Working scope

- Customer registration with password validation and a separate customer profile; no client-supplied role/ownership.
- Login, session restoration, CSRF protection and logout. Opaque session IDs are hashed in PostgreSQL; cookies are HttpOnly/SameSite=Lax and Secure in production. Passwords are salted scrypt hashes.
- Paginated, searchable, filtered subscriptions, invoices and payments. Customers see only owned records; direct access to another customer's invoice/subscription/payment history returns 404.
- Invoice detail and staff/admin payment entry: exact decimals, version checks, row locking, atomic balances/status and persistent idempotency responses. Identical retries return the original result even after the invoice becomes paid. Concurrent independent stale-version payments cannot both commit.
- Staff reports/customer portal reports: date-range invoiced/payment totals, current balances/counts, monthly buckets and optional plan filtering. Queries use a consistent database snapshot.
- Frontend connection indicators, registration/login, report filters, paginated lists, invoice detail and payment entry. Financial responses come from PostgreSQL, not fixture JSON. Demo data is explicitly seeded into the database.

The existing illustrative Albin dashboard is preserved behind **View Albin’s design preview**. The default live workspace uses real API requests. Pending subscription/invoice capabilities are false until their handlers exist.

## Start locally

Use Node.js 24 and a dedicated development PostgreSQL database. PostgreSQL 16 is used in CI; local integration was exercised on PostgreSQL 18. Do not point seed or test commands at production.

Backend terminal:

```powershell
cd E:\Desktop\subscription-management-system\backend
npm ci
npm run prisma:generate
# Only if .env does not already exist:
Copy-Item .env.example .env
```

Set `DATABASE_URL` in `backend/.env` to your local database. Keep credentials out of Git. Then:

```powershell
npm run db:deploy
$env:ALLOW_DEV_SEED='true'
npm run prisma:seed
npm run dev
```

The seed refuses production and requires explicit opt-in. Repeated runs preserve existing balances, statuses, passwords and record values. It upgrades only the original synthetic placeholder password hashes. New demo accounts use `DEMO_PASSWORD` if supplied, otherwise the development-only password below. It does not reset an already-changed password.

Frontend terminal:

```powershell
cd E:\Desktop\subscription-management-system\frontend
npm ci
npm run dev
```

Open `http://localhost:5173`. The default proxy targets backend port 3000, preserving cookies and Origin. Backend `FRONTEND_ORIGIN` must match the browser's origin. Vite proxy configuration is development-only; production needs a same-origin reverse proxy.

## Development accounts and demo

Default synthetic password: **`BrightloopDemo!2026`**. These credentials are only for a disposable local demo database.

| Account | Role |
| --- | --- |
| `admin@brightloop.io` | Admin |
| `staff@brightloop.io` | Staff |
| `billing@acmestudio.com` | Customer (Acme) |

1. Sign in as staff. The seeded subscription is `SUB-0001` and invoice `INV-0001`.
2. Select October 1–31, 2026 in Overview (the fixtures use these fixed dates). On a fresh seed, invoiced total is INR 1,180, payments received INR 500, balance INR 680. Current counts/balances use today's Asia/Kolkata business date.
3. Open Invoices → `INV-0001`. Record the outstanding INR `680.00`, with a payment date no later than today. This records a receipt; it does not charge a card or transfer money.
4. The database sets paid/balance zero. The Payments tab and reports show the recorded receipt; reports use the payment date's selected range. Reload to verify persistence.
5. Sign in as the customer: owned records are visible but payment-entry controls are unavailable. Register another customer to verify its lists are empty.

If the seed has already been used, balances may differ. Reseeding deliberately does not erase payments. To repeat the starting demo, use a new dedicated database; do not reset shared data.

Payment recovery metadata (body/key/version) is stored in sessionStorage under user + invoice, without session credentials. Revisiting that invoice in the same browser tab restores an uncertain payment for identical retry. Do not clear recovery storage until you reconcile the result.

## Implemented endpoints

All paths use `/api/v1`:

- GET `/auth/csrf`, `/auth/me`; POST `/auth/register`, `/auth/login`, `/auth/logout`.
- GET `/subscriptions`, `/subscriptions/{id}`.
- GET `/invoices`, `/invoices/{id}`, `/invoices/{id}/payments`; POST `/invoices/{id}/payments`.
- GET `/payments`, `/reports/overview`, `/portal/overview`.

Runtime validation uses the shared OpenAPI schemas for bodies/query fields; frontend types are generated from that same document. Enum casing, decimal strings, response envelopes and role rules are unchanged. The schema/migration files remain Zenfox's baseline. No new migration is required for this slice.

## Verification

```powershell
# backend
npm run check
npm run test:integration
# frontend
npm run check
```

The integration suite requires a local `DATABASE_URL` with schema-creation permission. It creates a randomly named `prototype_test_*` schema, applies all committed migrations, seeds, exercises HTTP against real PostgreSQL, then drops only that test schema. It never clears the public/application schema.

Checks cover response conformance to OpenAPI, auth/CSRF/ownership, reads/report reconciliation, validation, stale versions, final-payment replay after paid status, concurrent independent/identical payments and seed preservation. Frontend checks cover generated types, client errors/cookies/CSRF/idempotency, exact display formatting, recovery metadata, proxy configuration, lint and build. CI runs these alongside Zenfox's database suite.

Visual/browser interaction verification remains blocked by the browser permission gate. Database-backed HTTP tests are not a claim that every rendered browser interaction has been visually tested.

## Remaining work

Catalog CRUD, subscription creation/quotation/confirmation/activation/pause/renewal/close, recurring invoice generation, discount application, invoice confirmation/cancellation/send/PDF remain unimplemented. Vercel setup is prepared but not deployed; Gmail OAuth is not configured. See [authentication setup](authentication-v1.md). Their routes return 501. No automated scheduler is running. This prototype starts with a seeded active subscription and confirmed invoice; it does not yet create the full lifecycle from the UI.

Rate limiting now uses PostgreSQL, with seven-day absolute session limits and authenticated maintenance. See [authentication setup](authentication-v1.md) for delivery/retry configuration. Reports are scoped and consistent, but the thousands-of-subscriptions performance target has not been measured.

## Authentication increment

Six more contract operations now implement password recovery and admin staff management (20 total). See [the detailed checklist](authentication-v1.md) for the additive migration, Gmail setup, Vercel setup and outstanding external checks.
