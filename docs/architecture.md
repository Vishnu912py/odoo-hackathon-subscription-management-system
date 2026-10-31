# Architecture and shared contracts

Status: proposed guidance, not an existing system. No application code or API exists yet.

The [ER diagram and schema handoff](er-diagram.md) develops the proposed entities below into a PostgreSQL schema design using the React/Express/PostgreSQL baseline discussed with Vishnu. It is not an applied migration; runtime versions, hosting and listed business-policy decisions remain open.

## Decisions register

| Decision | Status | Owner |
| --- | --- | --- |
| Framework/version/edition | Unconfirmed; starter docs proposed Odoo, PDF does not mandate it | Vishnu |
| Database/runtime/deployment | Select with framework; document actual setup after scaffolding | Vishnu + Zenfox |
| Staff permissions | Specify limited create/read/update/action access per entity | Vishnu |
| Currency/timezone/rounding | Agree before money or scheduling implementation | Vishnu + Zenfox |
| Tax/discount order and stacking | Define examples with expected totals | Vishnu |
| Recurrence/pause/renewal/early closure | Define boundaries, month-end rules, catch-up and effects on invoices | Vishnu + Zenfox |
| Cancellation and partial/overpayment | Cancellation action required; detailed state/balance policy unresolved | Vishnu + Zenfox |
| Reporting definitions | Distinguish invoiced totals, cash received, outstanding and overdue; define revenue | All |

## Proposed entities

Zenfox owns schema definitions; Vishnu reviews behavior. Reuse framework entities where appropriate.

| Entity | Required/proposed content |
| --- | --- |
| User/customer | Unique email, secure password representation, role, ownership link; reset token lifecycle |
| Product/variant | Name, type, sales/cost price, notes, adjustment, add-on association |
| Plan | Price, interval, minimum quantity, availability and lifecycle flags |
| Quotation template/line | Plan, validity days, products, quantity and price defaults |
| Subscription/line | Unique number, customer, plan, dates, terms, status; product/variant/quantity/price/taxes/amount |
| Invoice/line | Customer/subscription, billing period, due date, status, totals and historical line snapshots |
| Tax/discount | Tax rules; discount type/value, scope, thresholds, validity and usage limit |
| Discount usage | Invoice/rule association consumed atomically and protected against retry duplication |
| Payment | Invoice, method, amount, date, note and recording identity |

Period identity, snapshots, due-date derivation and usage records are proposed design details. Agree whether one subscription produces one invoice per period before selecting its uniqueness constraint.

## Integration contract checklist

Document concrete model methods or API operations for auth, staff creation, catalog/plans/templates, subscriptions, invoice actions, payments and reports. REST is not mandated; use the selected framework's integration style.

Each operation needs permissions/ownership, inputs/outputs, ID format, states, errors, date/time and money encoding, filters, sorting and pagination. Include a shared fixture with expected totals. Browser clients must not connect directly to the database.

## Consistency boundaries

- Enforce email/subscription-number uniqueness and relationships in persistence as well as application validation.
- Proposed invoice transaction: claim a due period, compute/snapshot lines and totals, write invoice, record discount usage, advance schedule only after success. Concurrent workers/retries resolve to the same persisted result.
- Failed periods stay discoverable for retry. Define how multiple missed periods are caught up without gaps.
- Payment writes and balance/status changes remain consistent; check repeated submissions and simultaneous updates.
- Historical invoices retain original amounts when catalog/tax/discount rules change.
- Customer ownership applies to every read/write including lists and print/download routes; staff permissions are explicit.
- Use exact money arithmetic with documented rounding; frontend calculations are not authoritative.

## Performance verification proposal

Seed at least 5,000 subscriptions and representative invoices/payments (chosen benchmark size, not a number specified by the PDF). Record environment, dataset, filters and browser page response times. Query timings alone do not prove the under-two-second page requirement. Use measured bottlenecks to guide pagination, query plans and indexes on ownership, status, due dates and relationships.
