# Brightloop API contracts v0.1

> Current checkout update (31 October 2026): all 75 API operations are integrated. See [the product guide](integrated-product.md) for setup, current behavior and actual checks. Prototype-only status statements below describe earlier increments; hosted deployment and real-email acceptance are verified in the product guide.

Implementation owner: **Vishnu912py**. Frontend consumer: **albinsavi123-lang**. Persistence owner: **Zenfox-690**.

This is the shared implementation baseline for React + TypeScript, Express + TypeScript and PostgreSQL. **No API server or database migrations are implemented by these files.** API shapes below are the target for initial development. Business policies marked as proposed defaults are engineering decisions made for this handoff, not additional requirements from the problem statement or claims of prior team approval.

Implementation status: all 75 operations have concrete handlers; [prototype v1](prototype-v1.md) records an earlier increment. Infrastructure errors use `413 PAYLOAD_TOO_LARGE`, `415 UNSUPPORTED_MEDIA_TYPE`, and `503 DATABASE_UNAVAILABLE` when no database is configured, with the same error envelope. Prisma ORM/Migrate is confirmed; schema and migrations are located in `backend/prisma`.

## Source of truth and files

- [OpenAPI contract](api/openapi.json): import into an OpenAPI-compatible API client/editor for all operation schemas, headers, roles and responses.
- [Shared request/response examples](api/examples/manifest.json): manifest maps each JSON example to its response/request schema; use these for frontend mocks and backend contract tests.
- [Contract generator](api/build_contract.py): readable source for the generated JSON. Edit this and regenerate; do not hand-edit generated files.
- [Contract validator](api/validate_contract.py): OpenAPI/reference/schema/example checks; does not test a live API.
- Related: [requirements](requirements.md), [ER diagram](er-diagram.md), [UI handoff](ui-wireframe.md).

