# Odoo Hackathon Subscription Management System

Build a unified platform for Brightloop Software to manage products, recurring plans, quotations, subscriptions, invoices, discounts, payments, and reporting.

## Implementation status

The integrated prototype uses React/TypeScript, Express/TypeScript, PostgreSQL and Prisma 7. On `main`, **20 contract operations** implement authentication, staff management, owned subscription/invoice/payment reads, payment recording and reporting. Zenfox's billing persistence functions are also merged; catalog/lifecycle/billing HTTP orchestration and invoice delivery/printing remain incomplete. See [prototype setup](docs/prototype-v1.md) and [authentication/deployment setup](docs/authentication-v1.md).

This is an integrated prototype, not completion of all R01–R12 requirements. A completed UI or persistence module does not by itself establish a working end-to-end feature.

<a id="foundation-checklist--31-october-2026"></a>

## Team implementation checklist — 31 October 2026

Reviewed against `main` at `8a8536e`, `feat/prototype-v1` at `de91775`, and the D5 branch at `e834a3a`. Checked items record completed implementation; branch-only work is explicitly marked. Shared integration work is credited separately from each collaborator's authored deliverables.

| Location | Available work |
| --- | --- |
| `main` | Backend/database foundations, V1 authentication/integration, Albin's F1 auth UI, Zenfox's D3 persistence and D4 reporting |
| `feat/prototype-v1` | Also contains Albin's F2 catalog and F3 subscription screens from [PR #13](https://github.com/Vishnu912py/odoo-hackathon-subscription-management-system/pull/13); this newer frontend increment is not yet merged into `main` |
| `feat/db-benchmark` | D5 dataset generator and reporting benchmark tooling; not yet merged into `main` or accepted as page-performance evidence |

### Vishnu (`Vishnu912py`) — backend, integration and release

