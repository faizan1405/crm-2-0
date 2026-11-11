# Checkpoint B11C — Hostinger VPS Staging, Private Storage Durability & Recovery Acceptance (Phase 0 & Phase 1 Gate)

> **Working Branch:** `feat/b11c-vps-staging-durability-qa` (branched cleanly from `feat/b11c-pre-vps-deployment-preparation` / `a22e990`)  
> **Execution Status:** **STOPPED AT PHASE 0 OWNER APPROVAL GATE** after completing **Phase 1 Baseline Verification, Script Security Audit, Critical Safety Fixes, and Local Quality Gates**.  
> **Remote Infrastructure State (Hostinger MCP Read-Only Check on 2026-11-11):** **`0` VPS instances provisioned**, `crm.joinscaleflow.in` + `minddesk.joinscaleflow.in` + 2 `.hostingersite.com` sites untouched on `u256504187` (`hostinger_business_v3`), and `dns_records_list("joinscaleflow.in")` returned `[]` in Hostinger DNS Manager (indicating external DNS or unlinked zone).

---

## 1. Phase 0 — Mandatory Owner Approval Gate Status

| # | Required Owner Approval | Current State | Evidence / Blocker |
| --- | --- | --- | --- |
| 1 | VPS purchase/provisioning & INR budget (incl. hPanel Daily Backups add-on) | **MISSING — BLOCKED** | Zero VPS purchased or provisioned (`vps_virtual-machines_list` = `[]`) |
| 2 | Exact Hostinger VPS instance ID | **MISSING — BLOCKED** | No VPS instance exists yet |
| 3 | Staging hostname (`staging-v2.joinscaleflow.in`) & DNS A record edit | **MISSING — BLOCKED** | Hostinger DNS zone for `joinscaleflow.in` returned `[]`; DNS likely managed at registrar/Cloudflare or needs explicit Owner record creation |
| 4 | Remote server SSH access & root/deploy key configuration | **MISSING — BLOCKED** | Awaits provisioned VPS IP + Owner SSH public key |
| 5 | Synthetic `[B11C-SYNTHETIC]` Owner A / Owner B credentials | **MISSING — BLOCKED** | Required to execute authenticated staging API & cross-owner Test #5 |
| 6 | Staging-only app deployment (`staging-v2.joinscaleflow.in`) | **MISSING — BLOCKED** | Blocked pending VPS + DNS + env secret approvals |
| 7 | Planned Nitro restart (`06`/`Test #6`) & full VPS OS reboot (`Test #7`) | **MISSING — BLOCKED** | Blocked pending provisioned VPS |
| 8 | Dedicated always-on off-VPS encrypted backup destination & `age` private-key offline custody | **MISSING — BLOCKED** | `BACKUP_OFF_VPS_STATUS=UNRESOLVED_OWNER_DECISION` (sleep/shutdown-prone Windows laptop insufficient) |
| 9 | Clean-target disposable restore drill (`08-restore-verify.sh --mode staging-clean-verify`) | **MISSING — BLOCKED** | Blocked pending VPS + offline test `age` identity |

Per B11C rules, the prompt itself does not authorize VPS purchase, provisioning, DNS mutations, or remote execution.

---

## 2. Phase 1 — Baseline Verification & Critical Safety Audit Fixes

Audited every file under [`infra/hostinger-vps/`](../infra/hostinger-vps/README.md) and [`scripts/b11c-staging-durability-harness.mjs`](../scripts/b11c-staging-durability-harness.mjs) line by line. **Nine concrete safety/reliability defects** were found and fixed locally before any remote execution:

1. **CRITICAL — Missing `DROP`, `TRIGGER`, `SHOW VIEW` privileges on MariaDB restore/migrations ([`02-install-node-mariadb.sh`](../infra/hostinger-vps/scripts/02-install-node-mariadb.sh)):**
   - Original `GRANT` omitted `DROP`, `TRIGGER`, and `SHOW VIEW` on `${TARGET_DB_NAME}.*`, which would cause `DROP TABLE IF EXISTS` in `mariadb-dump` restores or DDL migrations to fail with `ERROR 1142`.
   - Fixed grants on `${TARGET_DB_NAME}.*` ONLY (still strictly isolated from `*.*` / `mysql.*`), and routed root-gated `07-backup-encrypted.sh` & `08-restore-verify.sh` DB dumps/restores through local `mariadb --protocol=socket -u root`.
