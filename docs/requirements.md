# Requirements and acceptance criteria

Source: the four-page `Subscription_Management_System.pdf` supplied by Vishnu (local original: `E:\Downloads\Subscription_Management_System.pdf`). This is a portable summary; the original PDF has not been copied into the repository. Page references below refer to that original. Implementation proposals are labeled separately.

## Statement-derived scope

| ID | Requirement | Acceptance evidence | Source |
| --- | --- | --- | --- |
| R01 | Email/password signup; unique email; password longer than eight characters with uppercase, lowercase and a special character; reset link to registered email | Duplicate email and invalid passwords rejected; registered user receives a usable reset link | p. 2 |
| R02 | Admin, limited internal staff and customer roles; only admin adds staff; customers see only their own subscriptions/invoices | Server rejects non-admin staff creation and cross-customer access | p. 2 |
| R03 | Product name, type, sales/cost price, notes, variants with price adjustments; add-ons can be switched on/off | Configure a variant such as Odoo brand with +560; selected variant affects price; demonstrate add-on management | pp. 1, 3 |
| R04 | Plan price, daily/weekly/monthly/yearly recurrence, minimum quantity, availability dates, individual auto-close/early-close/pause/renewal policies | Each recurrence can be configured; invalid dates/quantities rejected; actions respect plan flags | p. 3 |
| R05 | Quotation templates contain plan, product lines and validity in days | Template creates quotation with correct lines and validity | p. 3 |
| R06 | Subscription number, customer, plan, start/expiry, payment terms; product/quantity/unit-price/tax/amount lines | Demonstrate Draft -> Quotation -> Confirmed -> Active -> Closed, visible to authorized staff | p. 3 |
| R07 | Automatic recurring invoices copy customer/subscription lines, taxes and totals; no duplicate or missed billing | Batch due subscriptions; rerun without duplicates; recover failed runs without skipping periods | p. 3 |
| R08 | Admin tax rules; invoice confirm/cancel/send/print; Draft -> Confirmed -> Paid | Verify tax calculation, actions, sent output and print view; document cancellation semantics | p. 3 |
| R09 | Admin-only fixed/percentage discounts; minimum purchase or quantity, dates, usage limit, product/subscription scope | Eligible discount appears automatically on next invoice; expired/exhausted/ineligible discounts do not; retry consumes no extra use | p. 4 |
| R10 | Payments linked to invoice with method, amount, date and note; paid/outstanding visibility | Record different dates/methods; balances/status update consistently | p. 4 |
| R11 | Filterable summary of active subscriptions, revenue, payments, outstanding and overdue invoices | Dashboard reconciles with seeded subscriptions, invoices and payments | p. 4 |
| R12 | Pages respond in under two seconds with thousands of subscriptions | Record dataset, environment and measured key-page response times; do not claim compliance without measurements | p. 4 |

## Decisions before implementation

The statement does not define framework, exact staff permissions, currency, timezone, tax rounding/order, discount stacking, revenue accounting definition, proration, pause/resume dates, renewal boundaries, month-end handling, partial/overpayments, or cancellation effects on billed periods. Vishnu owns decisions with collaborator input; record them in `architecture.md`.

Reset-link expiration/single use, database constraints, transaction boundaries and monetary representation are proposed engineering safeguards rather than quoted requirements.

## Scope control

All R01-R12 remain required for final submission. A first integrated slice can be smaller, but is not full completion. Live payment gateways, upgrades/downgrades, multi-currency, refunds and advanced revenue recognition are not explicit requirements; defer unless deliberately added. Payment recording is required regardless of gateway choice.
