# V1 authentication and deployment handoff

Implemented on `feat/prototype-v1`; deployment and real Gmail delivery still require operator configuration. Catalog/lifecycle/billing work is outside this increment.

## Checklist

- [x] Customer signup/login/logout, cookie sessions, CSRF and server-side roles/ownership.
- [x] Generic reset-email responses, 30-minute single-use tokens, password-policy validation and session revocation.
- [x] Admin-only staff list/detail/invite/update, version checks and idempotent mutations. No role assignment through public inputs.
- [x] Pending staff set their password through the same reset endpoint; activation is atomic with token consumption. Expired invitations can request a new setup email. Disabling an invitation revokes it.
- [x] PostgreSQL rate counters shared across instances; IP and normalized email counters, 20 requests per endpoint/minute (5 for forgot-password). Vercel's platform-overwritten IP header is used only when `VERCEL=1`; local requests cannot opt into trusting forwarded headers.
- [x] 24-hour idle session expiry plus seven-day absolute expiry; login rotates cookies/CSRF. Password reset and staff disable revoke sessions. Login issuance locks/rechecks the user to prevent an old password from creating a session concurrently with reset.
- [x] Gmail API transport, encrypted durable email jobs, leased delivery/retry and expired-job cleanup.
- [x] Frontend forgot-password/password-setup and admin staff controls; real PostgreSQL integration tests and frontend client checks.
- [x] Vercel frontend/API configuration, serverless entrypoint and production setup guide.
- [ ] Configure Google OAuth, hosted PostgreSQL and Vercel project/environment.
- [ ] Verify a real Gmail delivery and deployed HTTPS browser journey.

## Shared contracts

Existing API payloads are unchanged. Newly implemented operations:

| Method | Path | Access |
| --- | --- | --- |
| POST | `/api/v1/auth/forgot-password` | Public with anonymous session + CSRF |
| POST | `/api/v1/auth/reset-password` | Public with anonymous session + CSRF |
| GET/POST | `/api/v1/staff` | Admin |
| GET/PATCH | `/api/v1/staff/{id}` | Admin |

Reset/setup never signs the user in automatically. Links use a URL fragment, which is removed from the address bar by the UI and submitted only in a POST body. Tokens are hashed in `password_reset_tokens`/`staff_invitations`; the mail queue contains an AES-256-GCM encrypted message until sent or expired. Never log raw messages, links, OAuth tokens or environment files.

`20261031150000_auth_delivery` adds only `auth_email_jobs` and `auth_rate_limits`. Existing migrations/domain tables are preserved. Zenfox should review this additive migration. Run `npm run db:deploy` from `backend` before starting the updated API.

The mail configuration is optional for ordinary sign-in. Without it, reset requests/invitations fail explicitly with 503 before creating a token/account. After durable enqueue, an immediate bounded delivery pass is attempted. Provider failure leaves the job available for retry. A 202/201 confirms acceptance, not inbox delivery. Concurrent workers claim jobs with a one-minute lease. Ambiguous provider timeouts can cause duplicate emails; the same link still works only once.

## Gmail setup

1. In your Google Cloud project, enable Gmail API and configure the OAuth consent screen and an OAuth client.
2. Authorize the designated sending account for only `https://www.googleapis.com/auth/gmail.send` with offline access, obtaining a refresh token. This is the app's own authorization, separate from Gmail connected to this chat. Do not paste credentials into chat or commit them.
3. Configure these **backend-only** variables together:

| Variable | Value |
| --- | --- |
| `GMAIL_CLIENT_ID` | OAuth client ID |
| `GMAIL_CLIENT_SECRET` | OAuth client secret |
| `GMAIL_REFRESH_TOKEN` | Sender's offline refresh token |
| `GMAIL_SENDER` | Authorized sender email |
| `AUTH_EMAIL_KEY` | Random 32-byte key encoded as 64 hexadecimal characters |
| `CRON_SECRET` | Separate random bearer secret for maintenance |

