# Brightloop backend

Express + TypeScript server foundation with PostgreSQL through Prisma ORM and Prisma Migrate. This package is independent of the future frontend package.

## Implemented now

- Validated environment configuration and one Prisma connection pool per process.
- `GET /health/live`: process liveness, HTTP 200 without a database.
- `GET /health/ready`: PostgreSQL `SELECT 1`, HTTP 200 when connected or 503 when unavailable/unconfigured. This checks connectivity only, not migrations or business-feature readiness.
- `GET /api/v1/openapi.json`: shared contract in development/test; disabled in production.
- Exact-origin credentialed CORS, security headers, bounded JSON parsing, request IDs and sanitized error envelopes.
- Graceful SIGINT/SIGTERM shutdown and tests for foundation behavior.
- Module routing aligned to all 68 shared contract operations. **Each business operation currently returns HTTP 501 `NOT_IMPLEMENTED`.** There is no authentication, CRUD, billing, payment processing or background worker yet, and no fake successful responses.
- Domain schema, reviewed PostgreSQL migrations, idempotent synthetic seeds and constraint integration tests implemented in `backend/prisma` and `backend/scripts` by Zenfox-690.

## Local setup

Prerequisites: **Node.js 24.x**, npm, and PostgreSQL for database-backed work. The server's liveness endpoint and HTTP tests work without a database. Use the lockfile so every teammate installs the same package versions.

From the repository root:

```powershell
cd backend
npm ci
npm run prisma:generate
Copy-Item .env.example .env
```

Edit `.env`: set `DATABASE_URL` to your own development PostgreSQL database. If you only want to test the HTTP foundation, leave that variable unset/remove its example line; readiness will return 503. The example connection is not a provisioned database and its credentials are placeholders. Use a separate local database for each developer. `DIRECT_URL`, if set, is used by Prisma migration commands instead of the runtime URL.

```powershell
npm run dev
```

Development defaults: `http://127.0.0.1:3000`, frontend origin `http://localhost:5173`. Run npm commands from `backend` so dotenv loads the intended `.env`. Set `HOST=0.0.0.0` only when container/network access is needed; production proxy trust must be configured for the actual deployment.

```powershell
Invoke-RestMethod http://localhost:3000/health/live
Invoke-RestMethod http://localhost:3000/health/ready
```

The second command returns 503 until PostgreSQL is configured and reachable. No database server is installed or started by npm scripts.

## Folder map

```text
backend/
  src/
    app.ts                  Express app factory; tests inject dependencies
    server.ts               Listen and shut down; loads .env
    config.ts               Parse environment without exposing secrets
    contracts.ts            Read the shared repository OpenAPI file
    http/                   Error envelopes and request context/logging
    db/client.ts            Shared Prisma adapter/pool and health probe
    modules/
      index.ts              Contract-aligned route registration (501 today)
      accounts/             Authentication, staff and customers handoff
      catalog/              Products, plans, templates, taxes, discounts
      subscriptions/        Lifecycle and subscription actions
      billing/              Invoices, payments and scheduled billing
      reporting/            Staff reports and owned customer summaries
    generated/prisma/       Generated Prisma 7 client, ignored by Git
  prisma/
    schema.prisma           Shared schema source (32 domain models)
    migrations/             Committed baseline and custom SQL migrations
      20261031110000_init/              Base table definitions & relations
      20261031110001_constraints.../    PostgreSQL CHECKs & functional indexes
    seed.ts                 100% idempotent synthetic test seed fixtures
  scripts/
    test_db_constraints.ts  Live PostgreSQL constraint & concurrency test suite
    verify_schema_integrity.py Static schema, DDL & ER integrity verifier
  prisma.config.ts          Prisma CLI paths and datasource URL
  test/                     HTTP and configuration tests
  .env.example              Safe variable names and local placeholders
```

## Database commands (Zenfox-690)

```powershell
# 1. Static Validation (No database server required)
npm run prisma:validate
npm run prisma:generate
npm run test:verify
npm run typecheck

# 2. Live Database Operations (Requires running PostgreSQL)
npm run db:deploy        # Apply committed migrations
npm run prisma:seed      # Seed synthetic fixtures (idempotent, repeatable)
npm run test:db          # Run live PostgreSQL constraint test suite
```

## Key data integrity guarantees

1. **Email Case-Insensitivity:** Functional index `users_email_lower_idx` (`CREATE UNIQUE INDEX users_email_lower_idx ON users (LOWER(email));`). Rejects duplicate emails differing only in casing.
2. **Product Variant Ownership:** `product_variants` composite unique `(id, product_id)`. Line tables enforce composite FK referencing `(variant_id, product_id)`, preventing cross-product variant misassignment.
3. **Exact Decimal Money:** `NUMERIC(18,2)` totals, `NUMERIC(18,4)` unit prices/quantities, and `NUMERIC(7,4)` tax rates. Binary floating-point arithmetic is prohibited.
4. **Table-Level CHECK Constraints:** 13 database-level `CHECK` constraints reject negative prices, zero quantities, percentage discounts > 100%, and inverted dates.
5. **Billing-Period Uniqueness:** `UNIQUE (subscription_id, period_start)` with `period_end > period_start` prevents overlapping or duplicate period generation.
6. **Payment Idempotency:** `payments.idempotency_key` unique constraint rejects duplicate payments.
7. **Discount Usage Protection:** `UNIQUE (discount_rule_id, invoice_id)` on `discount_redemptions` prevents duplicate redemption on the same invoice.
8. **Durable BillingRun & Lifecycle History:** `BillingRun` stores all recovery inputs (`period_limit`, `subscription_id_filter`) and result counters; `SubscriptionPauseInterval` and `DiscountRuleActivity` preserve exact historical lifecycle intervals for catch-up billing.

## Validation and build

```powershell
npm run check
npm run build
npm start
```

`check` validates/generates Prisma, checks TypeScript, runs tests and compiles.

## Next implementation steps

1. Zenfox: domain schema/migrations, session/idempotency/outbox persistence and fixtures (Completed).
2. Vishnu: session auth + CSRF + role/ownership enforcement; registration/login/reset; then one complete subscription path.
3. Albin: shell/forms against contracts, then replace mocks when each backend handler exists.
4. Add real-database integration tests for ownership, migrations, billing concurrency and payment replay before merging those features.
