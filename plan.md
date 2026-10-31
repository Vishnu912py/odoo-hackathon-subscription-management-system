# Implementation roadmap

## Goal

Build the Brightloop subscription platform described in `docs/requirements.md`. Status: planning only; no milestone is complete. Stack/version remain unconfirmed. Use dependency gates rather than invented deadlines; hackathon duration has not been supplied.

## Milestones

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
- [ ] R12: Representative pages measured under two seconds with thousands of subscriptions; environment/results recorded.
- [ ] Fresh-checkout setup verified, demo data synthetic, run/test commands documented.

## Demo sequence

Admin configures product/variant, plan, tax and discount -> staff uses quotation template -> subscription activates -> automatic invoice -> rerun proves no duplicate -> staff records payment -> customer sees owned records -> dashboard shows reconciled totals. Show one permission rejection and one plan-policy restriction.

Upgrades/downgrades and live gateways are optional extensions, not substitutes for unfinished required scope.