- [x] Confirm the stack, role matrix and billing defaults; prepare requirements, team responsibilities, ER/UI handoffs and shared OpenAPI contracts.
- [x] V1: implement the Express/TypeScript foundation, configuration, Prisma connection pool, health endpoints, CORS/security headers, validation, error envelopes and graceful shutdown ([PR #6](https://github.com/Vishnu912py/odoo-hackathon-subscription-management-system/pull/6)).
- [x] Integrate the frontend and database into an authenticated prototype with real persisted responses, local PostgreSQL setup and repeatable development fixtures.
- [x] V2: implement signup/login/logout, session restoration, password policy, server-side role checks and customer ownership enforcement.
- [x] V2: implement hashed opaque sessions, cookie/CSRF protection, shared PostgreSQL rate limits, idle/absolute expiry and session revocation.
- [x] V2: implement single-use password reset, admin staff invitations and account management, version checks and idempotent staff mutations.
- [x] V2: implement Gmail API transport, encrypted authentication-email queue, delivery leases/retries and maintenance; add the supporting authentication migration.
- [x] Configure Gmail locally and test the real reset endpoint: account creation returned 201, reset request returned 202, and Gmail accepted the email on the first delivery attempt. Inbox arrival and completing the link remain separate checks.
- [x] Implement paginated owned record reads, invoice details/payment history, staff/admin payment recording, exact balances, overpayment rejection and concurrency-safe idempotent replay.
- [x] Implement overview/portal HTTP routes and integrate Zenfox's D4 reporting persistence into those routes.
- [x] Prepare Vercel frontend/API deployment configuration, serverless entrypoint, environment guide and one-time admin bootstrap command.
- [x] Resolve PR #13's workspace conflicts while preserving Albin's F1 authentication layout, F2/F3 screens, role restrictions and subscription-to-invoice navigation.
- [ ] V3: implement catalog HTTP APIs, subscription authoring/transitions, plan policies, add-ons and renewal orchestration.
- [ ] V4: connect D3 persistence to authorized billing HTTP operations and a scheduler; complete invoice confirm/cancel/send/print and full tax/discount workflows.
- [ ] V1/V5 release: configure hosted PostgreSQL and Vercel secrets, deploy, verify HTTPS/browser flows and demonstrate the full create/quote/activate/bill/pay journey.

### Zenfox (`Zenfox-690`) — database and persistence

- [x] D1: design the domain model, relationships, constraints, indexes and synthetic fixtures; refine the ER/schema handoff.
- [x] D2: implement the shared Prisma 7 schema, baseline SQL migrations, seed tooling, schema verification, live constraint tests and PostgreSQL CI ([PR #4](https://github.com/Vishnu912py/odoo-hackathon-subscription-management-system/pull/4)).
- [x] D3: implement transactional invoice persistence, historical customer/line/tax snapshots, exact decimal calculations and subscription-period concurrency protection.
- [x] D3: implement discount eligibility/history and usage-limit protection, idempotent payment allocation, recoverable billing runs, pause handling and monotonic schedule safeguards; add regression/concurrency coverage ([PR #9](https://github.com/Vishnu912py/odoo-hackathon-subscription-management-system/pull/9)).
- [x] Document persistence interfaces and integration responsibilities in the [database persistence handoff](docs/database-persistence-handoff.md).
- [x] D4: implement database-side filtered reporting aggregation, repeatable-read snapshots, actor-derived customer scoping, monthly buckets and exact totals; integrate fixture reconciliation and cleanup tests ([PR #10](https://github.com/Vishnu912py/odoo-hackathon-subscription-management-system/pull/10), [reporting handoff](docs/reporting-persistence-handoff.md)).
- [x] D5 tooling on `feat/db-benchmark`: add a deterministic large-dataset generator, reporting benchmark script and benchmark workflow (`e834a3a`).
- [ ] D5 acceptance: review/merge benchmark tooling, record measured results, tune indexes as needed and support the under-two-second page target with representative data.

D3 persistence is implemented, but the complete scheduled billing/API journey still requires Vishnu's integration work. The existing payment HTTP handler remains distinct from the D3 payment persistence module. Authentication email delivery is implemented; invoice email delivery is still pending.

### Albin (`albinsavi123-lang`) — frontend and user experience

- [x] Scaffold React/Vite/TypeScript and build the RevOps Shield design preview, including responsive navigation, dashboard cards, illustrative chart and invoice/recovery views (`50524a8`).
- [x] F1: complete the authenticated workspace layout, role-aware sidebar/mobile navigation, signup/login/reset/setup forms, password validation and shared feedback states ([PR #11](https://github.com/Vishnu912py/odoo-hackathon-subscription-management-system/pull/11), merged into `main`).
- [x] F1: refine staff management and invoice/payment presentation on top of the shared API client and integrated authentication/payment flows.
- [x] F2: implement admin product/variant, plan, tax, discount and quotation-template screens, exact decimal validation and API error handling ([PR #13](https://github.com/Vishnu912py/odoo-hackathon-subscription-management-system/pull/13), merged into `feat/prototype-v1` only).
- [x] F3: implement subscription list/filtering, creation/detail screens, capability-driven lifecycle actions and navigation to invoice details (`7fa16d4`, included in PR #13 on `feat/prototype-v1`).
- [x] Add F1/F2/F3 tests for password/role rules, catalog validation, request contracts, version/idempotency headers and explicit handling of unimplemented backend endpoints.
- [ ] Bring the newer F2/F3 frontend increment from `feat/prototype-v1` into `main` after integration review.
- [ ] F2/F3 acceptance: verify catalog writes and the full subscription lifecycle against implemented backend operations; screens currently encounter 501 for pending operations.
- [ ] F4: finish invoice actions and printable views; preserve the existing integrated invoice detail/payment-entry flows.
- [ ] F5: verify rendered dashboard/portal journeys, mobile layouts, pagination and page performance with representative data.

Shared prototype integration already provides generated API types, cookie/CSRF handling, prepared mutations, exact money display, live overview data and recovery of uncertain payment requests. These are team integration deliverables, not claims that Albin authored every supporting backend/client component. The default workspace uses live API data; the separate design preview contains illustrative data.

### Verification recorded

These are recorded results from earlier implementation/test runs, not fresh code-test runs for this README-only update:

- [x] V1 authentication backend checks: 17 tests, Prisma validation/generation, TypeScript checks and build passed.
- [x] V1 PostgreSQL HTTP integration suite: 9 tests including the enclosing suite passed in an isolated schema, covering authentication, ownership, payments, recovery and mail retries with an injected transport.
- [x] PR #13 conflict resolution: frontend `npm run check` passed 33 tests, generated-type checks, lint, TypeScript and Vite build; sidebar/catalog role guards were checked together.
- [x] Local authentication migration applied without reseeding domain records; the real Gmail reset-send test subsequently succeeded at the provider-acceptance stage.
- [x] Baseline schema integrity and live PostgreSQL constraint checks were recorded; D3/D4 add further concurrency/reporting test coverage in their merged implementations.
- [x] Vercel configuration property validation passed; this is not a hosted build/deployment test.
- [ ] Confirm reset email inbox arrival and complete the reset link in a browser.
- [ ] Verify deployed HTTPS flows, full lifecycle/billing acceptance, scheduler recovery and the performance target.

Browser verification was previously blocked by the browser permission gate. Health/readiness proves connectivity only. See the [final acceptance checklist](plan.md#final-acceptance-checklist) for the full project requirements.

## Technology stack

The confirmed technology stack is:
- **Frontend:** React + Vite + TypeScript (`frontend/`)
- **Backend:** Node.js 24 + Express 5 + TypeScript (`backend/`)
- **Database:** PostgreSQL 16 + Prisma ORM 7.10.1 (`backend/prisma/`)
- **Contracts:** OpenAPI 3.1 REST JSON (`docs/api/openapi.json`)

## Directory structure

```text
├── frontend/               # React + Vite + TypeScript web application
├── backend/                # Express 5 + TypeScript API foundation
│   ├── prisma/             # Single authoritative schema.prisma, migrations & seed
│   ├── src/                # App, server, config, modules & db client
│   ├── test/               # HTTP, config & database integration tests
│   └── prisma.config.ts    # Prisma 7 CLI configuration
├── docs/                   # Specifications, ER diagrams, API contracts, and wireframes
└── .github/workflows/      # Automated CI workflows (PostgreSQL 16 service integration)
```

## Backend setup and verification

Prerequisites: **Node.js 24.x**, npm, and PostgreSQL for database-backed work.

From repository root:

```bash
cd backend
npm ci
npm run prisma:generate
cp .env.example .env
```

Edit `backend/.env` to point `DATABASE_URL` to your PostgreSQL database.

```bash
# Verify schema & run test suite
npm run check

# Start development server
npm run dev
```

Open `http://localhost:3000/health/live`. `/health/ready` verifies PostgreSQL connection readiness.

## Team responsibilities

| Owner | Responsibility | First deliverable |
| --- | --- | --- |
| Vishnu (`Vishnu912py`), team lead | Architecture, authentication/authorization, backend business rules, subscription lifecycle, billing orchestration, integration and release | Confirm stack/contracts and scaffold a working foundation |
| `Zenfox-690`, database specialist | Data model, migrations, constraints, seed data, transactional billing persistence, reporting queries and indexes | Reviewed schema covering users through payments |
| `albinsavi123-lang`, frontend specialist | Admin/staff interfaces, customer portal, forms, dashboards and UI integration | Shared shell and subscription workflow using agreed mock data |

See [team responsibilities](docs/team-responsibilities.md) for work packages and handoffs.

Database implementation starts with the [ER diagram and schema handoff](docs/er-diagram.md) and [API impact guide](docs/api-impact.md), including relationships, constraints and confirmed billing policies.

Frontend implementation lives under `/frontend`.

All three contributors use the [API integration guide](docs/api-contracts.md), [OpenAPI file](docs/api/openapi.json) and [shared examples](docs/api/examples/manifest.json) before implementing their interfaces.

## Required user journey

Register/sign in -> configure products and plans -> create quotation -> confirm and activate subscription -> generate recurring invoice with taxes/discounts -> record payment -> review dashboard.

Subscriptions follow **Draft -> Quotation -> Confirmed -> Active -> Closed**. Pause, renewal, early closure and automatic closure depend on plan policy. Customers access only their own records; only admins create staff and discount rules.

## Start here

1. Read [requirements](docs/requirements.md) for statement-derived scope and acceptance checks.
2. Read [team responsibilities](docs/team-responsibilities.md) for your work package.
3. Review confirmed billing defaults in [architecture](docs/architecture.md) and [API impact](docs/api-impact.md).
4. Follow [the roadmap](plan.md) and [contribution workflow](contributing.md).

Application setup and test commands are maintained in [backend/README.md](backend/README.md). Never commit credentials or real customer data.

## Documentation index

- [`agents.md`](./agents.md): Guidance and context for coding agents working in this repository.
- [`contributing.md`](./contributing.md): Contribution workflow and quality expectations.
- [`plan.md`](./plan.md): Current implementation roadmap and milestones.
- [`docs/README.md`](./docs/README.md): Shared documentation structure and expansion guidance.
- [`backend/README.md`](./backend/README.md): Backend setup, Prisma 7 workflow, and test commands.
