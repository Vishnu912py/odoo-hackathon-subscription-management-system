# Odoo Hackathon Subscription Management System

Build a unified platform for Brightloop Software to manage products, recurring plans, quotations, subscriptions, invoices, discounts, payments, and reporting.

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