The contract uses [OpenAPI 3.1](https://spec.openapis.org/oas/v3.1.0.html), which describes HTTP operations and JSON Schema-based payloads. These files define the interface; they do not provision hosting or select a database library/ORM.

## 1. Shared HTTP conventions

| Item | Contract |
| --- | --- |
| Base path | `/api/v1`; proposed local backend `http://localhost:3000/api/v1` |
| Local frontend | Proposed Vite port 5173; proxy `/api` to port 3000. Prefer same-origin requests through proxy, including auth cookies. These are configuration targets, not running services. |
| Content | `application/json` for bodies/responses except invoice PDF. Unknown body/query fields rejected; no silent mass assignment. |
| Naming | JSON keys snake_case; resource IDs UUID strings; human numbers such as SUB-0001 are separate display fields. |
| Single success | `{ "data": { ... } }`; no content for HTTP 204. |
| Collection success | `{ "data": [], "meta": { "page": 1, "page_size": 20, "total": 0, "total_pages": 0 } }` |
| Pagination | `page` starts at 1; `page_size` default 20, maximum 100. Out-of-range pages return empty data with actual totals. |
| Sorting/search | `sort_by`, `sort_order=asc|desc`, `q`; defaults created_at descending, except events occurred_at descending. If created_at is not allowed, use first documented sort field descending. Always append ID as stable tie-breaker. q is case-insensitive substring search of number/name/description labels displayed on that list, never hidden fields. |
| Null versus omitted | Required nullable response fields are returned as null. On PATCH, omitted leaves unchanged; null clears only a nullable field. Arrays replace their full collection, not append. |
| Money | Final totals exactly two decimal places as strings, e.g. `"1180.00"`. Quantity/unit prices/discount values four decimals, e.g. `"2.0000"`, `"500.0000"`. No JSON floating-point monetary values. |
| Dates | Calendar dates `YYYY-MM-DD`; instants RFC3339 UTC such as `2026-10-31T04:30:00Z`. Business timezone baseline Asia/Kolkata. |
| Bounds | Billing periods, line validity and subscription expiry use exclusive end dates. Plan availability, quotation validity and discount date bounds are inclusive. Reports from/to are inclusive. |
| Creates | 201 for created records; 202 only for work durably queued (reset mail, invoice delivery, billing run). |
| Deletes | No public hard-delete endpoints. Archive supported configuration with PATCH `is_active=false`; never erase financial history. |
| Versions | Every mutable business entity carries integer `version`. PATCH and protected action endpoints require `If-Match: "<version>"`; retrieve current record after 412 rather than overwriting. |

GET detail/list data must use the same field meanings. Subscription and invoice lists deliberately return summary schemas; details return line items. Payment histories/events are separate paginated requests, not unbounded nested collections.

## 2. Authentication, permissions and ownership

Use opaque server-side sessions in the `brightloop_session` cookie. Cookie is HttpOnly, SameSite=Lax, Path=/, Secure on HTTPS. Local HTTP development may omit Secure. Never store the session token in localStorage or expose it in JSON. Baseline idle lifetime: 24 hours; login rotates session ID and CSRF token; logout/reset/password changes revoke sessions. Exact production session limits may be tightened without changing payloads.

Frontend sequence:

1. `GET /auth/csrf` establishes an anonymous session and returns `data.csrf_token`.
2. Send this token as `X-CSRF-Token` on **all** mutations, including login, signup and password reset. Validate session-bound token plus allowed Origin on the server.
3. `POST /auth/login` sends email/password and returns user, rotated CSRF token and expiry. Browser receives session cookie automatically.
4. `GET /auth/me` restores identity and current CSRF token after reload. Clear UI state and return to login on 401.
5. `POST /auth/logout` invalidates the session and expires its cookie; returns 204.

Use `credentials: "include"` for browser fetches. Same-origin proxy avoids development CORS issues. If separate origins are used, allow only the exact frontend origin and credentials; never `Access-Control-Allow-Origin: *` with cookies. Cross-site hosting may require a different cookie policy; agree before deployment, not ad hoc in frontend code.

Signup always creates a customer and profile; client cannot supply role, active flag or customer ownership IDs. Staff creation is admin-only and queues a setup email, never returns a password. Existing customer profiles must not be linked simply because someone enters the same billing email; a verified account-linking workflow is outside v1. Password-reset requests return the same generic message regardless of email existence. Reset tokens expire after 30 minutes, are single-use, stored hashed and never returned by the API.

| Capability | Admin | Staff | Customer |
| --- | --- | --- | --- |
| Products/plans/taxes/payment terms/templates | Read/write | Read; no product cost_price | No direct access; allowed add-ons through own subscription |
| Discount configuration/targets | Read/write | No | No |
| Staff accounts | Read/create/update staff only | No | No |
| Customer records | Read/create/update | Read/create/update | Own profile through session context; no general customer list |
| Draft/quotation authoring, confirm/activate | Yes | Yes | No |
| Subscription reads/events | All | All | Own only |
| Pause/resume/renew/early-close/add-ons | Plan policy | Plan policy | Own and plan policy |
| Invoice reads/PDF/payment history | All | All | Own only |
| Invoice confirm/cancel/send; payment entry | Yes | Yes | No |
| Business reports | Yes | Yes | Own portal report only |
| Billing-run trigger/poll | Yes | No | No |

This is the **proposed MVP role matrix** that resolves the earlier unspecified staff limits. Server checks are mandatory, even if buttons are hidden. A customer cannot widen scope with query filters: supplying `customer_id` on shared lists returns 403. Cross-customer record IDs return 404, including nested events, payments and PDFs. `capabilities` fields are server-computed UI hints, not authorization tokens. Response projections must omit product cost for staff, password/reset/session secrets for everyone, and internal audit payloads for customers.

## 3. Endpoint map

All paths are relative to `/api/v1`. Full field schemas and filter allowlists live in OpenAPI. A collection's POST creates; `GET /{id}` reads; PATCH changes only permitted properties.

| Area | Operations |
| --- | --- |
| Account access | GET `/auth/csrf`, `/auth/me`; POST `/auth/register`, `/auth/login`, `/auth/logout`, `/auth/forgot-password`, `/auth/reset-password` |
| Staff/customers | GET/POST `/staff`, `/customers`; GET/PATCH `/staff/{id}`, `/customers/{id}` |
| Catalog | GET/POST `/products`; GET/PATCH `/products/{id}`; POST `/products/{id}/variants`; PATCH `/products/{id}/variants/{variant_id}` |
| Configuration | GET/POST `/plans`, `/taxes`, `/payment-terms`, `/quotation-templates`, `/discounts`; GET/PATCH each `/{id}` |
| Subscription authoring | GET/POST `/subscriptions`; GET/PATCH `/subscriptions/{id}` |
| Subscription actions | POST `/subscriptions/{id}/quote`, `/confirm`, `/activate`, `/pause`, `/resume`, `/renew`, `/close`, `/addons` |
| Supporting data | GET `/subscriptions/{id}/events`, `/subscriptions/{id}/available-addons` |
| Invoices | GET `/invoices`, `/invoices/{id}`, `/invoices/{id}/pdf`; POST `/invoices/{id}/confirm`, `/cancel`, `/send` |
| Payments | GET `/payments`; GET/POST `/invoices/{id}/payments` |
| Recurring billing | POST `/billing-runs`; GET `/billing-runs/{id}` |
| Reporting | GET `/reports/overview`, `/portal/overview` with required from/to and optional plan_id |

There is no public `POST /invoices` accepting arbitrary totals: the billing service generates invoice snapshots from due subscriptions. There is no payment-gateway charge endpoint. An account's recorded `card` payment method does not imply online card processing.

## 4. Validation and errors

All errors use this stable envelope, including authentication and server failures:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Correct the highlighted fields.",
    "fields": [
      { "path": "lines.0.quantity", "code": "MUST_BE_POSITIVE", "message": "Quantity must be greater than zero." }
    ],
    "request_id": "00000000-0000-4000-8000-000000000900"
  }
}
```

`fields` is empty for non-field errors. `path` uses dotted names and zero-based array indexes. Display human messages; branch UI logic on codes/status, never parsed message text. Never return SQL, stack traces or secrets.

| Status | Stable codes / meaning |
| --- | --- |
| 400 | `MALFORMED_REQUEST`, `UNKNOWN_FIELD`, `INVALID_QUERY`, `IDEMPOTENCY_KEY_REQUIRED` |
| 401 | `AUTH_REQUIRED`, `INVALID_CREDENTIALS`, `SESSION_EXPIRED` |
| 403 | `FORBIDDEN`, `CSRF_INVALID`, `ACCOUNT_DISABLED` |
| 404 | `NOT_FOUND` (also inaccessible customer-owned record) |
| 409 | `EMAIL_EXISTS`, `INVALID_TRANSITION`, `PLAN_POLICY_DENIED`, `QUOTE_EXPIRED`, `PAYMENT_EXCEEDS_BALANCE`, `INVOICE_HAS_PAYMENTS`, `IDEMPOTENCY_CONFLICT`, `REQUEST_IN_PROGRESS`, `DISCOUNT_EXHAUSTED`, `IMMUTABLE_RULE`, `BILLING_CATCHUP_REQUIRED` |
| 412 | `VERSION_CONFLICT`; refresh record and ask user to reapply changes |
| 422 | `VALIDATION_ERROR`, `RESET_TOKEN_INVALID` |
| 428 | `PRECONDITION_REQUIRED` for missing If-Match |
| 429 | `RATE_LIMITED`; include Retry-After seconds |
| 500 | `INTERNAL_ERROR`; safe message and request_id for diagnostics |

Cross-field validation includes variant/product ownership, positive quantities, minimum plan quantity, dates, active selectable references, fixed-discount currency, percentage <=100, consistent scope/target arrays and sufficient invoice balance. Customer-supplied ownership/pricing/role overrides are rejected, not ignored. The schema describes structural validation; these cross-record checks belong in the backend transaction layer.

## 5. Retries and concurrent updates

All non-auth POST/PATCH operations require `Idempotency-Key`, a UUID. Generate once when a logical action starts. Keep that same key, path, payload and If-Match value across network retries. Use a new key only for a deliberate new action. Do not reuse payment keys for another invoice.

Persist idempotency by authenticated actor + method + canonical path + key with a hash of the body and preconditions. Authorize the current actor first. A completed identical request returns its original status/body **before checking a now-stale version**. Different contents for the same key return 409 `IDEMPOTENCY_CONFLICT`. An in-progress request returns 409 `REQUEST_IN_PROGRESS` with Retry-After, or waits for completion; use one documented implementation consistently (baseline: return 409). A validation/authorization failure before mutation does not consume the key.

Write the mutation and successful idempotency result in one transaction. For queued work, commit the job/outbox row and the key result together before 202. Retain payment/billing keys for the lifetime of their financial records; retain other successful writes at least 7 days. Client treats lost responses older than retention as requiring reconciliation before resubmission. Also enforce database period uniqueness and payment uniqueness; a header alone is not sufficient.

If-Match applies to the entity being changed: variant version for variant edits, subscription version for subscription actions, **invoice version for payment creation**. Increment the affected aggregate version on every committed change. Changes to payment balances or delivery status also update invoice version. For example, a second independent payment with an old invoice version gets 412; a retry of the first payment with the same idempotency key gets the first result.

## 6. Proposed MVP business defaults

These choices resolve ambiguity so the team can implement one behavior. Vishnu may revise them through a contract PR before affected features merge. They are not extracted requirements from the PDF.

### Pricing, taxes and discounts

- Single currency INR; exact decimal arithmetic; final amounts rounded half-up to 2 decimals. Unit prices/quantities retain 4 decimals. Values exceeding the documented precision are rejected, not silently truncated.
- `plans.price` is the advertised base bundle price, **not an extra line charge**. At plan creation, sum default included-product quantity × override price (or product sales price) and require it to equal plan.price after rounding. Add-ons excluded. This replaces the ER document's unresolved automatic allocation proposal with explicit included-line pricing.
- Copied template lines retain their final unit prices, including any variant adjustment. Otherwise default plan/product prices receive the variant adjustment once. Explicit staff unit_price is final, including adjustment; do not add it again. Editing quantities adjusts line sums; minimum_quantity applies to total non-add-on units. Subscription responses include tax/total estimates before automatic invoice discounts; final discounted amounts come from generated invoices.
- Taxes are tax-exclusive simple percentages applied to the discounted line base. Multiple assigned taxes are additive, not compounded. Round each line subtotal, each discount allocation and each tax amount to 2 decimals; invoice totals are sums of rounded lines. Rates are immutable: changing a tax means a new rule ID. Existing agreements retain assigned rates unless explicitly renegotiated.
- No discount stacking in v1: choose the one eligible rule producing the largest invoice saving; ties sort by rule UUID. Product scope discounts only matching lines; subscription scope only explicitly assigned subscriptions. Thresholds apply to the eligible scope's pre-discount subtotal/quantity; if both minimums exist, both must pass. Compare dates against billing period_start.
- Fixed discounts are capped at eligible subtotal. Allocate subscription-wide/fixed discounts proportionally to eligible line subtotals in stable line-ID order, with the final line taking the rounding remainder. Percentage discounts round line by line. Never create a negative taxable base. A zero saving consumes no use.
- Usage counts are one redemption per invoice, protected by rule-row locking. Exhausted candidate rules are excluded; reevaluate other eligible rules while locked. Billing continues without a discount when none qualify. Rule value/scope/targets/dates are immutable after creation; replacement creates a new ID. Record activation/archive effective time so historical catch-up does not apply future changes retroactively.

### Subscription and calendar behavior

- Create always returns draft. Draft PATCH cannot reassign customer. Quote requires nonempty valid lines and availability/minimum checks. Quote validity is server business date + validity_days (template default or 7); confirmation after that inclusive date fails. There is no separate quotation entity.
- Confirm snapshots currency, interval, plan policy flags and payment due_days; later plan/term edits do not silently change existing agreements. Before confirmation, those response fields show the current proposed agreement values. Activate sets status active and next_billing_date=start_date, without billing synchronously.
- Periods begin on start_date, end exclusively at the next calendar boundary. Daily/weekly add 1/7 days. Monthly/yearly preserve original day/month anchor, clamped to the target month's final day; a Jan 31 anchor yields Feb 28 then Mar 31. Restore original anchor after a short month. Leap-day yearly anchor clamps then restores on leap years.
- Finite expiry must align to a billing boundary in v1; no partial-period proration. API expiry `2027-10-01` means last covered day 30 Sep 2027. Frontend may display that inclusive last-day label, but sends the exclusive boundary.
- Pause and early close requested now take effect at the next **not-yet-started** recurrence boundary; a request made exactly at a boundary can take effect there if that period has not been billed. Already started/due periods remain billable. Backend first catches up prior due periods or rejects with BILLING_CATCHUP_REQUIRED; never skip debt. Pause may be shown as pending until its effective date; close likewise stays active until effective date. Responses expose pause_effective_date, resume_effective_date and close_effective_date (null when no corresponding pending/effective action); capabilities disallow duplicate pending requests. Keep full interval history separately, not only these projection fields.
- While paused, unstarted periods within the effective pause interval are skipped without invoices. Resume takes effect at the next original boundary on/after today; it does not shift anchor or extend expiry. Return pending action dates explicitly. `is_paused` describes effective state at business today, not a future scheduled state.
- Renewal extends an active subscription's finite expiry to a later aligned boundary if allowed; do not reopen closed records. At expiry, stop billing. Auto-close plans transition to closed; others remain active with next_billing_date=null until renewed or closed. Plans with indefinite expiry may not enable auto_close; renewal of indefinite agreements is unnecessary and denied.
- Add-on changes use plan-permitted products only, server prices, and next not-yet-started boundary. Versioned lines retain prior values. Customer cannot submit arbitrary price, tax, plan or effective date. A second pending change to the same add-on returns 409 rather than silently replacing the first.

### Invoices and payments

- One recurring invoice per subscription/period start, with immutable period end and snapshots; generation creates draft and advances scheduling in the same transaction. Confirmation changes draft to confirmed. Confirming never regenerates amounts or consumes discounts again.
- Worker catches up periods oldest first. Each period is its own transaction. Failed periods remain due; the run records errors and continues with other subscriptions. Limit is number of periods per run; has_more/next_run_required tell scheduler to continue. Empty eligible set is a completed run with zero counts.
- Invoice issue_date is period_start even on catch-up; due_date is period_start + snapshotted due_days. created_at records actual generation time. This explicitly makes missed historical periods potentially overdue after confirmation.
- Payments apply to confirmed invoices only; multiple partial payments allowed, overpayment rejected. Amount must be positive; future payment dates rejected; backdated actual receipts permitted and affect reports by payment_date. Full settlement sets paid; zero-total invoices become paid on confirmation without a fabricated payment row.
- Cancellation allowed only for draft/confirmed invoices with no payments. Cancellation is terminal, reserves period identity, does not rewind schedule and does not restore discount usage. Same-period rebilling, refunds and reversals are deferred. Cancelled records have collectible balance_due=0 while retaining original total and amount_paid=0. They are excluded from revenue/outstanding calculations.
- Send is a durable queued email to the invoice's billing-email snapshot, not arbitrary request input. Retry same key never sends twice. Intentional resend uses new key. Customer print/download always passes ownership checks.

## 7. Reporting definitions

from/to required, inclusive, maximum 366 days, ending no later than business today. Optional plan_id limits all metrics to that plan. Portal report applies customer ownership first. Response `as_of` is business today; historical active-subscription and balance reconstruction is not part of v1.

- `invoiced_total`: confirmed/paid invoice totals with issue_date in range; draft/cancelled excluded. Includes tax; this is billed amount, not formal accounting revenue recognition. `revenue_basis` states that limitation.
- `payments_received`: recorded payment amounts with payment_date in range. Never infer cash from invoice paid status.
- `outstanding_balance`: current positive balances of all confirmed invoices within caller/plan scope, independent of date filter. `overdue_balance` subset has due_date < today. Paid/draft/cancelled excluded.
- `active_subscriptions`: effective active, not paused, start_date <= today, and unexpired; `paused_subscriptions` is counted separately. Both are current snapshots independent of date filter.
- `monthly`: ordered YYYY-MM buckets in the selected range, including zero buckets. Sum each series to its matching period total.

UI must label period totals and current balances separately. No manually updated dashboard table is needed.

## 8. Database additions for Zenfox

The ER diagram described business entities only. These contract requirements add implementation details; include them in migrations and update the ER design when finalized:

| Addition | Purpose |
| --- | --- |
| version integer on mutable aggregates | Conditional updates and stale-edit prevention |
| Sessions with hashed session ID, user/anonymous identity, CSRF binding, expiry/revocation | Cookie auth and CSRF; no plaintext passwords/tokens |
| Staff invitations/setup tokens | Pending staff creation with verified password setup; setup token activates staff on successful reset/setup |
| Idempotency records with scope/key/hash/status/result | Atomic retry handling; unique scope+key |
| Durable billing_runs and invoice-email outbox | 202 represents work that survives process restart; track retry/failure/delivery |
| Subscription policy and payment-term snapshots, original recurrence anchor | Stable existing agreement rules |
| Scheduled lifecycle changes and effective pause intervals | Pending pause/resume/close, historical billing catch-up |
| Stable logical line ID and effective line versions | Boundary-effective add-on changes without losing history |
| Rule effective activity history | Historical discount eligibility during catch-up; no retrospective edits |
| Payment-term is_active and immutable due_days | Archive terms without changing old invoice deadlines |

Financial mutation invariants still apply: unique invoice period; unique rule/invoice redemption; record locks on subscription, discount and invoice aggregates; insert payment + balance/state change + idempotency record atomically. An append-only event describes changes, but event logging alone does not enforce them.

## 9. First integration exercise

Use [subscription-create.json](api/examples/subscription-create.json) and the fixture IDs described there. Zenfox seeds its customer, product, plan, tax and payment term (the IDs are illustrative, not preexisting records). Albin uses response examples for mocks; Vishnu implements the same shapes.

1. Obtain CSRF token, log in as staff, retain rotated token.
2. POST `/subscriptions` with fixture body and fresh Idempotency-Key -> 201 draft, shaped like [subscription-created.json](api/examples/subscription-created.json). Capture returned ID/version. The active-subscription example illustrates a later state, not this create response.
3. POST `/subscriptions/{id}/quote` with `{}` and quoted If-Match -> quotation. Confirm -> confirmed. Activate -> active. Each action uses a new key and latest version.
4. As admin, POST `/billing-runs` with `{ "as_of": "2026-10-31", "limit": 100 }` for the fixed sample scenario. Poll returned ID until terminal. For real tests use an injected business clock; don't hard-code today's date in production.
5. Fetch generated invoice; confirm with current version. Fetch it again and record a payment with a new key. Fetch authoritative balances and report after mutation.
6. Retry identical payment request/key: same ID/body, no extra money. Fresh key with stale version: 412. Fresh key with current version and too-large amount: 409.
7. Customer A can read its invoice; customer B gets 404 for that invoice, its PDF and payment history. Customer cannot record a payment or trigger billing.

The examples cover a single existing partially paid invoice and a final payment, plus a two-invoice overview matching the wireframe. They are representative HTTP payloads, not a complete database dump. Before running the whole sample as an integration test, seed both customers/invoices and use a fixed clock.

Example payment request headers/body (IDs are fixtures; session cookie is sent by the browser):

```http
POST /api/v1/invoices/00000000-0000-4000-8000-000000000200/payments
Content-Type: application/json
X-CSRF-Token: <current-session-csrf-token>
Idempotency-Key: 00000000-0000-4000-8000-000000000700
If-Match: "1"

