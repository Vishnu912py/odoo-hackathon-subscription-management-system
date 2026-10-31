# Team responsibilities

Confirmed by Vishnu: `Zenfox-690` specializes in databases; `albinsavi123-lang` specializes in frontend. This document defines the team's assignments; GitHub issue assignments and collaborator notifications are managed separately.

## Vishnu912py - team lead and backend

Own architecture and shared behavior while reserving time for reviews and integration.

- V1: Confirm stack/version, runtime, deployment and shared contracts; scaffold the project and document actual setup commands.
- V2: Implement signup/login/reset, role enforcement, admin staff creation and customer ownership checks (R01-R02).
- V3: Implement product/plan/template operations, subscription transitions, plan policies, add-on behavior and renewal scheduling (R03-R06).
- V4: Implement billing orchestration, tax/discount eligibility, invoice actions and payment business rules using Zenfox's persistence operations (R07-R10).
- V5: Expose reporting data, integrate all work streams, own release configuration and final demo (R11-R12).

Done when the real backend supports the full journey, rejects unauthorized operations, and critical lifecycle/billing tests pass. Review shared contracts early rather than implementing both collaborators' work yourself.

## Zenfox-690 - database and data reliability

- D1: Design entities, relationships, constraints, indexes, migrations and demo fixtures with Vishnu, covering users through payments (R01-R10).
- D2: Implement Prisma schema/model definitions and reviewed SQL migrations in `backend/prisma`. Prisma ORM/Migrate is now confirmed; use the pinned backend toolchain and keep one shared schema.
- D3: Implement persistence operations for unique subscription/period billing, atomic invoice creation, safe discount usage, payment allocation and recoverable scheduler progress (R07-R10).
- D4: Implement filterable report queries/indexes and reconcile totals against fixtures (R11).
- D5: Seed thousands of subscriptions, measure query performance and help Vishnu meet page-level targets (R12).

Done when a fresh database initializes reproducibly, constraints prevent duplicates/invalid references, retry/concurrency checks pass, and reports return agreed totals. Own persistence correctness; Vishnu owns billing policy and invocation.

## albinsavi123-lang - frontend and user experience

- F1: Build role-aware navigation, shared forms/tables, empty/loading/error states and signup/login/reset screens (R01-R02). UI visibility complements server authorization.
- F2: Build admin product/variant, plan, tax, discount, staff and quotation-template screens (R02-R05, R08-R09).
- F3: Build subscription screens with lines, lifecycle visibility and permitted actions; customer views use ownership-filtered backend data (R06).
- F4: Build invoices, printable views, staff payment-entry workflow and paid/outstanding/overdue views (R07-R10).
- F5: Build filterable dashboard; integrate real data and verify page response times with realistic pagination (R11-R12).

Done when all three roles complete permitted workflows against the real backend, errors are clear and the portal cannot reveal another customer's records. Use React/TypeScript and the shared API contract. Prototype with agreed fixtures until backend operations exist; the current server foundation's business routes return explicit 501 responses.

## Handoffs and review

| Deliverable | Owner | Consumer/reviewer | Agreement needed |
| --- | --- | --- | --- |
| Stack and role matrix | Vishnu | Both collaborators | Runtime, setup, exact permissions |
| Entity/schema contract | Zenfox | Vishnu; frontend reads field definitions | IDs, fields, enums, dates, money, migration ownership |
| Operations and errors | Vishnu | Frontend; Zenfox checks persistence | Inputs, outputs, validation, authorization, pagination |
| Invoice persistence | Zenfox | Vishnu | Transaction boundary, period key, retry/failure behavior |
| Reports | Zenfox + Vishnu | Frontend | Metrics, date filters and response shapes |
| Integrated journey | Vishnu | Both collaborators | Real seed data and acceptance checklist |

Coordinate simultaneous edits to shared files. Folder names depend on framework selection; do not create incompatible scaffolds independently.

## Parallel starting tasks

1. Together: agree stack, role matrix, statuses, fields and one demo fixture.
2. Vishnu: scaffold auth and one subscription path. Zenfox: schema and fixtures. Frontend: the same journey with matching fixtures.
3. Integrate as soon as backend operations exist; replace mocks before expanding edge cases.
4. Add recurring billing, discounts, payments and reporting, then run `plan.md` checks.

Each person tests their own work; Vishnu coordinates end-to-end verification. Include completed work, validation, dependencies and next handoff in each PR.
