# Catalog module

Routes: products/variants, plans, taxes, payment terms, quotation templates and discounts.

Current handlers are 501 placeholders in `../index.ts`. Add read handlers and admin-only mutations after auth and schema exist. Staff product responses omit cost_price. Snapshot prices/rules for agreements and invoices instead of mutating history. Use Prisma decimal values and strings at the HTTP boundary, never Number for official money calculations. Coordinate custom constraints, versions and idempotency persistence with Zenfox.
