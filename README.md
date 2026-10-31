# Odoo Hackathon Subscription Management System

Build a unified platform for Brightloop Software to manage products, recurring plans, quotations, subscriptions, invoices, discounts, payments, and reporting.

## Current status

The [backend foundation](backend/README.md) now lives in `backend/`: Express/TypeScript, Prisma configuration, health endpoints, standard error handling and HTTP/configuration tests. Business API operations explicitly return 501 until implemented. Domain schema/migrations, auth and subscription/billing features are still pending. The UI remains a static wireframe.

The original documentation proposed an Odoo-based implementation. The supplied problem statement does not explicitly mandate that framework.

The implementation baseline is **React + TypeScript, Express + TypeScript, PostgreSQL, Prisma ORM and Prisma Migrate**. Backend uses Node.js 24 and pinned Prisma 7 packages. Database schema/migrations live in `backend/prisma`. Deployment target remains open. The [API contracts](docs/api-contracts.md) define shared request/response formats and proposed MVP policies; they supersede older open questions where explicitly resolved.

## Run the backend foundation

```powershell
cd backend
npm ci
npm run prisma:generate
npm run dev
```

Open `http://localhost:3000/health/live`. PostgreSQL is not required for liveness or HTTP tests; configure your own `DATABASE_URL` before expecting `/health/ready` to succeed. See [backend setup](backend/README.md) for environment variables, migration workflow and frontend proxy configuration. No business API is ready for end-to-end integration yet.

## Team responsibilities

| Owner | Responsibility | First deliverable |
| --- | --- | --- |
| Vishnu (`Vishnu912py`), team lead | Architecture, authentication/authorization, backend business rules, subscription lifecycle, billing orchestration, integration and release | Confirm stack/contracts and scaffold a working foundation |
| `Zenfox-690`, database specialist | Data model, migrations, constraints, seed data, transactional billing persistence, reporting queries and indexes | Reviewed schema covering users through payments |
| `albinsavi123-lang`, frontend specialist | Admin/staff interfaces, customer portal, forms, dashboards and UI integration | Shared shell and subscription workflow using agreed mock data |

See [team responsibilities](docs/team-responsibilities.md) for work packages and handoffs.

Database implementation starts with the [ER diagram and schema handoff](docs/er-diagram.md), including relationships, constraints and unresolved billing policies.

Frontend implementation starts with the [UI wireframe and handoff](docs/ui-wireframe.md). Open `docs/wireframes/index.html` locally to explore the admin, staff and customer screens with sample data.

All three contributors should use the [API integration guide](docs/api-contracts.md), [OpenAPI file](docs/api/openapi.json) and [shared examples](docs/api/examples/manifest.json) before implementing their interfaces. These define the target contract, not running endpoints.

## Required user journey

Register/sign in -> configure products and plans -> create quotation -> confirm and activate subscription -> generate recurring invoice with taxes/discounts -> record payment -> review dashboard.

Subscriptions follow **Draft -> Quotation -> Confirmed -> Active -> Closed**. Pause, renewal, early closure and automatic closure depend on plan policy. Customers access only their own records; only admins create staff and discount rules.

## Start here

1. Read [requirements](docs/requirements.md) for statement-derived scope and acceptance checks.
2. Read [team responsibilities](docs/team-responsibilities.md) for your work package.
3. Settle unresolved choices in [architecture and contracts](docs/architecture.md) before building incompatible implementations.
4. Follow [the roadmap](plan.md) and [contribution workflow](contributing.md).

Application setup and test commands are maintained in [backend/README.md](backend/README.md). Database migrations and seed commands will be documented when Zenfox implements them. Never commit credentials or real customer data.

## Documentation index

- [`agents.md`](./agents.md): Guidance and context for coding agents working in this repository.
- [`contributing.md`](./contributing.md): Contribution workflow and quality expectations.
- [`plan.md`](./plan.md): Current implementation roadmap and milestones.
- [`docs/README.md`](./docs/README.md): Shared documentation structure and expansion guidance.
