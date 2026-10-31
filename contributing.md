# contributing.md

## Getting started

Read `docs/team-responsibilities.md` and `docs/architecture.md` first. Stack-specific commands will be added after scaffolding; none are currently available.

1. Create a focused branch for each issue or feature.
2. Keep pull requests small and easy to review.
3. Update documentation for any behavior or workflow changes.

Suggested branches: `feat/backend-auth`, `feat/db-foundation`, `feat/ui-subscriptions`. Open small PRs against `main`; Vishnu reviews integration, Zenfox reviews schema/persistence, and albinsavi123-lang reviews UI. Have a collaborator review Vishnu's changes. These are team conventions, not claims that GitHub branch protection is configured.

Coordinate shared field, enum, contract and dependency changes with affected owners. Include migrations with schema changes and update fixtures when contracts change.

## Development expectations

- Make the smallest possible change that fully solves the issue.
- Do not modify unrelated code.
- Prefer consistency with existing project style and structure.

## Validation

Before opening or updating a PR:

1. Run relevant tests/checks available for the files you changed.
2. Manually review changed files for correctness and clarity.
3. Ensure no secrets or sensitive values were introduced.

## Pull request checklist

- [ ] Problem is clearly addressed.
- [ ] Changes are minimal and scoped.
- [ ] Relevant docs are updated.
- [ ] Validation has been performed.
- [ ] Affected R01-R12 requirement IDs and handoffs are listed.
- [ ] Authorization/customer isolation checked where relevant.
- [ ] Billing/payment changes checked for retries, concurrency and consistent totals.
- [ ] Real backend integration verified or remaining mocks identified.
