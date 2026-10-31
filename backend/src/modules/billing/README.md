# Billing module

Routes: invoices/actions/PDF, payments and billing-run submission/status.

Current handlers are 501 placeholders in `../index.ts`. No scheduler, mail delivery or payment processing runs yet. Do not start billing in a module import or a development server restart.

Build period generation, invoice snapshots, redemption usage and schedule advancement in one transaction. Authorize before replaying idempotent results, and replay completed matching payments before checking changed invoice state/version. A full payment retry must return the original result after the invoice becomes paid. Enforce same-subscription invoice lines and same-invoice discount allocations. Queue billing/email durably before acknowledging 202. Implement concurrency/recovery tests with PostgreSQL before enabling these routes.
