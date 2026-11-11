# Scale Flow Sales OS 3.0 — Checkpoint B11C-LAUNCH-HARDENING

**Status:** Local Infrastructure Hardening Complete — Live Staging Verification & Off-Site Backup Activation **BLOCKED / PENDING OWNER APPROVAL**  
**Branch:** `feat/b11c-launch-hardening` (branched from `228214e`)  
**Staging Target:** `khaki-butterfly-345144.hostingersite.com` (NOT modified by this checkpoint)  
**CRM V1 Production:** `crm.joinscaleflow.in` — **UNTOUCHED**

---

## 1. Executive Summary

Checkpoint **B11C-LAUNCH-HARDENING** closes the three infrastructure readiness gaps identified after B11C-BUSINESS-QA (`228214e`) while keeping `PROOF_PRODUCTION_DURABLE_CONFIRMED=false` and unattended production automations disabled:

1. **Database Capacity Limit Enforcement (`3,072 MiB` Hostinger Quota):** Added fail-closed MariaDB capacity measurement (`INFORMATION_SCHEMA.TABLES` + zero-lag `crm_payment_proof_blobs` chunk summation + `16 MiB` safety margin), `50%` (`1,536 MiB`) structured warning events, `70%` (`2,150 MiB`) hard stop returning HTTP `507 storage_quota_exceeded` for new uploads/replacements, and serialized concurrency locking (`AsyncLocalStorage` + per-DB FIFO mutex + MariaDB `GET_LOCK`).
2. **Hostinger Cron Reliability (`run-cron.mjs`):** Eliminated `/opt/alt/alt-nodejs22/root/bin/node` path mismatch and `cd ... && ...` shell chaining in favor of direct `/opt/alt/alt-nodejs22/root/usr/bin/node` execution (`158` chars for staging `--dry-run`, `97` chars below Hostinger's `255`-char limit), plus automatic relative `../../../config/.env` discovery across `hbuilds/current` symlink transitions with strict permission/trust/syntax validation and zero secret printing.
3. **Encrypted Off-Site Backups & Safe Restore (`age v1`):** Built zero-dependency standard `age-encryption.org/v1` (X25519 + 64 KiB ChaCha20-Poly1305 STREAM) + gzip encryption/decryption and freshness/corruption watchdog tooling (`scripts/b11c-backup-crypto.mjs`, `scripts/b11c-mariadb-backup.mjs`) enforcing offline-only owner key custody, webroot/build exclusion, deterministic plaintext staging cleanup, and clean-target empty-DB restore verification.

---

## 2. MariaDB Capacity Enforcement Design (`3,072 MiB` Quota Policy)

| Policy Threshold | Default Value | Ratio of Quota | Runtime Behavior |
|---|---:|---:|---|
| Hard Database Allocation | `3,072 MiB` | `100.0%` | Hostinger Business per-database limit |
| Conservative Safety Margin | `16 MiB` | `~0.5%` | Added to live measured bytes to cover InnoDB stats lag & tablespace gap (B11C-BUSINESS-QA observed `80.83 MiB` logical vs `~100 MiB` Hostinger metric with sample rows) |
| Warning Threshold | `1,536 MiB` | `50.0%` | Emits secret-free `storage_capacity_warning` JSON telemetry; uploads permitted |
| Hard Stop Threshold | `2,150 MiB` | `~70.0%` | Rejects new BLOB uploads & net-positive replacements with HTTP `507 storage_quota_exceeded`; retains `~922 MiB` headroom for CRM tables, indexes, and InnoDB undo/redo logs |
| Measurement / Lock Failure | Fail-closed | `N/A` | Returns HTTP `503 storage_capacity_unavailable`; blocks unverified storage writes |

### Key Implementation Contracts
- **Modules:** `src/server/storage/mariadbCapacity.server.ts`, `src/server/storage/mariadbBlobProofStorage.server.ts`, `src/server/crm/proofService.server.ts`, `src/server/crm/errors.server.ts`, `src/server/config/env.server.ts`.
- **Zero-Lag Concurrent Accounting:** `measureMariadbCapacityFromDb` takes `max(logicalInfoSchemaBytes, nonBlobInfoSchemaBytes + liveBlobWithOverheadBytes) + safetyMarginBytes`, where `liveBlobWithOverheadBytes` queries `COUNT(*)` and `COALESCE(SUM(chunk_size), 0)` directly from `crm_payment_proof_blobs` (multiplied by `1.06` conservative InnoDB expansion + `512 B/chunk` row header).
- **Concurrency Serialization:** `withMariadbCapacityWriteLock` coordinates both an in-process per-DB FIFO promise queue and a MariaDB `GET_LOCK('sf_crm_proof_quota_write', 10)` session lock held across quota measurement, transaction execution, BLOB chunk persistence, and commit before release.
- **Replacements & Invariants:**
  - Replaced historical proofs remain stored in `crm_payment_proof_blobs` for immutable financial audit retention (`retainHistoricalBlobs = true` by default), so expected net growth equals the incoming file footprint (`incoming * 1.06 + chunks * 512 + 8192`). Where remaining `< 70%` budget permits a smaller replacement (`netGrowth` within budget), replacement succeeds; larger replacements exceeding the `2,150 MiB` ceiling fail cleanly with HTTP `507`.
  - When hard stop triggers (`507`) or measurement fails (`503`): **zero** orphan BLOB chunks are created, existing proof downloads remain operational, payment creation/void/edit flows and deal balances remain untouched, and Owner UI (`PilotPaymentDialog.tsx`, `PilotProofViewer.tsx`, `PilotDealsPage.tsx`, `src/lib/api/errors.ts`) renders clear guidance via `formatApiErrorMessage`.

---

## 3. Hostinger Cron Command & Runtime Env Hardening

### Verified Binary & Command Shape
- **Root Cause Fixed:** Hostinger Business shared cron workers use `/opt/alt/alt-nodejs22/root/usr/bin/node` (NOT `/opt/alt/alt-nodejs22/root/bin/node`) and drop output or fail silently on compound `cd ... && ...` panel strings.
- **New Production/Staging Cron Command (`--dry-run`):**
  ```text
  /opt/alt/alt-nodejs22/root/usr/bin/node /home/u256504187/domains/khaki-butterfly-345144.hostingersite.com/hbuilds/current/nodejs/server/run-cron.mjs --dry-run
  ```
  - Exact length: **`158` characters** (`97` chars headroom below Hostinger's `255`-char panel ceiling; whereas passing `--env-file=<config/.env>` puts the same command at `255` characters with zero headroom).
  - With `--owner=usr_owner_main`: **`181` characters** (`74` chars headroom).
  - Contains **zero** shell chaining operators (`&&`, `||`, `;`, `>`, `<`, `|`, backticks, subshells) and omits `--env-file=` from CLI args so custom domains stay under `255` chars.

### Secure `.env` Auto-Discovery (`scripts/run-automation-cron.mjs`)
1. Prioritizes `../../../config/.env` resolved relative to `import.meta.url` (`.../hbuilds/<releaseId|current>/nodejs/server/run-cron.mjs` -> `.../hbuilds/config/.env`), surviving symlink flips across Hostinger Node deployments regardless of cron worker `cwd`.
2. **Fail-Closed Trust Validation:**
   - Rejects paths inside public web directories (`public_html`, `htdocs`, `wwwroot`) or standalone `/tmp/` / `/var/tmp/`.
   - Rejects symbolic links (`lstat.isSymbolicLink()`), non-regular files (`!lstat.isFile()`), POSIX world-writable modes (`mode & 0o002`), and POSIX files not owned by runtime UID or root.
   - Rejects NUL bytes, malformed non-assignment lines, invalid key names, and invalid `NODE_ENV` values.
   - Never logs environment secret values (`DATABASE_URL`, `DB_PASSWORD`, `AUTH_SECRET`, etc.).
3. Continues to block unattended mutations (`--execute-disposable` exits code `2`, `automation_cron_mutations_disabled`), preserves `Asia/Kolkata` (`+05:30`) and UTC bucket calculations, and enforces `GET_LOCK` mutual exclusion.

---

## 4. Encrypted Off-Site Backups & Offline Key Management

### Encryption Standard & Guarantees (`scripts/b11c-backup-crypto.mjs`)
- **Format:** Standard **age v1 (`age-encryption.org/v1`)** X25519 recipient stanza + `64 KiB` ChaCha20-Poly1305 STREAM authenticated chunks wrapping `gzip`-compressed consistent-snapshot SQL (`--export-encrypted`).
- **One-Way Public Key Custody on Hostinger:**
  - Hostinger runtime configuration ONLY holds `BACKUP_AGE_PUBLIC_KEY` (`age1...` public recipient key).
  - Producer fails closed (`assertBackupProducerEnvHasNoPrivateKey`) if `AGE_SECRET_KEY`, `BACKUP_AGE_SECRET_KEY`, `BACKUP_AGE_PRIVATE_KEY`, or `BACKUP_PRIVATE_KEY` is present in the runtime environment.
  - Plaintext SQL and gzip staging artifacts are written strictly outside webroots (`public_html`, `hbuilds`, `.output`, `dist`) inside isolated `0o700` temp directories (`0o600` files) and overwritten/unlinked in `try/finally`.
- **Clean-Target Restore & Integrity Verification (`--restore-encrypted`, `--verify-encrypted`):**
  - Verifies encrypted archive SHA-256 (`.meta.json`), age header HMAC, every 64 KiB STREAM chunk Poly1305 tag + final-chunk marker, gzip decompression integrity, and decrypted SQL SHA-256 against the encrypted manifest (`.manifest.age`).
  - Restore refuses execution without `--confirm-clean-target`, refuses protected production / CRM V1 names, refuses same-as-source DB, and refuses non-empty target databases (`SHOW TABLES > 0`).
- **Freshness & Corruption Watchdog (`--check-backup-health`):**
  - Flags missing archives (`backup_missing`), stale backups (`backup_stale`, default SLA `26h`), malformed/truncated envelopes (`backup_corrupted`), and companion SHA-256 mismatches (`manifest_mismatch`).

### Off-Site Backup Destination Options Comparison

| Destination Option | Approx Cost / Monthly Free Tier | Push/Pull Security Model | Pros for Hostinger Business | Cons / Operational Notes | Status |
|---|---:|---|---|---|---|
| **1. Cloudflare R2 (S3 API, Recommended)** | **\$0/mo up to 10 GB/mo** (no egress fees) | Hostinger cron encrypts locally with `age1...` public key and pushes via write-only Object-Lock/put-only R2 token; lifecycle expires >30d or Admin deletes via separate management token | Zero egress fees on restore tests; S3 API works from short-lived Node script; Object Lock protects against ransomware overwrite | Requires API token setup in Cloudflare + external health ping | **Recommended (Pending Owner Approval)** |
| **2. Backblaze B2 (S3-Compatible)** | **\$0/mo up to 10 GB** (~\$0.006/GB/mo above; 3x free egress) | Same write-only S3 push token (`s3:PutObject` only on bucket) + age v1 client-side encryption | Mature immutability/Object Lock; trivial lifecycle retention | Over-10 GB egress costs apply after 3x storage cap | Viable Alternative |
| **3. Private Admin Workstation / Dedicated VPS Pull (SFTP/SSH)** | \$0 if existing Admin workstation / \$4–5/mo for tiny external pull node | Remote pull machine fetches encrypted `.sql.gz.age` over key-based SSH after Hostinger job stages outside `public_html` | Zero third-party cloud storage credentials stored on Hostinger at all | Requires reliable always-on pull host or scheduled pull job; failed workstation poll risks delayed off-site copy | Most Isolated Pull Model |

### Offline Owner Key Generation, Custody & Disaster Recovery Runbook
1. **Generate Offline Keypair (on Owner/Admin local trusted machine, NEVER on Hostinger):**
   ```bash
   node scripts/b11c-mariadb-backup.mjs --keygen
   ```
2. **Offline Custody Rules:**
   - Save `AGE-SECRET-KEY-1...` inside two offline/escrowed locations (e.g., encrypted password manager vault + printed physical recovery sheet in Owner safe).
   - **Never** upload `AGE-SECRET-KEY-1...` to GitHub, Hostinger File Manager, `hbuilds/config/.env`, browser storage, or chat transcripts.
   - Add **only** `BACKUP_AGE_PUBLIC_KEY=age1...` to `hbuilds/config/.env` (or backup runner env).
3. **Key Rotation Procedure:**
   - Generate new keypair `--keygen`, swap `BACKUP_AGE_PUBLIC_KEY` in backup config, retain prior offline `AGE-SECRET-KEY-1...` labeled with rotation date until all older archives expire (e.g. 90 days), and verify one fresh backup with `--verify-encrypted`.
4. **Full Database + Proof Recovery Drill (Operator Workstation):**
   - Download latest `<backup>.sql.gz.age`, `<backup>.sql.gz.age.manifest.age`, and `<backup>.sql.gz.age.meta.json`.
   - Create an **empty** destination MariaDB database via Hostinger hPanel.
   - Run from operator shell (holding `TARGET_DB_*` + `BACKUP_AGE_SECRET_KEY` transiently in memory):
     ```bash
     node scripts/b11c-mariadb-backup.mjs --restore-encrypted --in-age /path/to/backup.sql.gz.age --source-db <source_db_name> --confirm-clean-target
     ```
   - Confirm `"ok": true`, `restoredTableCount === 49`, zero row/blob mismatches, and 100% matched `proofIntegrityResults`.
   - Clear `BACKUP_AGE_SECRET_KEY` from operator shell history/environment immediately after drill.

---

## 5. Known Hostinger Business Plan Constraints
- No OS-level `mysqldump` or `age` binaries assumed on Hostinger PHP/Node cron workers -> implemented purely in Node (`mysql2` consistent snapshot SQL + `node:crypto` + `node:zlib`).
- Strict `255`-char Hostinger hPanel cron command cap and no compound `cd &&` guarantees -> solved via direct `/opt/alt/alt-nodejs22/root/usr/bin/node .../run-cron.mjs --dry-run` (`158` chars).
- Single shared database `3 GB` (`3,072 MiB`) limit -> defended by app-level `70%` (`2,150 MiB`) hard stop + serialized write lock + `16 MiB` safety margin; large archival/S3 offloading remains the Phase B scaling path once proof volume grows near `50%`.

---

## 6. Limited Staging Regression Verification Plan & Approval Checklist (NOT YET EXECUTED)

Per strict B11C-LAUNCH-HARDENING rules, **no remote deployment, cron execution, or off-site transfer has been executed in this checkpoint**. Before cutting over `PROOF_STORAGE_DRIVER=mariadb-blob` or enabling any scheduled backups/crons, request explicit Owner approval for:

1. **Limited Staging Deployment (`khaki-butterfly-345144.hostingersite.com` + disposable staging DB `u256504187_crm_b11c_stg` only):**
   - Save fresh pre-deploy rollback snapshot before deploying built `.output`.
   - Deploy updated build containing `mariadbCapacity.server.ts`, updated `run-cron.mjs`, and `b11c-mariadb-backup.mjs`.
   - Test with synthetic `MARIADB_QUOTA_MIB` / `MARIADB_HARD_STOP_MIB` staging thresholds:
     - Verify `50%` warning telemetry log without blocking upload.
     - Verify `70%` hard-stop HTTP `507 storage_quota_exceeded` JSON response and UI toast/error presentation while existing proof downloads and payment ledger mutations succeed cleanly.
     - Verify two concurrent uploads competing for final headroom do not breach hard stop and leave `0` orphan BLOB chunks.
2. **Temporary Staging Cron Verification (Dry-Run Only):**
   - Schedule ONE temporary Hostinger cron using the exact shell-free `158`-char command (`/opt/alt/alt-nodejs22/root/usr/bin/node /home/u256504187/domains/khaki-butterfly-345144.hostingersite.com/hbuilds/current/nodejs/server/run-cron.mjs --dry-run`).
   - Verify non-empty JSON execution output (`"ok": true`, `"envSource": "auto_discovered_env_file"`, `"outboundDeliveryGuaranteedDisabled": true`), then **delete** the temporary cron job immediately.
3. **Encrypted Backup Round-Trip Drill on Staging DB (Owner Approval + Chosen Off-Site Destination Required):**
   - Owner supplies `BACKUP_AGE_PUBLIC_KEY` (`age1...`) generated offline and selects an off-site destination (Cloudflare R2 / Backblaze B2 / private pull).
   - Export encrypted synthetic staging backup (`u256504187_crm_b11c_stg`), upload encrypted bundle to approved off-site destination, run watchdog `--check-backup-health`, then restore into an empty disposable database (`u256504187_crm_b11c_rst2`) with `--confirm-clean-target` using offline secret key to prove 49/49 tables and 100% SHA-256 payment-proof parity.
4. **Status Pending Approval:**
   - Live staging HTTP `507` / concurrency verification: **PENDING OWNER APPROVAL**
   - Live Hostinger `158`-char cron scheduler dry-run: **PENDING OWNER APPROVAL**
   - Real off-site encrypted backup upload & clean-target restore drill: **BLOCKED (awaiting Owner keypair custody & destination approval)**
   - Production durable storage confirmation (`PROOF_PRODUCTION_DURABLE_CONFIRMED`): Remains **`false`** (fail-closed)
   - Production CRM automations & CRM V1 (`crm.joinscaleflow.in`): **UNTOUCHED / DISABLED**
