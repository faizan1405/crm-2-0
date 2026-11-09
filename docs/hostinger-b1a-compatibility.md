# Hostinger Managed Node.js Compatibility Assessment — Checkpoint B1A

Verified on branch `feat/b1a-backend-foundation` against official Hostinger Node.js support docs and local Nitro `node-server` build inspection. No Hostinger production/staging resources or credentials were created or accessed.

## 1. Feasibility Verdict (Business/Unlimited Web & Cloud vs VPS)
**Feasible on Hostinger Business/Unlimited Web & Cloud managed Node.js plans** with specific deployment configuration — **do not purchase a VPS unless live staging reveals a hard limit violation** in real usage.

Official Hostinger docs consulted:
- Deploying a Node.js web app (Express/frameworks, GitHub & archive upload, custom start command/output directory, managed env vars)
- Hostinger Node.js limits for Web and Cloud plans
- Scheduled Node.js cron jobs at Hostinger

## 2. Capabilities Matrix: Confirmed vs Requires Live Staging Test

| Capability | Status | Details & CRM V2 Impact |
|---|---|---|
| **Node.js runtime version** | Confirmed (Docs + Local Build) | Hostinger supports Node 18 / 20 / 22 / 24. `@tanstack/react-start@1.168.60` requires `node >= 22.12.0` (`package.json` `engines.node` pinned). Select **Node 22 LTS or Node 24 LTS** in hPanel. |
| **Package manager & lockfile** | Confirmed Gap Resolved | Hostinger supports `npm`, `yarn`, and `pnpm` — **NOT `bun`**. Repository originally shipped only `bun.lock`. `package-lock.json` is generated cleanly against public `registry.npmjs.org` for Hostinger `npm ci` / `npm install`. |
| **Nitro `node-server` entrypoint** | Confirmed Locally / **Test on Hostinger** | `vite.config.ts` sets `nitro: { preset: "node-server" }` and builds single-process `.output/server/index.mjs` + `.output/public/*`. Started locally via `node .output/server/index.mjs`, reading `PORT` / `NITRO_PORT` and serving both `/api/v1/health` and all SSR/SPA routes. Hostinger auto-detects common frameworks; **TanStack Start requires testing `"Other"` preset + custom build/start (`npm run build` / `npm start`) / `.output` preservation** in live hPanel. |
| **Managed environment variables** | Confirmed (Docs) | Hostinger injects managed env vars at build & runtime (`loadServerEnv()` reads standard `process.env`). Cron runs in an isolated shell and must load `--env-file=.builds/config/.env` (exact hPanel path must be confirmed in staging). |
| **MySQL / MariaDB connectivity** | Confirmed (Docs + `mysql2` + Drizzle Probe) | Use `DB_HOST=127.0.0.1` (never `localhost` on Node 18/20/22/24 to avoid IPv6 `::1` grant mismatch). Shared plan connection/process ceiling (`NPROC` ~120 Business / 200+ Cloud) fits single-process Nitro with `DB_POOL_LIMIT=8`. Live Cloud/Business MySQL grant + idle timeout testing remains open for staging. |
| **Private payment-proof durability across redeploys** | **CRITICAL — Requires Live Hosting Test** | Hostinger deploys into versioned `~/domains/{domain}/hbuilds/current/nodejs` symlinks and keeps `hbuilds/last-source`. Anything stored inside `hbuilds/current/nodejs` or `public_html` is **unsafe or ephemeral across redeploys**. Staging must test whether a sibling directory outside both (e.g. `~/domains/{domain}/private-data/payment-proofs`) is writable and preserved across redeploys; otherwise use private S3-compatible object storage (Cloudflare R2 / Backblaze B2) behind authenticated API streaming (`PROOF_STORAGE_DRIVER=object-storage`). |
| **Always-on daemons & WebSockets** | Confirmed Unsupported (Acceptable for CRM V2) | Managed hosting allows **no** always-running workers, **no** cluster/worker-process forks, **no** inbound WebSockets, and caps HTTP requests at **120s**. Single-owner CRM V2 + short REST/AI requests fit safely (`<= 30s` OpenRouter timeouts). Multi-user realtime push later would use SSE/polling rather than WebSockets. |
| **Scheduled automations (Cron)** | Confirmed with Constraints | hPanel runs Node cron scripts in UTC (`/opt/alt/alt-nodejs{VER}/root/bin/node --env-file=...`), max **30 min** execution. Existing IST business-time (`Asia/Kolkata`) logic must convert UTC triggers cleanly inside server cron handlers. |
| **Backup & dedicated CRM V2 domain** | Confirmed Architecturally | Deploy CRM V2 on its own domain/subdomain + its own MySQL DB + git branch, completely separate from CRM V1 (`crm.joinscaleflow.in` / `faizan1405/CRM`). Note hPanel Business limits **1 Node app on Business, up to 10 on Cloud Startup+**. |

## 3. Database & Exact-Money Assessment (`src/server/db/*`)
- **Stack:** `drizzle-orm` + `mysql2` (`drizzle-kit` for MySQL schema generation/checks).
- **Precision:** All currency columns use `DECIMAL(15, 2)` (`inrDecimal()`) read with `decimalNumbers: false` (string), converted in TypeScript to exact integer paise via `src/server/db/money.server.ts` so `0.1 + 0.2` binary float errors never touch ledger math.
- **Dates & concurrency:** Instants stored as UTC `DATETIME(3)` (`mode: "string"`) avoiding MySQL `TIMESTAMP` Y2038 limits; due/payment dates stored as `CHAR(10)` `YYYY-MM-DD` (`Asia/Kolkata`); optimistic concurrency preserves `version INT DEFAULT 1` per editable entity.

## 4. Verified Data Vault Discrepancy Result
Confirmed in [`src/lib/crm/vault.ts`](../src/lib/crm/vault.ts), [`src/routes/data-vault.tsx`](../src/routes/data-vault.tsx), and synthetic test [`src/test/data-vault-proof.b1a.test.ts`](../src/test/data-vault-proof.b1a.test.ts):
- Data Vault ZIP export **already** loads proof binaries from IndexedDB `scale-flow-payment-proofs` via `idbProofRepo`, writes each file to `files/payment-proofs/<paymentId>__<originalFileName>`, writes SHA-256 checksums + metadata to `data/attachment-metadata.json` and `manifest.json`, and self-validates the archive via `validateBackup()`.
- `docs/antigravity-hostinger-backend-handover.md` and `docs/DATA_CONTRACTS.md` contained stale pre-Phase-3B.5 wording claiming proof export had not been built yet — both docs have been corrected in B1A.
