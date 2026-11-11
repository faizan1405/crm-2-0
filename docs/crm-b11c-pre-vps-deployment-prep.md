# Checkpoint B11C-PRE — Hostinger VPS Deployment Preparation & Safety Gate

> **Branch:** `feat/b11c-pre-vps-deployment-preparation` (branched cleanly from `feat/b11b-hostinger-storage-decision-gate` / `c1f627c`)  
> **Scope:** **LOCAL PREPARATION ONLY.** Zero VPS purchases, zero Hostinger account mutations, zero DNS changes, zero remote uploads, zero GitHub pushes, zero CRM V1/customer-data modifications.  
> **Production Proof Storage Verdict:** **REMAINS BLOCKED / FAIL CLOSED (`503`)** (`PROOF_PRODUCTION_DURABLE_CONFIRMED=false`) until Owner approves provisioning and all **20 staging durability checks** execute and pass cleanly in **Checkpoint B11C**.

---

## 1. Verified Starting Baseline

1. **Git Lineage:** Branched cleanly from `feat/b11b-hostinger-storage-decision-gate` at commit `c1f627c` with a clean working tree (`git status --short` empty prior to B11C-PRE additions).
2. **Database Table Inventory Confirmed (`48` Physical / `47` Drizzle Schema / `46` `crm_*`):**
   - `46` `crm_*` tables + `1` `_crm_schema_meta` table = `47` tables declared in [`src/server/db/schema.server.ts`](../src/server/db/schema.server.ts) and [`0014_snapshot.json`](../src/server/db/migrations/meta/0014_snapshot.json) (`Diff = 0`), across `15` migrations (`0000_b1b_owner_auth.sql` .. `0014_b11a_proof_storage_hardening.sql`).
   - `+ 1` runtime migrator journal (`__drizzle_migrations`) created by [`scripts/db-migrate.mjs`](../scripts/db-migrate.mjs) = **`48` total physical MariaDB tables**.
3. **B11A Storage Contract & Runtime Compatibility:**
   - Compiled Nitro preset (`nitro.preset: "node-server"` in [`vite.config.ts`](../vite.config.ts)) outputs `.output/server/index.mjs` and requires Node.js `>= 22.12.0` ([`package.json`](../package.json)).
   - [`src/server/storage/proofStorage.server.ts`](../src/server/storage/proofStorage.server.ts) wires `PROOF_STORAGE_DRIVER=hostinger-private-fs` to `LocalFsProofStorage` (persisting binaries under `<PROOF_STORAGE_DIR>/proofs/` and transient upload temps under `<PROOF_STORAGE_DIR>/staging/`), while [`assessProofStorageEnv`](../src/server/config/env.server.ts) enforces fail-closed `503` blocking unless `PROOF_PRODUCTION_DURABLE_CONFIRMED=true` AND `PROOF_STORAGE_DIR` is outside `["public_html", "public", ".output", "dist", "hbuilds"]`.