Generate each random secret locally with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`. Store the values in local ignored environment configuration or Vercel secrets. Changing the email key makes pending jobs unreadable; drain/expire them before key rotation. No `VITE_` variable may contain these values.

Google OAuth apps left in external Testing status can have refresh tokens expire after seven days. Complete the appropriate consent/publishing setup for the chosen audience before relying on long-running delivery. See [Google OAuth guidance](https://developers.google.com/identity/protocols/oauth2) and [Gmail sending documentation](https://developers.google.com/workspace/gmail/api/guides/sending).

For a local delivery retry, run `npm run mail:deliver` from `backend`. To request another expired setup link, use **Forgot password / staff setup** in the UI.

## Vercel setup

The root `vercel.json` uses [Vercel Services](https://vercel.com/docs/services) (Beta) to deploy Vite and Express together. `/api/*` and `/health/*` route to the API, other paths to the SPA. Browser API calls stay on the same HTTPS origin. The backend exports an Express app from `src/vercel.ts`; it does not start a second listening server on Vercel.

1. Provision hosted PostgreSQL and separate production/preview databases. A database on your laptop is not reachable from Vercel. Set `DATABASE_URL` for runtime and `DIRECT_URL` for migrations as recommended by that provider; preserve TLS verification. Runtime uses up to five connections per instance, so provision pooling/limits accordingly.
2. Import this GitHub repository into a Vercel project with repository root directory and Node.js 24. Enable access to source files outside the service root if prompted: backend contract loading needs `docs/api/openapi.json`. Keep the repository docs in the deployed source.
3. Set backend variables: `NODE_ENV=production`, `FRONTEND_ORIGIN=https://<your-app-domain>`, database variables, all Gmail variables and `CRON_SECRET`. Use exact origins, never a wildcard. Preview deployments need their own exact origin and isolated database/mail sender or disabled mail configuration.
4. From an operator environment configured for the intended database, run `npm ci`, `npm run db:deploy`. Migrations are deliberately not run automatically by every parallel preview build. Never run the development seed in production.
5. Create the initial admin once with `npm run admin:create`, supplying `ADMIN_BOOTSTRAP_EMAIL` and `ADMIN_BOOTSTRAP_PASSWORD` in that operator environment. It creates only a new account and never overwrites existing users. Remove those variables afterward; do not set them as permanent Vercel variables.
6. Deploy a preview, verify liveness/readiness plus actual sign-in, reset email, staff invitation, role denial and payment reads. Readiness alone is not acceptance. Check Secure/HttpOnly cookies and that no reset token appears in network URLs or logs. Production promotion is a separate release decision.

Daily maintenance is configured at `/api/internal/auth-maintenance` with bearer `CRON_SECRET`. It cleans expired sessions/counters/jobs and retries eligible mail. **Daily scheduling cannot reliably retry a 30-minute link.** Immediate delivery is attempted by each request; for automatic recovery from outages, configure an external scheduler every minute or use a supported higher-frequency Vercel plan. [Vercel Hobby cron is limited to daily execution](https://vercel.com/docs/cron-jobs/usage-and-pricing). Do not make this endpoint public without its bearer check. Deployment Protection must allow the authorized scheduler.

Monitor pending jobs (`sent_at IS NULL`, `encrypted_message IS NOT NULL`) and `attempts` without reading/logging decrypted payloads. Once a link expires, the user must request a new email. The queue is intentionally scoped to authentication, not invoice delivery or recurring billing.

## Verification

Verified locally on 31 October 2026: backend `npm run check` (17 tests, Prisma validation/generation and TypeScript build); backend `npm run test:integration` (9 tests including the enclosing suite) in an isolated PostgreSQL schema; frontend `npm run check` (14 tests, contract type consistency, lint and build); schema integrity verifier. The additive migration was also applied successfully to the existing local `brightloop` development database; domain records were not reseeded. Integration delivery uses an injected test transport and makes no real Gmail calls. Tests cover generic responses, concurrent token consumption, session revocation, invitation replay, disabled staff, failed delivery/retry, encrypted-payload removal and limits across API instances.

Not verified: real Gmail OAuth/delivery, an actual Vercel build/deployment, or browser rendering. Browser access remains blocked by the existing permission gate. The Vercel config passed property validation against the published schema (using a Draft 7 validator because the upstream schema mixes newer constructs with a Draft 4 declaration); this is not a deployment test.
