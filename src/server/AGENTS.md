# src/server rules

- Every server module lives under `src/server/**` and uses the `.server.ts` suffix so Vite/TanStack `importProtection` fails the build if client bundles import backend code.
- Runtime server modules (`src/server/config/*`, `src/server/db/index.server.ts`, `src/server/db/money.server.ts`, `src/server/health/*`, `src/server/http/*`, `src/server/storage/*`) also import `@tanstack/react-start/server-only` (which exposes `"./server-only"` under ESM `"import"` only). Schema definition modules loaded by `drizzle-kit` CJS CLI (`src/server/db/schema.server.ts`, `src/server/db/conventions.server.ts`) omit `@tanstack/react-start/server-only` so `drizzle-kit generate` runs cleanly in Node while remaining guarded by `**/server/**` and `*.server.ts` rules.
- Do NOT introduce a second HTTP framework alongside Nitro + `src/server.ts`. All `/api/*` requests are intercepted in `src/server.ts` and dispatched via `src/server/http/apiRouter.server.ts` before TanStack Start SSR runs, so API 404/405/500 responses always return JSON with `Cache-Control: no-store`, never SSR HTML error pages.
- Environment variables are validated via Zod in `src/server/config/env.server.ts`. Never read unvalidated secrets across handlers, and never return environment values, DSNs, stack traces, or client PII from health endpoints or logs.
- MySQL/MariaDB connectivity (`src/server/db/index.server.ts`):
  - Default `DB_HOST` is `127.0.0.1` (not `localhost`) so Node 18/20/22/24 does not resolve `::1` against Hostinger IPv4 MySQL grants.
  - Pool limit is bounded (`<= 20`, default `8`) for shared Hostinger process/connection budgets; `multipleStatements` stays `false`; `timezone` stays `"Z"`.
- Money representation (`src/server/db/money.server.ts` + `conventions.server.ts`):
  - Store currency amounts in MySQL `DECIMAL(15, 2)` (`decimalNumbers: false`) and compute strictly in exact integer paise in TypeScript.
- Do not implement authentication, CRM entity endpoints, OpenRouter calls, or production storage handlers outside their approved checkpoints (B1A covers runtime, env, DB/storage foundation, and `/api/v1/health` only).