2. **CRITICAL — Broken single-backslash SQL escape check ([`02-install-node-mariadb.sh`](../infra/hostinger-vps/scripts/02-install-node-mariadb.sh)):**
   - Original `*'\'*` pattern was written `*'\\'*`, matching only double backslashes and allowing a trailing `\` in `CRM_DB_PASSWORD` to break SQL string quoting in `IDENTIFIED BY`.
   - Fixed to reject `'`, `"`, single `\`, backtick, and `[[:space:][:cntrl:]]`; added strict `Node >= 22.12.0` minor-version verification.
3. **CRITICAL — Unsafe root `source "${ENV_FILE}"` during deployment ([`05-deploy-release.sh`](../infra/hostinger-vps/scripts/05-deploy-release.sh)):**
   - Original deployment sourced `crm.env` in a root bash subshell before running `db-migrate.mjs`, risking `$` substitution corruption or root shell execution if secrets contain shell metacharacters.
   - Replaced with zero-shell-eval `runuser -u crmapp -- node --env-file="${ENV_FILE}" "${RELEASE_DIR}/scripts/db-migrate.mjs"`, unpacked tarballs with `--no-same-owner --no-same-permissions`, blocked any `.env*`/`.data`/`.git` files bundled inside tarballs, normalized release permissions (`u+rwX,g+rX,g-w,o-rwx`), added pre-symlink ERR cleanup for failed deploys, and verified health on auto-revert.
4. **HIGH — Certbot `--webroot` missing `/etc/letsencrypt/options-ssl-nginx.conf` ([`nginx-scaleflow-crm.conf.template`](../infra/hostinger-vps/templates/nginx-scaleflow-crm.conf.template), [`03-configure-nginx-tls.sh`](../infra/hostinger-vps/scripts/03-configure-nginx-tls.sh)):**
   - `certbot certonly --webroot` does not write `certbot-nginx` helper include files (`options-ssl-nginx.conf` / `ssl-dhparams.pem`), which would cause `nginx -t` to fail immediately on first VPS setup.
   - Replaced includes with self-contained TLS 1.2/1.3 directives, added HTTP `default_server` drop (`444`) and SNI Host-header check (`if ($host != "__DOMAIN__")`), tightened FQDN regex, and added EXIT trap cleanup for temporary ACME config.
5. **HIGH — Env validator gaps for Nitro bindings & allowlist hygiene ([`lib-common.sh`](../infra/hostinger-vps/scripts/lib-common.sh), [`04-validate-env-and-preflight.sh`](../infra/hostinger-vps/scripts/04-validate-env-and-preflight.sh)):**
   - Added validation requiring `NITRO_HOST == "127.0.0.1"`, `NITRO_PORT == PORT`, valid `DB_SSL_MODE`, last-definition-wins parsing in `read_env_value`, strict confinement of `PROOF_STORAGE_DIR` inside `/var/lib/scaleflow-crm/` (matching systemd `ReadWritePaths`), non-overlap of `BACKUP_ARCHIVE_DIR`, and explicit blocking of `PROOF_TEST_STORAGE_ALLOWLIST`.
6. **MEDIUM-HIGH — Silent backup/restore copy error suppression & JSON escaping ([`07-backup-encrypted.sh`](../infra/hostinger-vps/scripts/07-backup-encrypted.sh), [`08-restore-verify.sh`](../infra/hostinger-vps/scripts/08-restore-verify.sh)):**
   - Removed `cp -a ... 2>/dev/null || true` error swallowing (only skip `cp -a` if source dir is genuinely empty, otherwise fail loudly on disk/permission errors).
   - Replaced hand-interpolated JSON heredocs with `jq -n`, switched file hashing to `-print0 | sort -z | xargs -0 -r`, required non-empty `database.sql` and `>= 48` table count verification in both `staging-clean-verify` and `overwrite-live` before restarting `scaleflow-crm`.
7. **MEDIUM — Logrotate ownership mismatch on `backup.log` ([`logrotate-scaleflow-crm.template`](../infra/hostinger-vps/templates/logrotate-scaleflow-crm.template)) & swap fallback ([`01-bootstrap-vps.sh`](../infra/hostinger-vps/scripts/01-bootstrap-vps.sh)):**
   - Separated `backup.log` (`create 0640 root root`) from `app.log`/`app-error.log` (`create 0640 crmapp adm`), and added `dd` swap creation fallback if `fallocate` fails.