{"amount":"680.00","method":"bank_transfer","payment_date":"2026-10-31","note":"Remaining balance"}
```

Expected 201 body is [payment-result.json](api/examples/payment-result.json). Refetch invoice and report after mutation, or update the invoice from `data.invoice` immediately. Do not increment a local balance independently of the response.

## 10. Contract workflow and validation

Use a supported Python 3 installation for these documentation commands:

```text
python docs/api/build_contract.py
python -m pip install openapi-spec-validator==0.7.2
python docs/api/validate_contract.py
```

Prefer a virtual environment for validation dependencies. The validator also accepts `--dependency-path <directory>` for isolated installs. Application code does not depend on Python or this validator.

Albin: build API adapters and mocks against OpenAPI examples; always render server statuses/capabilities, preserve form input on errors, and retry with the same key. Zenfox: implement constraints, fixtures, migrations and transactional support. Vishnu: implement handlers/permissions/domain behavior and integration tests.

Contract PRs change the generator, regenerated OpenAPI/examples and this guide together. No teammate independently renames fields/enums or switches money/date formats. Additive optional fields may fit v1; breaking changes require explicit coordination before merge or a new version after clients depend on v1. Contract validation is necessary but does not prove the implemented endpoints work; backend integration tests must exercise authorization, concurrency, email/job behavior, billing totals and failure recovery.

## Authentication implementation update

The existing forgot/reset and staff contracts are now implemented without payload changes. Password setup uses `/auth/reset-password`; Vercel/Gmail setup and local verification are documented in [authentication-v1.md](authentication-v1.md). Six newly implemented operations bring the prototype total to 20.
