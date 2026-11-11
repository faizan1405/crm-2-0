# Scale Flow CRM V2 — B11C-BUSINESS-QA Preparation & Local Verification Report

**Branch:** `feat/b11c-business-final-qa` (created from `dd95f6e`)  
**Staging Target (Unmodified Pending Approval):** `khaki-butterfly-345144.hostingersite.com`  
**CRM V1 Production (`crm.joinscaleflow.in`):** Completely untouched  
**Status:** Local Phases 1–3, Phase 7 Policy & Phase 8 Local Gates complete — **Awaiting explicit Owner approval for remote Phases 4, 5, and 6.**

---

## 1. Phase 2 — Exact 10 MiB Multipart Upload Boundary Fix

### Root Cause
In `src/server/http/crmRoutes.server.ts`, `parseProofUploadRequest` previously checked:
`if (clHeader && Number(clHeader) > MAX_PROOF_BYTES)` against the raw HTTP `Content-Length` header *before* parsing `multipart/form-data`.

Because `multipart/form-data` adds boundaries, `Content-Disposition` / `Content-Type` headers, and optional form metadata fields (`reason`, `mimeType`, `idempotencyKey`, `expectedProofVersion`), an exact **10 MiB** (`10,485,760` bytes) receipt has an HTTP `Content-Length` > `10,485,760` bytes (~`10,486,100`+ bytes), causing valid 10 MiB uploads to fail with `400 file_too_large`. Additionally, chunked requests without `Content-Length` called `request.formData()` / `request.arrayBuffer()` without a streaming byte guard.

### Fix Applied (`src/server/http/crmRoutes.server.ts`)
- Preserved `MAX_PROOF_BYTES = 10 * 1024 * 1024` (`10,485,760` bytes decoded file limit — single source in `proofValidation.server.ts`).
- Added `MAX_PROOF_MULTIPART_OVERHEAD_BYTES = 256 * 1024` (`256 KiB` framing & metadata field allowance) and `MAX_PROOF_MULTIPART_BODY_BYTES = MAX_PROOF_BYTES + MAX_PROOF_MULTIPART_OVERHEAD_BYTES` (`10,747,904` bytes).
- Added `readRequestBodyBounded(request, maxBodyBytes)`:
  - Validates numeric `Content-Length` upfront and rejects oversized requests immediately (`413 file_too_large` for multipart > `MAX_PROOF_MULTIPART_BODY_BYTES`, `400 file_too_large` for raw binary > `MAX_PROOF_BYTES`, `400 validation_error` for JSON > `64 KiB`) before pulling any body chunks.
  - Streams `request.body` incrementally and cancels the `ReadableStream` immediately if streamed bytes cross `maxBodyBytes` (prevents unbounded buffering on `Transfer-Encoding: chunked` or forged `Content-Length`).
  - Rejects truncated uploads where received byte length mismatches declared `Content-Length` (`truncated_body` -> `400 validation_error`).
- Added `parseMultipartFormData(bodyBuffer, rawContentType)` implementing strict RFC 7578 binary boundary parsing directly from bounded `Buffer` slices (`subarray`, zero redundant 10 MiB copy, no `jsdom`/WebIDL realm conflict):
  - Requires valid `boundary=...`, opening `--boundary\r\n`, part headers `\r\n\r\n`, and explicit closing `--boundary--`.
  - Rejects missing boundaries, malformed framing, and truncated uploads lacking the closing delimiter with `400 validation_error`.
  - Enforces exact `fileBuffer.length > MAX_PROOF_BYTES` (`10,485,760` allowed, `10,485,761` rejected with `400 file_too_large`).