4. **B10C-QA Automation Lockout:** `POST /api/v1/automations/:id/execute-test` enforces `NODE_ENV !== "production"`, `DEV_LEAD_PILOT=true`, loopback DB, and `AUTOMATION_TEST_DB_ALLOWLIST` ([`src/server/http/crmRoutes.server.ts`](../src/server/http/crmRoutes.server.ts#L4867-L4920)). Unattended background schedulers remain **disabled**.
5. **CRM V1 & Browser-Local Preservation:** `crm.joinscaleflow.in`, Hostinger Business `u256504187`, `localStorage` (`scale-flow-crm-2-demo`), and IndexedDB (`scale-flow-payment-proofs`) remain completely untouched.

---

## 2. Proposed VPS Architecture & Resource Sizing Assessment

### Baseline Hostinger KVM 1 Target Specification (From B11B Audit)

- **Region:** Mumbai 2, India (`mum2`, Hostinger DC ID `23`)
- **Hardware:** `1 vCPU`, `4 GB RAM`, `50 GB NVMe`, `4 TB` bandwidth
- **OS Baseline:** Ubuntu 24.04 LTS (verified available in Hostinger `vps_templates_list` as ID `1077`), subject to staging compatibility verification (`Node >= 22.12.0` + `MariaDB 11.4` + `Nginx`)
- **Process Architecture:** Single co-located node behind Nginx reverse proxy (`HTTPS 443 -> 127.0.0.1:3000 -> MariaDB 11.4 on 127.0.0.1:3306`) supervised by `systemd`

### Resource Allocation & Sizing Assessment (Planning Baseline Only)

> [!WARNING]
> **4 GB RAM Adequacy Is Unverified Until B11C Staging Tests:** The allocations below are engineering planning baselines only. **Do not claim 1 vCPU / 4 GB RAM is adequately sized** until real staging memory pressure, multi-file 10 MiB proof uploads, and `mariadb-dump` + `zstd` + `age` compression benchmarks pass without OOM kills or latency degradation in B11C.

| Component / Budget | Planning Allocation | Configuration Guard / Notes |
| --- | --- | --- |
| **Linux OS + Nginx + Fail2ban + Systemd** | ~350–450 MB RAM | Ubuntu 24.04 minimal headless LTS; no desktop or panel bloat (no CyberPanel/HestiaCP) |
| **Nitro Node.js Runtime (`scaleflow-crm.service`)** | `NODE_OPTIONS=--max-old-space-size=1024`<br>`MemoryHigh=1200M` / `MemoryMax=1536M` | Prevents V8 heap growth from starving MariaDB on 4 GB RAM; `DB_POOL_LIMIT=8` caps pool connections |
| **MariaDB 11.4 (`60-scaleflow-crm.cnf`)** | `innodb_buffer_pool_size=768M`<br>`innodb_log_file_size=128M`<br>`max_connections=60` | Tuned cleanly for 1–2 GB working dataset alongside Node; ACID `innodb_flush_log_at_trx_commit=1` |
| **Backup / `zstd` / `age` / `apt` Spikes** | ~256–512 MB burst (`zstd -T1`) | Single-thread `zstd -T1` prevents multi-core memory/CPU exhaustion on 1 vCPU |
| **Emergency Swapfile Safeguard** | `2 GB` `/swapfile` (`vm.swappiness=10`) | Configured in `01-bootstrap-vps.sh` to absorb transient `npm ci --omit=dev` or upload/dump spikes without kernel OOM killer |
| **50 GB NVMe Disk Budget** | OS (~8 GB) + Releases x5 (~2 GB) + MariaDB + Backups local cache + Private proofs + **Min `5 GiB` preflight floor** | `04-validate-env-and-preflight.sh` fails closed below `5 GiB` free space |
| **Upgrade Path** | Seamless tier bump to KVM 2 (`2 vCPU / 8 GB RAM / 100 GB NVMe`) | Requires ~10 min downtime + SSH partition expansion (`lsblk`/`parted`) if B11C staging metrics show contention |

---

## 3. Hardened Filesystem Structure & Private Storage Alignment

All private files reside outside Nginx webroots (`public_html`, `/var/www/html`) and outside immutable release builds (`/opt/scaleflow-crm/releases/`):

| VPS Path | Purpose | Owner & Mode | Exposure & Lifetime |
| --- | --- | --- | --- |
| `/opt/scaleflow-crm/releases/` | Immutable release directories (`<git-sha>`) | `deploy:crmapp` (`0755`) | Read-only during service runtime (`ReadOnlyPaths=/opt/scaleflow-crm` in systemd) |
| `/opt/scaleflow-crm/current` | Atomic symlink to active release | Symlink -> `releases/<id>` | Updated only after preflight, backup, and `db:migrate` pass |
| `/var/lib/scaleflow-crm/private-proofs/` | Root `PROOF_STORAGE_DIR` configured for `hostinger-private-fs` | `crmapp:crmapp` (`0700`) | **Zero web exposure.** Contains `<dir>/proofs/` (opaque `prf_<proofId>.<ext>`, `0600`) and `<dir>/staging/` (app `tmp_*` upload staging) per `LocalFsProofStorage` |
| `/var/lib/scaleflow-crm/staging/` | Controlled operational & verification workspace | `crmapp:crmapp` (`0700`) | Used by temporary backup pipes, B11C clean-target restore drills, and harness state JSON |
| `/etc/scaleflow-crm/crm.env` | Runtime secrets & environment config | `root:crmapp` (`0640`) | Loaded only via systemd `EnvironmentFile`; never committed or placed in `/opt/scaleflow-crm` |
| `/var/log/scaleflow-crm/` | Application, Nginx, MariaDB, backup logs | `root:adm` (`0750`) + `mariadb/` (`mysql:adm` `0750`) | Daily `14`-day compressed rotation via `/etc/logrotate.d/scaleflow-crm` |
| `/var/backups/scaleflow-crm/` | Local encrypted `.tar.zst.age` + `.sha256` staging ring | `root:root` (`0700`) | Replicated off-VPS (`30`-day target retention); zero private decryption keys stored here |

---

## 4. Prepared Templates, Scripts & Execution Safety Gates

Located under [`infra/hostinger-vps/`](../infra/hostinger-vps/README.md):

### Templates (`infra/hostinger-vps/templates/`)
- [`crm.env.example`](../infra/hostinger-vps/templates/crm.env.example) — Production defaults (`NODE_ENV=production`, `DEV_LEAD_PILOT=false`, `HOST=127.0.0.1`, `DB_HOST=127.0.0.1`, `AUTH_TRUST_PROXY=true`, `PROOF_PRODUCTION_DURABLE_CONFIRMED=false`), unreplaced placeholder markers (`__REPLACE_...__`), and zero secrets.
- [`nginx-scaleflow-crm.conf.template`](../infra/hostinger-vps/templates/nginx-scaleflow-crm.conf.template) — HTTP->HTTPS redirect, ACME HTTP-01 exception, `Strict-Transport-Security`, `client_max_body_size 12m`, explicit `404` on dotfiles and `/private-proofs`/`/proofs`/`/staging`, proxy to `127.0.0.1:3000`.
- [`scaleflow-crm.service.template`](../infra/hostinger-vps/templates/scaleflow-crm.service.template) — Runs `.output/server/index.mjs` as unprivileged `crmapp` under systemd `ProtectSystem=strict`, `NoNewPrivileges=yes`, `PrivateTmp=yes`, `ProtectHome=yes`, empty `CapabilityBoundingSet=`, and `ReadWritePaths=/var/lib/scaleflow-crm /var/log/scaleflow-crm`.
- [`mariadb-crm.cnf.template`](../infra/hostinger-vps/templates/mariadb-crm.cnf.template) — Loopback-only `bind-address = 127.0.0.1`, UTC `+00:00`, `utf8mb4_unicode_ci`, `innodb_flush_log_at_trx_commit = 1`, isolated slow/error logs.
- [`logrotate-scaleflow-crm.template`](../infra/hostinger-vps/templates/logrotate-scaleflow-crm.template) — 14-day rotation for app, Nginx, backup, and MariaDB logs.

### Operational Scripts (`infra/hostinger-vps/scripts/`)
Every script sources `lib-common.sh`, checks `ALLOW_REAL_VPS_CHANGES=true` + Ubuntu root check, blocks `crm.joinscaleflow.in` (`assert_not_crm_v1_domain`), validates configuration without printing secrets, and demands explicit typed confirmation phrases (`BOOTSTRAP CRM VPS`, `INSTALL NODE AND MARIADB`, `CONFIGURE NGINX TLS`, `DEPLOY CRM RELEASE <id>`, `ROLLBACK CRM RELEASE`, `RESTORE OVERWRITE LIVE CRM`) on provisioning/mutating/destructive actions:

1. `01-bootstrap-vps.sh` — Packages (`ufw`, `fail2ban`, `unattended-upgrades`, `nginx`, `certbot`, `age`, `zstd`, `jq`, `acl`), `2 GB` swapfile, `crmapp` & `deploy` users, SSH-key presence verification prior to disabling password auth, UFW (`limit 22/tcp`, allow `80/443`, deny `3000/3306`), directory layout.
2. `02-install-node-mariadb.sh` — Node.js `22.x LTS` + MariaDB `11.4` repository, installs `60-scaleflow-crm.cnf`, creates target DB & least-privilege `crm_app`@`127.0.0.1` account via hidden prompt.
3. `03-configure-nginx-tls.sh` — Installs systemd + logrotate, checks live DNS matches VPS public IPv4 before ACME Certbot run, enables TLS Nginx vhost.
4. `04-validate-env-and-preflight.sh` — Non-destructive validator verifying `crm.env` placeholders, HTTPS `APP_ORIGIN`, `DB_HOST=127.0.0.1`, `AUTOMATION_TEST_DB_ALLOWLIST` absence, `AGE-SECRET-KEY` absence, `0700`/`0640` permissions, `>= 5 GiB` disk headroom, and live `SELECT 1`.
5. `05-deploy-release.sh` — Runs preflight, enforces mandatory pre-deploy encrypted backup (`07-backup-encrypted.sh`), unpacks `.tar.gz` into immutable `releases/<id>`, runs `npm ci --omit=dev` (if needed) + `node scripts/db-migrate.mjs`, switches `current` symlink atomically, restarts systemd, checks `/api/v1/health` (auto-reverting code symlink if unhealthy while never modifying private proof files), and keeps newest 5 releases.
6. `06-rollback-release.sh` — Code rollback requiring `--to-release`, `--ack-schema-compatible`, typed confirmation, and `/api/v1/health` verification.
7. `07-backup-encrypted.sh` — Produces encrypted `.tar.zst.age` + `.sha256` bundle.
8. `08-restore-verify.sh` — Verifies archive hashes, decrypts via ephemeral Owner-provided private key (`--age-identity`), executes either clean disposable verification restore (`staging-clean-verify`) or gated live restore (`overwrite-live`), and reconciles `crm_payment_proofs` `(id, storage_key, sha256_hash, file_size)` against restored binaries.

---

## 5. Database Setup & Bootstrap Runbook (Staging / Future Prod)

1. Run `02-install-node-mariadb.sh` to install **MariaDB 11.4** (`default-time-zone = '+00:00'`, `bind-address = 127.0.0.1`).
2. Populate `/etc/scaleflow-crm/crm.env` from `crm.env.example` (`DB_HOST=127.0.0.1`, strong `DB_PASSWORD`, `64`-hex `AUTH_SECRET`, `PROOF_PRODUCTION_DURABLE_CONFIRMED=false`, `DEV_LEAD_PILOT=false`).
3. Lock permissions cleanly: `chown root:crmapp /etc/scaleflow-crm/crm.env && chmod 0640 /etc/scaleflow-crm/crm.env`.
4. Validate preflight (`04-validate-env-and-preflight.sh`).
5. Deploy first release (`05-deploy-release.sh --allow-initial-empty`) -> runs `node scripts/db-migrate.mjs`, creating all **`48` physical tables** (`46 crm_*` + `_crm_schema_meta` + `__drizzle_migrations`).
6. Verify `SHOW TABLES` count (`48`) cleanly via MariaDB loopback.
7. Create the single Owner account interactively (zero passwords in scripts or CLI args):
   `set -a && source /etc/scaleflow-crm/crm.env && set +a && node /opt/scaleflow-crm/current/scripts/bootstrap-owner.mjs`
8. Confirm `/api/v1/health` returns `200 OK`, `runtime.env === "production"`, `database.status === "configured"`, and `storage.failClosed === true` until `20/20` staging tests pass!

---

## 6. Staging DNS & SSL Plan (PROPOSED Names Only)

| Role | Proposed Hostname | Current Status | Explicit Protection Rule |
| --- | --- | --- | --- |
| **CRM V1 Live Production** | `crm.joinscaleflow.in` | Active on `hostinger_business_v3` (`u256504187`) | **FORBIDDEN TO MODIFY.** Hard-blocked inside `lib-common.sh` and `b11c-staging-durability-harness.mjs` |
| **CRM V2 Staging (Proposed)** | `staging-v2.joinscaleflow.in` | **NOT CREATED** (pending Owner approval) | Separate DNS A record -> dedicated KVM 1 VPS IPv4; ACME HTTP-01 -> Let's Encrypt TLS |
| **CRM V2 Future Production (Proposed)** | `v2.crm.joinscaleflow.in` | **NOT CREATED** (deferred until B13 cutover approval) | Will use clean HTTPS cutover only after B11C & B12 pass |

---

## 7. Encrypted Backup & Disaster Recovery Architecture

Because Hostinger documentation confirms **VPS backups and snapshots are NOT encrypted at rest**, `07-backup-encrypted.sh` enforces authenticated client/server-side encryption before any archive leaves the memory pipeline:

- **Asymmetric Encryption (`age`):** The VPS holds **ONLY** the public recipient (`BACKUP_AGE_RECIPIENT=age1...`). Even full root compromise on the VPS cannot decrypt older `.tar.zst.age` archives. The decryption identity (`AGE-SECRET-KEY-...`) MUST remain offline with the Owner.
- **Backup Scope Covered:**
  1. Consistent point-in-time SQL dump (`mariadb-dump --single-transaction --quick --hex-blob --routines --triggers` -> all `48` tables including schema, CRM records, proof metadata, and audit history).
  2. All durable proof binaries (`/var/lib/scaleflow-crm/private-proofs/proofs/prf_*`, excluding transient `staging/`).
  3. Secret-free configuration key inventory (`metadata/config-inventory.json` — key names only, zero passwords/tokens).
  4. Integrity manifest (`manifest.json` + `metadata/proof-files.sha256` with exact SHA-256 digests and row/file counts).
- **Retention & Off-VPS Destination Gap (IMPORTANT):**
  - Target policy: **30-day retention** with automated daily archives + pre-deploy snapshots + quarterly restore drills.
  - **CRITICAL OPERATIONAL WARNING:** Do **not** assume a personal Windows laptop that can be powered off, asleep, or disconnected provides reliable unattended backup retention.
  - The authoritative **off-VPS encrypted backup destination** (e.g., an always-on append-only SFTP/VPS target inside Hostinger or an explicitly approved object store exception) remains an **UNRESOLVED OWNER DECISION** required before production cutover (`B12`/`B13`).

### Disaster Restore & Proof Reconciliation Protocol (`08-restore-verify.sh`)

1. Owner supplies decrypted identity ephemerally during drill/restore (`--age-identity /mnt/secure-key/owner.agekey` — deleted/unmounted immediately afterward).
2. Run clean staging verification first (`08-restore-verify.sh --mode staging-clean-verify --archive ...`):
   - Validates `.tar.zst.age.sha256`, decrypts via `age -d`, verifies `manifest.json` SHA-256 of `database.sql` and every binary under `files/proofs/`.
   - Loads `database.sql` into isolated DB (`scaleflow_crm_restore_verify`), confirms `>= 48` physical tables, and reconciles every row in `crm_payment_proofs` (`id`, `storage_key`, `sha256_hash`, `file_size`) against restored disk files (`0` mismatches required).
3. For catastrophic live recovery, run `--mode overwrite-live` (stops `scaleflow-crm`, verifies hashes first, restores SQL + `/proofs/` with `crmapp:crmapp 0700/0600`, restarts systemd, and re-runs `GET /api/v1/payments/:id/proof/verify`).

---

## 8. Staging Durability Test Harness (`NOT YET EXECUTED`)

Created locally at [`scripts/b11c-staging-durability-harness.mjs`](../scripts/b11c-staging-durability-harness.mjs):

- Safe `--plan` mode inspects the 20-point specification offline (`status: NOT_YET_EXECUTED`).
- Live execution requires BOTH `--confirm-staging` AND `B11C_STAGING_APPROVED=true`, refuses `crm.joinscaleflow.in`, creates strictly `[B11C-SYNTHETIC]` records, and tracks persistent cross-phase verification (`api` -> `post-restart` -> `post-reboot` -> `post-deploy` -> `post-rollback` -> `fault-drill` -> `backup-restore` -> `finalize`) across all **20 required durability tests** (`1. Synthetic proof upload` .. `20. Final storage durability acceptance`).
- **Status:** Prepared locally and verified via automated Vitest harness checks; **staging tests are `NOT YET EXECUTED`** and **never marked passed** without running against approved VPS infrastructure.

---

## 9. Security Checklist & Exact Unresolved Owner Decisions

### Pre-Provisioning & Go-Live Security Checklist
- [x] `crm.env.example` contains zero real credentials; `PROOF_PRODUCTION_DURABLE_CONFIRMED=false` & `DEV_LEAD_PILOT=false` enforced by default
- [x] `crm.joinscaleflow.in` explicitly hard-blocked across Nginx, preflight, and staging harness scripts
- [x] `NODE_ENV=production` + `AUTOMATION_TEST_DB_ALLOWLIST` absent + unattended scheduler disabled
- [x] Unprivileged `crmapp` runtime user + systemd `ProtectSystem=strict` + MariaDB `127.0.0.1` loopback bind + UFW port lockdown
- [x] Backup scripts accept ONLY public `age1...` recipient and abort if private `AGE-SECRET-KEY` exists on VPS
- [ ] Real KVM 1 VPS provisioned & staging 20/20 durability tests executed (**awaiting Owner approval for B11C**)
- [ ] In-app Data Vault ZIP encryption (`blocker-backup-encryption`, **B12**) & malware scanning decision resolved

### Unresolved Owner Decisions Required Before Checkpoint B11C
1. **VPS Provisioning & Budget Approval:** Approve purchasing/provisioning Hostinger **KVM 1** (`mum2` Mumbai 2 — verify exact hPanel Daily Backups add-on INR fee in checkout before confirming).
2. **Staging & Future Production Subdomains:** Approve `staging-v2.joinscaleflow.in` and `v2.crm.joinscaleflow.in` DNS A records pointing to the new VPS IP (confirming zero changes to `crm.joinscaleflow.in`).
3. **Dedicated Off-VPS Encrypted Backup Destination:** Choose a reliable always-on destination for `.tar.zst.age` 30-day retention (cannot rely on a sleep/shutdown-prone Windows laptop — e.g., secondary Hostinger storage/VPS SFTP pull endpoint or Owner-signed exception for an external immutable bucket).
4. **Offline Key Custody & Synthetic Verification Owner B:** Confirm where Owner will store the `age` private decryption key offline, and approve provisioning temporary `[B11C-SYNTHETIC]` Owner A/B test credentials on the disposable staging DB for Test #5 (`cross-owner access rejection`).
5. **ClamAV / Malware Scanning Trade-off on 4 GB RAM:** Decide whether to leave B11A's structural/container validation + CSP sandbox headers as-is for staging or benchmark on-demand `clamscan` (since resident `clamd` typically consumes ~1+ GB RAM on a 4 GB KVM 1 host).
