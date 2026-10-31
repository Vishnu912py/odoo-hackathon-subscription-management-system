# Database Engineering & Persistence Layer

Owner: **Zenfox-690** (Database Specialist)  
Technology: **PostgreSQL 16**, **Prisma ORM 5.22.0**, **Prisma Migrate**, **TypeScript**

---

## Directory Overview

```text
database/
├── prisma/
│   ├── schema.prisma                  # Canonical 32-model declarative Prisma schema
│   ├── migrations/
│   │   ├── 20261031110000_init/       # Baseline PostgreSQL DDL generated via prisma migrate diff
│   │   ├── 20261031110001_constraints/ # Handcrafted SQL: CHECK constraints, functional index, partial indexes
│   │   └── migration_lock.toml        # Provider lock file
│   └── seed.ts                        # 100% idempotent synthetic test seed fixtures
├── scripts/
│   ├── verify_schema_integrity.py     # Static AST / DDL integrity cross-verifier
│   └── test_db_constraints.ts        # PostgreSQL constraint & concurrency integration test suite
└── README.md                          # This developer guide
```

---

## Prerequisites & Environment

- **Node.js:** v20+ or v22+
- **Python:** v3.10+ (for static verification script)
- **PostgreSQL:** v16 (required for migrations, seeding, and constraint tests; not needed for static validation)

### Environment Configuration

Configure `DATABASE_URL` in `.env` at the project root:

```bash
# PostgreSQL Connection URL
DATABASE_URL="postgresql://brightloop:brightloop@localhost:5432/subscription_management?schema=public"
NODE_ENV=development
```

---

## Verification & Development Commands

### 1. Static Validation (No Database Server Required)

These commands validate code syntax, schema integrity, and TypeScript typing without requiring a running PostgreSQL instance:

```bash
# Validate Prisma schema syntax
npx prisma validate --schema=database/prisma/schema.prisma

# Generate Prisma Client to node_modules/@prisma/client
npm run prisma:generate

# Run static schema, migration DDL, and ER documentation verifier
npm run db:validate
# Or directly:
python database/scripts/verify_schema_integrity.py

# Type-check seed and test scripts
npx tsc --noEmit database/prisma/seed.ts database/scripts/test_db_constraints.ts
```

### 2. Live Database Operations (Requires Running PostgreSQL)

```bash
# Apply pending migrations to a development database
npm run prisma:migrate

# Deploy migrations to production / staging / CI environment
npm run prisma:deploy

# Execute idempotent synthetic test seed fixtures (safe to run multiple times)
npm run prisma:seed

# Run PostgreSQL constraint integration tests
npm run test:db
```

---

## Key Data Integrity Guarantees

1. **Email Case-Insensitivity:** Enforced via `users_email_lower_idx` (`CREATE UNIQUE INDEX users_email_lower_idx ON users (LOWER(email));`). Duplicate emails differing only in casing are rejected at the database level.
2. **Product Variant Ownership:** `product_variants` declares `UNIQUE (id, product_id)`. Line tables declare composite foreign keys referencing `(variant_id, product_id)`, preventing cross-product variant misassignment.
3. **Monetary Precision:** Strict exact numeric types: `NUMERIC(18,2)` for settlement amounts and totals, `NUMERIC(18,4)` for unit prices, quantities, and price adjustments, and `NUMERIC(7,4)` for tax percentages. Binary floats (`FLOAT`, `DOUBLE PRECISION`) are prohibited.
4. **Table-Level CHECK Constraints:** 13 database-level `CHECK` constraints reject negative prices, non-positive quantities, percentage discounts > 100%, and inverted date ranges.
5. **Billing-Period Uniqueness:** `UNIQUE (subscription_id, period_start)` with `period_end > period_start` prevents overlapping or duplicate period generation.
6. **Payment Idempotency:** `payments.idempotency_key` is unique; duplicate submissions are rejected or return the existing record.
7. **Discount Usage Protection:** `UNIQUE (discount_rule_id, invoice_id)` on `discount_redemptions` prevents a discount rule from being consumed multiple times on the same invoice.