### Regression Coverage (`src/server/b11c-business-qa.test.ts`)
All 10 required upload & security scenarios are verified end-to-end against `handleCrmApiRequest` + `MariadbBlobProofStorage`:
1. Valid small JPEG (`201` + identical download).
2. Valid PDF (`201` + identical download).
3. Exact `10 MiB` (`10,485,760` bytes) valid PDF in `multipart/form-data` with `Content-Length > 10 MiB` (`201`, stored across 10 x 1 MiB MariaDB BLOB chunks, downloaded with matching SHA-256).
4. `10 MiB + 1 byte` (`10,485,761` bytes) valid PDF (`400 file_too_large`, zero rows stored).
5. Exact `10 MiB` file + extra `reason`, `mimeType`, `idempotencyKey`, and `PUT` replacement with `10 MiB` JPEG (`201` / `200`).
6. Excessively large request bodies (`> 10.25 MiB`) rejected (`413`) via both `Content-Length` pre-check (0 stream chunks read) and chunked stream abort (`<= 12` MiB chunks read of 30).
7. Missing/invalid multipart boundaries (`400 validation_error`).
8. Truncated multipart body and declared `Content-Length` mismatch (`400 validation_error`).
9. Missing and forged auth cookies (`401 unauthenticated`).
10. Cross-owner upload (Owner B onto Owner A payment -> `404 not_found`, Deal and Payment amounts untouched).

---

## 2. Phase 3 — Backup & Recovery Capability Audit (Manual vs Hostinger Automated)

### Capabilities Distinction
| Capability | Verification Status | Evidence & Notes |
| --- | --- | --- |
| **Manual Logical MariaDB Backup & Restore** (`scripts/b11c-mariadb-backup.mjs`) | **Implemented & Unit-Tested Locally** (Live staging run pending Owner approval for Phase 4) | Consistent snapshot (`REPEATABLE READ` + `START TRANSACTION WITH CONSISTENT SNAPSHOT`), `0x<hex>` / `X''` BLOB encoding, exact `SHOW CREATE TABLE` DDL, `<= 1.5 MiB` batched `INSERT`s, zero-secret manifests, fail-closed clean-target restore guard, and full SHA-256 verification. |
| **Linux / Hostinger SSH `mariadb-dump`** | **Documented (Local Windows host lacks CLI/WSL)** | `mysqldump`, `mariadb-dump`, `mysql`, `mariadb`, `docker`, and `wsl` are not installed on the local Windows machine. Standard Linux/SSH equivalent command is documented below. |
| **Hostinger Automated Business Backup / Restore** | **`NOT VERIFIED`** | Hostinger MCP `search` (`hosting_backups backup restore`) confirmed only VPS (`vps_backups_*`) and agency (`agency-hosting_*`) backup endpoints exist; zero `hostinger_business_v3` automated backup/restore API endpoints exist. Must be treated as unverified and must **not** replace independent off-site encrypted MariaDB backups. |

