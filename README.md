# Odoo Hackathon Subscription Management System

Build a unified platform for Brightloop Software to manage products, recurring plans, quotations, subscriptions, invoices, discounts, payments, and reporting.

## Current status

Planning only: this repository contains documentation, with no application scaffold, dependencies, migrations, or runnable tests yet. Installation and start commands will be added after scaffolding.

The original documentation proposed an Odoo-based implementation. The supplied problem statement does not explicitly mandate that framework; stack, version/edition and deployment target remain to be confirmed by the team lead.

## Team responsibilities

| Owner | Responsibility | First deliverable |
| --- | --- | --- |
| Vishnu (`Vishnu912py`), team lead | Architecture, authentication/authorization, backend business rules, subscription lifecycle, billing orchestration, integration and release | Confirm stack/contracts and scaffold a working foundation |
| `Zenfox-690`, database specialist | Data model, migrations, constraints, seed data, transactional billing persistence, reporting queries and indexes | Reviewed schema covering users through payments |
| `albinsavi123-lang`, frontend specialist | Admin/staff interfaces, customer portal, forms, dashboards and UI integration | Shared shell and subscription workflow using agreed mock data |

See [team responsibilities](docs/team-responsibilities.md) for work packages and handoffs.

Database implementation starts with the [ER diagram and schema handoff](docs/er-diagram.md), including relationships, constraints and unresolved billing policies.

Frontend implementation starts with the [UI wireframe and handoff](docs/ui-wireframe.md). Open `docs/wireframes/index.html` locally to explore the admin, staff and customer screens with sample data.

## Required user journey

Register/sign in -> configure products and plans -> create quotation -> confirm and activate subscription -> generate recurring invoice with taxes/discounts -> record payment -> review dashboard.

Subscriptions follow **Draft -> Quotation -> Confirmed -> Active -> Closed**. Pause, renewal, early closure and automatic closure depend on plan policy. Customers access only their own records; only admins create staff and discount rules.

## Start here

1. Read [requirements](docs/requirements.md) for statement-derived scope and acceptance checks.
2. Read [team responsibilities](docs/team-responsibilities.md) for your work package.
3. Settle unresolved choices in [architecture and contracts](docs/architecture.md) before building incompatible implementations.
4. Follow [the roadmap](plan.md) and [contribution workflow](contributing.md).

After scaffolding, add verified prerequisites, environment variable names, database setup/seed commands, start commands and test commands here. Never commit credentials or real customer data.

## Documentation index

- [`agents.md`](./agents.md): Guidance and context for coding agents working in this repository.
- [`contributing.md`](./contributing.md): Contribution workflow and quality expectations.
- [`plan.md`](./plan.md): Current implementation roadmap and milestones.
- [`docs/README.md`](./docs/README.md): Shared documentation structure and expansion guidance.
