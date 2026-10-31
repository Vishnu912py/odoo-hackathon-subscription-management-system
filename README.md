# Odoo Hackathon Subscription Management System

Build a unified platform for Brightloop Software to manage products, recurring plans, quotations, subscriptions, invoices, discounts, payments, and reporting.

## Prototype v1

The `feat/prototype-v1` branch combines Albin's frontend, Zenfox's Prisma 7 database foundation, and working handlers for registration, login/logout, owned subscription/invoice/payment reads, reports and staff payment recording. See [prototype setup and demo](docs/prototype-v1.md).

Reset/setup email, admin staff management and session hardening are implemented; see the [authentication and Vercel setup checklist](docs/authentication-v1.md). Gmail credentials and hosted deployment remain to be configured. Catalog editing, subscription lifecycle actions, recurring billing, discounts and invoice delivery/printing remain follow-ups. This is an integrated first prototype, not completion of R01–R12.

## Foundation checklist — 31 October 2026

Checked items below record the earlier foundation deliverables. PR #6 and PR #4 are merged in `main` at `998c6a8`. The prototype branch now implements 20 operations; the other contract endpoints still return `501 NOT_IMPLEMENTED`. Its newer scope and validation are recorded in the prototype guide above.

### Vishnu (`Vishnu912py`) — backend and integration

- [x] Confirm stack, shared API contracts, role matrix and MVP billing defaults.
- [x] Implement Express/TypeScript foundation, environment validation, Prisma connection pool, health endpoints, error handling and HTTP/configuration tests (PR #6).
- [x] Integrate PR #4 locally, configure a dedicated local PostgreSQL database, apply both migrations and verify real backend connectivity.
- [x] V1 deployment setup: Vercel selected; frontend/API configuration and operator guide added.
- [ ] V1 release: configure hosted PostgreSQL/Gmail OAuth and verify the deployed application.
- [x] V2 implementation: authentication, password reset, staff invitations, CSRF, server roles and customer ownership.
- [ ] V2 external verification: real reset/setup email delivery and browser journey.
- [ ] V3: implement catalog APIs and subscription lifecycle/business rules.
- [ ] V4: implement billing orchestration, tax/discount calculations, invoice actions and payment rules.
- [ ] V5: expose reports, complete the real end-to-end journey, validate performance and prepare release/demo.

Frontend integration, registration/sign-in, invoice details and payment entry are included in the prototype branch. PostgreSQL-backed HTTP integration tests exercise the workflow; browser visual verification remains blocked by the browser permission gate.

### Zenfox (`Zenfox-690`) — database and persistence

- [x] D1: deliver the domain model, relationships, constraints, baseline indexes and synthetic demo fixtures.
- [x] D2: implement the shared Prisma 7 schema and two PostgreSQL migrations under `backend/prisma` (PR #4).
- [x] Add seed tooling, static schema verification and live database constraint tests; configure PostgreSQL 16 CI.
- [x] D3: implement transactional invoice creation, discount usage, payment allocation and recoverable billing progress, with retry/concurrency tests (PR #9).
- [x] D4: implement filterable, customer-scoped reporting queries and reconcile their totals against fixtures.
- [ ] D5: seed thousands of subscriptions, measure query performance and tune indexes; support page-level performance verification.

Session, idempotency, billing-run and outbox tables exist; their runtime workflows are still pending.

### Albin (`albinsavi123-lang`) — frontend

- [x] Scaffold the React/Vite/TypeScript application.
- [x] Build the RevOps Shield dashboard prototype: navigation shell/mobile menu, summary cards, illustrative chart, invoice table and recovery overview (commit `50524a8`).
- [x] F1 authentication: role-aware navigation and signup/login/reset/setup flows connected to the API. Browser verification remains pending.
- [ ] F2: implement admin catalog, variants, plans, taxes, discounts, staff and quotation-template screens.
- [ ] F3: implement subscription detail/forms, lifecycle actions and the ownership-scoped customer portal.
- [ ] F4: implement invoice detail/print and payment-entry workflows with authoritative balances.
- [ ] F5: integrate live dashboard filters/data and verify pagination and page performance.

The dashboard prototype uses illustrative data; navigation labels and preview controls do not establish completed business screens.

### Verification recorded

- [x] Local backend `npm run check`: 15 tests passed, Prisma validation/generation and TypeScript compilation succeeded.
- [x] Local PostgreSQL 18: both migrations applied, migration status up to date, synthetic seed loaded, and `npm run test:db` passed 13 checks.
- [x] Running backend `/health/ready`: HTTP 200 with `database: connected`.
- [x] PR #4 PostgreSQL 16 CI: backend checks, migrations, two seed runs and live constraint suite succeeded.
- [ ] Real authenticated business journey, concurrency/recovery acceptance checks and under-two-second page performance verified.

These results cover foundation checks, not completed authentication, billing or reporting. See [team responsibilities](docs/team-responsibilities.md) and the [acceptance checklist](plan.md).

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