8. **HIGH — Fault-drill permission preservation, logout session probe, path-traversal probe & structured evidence ([`scripts/b11c-staging-durability-harness.mjs`](../scripts/b11c-staging-durability-harness.mjs)):**
   - Replaced unguarded `JSON.parse` / `.json()` calls with `parseJsonSafe`, added Phase 4 structured evidence fields (`httpOutcome`, `sqlAssertion`, `fileHash`, `serverRelease`, `recoveryObservation`), added post-logout `401` and path-traversal HTTP probes in Test #4, expanded Test #5 cross-owner rejection to metadata/verify/download/upload, and preserved exact `uid`/`gid`/`mode` (`crmapp:crmapp 0600`) inside fault-drill `finally` blocks.
9. **Baseline Compatibility Verified:**
   - `npm run build` (`vite build` + Nitro `node-server`) compiled cleanly into `.output/server/index.mjs` on local Node.js.
   - `B11A` storage backend fails closed (`503`) unless `PROOF_PRODUCTION_DURABLE_CONFIRMED=true`; `B10C-QA` execute-test route remains disabled in `NODE_ENV=production`.
   - Hostinger Mumbai 2 (`mum2`, DC ID `23`) and **Ubuntu 24.04 LTS** (template ID `1077`) confirmed available via read-only Hostinger API.

---

## 3. Twenty-Test Staging Durability Matrix (Current Status)

| # | Key | Phase | Status | Blocker |
| --- | --- | --- | --- | --- |
| 1–5 | Upload, byte retrieval, SHA-256 verify, Owner auth/CSRF/logout/traversal, cross-owner rejection | `api` | **BLOCKED (NOT EXECUTED)** | Phase 0 Approvals #1–#6 |
| 6 | Nitro systemd restart persistence | `post-restart` | **BLOCKED (NOT EXECUTED)** | Phase 0 Approval #7 |
| 7 | Full VPS OS reboot persistence | `post-reboot` | **BLOCKED (NOT EXECUTED)** | Phase 0 Approval #7 |
| 8 | New release symlink deploy persistence | `post-deploy` | **BLOCKED (NOT EXECUTED)** | Phase 0 Approval #6 |
| 9 | Controlled release rollback persistence | `post-rollback` | **BLOCKED (NOT EXECUTED)** | Phase 0 Approval #6 |
| 10 | Direct HTTP/Nginx public-path probes (`404`/`403`) | `api` | **BLOCKED (NOT EXECUTED)** | Phase 0 Approvals #1–#6 |
| 11–12 | Missing file & 1-byte bit-rot corruption fault drills | `fault-drill` | **BLOCKED (NOT EXECUTED)** | Phase 0 Approvals #1–#6 |
| 13 | Truncated container / interrupted upload recovery | `api` | **BLOCKED (NOT EXECUTED)** | Phase 0 Approvals #1–#6 |
| 14–16 | Single-transaction SQL + proofs `.tar.zst.age` encrypted backup | `backup-restore` | **BLOCKED (NOT EXECUTED)** | Phase 0 Approval #8 |
| 17–19 | Clean disposable restore (`48` tables + binary SHA-256 reconciliation) | `backup-restore` | **BLOCKED (NOT EXECUTED)** | Phase 0 Approvals #8–#9 |
| 20 | Final durability acceptance & lockout verification | `finalize` | **BLOCKED (NOT EXECUTED)** | All 1–19 + Off-VPS Retention Gate |

---

## 4. Production-Readiness Blockers & B12 Transition Recommendation

- **Production-Readiness Blockers:**
  1. Missing Phase 0 Owner approvals (`1`–`9`), no VPS provisioned (`0` KVM instances).
  2. All `20` live staging durability & backup/restore tests remain **BLOCKED / NOT EXECUTED**.
  3. KVM 1 `1 vCPU / 4 GB RAM` resource telemetry under load/backup/restore is **unmeasured** (`CPU`, `RAM`, `swap`, `disk`, latency unverified).
  4. Approved off-VPS encrypted backup destination remains **UNRESOLVED** (Phase 6 marks the full recovery gate **BLOCKED** until decided).
  5. `PROOF_PRODUCTION_DURABLE_CONFIRMED` remains **`false`** (fail-closed `503`).
- **Recommendation Regarding B12:** **DO NOT transition to B12.** Complete Phase 0 Owner approvals, run live B11C staging (Phases 2–9) end to end on the isolated staging VPS, resolve the off-VPS backup target, and sign off all 20 tests before opening B12 (`Data Vault Production Encrypted Backup & Customer Cutover Preparation`).