### Binary-Safe Dump & Restore Tooling (`scripts/b11c-mariadb-backup.mjs`)
- **Export (`--export`):** Uses environment variables (`SOURCE_DB_URL` or `DB_*`) only; sets session `TIME_ZONE = '+00:00'` and `REPEATABLE READ` snapshot; exports all tables sorted (`49` physical tables on staging = `48` Drizzle tables + `__drizzle_migrations`), inspects views/triggers/routines/events, serializes binary/`LONGBLOB` columns (`crm_payment_proof_blobs.blob_data`) strictly as hexadecimal literals (`0x...` / `X''`), caps `INSERT` batches at `1.5 MiB` (well below Hostinger's `16 MB` documented ceiling), and outputs an integrity manifest with per-table row counts, chunk `SHA2(blob_data, 256)` checksums, and dump `SHA-256`.
- **Clean-Target Restore (`--restore`):** Fails closed unless `--confirm-clean-target` is explicitly supplied, target DB name does not match CRM V1 / production patterns or source DB name, and `SHOW TABLES` confirms `0` existing tables. Re-runs table count, row count, chunk SHA-256, and reassembled full-file proof SHA-256 checks post-restore.
- **Linux/SSH Equivalent (`mariadb-dump`):**
  ```bash
  mariadb-dump \
    --single-transaction \
    --routines --triggers --events \
    --hex-blob --default-character-set=utf8mb4 \
    --tz-utc \
    --host="$DB_HOST" --port="$DB_PORT" --user="$DB_USER" \
    "$DB_NAME" > crm_v2_backup_utc.sql
  ```

---

## 3. Phase 7 — MariaDB 3 GB Storage Capacity & Recovery Policy

### Grounded Staging Telemetry (`B11C-BUSINESS-LIVE`)
From `docs/crm-b11c-business-live-verification.md`:
- **Hostinger Business DB Plan Limit:** `3,072 MiB` (`3 GB`).
- **Empty CRM V2 Schema (49 tables):** `4.22 MiB` (InnoDB data + index).
- **Synthetic BLOB Storage Observed:** `15.52 MiB` `crm_payment_proof_blobs` table size for `14.97 MiB` raw proof payload (`~1.0367x`, `~3.67%` InnoDB row/index/chunk overhead at `1 MiB` chunking).
- **Hostinger Panel Reported Disk Usage:** `33 MiB / 3,072 MiB` (~`1.07%`, including InnoDB tablespace preallocation/extents).

### Conservative Capacity Thresholds & Policy
Implemented in `evaluateMariadbStorageCapacity()` (`scripts/b11c-mariadb-backup.mjs`):

| Threshold Level | Trigger | Action & Rationale |
| --- | --- | --- |
| **Normal (`ok`)** | `< 1,536 MiB` (`< 50%`) | Normal operation. Nightly encrypted off-site SQL dump (`0x` hex-encoded BLOBs) + manifest SHA-256 check. |
| **Warning (`warning`)** | `>= 1,536 MiB` (`50%`) | Notify Owner; audit replaced/removed proof history (`crm_payment_proofs`) and orphaned chunks (`reconcileStorage`); verify encrypted off-site dump retention; plan archival or VPS/object-storage transition (`b11a` / `b11c-pre` package ready). |
| **Hard Stop New Proof Uploads (`hard_stop_uploads`)** | `>= 2,150 MiB` (`70%`) | Block new MariaDB BLOB proof uploads proactively (`allowNewProofUploads = false`), reserving **`~922 MiB`** headroom for active CRM Leads/Deals/Payments/Quotations/Audit writes, InnoDB index/undo growth, and consistent snapshot dumps before hitting Hostinger's hard disk quota. |
| **Exhausted (`quota_exhausted`)** | `>= 3,072 MiB` (`100%`) | Immediate storage migration/cleanup incident; read-only protection against `INSERT` failures. |

**Receipt Headroom Estimate (at `~1.0367x` measured BLOB overhead):**
- Up to `2,150 MiB` hard-stop threshold (`2,117 MiB` proof budget remaining from observed `33 MiB` base): **`2,042` × 1 MiB receipts** or **`10,210` × 200 KiB receipts** before triggering proof upload cutoff, while preserving `922 MiB` non-BLOB operational safety margin.
- **Off-site Backup Policy:** Provider/Hostinger automated backups are unverified via API and **never** replace off-site backups. Production launch requires automated daily encrypted off-site dumps stored outside Hostinger (e.g., encrypted Object Storage / offline archive), weekly clean-target restore drill on disposable DB, and **VPS + S3 object storage migration** prior to approaching the `50%`–`70%` database quota band.

---

## 4. Pending Remote Approval Gate

The following **three staging-only remote operations** require explicit Owner approval before execution:
1. **Phase 6:** Rebuild cleanly and redeploy the fixed `B11C-BUSINESS-QA` build to **`khaki-butterfly-345144.hostingersite.com`** ONLY, then verify live HTTP `POST`/`PUT` `10 MiB` upload, `10 MiB + 1` rejection, download integrity, malformed multipart rejection, auth & cross-owner isolation (storing rollback metadata cleanly first).
2. **Phase 4:** Export a full binary-safe backup of `u256504187_crm_b11c_stg`, restore it ONLY into a **NEW empty disposable database** (`u256504187_crm_b11c_rst`), and verify all 49 physical tables, row counts, and binary `SHA-256` checksums end-to-end (leaving source staging DB untouched).
3. **Phase 5:** Register **one temporary staging-only `run-cron.mjs --dry-run` Hostinger cron job** (`<= 255` chars), verify scheduler trigger/completion with zero CRM writes, and delete/disable the temporary cron job afterward.
