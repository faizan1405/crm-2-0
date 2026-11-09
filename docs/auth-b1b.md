# B1B Owner Authentication Architecture

> Scope: Checkpoint B1B on local branch `feat/b1b-owner-auth` (continuing from committed B1A `e611ee7`). CRM business data remains browser-local (`scale-flow-crm-2-demo`, `scale-flow-payment-proofs`) until B2–B4. CRM V1 (`faizan1405/CRM`) and CRM V2 `main` remain untouched.

## 1. Implemented vs Planned Boundaries

### Implemented in B1B

- **Database schema & migration:** [`src/server/db/schema.server.ts`](../src/server/db/schema.server.ts) + [`src/server/db/migrations/0000_b1b_owner_auth.sql`](../src/server/db/migrations/0000_b1b_owner_auth.sql) defining:
  - `crm_users` (unique email `uq_crm_users_email`, `role_id` `'owner'`, `account_status`, `password_hash`, `last_login_at`, `version`, UTC audit timestamps)
  - `crm_sessions` (FK `user_id -> crm_users.id` `ON DELETE CASCADE`, unique `uq_crm_sessions_token_hash` storing SHA-256 hex digest only, `expires_at`, sliding `idle_expires_at`, `last_seen_at`, `revoked_at`, `revoke_reason`, masked IP prefix, UA SHA-256)
  - `crm_auth_audit` (FK `user_id -> crm_users.id` `ON DELETE SET NULL`, append-only event log using SHA-256 `email_hash` and masked `ip_prefix`)
  - `crm_auth_rate_limits` (persistent MySQL rate-limit buckets keyed by SHA-256 `limit_key`)
- **Password hashing:** `node:crypto` `scrypt` (`N=32768`, `r=8`, `p=1`, `keylen=64`, random 16-byte salt, constant-time `timingSafeEqual`, dummy scrypt verification on unknown emails) in [`src/server/auth/password.server.ts`](../src/server/auth/password.server.ts). Policy requires `10..128` characters with at least one letter and one number and no leading/trailing whitespace.
- **Sessions & Cookies:** 32-byte CSPRNG opaque tokens in `HttpOnly`, `SameSite=Lax`, `Path=/` cookies (`SESSION_COOKIE_NAME`, default `sf_session`). `Secure` is enabled automatically on HTTPS `APP_ORIGIN`, HTTPS/proxy requests, and any non-loopback `NODE_ENV=production` host (omitted only on local HTTP loopback for built-server dev tests).
- **Rate Limiting & CSRF:** Persistent MySQL login throttling (`AUTH_RATE_LIMIT_MAX_ATTEMPTS`, `AUTH_RATE_LIMIT_WINDOW_SECONDS`, `AUTH_LOCKOUT_SECONDS`, `AUTH_TRUST_PROXY`) + `Origin` / `Referer` / `Sec-Fetch-Site` / `application/json` checks in [`src/server/auth/security.server.ts`](../src/server/auth/security.server.ts).
- **Auth API Endpoints:**
  - `GET /api/v1/auth/session` — validates cookie, slides idle timeout (bounded by absolute TTL), fails closed (`401` / `503`)
  - `POST /api/v1/auth/login` — CSRF + JSON validation + rate limit + generic `401` + sets `HttpOnly` cookie
  - `POST /api/v1/auth/logout` — revokes current DB session + clears cookie (`401` when unauthenticated)
  - `POST /api/v1/auth/logout-all` — revokes all active Owner sessions + clears cookie (`401` when unauthenticated)
- **Fail-Closed SSR & Client Guard:**
  - Server entry ([`src/server.ts`](../src/server.ts) -> `executeProtectedSsrRequest`) intercepts unauthenticated requests to CRM routes (`302` to `/login?redirect=...` with `Cache-Control: no-store, private`) before rendering any CRM HTML, and rejects unauthenticated `/_serverFn/*` calls (`401`/`503`).
  - Frontend root guard ([`src/routes/__root.tsx`](../src/routes/__root.tsx)) + [`Shell`](../src/components/crm/Shell.tsx) re-check `/api/v1/auth/session` on `pageshow` (bfcache/Back), focus/visibility, cross-tab logout sync (`scale-flow-auth-sync` / `BroadcastChannel`), and idle-deadline expiry.
  - `/login` wires Owner sign-in to real backend auth, keeps Employee login clearly disabled/unavailable, and removes the unauthenticated demo bypass link.
  - `Settings -> Security` wires **Log out** and **Log out all sessions** while keeping in-app password inputs disabled cleanly.

### Intentionally Deferred (Not Implemented in B1B)

- **Self-service in-app Owner password change UI/endpoint:** intentionally deferred; emergency credential rotation runs via the isolated CLI (`npm run auth:bootstrap -- --reset-password`).
- **Employee authentication, roles & Team CRM login:** disabled in B1B; reserved for dedicated Team CRM checkpoint.
- **CRM data APIs, OpenRouter integration, Data Vault ZIP server import:** untouched until B2–B5; localStorage/IndexedDB CRM data stays strictly local.

## 2. Database Migration & Owner Bootstrap Runbook

1. Provide MySQL credentials via environment variables (`DB_HOST=127.0.0.1`, `DB_PORT=3306`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, or `DATABASE_URL`) and ensure `NODE_ENV=production` and `APP_ORIGIN=https://<crm-v2-domain>` on Hostinger. Optionally set `AUTH_SECRET` (`>= 32` characters, documented in [`.env.example`](../.env.example) and validated by [`src/server/config/env.server.ts`](../src/server/config/env.server.ts)). Set `AUTH_TRUST_PROXY=true` only behind a trusted reverse proxy (e.g., Hostinger Nginx/LiteSpeed).
   - For local development, `.env` (gitignored) is loaded both via `--env-file-if-exists=.env` in [`package.json`](../package.json) (`start`, `db:*`, `auth:bootstrap`) and via [`src/server/config/dotenv.server.ts`](../src/server/config/dotenv.server.ts) (using process-env precedence without overwriting already-set shell variables). Production builds run [`scripts/build-prod.mjs`](../scripts/build-prod.mjs) (`NODE_ENV=production`) so local `.env` `NODE_ENV=development` cannot leak development JSX (`jsxDEV`) into `.output/server`.
2. Apply SQL migrations:
   ```bash
   npm run db:migrate
   ```
3. Bootstrap the single active Owner account without placing passwords in files or Git:
   ```bash
   # Interactive masked prompt:
   npm run auth:bootstrap

   # Or environment-provided one-shot execution:
   BOOTSTRAP_OWNER_EMAIL="owner@example.com" \
   BOOTSTRAP_OWNER_NAME="Owner" \
   BOOTSTRAP_OWNER_PASSWORD="..." \
   npm run auth:bootstrap
   ```
4. Emergency password rotation (also revokes all active Owner sessions):
   ```bash
   npm run auth:bootstrap -- --reset-password
   ```
