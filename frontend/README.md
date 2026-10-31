# Frontend and API handoff

React/TypeScript + Vite. Albin owns the UI; Vishnu owns API integration; Zenfox owns backend/database integration. Prototype v1 integrates the frontend with Express handlers and Zenfox’s existing Prisma schema/migrations. Shared HTTP contracts remain unchanged.

## Run locally

Use Node.js 24 and install the locked dependencies:

```powershell
cd frontend
npm ci
npm run dev
```

Open **http://localhost:5173**. In a second terminal run the backend according to [its README](../backend/README.md). Vite forwards `/api` and `/health` to `http://127.0.0.1:3000`, preserving the browser Origin and session cookies. Port 5173 is strict: it will not silently move to a port rejected by backend CORS.

For another backend address, copy `.env.example` to `.env.local`, set `BACKEND_PROXY_TARGET`, and restart Vite. Never put database credentials or session secrets in frontend environment files. Use `localhost` in the browser, matching the default `FRONTEND_ORIGIN=http://localhost:5173`.

## What is connected

The default **Live backend workspace** provides:

- Independent process/database indicators from `/health/live` and `/health/ready`.
- Session restoration through `/auth/me` and sign-in using CSRF initialization and rotation.
- Logout with the current session-bound CSRF token.
- Reports from `/reports/overview` for staff/admin or `/portal/overview` for customers, with required date filters.
- Paginated subscription, invoice, and payment lists using server-provided states and decimal strings.
- Loading, empty, permission-denied, expired-session, network-failure and `501 NOT_IMPLEMENTED` states. No fixture fallback.

**Prototype v1 implements authentication, record reads, reports and payment recording.** Configure/migrate/seed PostgreSQL using [the prototype guide](../docs/prototype-v1.md). Other operations remain 501.

Albin's dashboard is preserved behind **View Albin’s design preview**. It is illustrative, not an authenticated session or live financial data. Invoices open a detail panel with staff/admin payment entry. Customer registration is available from sign-in. Subscription actions, reset-password UI and production deployment remain follow-ups.

## Code map

- `src/api/schema.ts`: generated types from the shared OpenAPI file.
- `src/api/client.ts`: cookie-based requests, CSRF, errors, cancellation/timeouts, and prepared idempotent mutations. Includes customer registration.
- `src/api/format.ts`: exact decimal display without floating-point financial arithmetic.
- `src/features/live/LiveWorkspace.tsx`: isolated live workspace and record views.
- `src/features/live/live.css`: scoped live-workspace styles.
- `src/App.tsx`: existing design preview plus a small mode switch.
- `vite.config.ts`: development proxy; no database configuration belongs here.

## Working agreement with Zenfox and Albin

1. Zenfox can continue backend/database work on his branch. This frontend follows the existing [API contract](../docs/api-contracts.md), independent of Prisma field names or database paths.
2. `/auth/csrf`, `/auth/login`, `/auth/me`, and `/auth/logout` are implemented. The server must enforce CSRF, roles and ownership; frontend controls do not provide authorization.
3. Reports and list endpoints are implemented. API enums are lowercase; money remains decimal strings; responses use `{data}` or `{data,meta}`. The backend must exclude records the customer does not own.
4. Albin can reuse the API client and types. Coordinate edits to `App.tsx` and `vite.config.ts`; keep live-page work under `src/features/live/` until his full screens are ready.
5. Contract changes require a coordinated contract PR. Run `npm run api:generate` after a contract update; never hand-edit generated types.

For future writes, call `api.prepare(path, method, body, version)` once per logical action and keep that object for network retries. `api.send(action)` sends the original body, UUID idempotency key and quoted `If-Match`. It never automatically retries mutations. After a 412, refresh and ask the user to reapply changes as a new action. After uncertain network failures, preserve the prepared action until reconciled. Do not recalculate balances in the browser.

## Checks

```powershell
npm run check
```

Checks cover generated contract types, API-client tests using injected HTTP responses, Vite proxy configuration, lint and production build. Test responses never run in the app. These checks do not verify live authentication or database persistence.

Manual browser check:

1. Start backend and frontend; open `http://localhost:5173`.
2. Confirm API reachability, then sign in with a development account supplied by the backend team.
3. Reload: session restores without localStorage credentials.
4. Read reports and each list; check pagination, empty results and errors.
5. As a customer, verify only owned records appear. Also test direct cross-customer requests on the server.
6. Sign out and reload: private records disappear. Stop the backend and verify the connection error.

Automated browser access was declined, so visual layout and the actual browser cookie/proxy round trip remain unverified. For deployment, configure a same-origin reverse proxy for `/api` and `/health`; Vite's `server.proxy` is development-only. `vite preview` is not the production API proxy.
