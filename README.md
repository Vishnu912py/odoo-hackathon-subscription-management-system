# Odoo Hackathon Subscription Management System

Build a unified platform for Brightloop Software to manage products, recurring plans, quotations, subscriptions, invoices, discounts, payments, and reporting.

## Technology stack

The confirmed technology stack is:
- **Frontend:** React + Vite + TypeScript (`/frontend`)
- **Backend:** Node.js + Express + TypeScript (`/backend`)
- **Database:** PostgreSQL 16 + Prisma ORM 5.22.0 (`/database`)
- **Contracts:** OpenAPI 3.1 REST JSON (`docs/api/openapi.json`)

## Directory structure

```text
├── frontend/               # React + Vite + TypeScript web application
├── database/               # PostgreSQL schema, Prisma models, migrations, seeds & tests
│   ├── prisma/             # schema.prisma, migrations, and idempotent seed.ts
│   ├── scripts/            # verify_schema_integrity.py and test_db_constraints.ts
│   └── README.md           # Database developer guide
├── docs/                   # Specifications, ER diagrams, API contracts, and wireframes
└── .github/workflows/      # Automated CI workflows (PostgreSQL 16 service integration)
```

## Database setup and verification

Prerequisites: Node.js (v20+ or v22+), npm, Python (v3.10+).

### 1. Static validation (No database server required)

```bash
# Install root dependencies
npm install

# Validate Prisma schema
npx prisma validate --schema=database/prisma/schema.prisma

# Generate Prisma Client to node_modules/@prisma/client
npm run prisma:generate

# Run static schema, migration DDL, and ER documentation verifier
npm run db:validate

# Type-check TypeScript seed and constraint test scripts
npx tsc --noEmit database/prisma/seed.ts database/scripts/test_db_constraints.ts
```

### 2. Live database operations (Requires running PostgreSQL)

```bash
# Configure connection string in .env
cp .env.example .env
# Edit DATABASE_URL in .env

# Apply migrations
npm run prisma:migrate

# Or deploy in staging/production/CI
npm run prisma:deploy

# Execute idempotent synthetic test seed fixtures (safe to run multiple times)
npm run prisma:seed

# Run PostgreSQL constraint and concurrency integration tests
npm run test:db
```

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

Never commit credentials or real customer data.

## Documentation index

- [`agents.md`](./agents.md): Guidance and context for coding agents working in this repository.
- [`contributing.md`](./contributing.md): Contribution workflow and quality expectations.
- [`plan.md`](./plan.md): Current implementation roadmap and milestones.
- [`docs/README.md`](./docs/README.md): Shared documentation structure and expansion guidance.
- [`database/README.md`](./database/README.md): Database layer setup, migrations, and test commands.
