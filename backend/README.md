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

The Prisma schema intentionally contains only generator/datasource configuration. Zenfox adds real domain models and migrations here; no dummy tables or initial database migrations have been created. Do not deploy this foundation as a finished application.

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
    generated/prisma/       Generated, ignored by Git
  prisma/
    schema.prisma           Shared schema source for Zenfox
    migrations/             Commit generated and reviewed SQL migrations
  prisma.config.ts          Prisma CLI paths and datasource URL
  test/                     HTTP and configuration tests
  .env.example              Safe variable names and local placeholders
```

As each module is implemented, add `routes.ts`, `service.ts` and persistence helpers where useful, and replace its 501 registration. Mount implemented handlers before remaining placeholders; remove the relevant placeholder when its operation is fully implemented. Do not introduce separate frontend-facing routes or alternate field names outside the shared contract.

## Prisma / migration workflow for Zenfox

Use **Prisma 7** (exact versions are pinned in package.json/lockfile). Its configuration and adapter setup use the Prisma 7 APIs; do not copy newer-major CLI instructions or upgrade only one of Prisma CLI/client/adapter packages independently.

1. Add the agreed models to `backend/prisma/schema.prisma` and review the [ER design](../docs/er-diagram.md) together with [API database additions](../docs/api-contracts.md).
2. Format, validate and regenerate after schema changes:

   ```powershell
   npx prisma format
   npm run prisma:validate
   npm run prisma:generate
   ```

3. On your disposable development database, create an editable migration:

   ```powershell
   npm run db:migrate -- --name foundation --create-only
   ```

4. Add reviewed custom SQL where Prisma cannot express required constraints/indexes (for example `LOWER(email)` uniqueness and CHECK constraints). Do not remove existing migration history.
5. Apply locally with `npm run db:migrate`. Commit schema and migration SQL together. Prisma Migrate development operations can need a separate shadow database/creation privileges; use local development credentials, never a shared production database.
6. Apply reviewed, committed migrations in shared environments using `npm run db:deploy`. Do not use `db push` to bypass migration history. `db:deploy` is not meaningful until the first migration is committed.

This scaffold has not applied migrations or seeded users. Do not treat `/health/ready` success as proof that domain tables exist. Prisma generated files stay untracked and are regenerated on each developer's machine.

## Validation and build

```powershell
npm run check
npm run build
npm start
```

`check` validates/generates Prisma, checks TypeScript, runs tests and compiles. Tests use injected database states; they do not prove a real PostgreSQL connection or database constraints. The production build expects the repository's `docs/api/openapi.json` alongside `backend`; copy it when packaging, not only `backend/dist`.

## Frontend integration

Albin can start by fetching `/health/live` and the local OpenAPI document. For Vite, use a development proxy:

```ts
server: {
  proxy: {
    '/api': 'http://127.0.0.1:3000',
    '/health': 'http://127.0.0.1:3000',
  },
}
```

Use relative URLs and `credentials: 'include'`. The exact allowed origin is configurable with `FRONTEND_ORIGIN`; localhost and 127.0.0.1 are different browser origins. CORS is not authorization. Session/CSRF/role/ownership middleware must be implemented before any data-bearing route goes live. A 501 response means the operation is pending, not a successful integration.

Use [API contracts](../docs/api-contracts.md) and [shared examples](../docs/api/examples/manifest.json) for payloads. Foundation-only responses add `NOT_IMPLEMENTED` (501), `PAYLOAD_TOO_LARGE` (413), and `UNSUPPORTED_MEDIA_TYPE` (415) using the same error envelope. Operational health routes are outside the business API and have their documented status payload.

## Next implementation steps

1. Zenfox: domain schema/migrations, session/idempotency/outbox persistence and fixtures.
2. Vishnu: session auth + CSRF + role/ownership enforcement; registration/login/reset; then one complete subscription path.
3. Albin: shell/forms against contracts, then replace mocks when each backend handler exists.
4. Add real-database integration tests for ownership, migrations, billing concurrency and payment replay before merging those features.

The three findings from PR #2 remain tracked in the review conversation: payment replay must precede mutable status/version checks, cross-record invoice/discount ownership must be enforced, and confirmation-time snapshots must match API behavior. This scaffold does not implement or silently resolve those domain rules.
