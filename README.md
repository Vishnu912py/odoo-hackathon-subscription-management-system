# Odoo Hackathon Subscription Management System

Build a unified platform for Brightloop Software to manage products, recurring plans, quotations, subscriptions, invoices, discounts, payments, and reporting.

## Technology stack

The confirmed technology stack is:
- **Frontend:** React + Vite + TypeScript
- **Backend:** Node.js + Express + TypeScript
- **Database:** PostgreSQL
- **ORM & Migrations:** Prisma ORM + Prisma Migrate
- **Contracts:** OpenAPI 3.1 REST JSON (`docs/api/openapi.json`)

## Database setup and migrations

Prerequisites: Node.js (v18+), npm, and a running PostgreSQL instance.

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment:**
   Copy `.env.example` to `.env` and set your PostgreSQL connection string:
   ```bash
   cp .env.example .env
   # Edit DATABASE_URL in .env
   ```

3. **Validate schema & generate client:**
   ```bash
   npx prisma validate
   npx prisma generate
   ```

4. **Apply migrations:**
   ```bash
   npx prisma migrate dev
   ```

5. **Seed baseline demo data:**
   ```bash
   npm run prisma:seed
   ```

6. **Verify schema & constraint integrity:**
   ```bash
   python scripts/verify_schema_integrity.py
   ```

## Team responsibilities

| Owner | Responsibility | First deliverable |
| --- | --- | --- |
| Vishnu (`Vishnu912py`), team lead | Architecture, authentication/authorization, backend business rules, subscription lifecycle, billing orchestration, integration and release | Confirm stack/contracts and scaffold a working foundation |
| `Zenfox-690`, database specialist | Data model, migrations, constraints, seed data, transactional billing persistence, reporting queries and indexes | Reviewed schema covering users through payments |
| `albinsavi123-lang`, frontend specialist | Admin/staff interfaces, customer portal, forms, dashboards and UI integration | Shared shell and subscription workflow using agreed mock data |

See [team responsibilities](docs/team-responsibilities.md) for work packages and handoffs.

Database implementation starts with the [ER diagram and schema handoff](docs/er-diagram.md) and [API impact guide](docs/api-impact.md), including relationships, constraints and unresolved billing policies.

Frontend implementation starts with the [UI wireframe and handoff](docs/ui-wireframe.md). Open `docs/wireframes/index.html` locally to explore the admin, staff and customer screens with sample data.

All three contributors should use the [API integration guide](docs/api-contracts.md), [OpenAPI file](docs/api/openapi.json) and [shared examples](docs/api/examples/manifest.json) before implementing their interfaces. These define the target contract, not running endpoints.

## Required user journey

Register/sign in -> configure products and plans -> create quotation -> confirm and activate subscription -> generate recurring invoice with taxes/discounts -> record payment -> review dashboard.

Subscriptions follow **Draft -> Quotation -> Confirmed -> Active -> Closed**. Pause, renewal, early closure and automatic closure depend on plan policy. Customers access only their own records; only admins create staff and discount rules.

## Start here

1. Read [requirements](docs/requirements.md) for statement-derived scope and acceptance checks.
2. Read [team responsibilities](docs/team-responsibilities.md) for your work package.
3. Settle unresolved choices in [architecture and contracts](docs/architecture.md) and [API impact](docs/api-impact.md) before building incompatible implementations.
4. Follow [the roadmap](plan.md) and [contribution workflow](contributing.md).

Never commit credentials or real customer data.

## Documentation index

- [`agents.md`](./agents.md): Guidance and context for coding agents working in this repository.
- [`contributing.md`](./contributing.md): Contribution workflow and quality expectations.
- [`plan.md`](./plan.md): Current implementation roadmap and milestones.
- [`docs/README.md`](./docs/README.md): Shared documentation structure and expansion guidance.
