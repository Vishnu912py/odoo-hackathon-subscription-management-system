# Accounts module

Routes: `/auth/*`, `/staff/*`, `/customers/*` under `/api/v1`.

Owner: Vishnu; session/user/customer persistence coordinated with Zenfox. Current handlers are explicit 501 placeholders in `../index.ts`.

Implement opaque sessions, login rotation, password hashing, expiring single-use reset/setup tokens, CSRF, exact role checks and customer ownership before exposing protected data. Use the shared API input/response schemas; signup cannot accept a role or ownership override. Keep password/reset/session secrets out of responses and logs. Do not substitute in-memory production sessions for the contract's database-backed session design.
