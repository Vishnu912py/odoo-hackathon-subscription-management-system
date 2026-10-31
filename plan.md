# Implementation roadmap

## Goal

Build the Brightloop subscription platform described in `docs/requirements.md`. Status: backend and database foundations are implemented, alongside a React dashboard prototype. Domain schema, migrations and synthetic fixtures are in `backend/prisma`; prototype v1 implements auth, owned reads, reports and transactional payment recording. The full subscription-create/activate/bill journey remains incomplete. React/TypeScript, Express/TypeScript, PostgreSQL and Prisma ORM/Migrate form the baseline. Backend uses Node.js 24/Prisma 7 in `backend/`. Vercel is selected; deployment configuration is present and hosted database/Gmail setup remains pending. See the dated [implementation checklist](README.md#foundation-checklist--31-october-2026) for completed deliverables and local-only work. Use `docs/api-contracts.md` for shared interfaces and confirmed MVP defaults. Use dependency gates rather than invented deadlines; hackathon duration has not been supplied.

## Milestones

Prototype v1 delivers a smaller integrated slice: registration/login, owned subscription/invoice/payment views, reports and transactional payment recording. See [prototype scope and verification](docs/prototype-v1.md). Milestone 2 still requires subscription authoring/lifecycle and recurring invoice generation.

1. **Foundation:** Vishnu confirms stack, role matrix and contracts; Zenfox designs schema/fixtures; albinsavi123-lang builds navigation and screen prototypes. Exit: shared runnable scaffold and consistent field/status definitions.
2. **First integrated journey:** Signup/login, one product/monthly plan, quotation, activation, invoice and payment. Exit: real backend journey works and customers see only owned records. This is not full statement completion.
3. **Full functional scope:** Reset email, staff management, variants/add-ons, all recurrence intervals, templates, minimums/availability, lifecycle policies, retry-safe billing, taxes/discounts, invoice actions, payments and filtered reporting. Follow named owners in `docs/team-responsibilities.md`.
4. **Validation and demo:** Complete checks below, verify fresh-checkout setup and document actual commands/results.

## Final acceptance checklist

- [ ] R01-R02: Duplicate email/weak password rejected; reset email works; only admin creates staff; direct cross-customer requests denied.
- [ ] R03-R06: Variant surcharge/add-ons, all intervals, templates/validity, line totals and lifecycle/policy enforcement demonstrated.
- [ ] R07-R08: Due batch, retries, concurrency and failed-run recovery produce no duplicate/skipped billing; invoice actions and tax totals verified.
- [ ] R09: Fixed/percentage, scope, minimums, dates and usage limits tested; expiry/exhaustion and retry double-use handled.
- [ ] R10: Different dates/methods and agreed partial-payment rules give correct balances/statuses.
- [ ] R11: Dashboard filters/totals reconcile with fixtures; overdue logic uses agreed due dates.
- [x] R12: Representative reporting pages measured under two seconds with 10,000 subscriptions and 100,000 invoices in PostgreSQL 16; environment and results recorded in [docs/database-performance-benchmark.md](docs/database-performance-benchmark.md).
- [ ] Fresh-checkout setup verified, demo data synthetic, run/test commands documented.

## Demo sequence

Admin configures product/variant, plan, tax and discount -> staff uses quotation template -> subscription activates -> automatic invoice -> rerun proves no duplicate -> staff records payment -> customer sees owned records -> dashboard shows reconciled totals. Show one permission rejection and one plan-policy restriction.

Upgrades/downgrades and live gateways are optional extensions, not substitutes for unfinished required scope.

## V1 authentication increment

Implementation checklist and deployment gates are tracked in [docs/authentication-v1.md](docs/authentication-v1.md). Local implementation does not check off real-mail delivery or deployed browser acceptance.
