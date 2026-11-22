# Scale Flow CRM V2 — Checkpoint B14F: Fresh Production Launch Plan

**Owner Decision:** Fresh start from scratch — **ZERO legacy CRM V1 / browser data import or migration.**  
**Hosting:** Existing Hostinger Business (`u256504187`, Order `1010060772`) exclusively — **No VPS, No Cloudflare.**  
**CRM V1 Isolation:** `https://crm.joinscaleflow.in` (`main` vhost) remains 100% untouched.

---

## 1. Production Architecture (`crm2.joinscaleflow.in`)

| Component | Production Value | Isolation / Notes |
|---|---|---|
| **Domain** | `crm2.joinscaleflow.in` | Single-level subdomain (supported natively by `hosting_websites_create` on Hostinger Business). |
| **Node.js Runtime Slot** | **5th of 5 slots** on `u256504187` | Verified live: 4/5 slots currently used (`crm.joinscaleflow.in`, `joinscaleflow.in`, `minddesk.joinscaleflow.in`, `khaki-butterfly-345144.hostingersite.com`). Existing staging stays separate! |
| **Database** | **NEW `u256504187_crm_v2_prod`** | Dedicated user `u256504187_crm_v2_usr` on `srv469.hstgr.io` (3,072 MiB quota). Zero staging records copied. |
| **Payment Proofs** | `PROOF_STORAGE_DRIVER=mariadb-blob` | Stored as chunked LONGBLOBs with SHA-256 verification. `PROOF_PRODUCTION_DURABLE_CONFIRMED` stays `false` until live production verification passes. |
| **Default Backend Flag** | `CRM_V2_DEFAULT_BACKEND=true` | All 18 Owner modules run natively on MariaDB without `?pilot=1`; zero localStorage/demo fallback. |
| **Automations** | **Disabled** | `0` active cron jobs; zero outbound customer messaging. |

---

## 2. Fresh Database & Owner Bootstrap Sequence (Executed ONLY After Owner Approval)

1. Provision `crm2.joinscaleflow.in` (5th Node.js slot on Order `1010060772`) + SSL certificate + DNS A/CNAME verification.
2. Provision empty MariaDB database `u256504187_crm_v2_prod` + dedicated user `u256504187_crm_v2_usr`.
3. Configure production `.env` (`NODE_ENV=production`, `CRM_V2_DEFAULT_BACKEND=true`, `DEV_LEAD_PILOT=false`, `APP_ORIGIN=https://crm2.joinscaleflow.in`, `BUSINESS_TIMEZONE=Asia/Kolkata`, `PROOF_STORAGE_DRIVER=mariadb-blob`, `PROOF_PRODUCTION_DURABLE_CONFIRMED=false`, fresh 64-byte `AUTH_SECRET`, `AUTH_TRUST_PROXY=true`).
4. Run all 16 Drizzle schema migrations against `u256504187_crm_v2_prod` (`0` leads, `0` deals, `0` payments, `0` quotations, `0` projects).
5. Deploy verified release build (`b14f` commit) to `crm2.joinscaleflow.in`.
6. Run `scripts/bootstrap-owner.mjs` interactively on the server to create your real production Owner credentials (never stored in Git, logs, or chat).
7. Run Phase 5 acceptance test using a **disposable synthetic QA account** (Lead → Call → Follow-up → Pipeline → Deal → Payment + Receipt SHA-256 → Quotation → Project → Dashboard + refresh + logout/login + mobile viewport + cross-Owner isolation), then delete the disposable synthetic QA account's rows so your production Owner account remains 100% clean (0 records, genuine empty states on all 18 modules).
8. Verify Hostinger daily hPanel backup + run one clean `mysqldump --single-transaction` backup test before enabling `PROOF_PRODUCTION_DURABLE_CONFIRMED=true`.

---

## 3. Rollback Guarantee

- `https://crm.joinscaleflow.in` (CRM V1) and `https://khaki-butterfly-345144.hostingersite.com` (Staging) remain 100% untouched.
- If any issue occurs on `crm2.joinscaleflow.in`, CRM V1 continues operating with zero downtime.
