# Checkpoint B11B — Hostinger Durable Storage Architecture & Production Decision Gate

> **Branch:** `feat/b11b-hostinger-storage-decision-gate` (branched from `feat/b11a-durable-private-proof-storage` / `9930761`)  
> **Checkpoint Nature:** Strictly read-only infrastructure audit, reconciliation, and architectural decision gate (**zero** VPS purchases, **zero** Hostinger account mutations, **zero** GitHub pushes, **zero** production deployments, **zero** CRM UI/DB/browser-local changes).  
> **Recommended Architecture:** **Option B — Dedicated Hostinger KVM 1 VPS (`mum2` Mumbai 2, India) for CRM V2** (leaving CRM V1 `crm.joinscaleflow.in` and existing apps untouched on `hostinger_business_v3`).  
> **Production Proof Storage Verdict:** **REMAINS BLOCKED / FAIL CLOSED (`503`)** on current infrastructure until Owner approves VPS provisioning and all 20 staging durability tests pass in **Checkpoint B11C**.

---

## 1. Executive Summary & Decision Gate Status

1. **Table Count Discrepancy Reconciled (`48` vs `47` vs `46`):** There is no missing table or schema bug. A freshly migrated MariaDB 11.4 database contains **`48` physical tables** (`46` `crm_*` domain/auth tables + `1` schema-managed metadata table `_crm_schema_meta` = **`47` Drizzle-managed schema tables** in `src/server/db/schema.server.ts` / `0014_snapshot.json`, plus `1` runtime Drizzle migrator table `__drizzle_migrations` created by `scripts/db-migrate.mjs`).
2. **Current Shared Business Plan (`u256504187`) Cannot Host CRM V2 Durable Production Safely:** Read-only Hostinger account inspection proves that account `u256504187` (`hostinger_business_v3`) **already hosts 5 active `nodejs` web apps** — matching the plan's hard maximum limit of 5 Node.js applications. It also hosts zero VPS instances, has zero native Hostinger S3 object storage available, isolates backups to `public_html` + MySQL databases, and deploys Node apps via versioned `hbuilds` symlink replacements without always-running worker support.
3. **Unencrypted Hostinger VPS Backup Caveat Requires Application-Level Encryption:** Official Hostinger documentation explicitly confirms that **Hostinger does NOT encrypt VPS backups or manual snapshots at rest** (only in transit). Therefore, even on a Hostinger VPS, customer PII, financial ledgers, and payment proofs **must** be bundled and encrypted at the application/OS layer (with the decryption private key held offline by the Owner) before off-VPS retention or reliance on platform snapshots.
4. **Stop & Approval Gate:** Nothing is provisioned or changed in B11B. Owner sign-off on the KVM 1 VPS cost, Mumbai 2 region (`mum2`), off-VPS encrypted backup target, and domain routing is required before starting **B11C Staging Verification**.

---

## 2. Database Schema & Table Inventory Reconciliation

Verified directly against [`src/server/db/schema.server.ts`](../src/server/db/schema.server.ts), [`src/server/db/migrations/meta/0014_snapshot.json`](../src/server/db/migrations/meta/0014_snapshot.json), [`src/server/db/migrations/meta/_journal.json`](../src/server/db/migrations/meta/_journal.json), and [`scripts/db-migrate.mjs`](../scripts/db-migrate.mjs):

- **46 `crm_*` tables** (Core CRM, Auth, Finance, Payment Proofs, Quotations, Projects, Settings/Goals, Custom Fields/Saved Views, Smart Inbox/Relationships, Automation Rules/Execution).
- **1 schema-level internal table** (`_crm_schema_meta`, created in `0000_b1b_owner_auth.sql` and declared in `schema.server.ts`).
- **= 47 Drizzle-managed schema tables** (`schema.server.ts` `mysqlTable(...)` count = `47`; `0014_snapshot.json` `tables` key count = `47`; structural diff = empty; sum of `CREATE TABLE` statements across `0000`..`0014` = `47`).
- **+ 1 runtime Drizzle migrator journal table** (`__drizzle_migrations`, created at runtime by `migrate(db, { migrationsFolder })` from `drizzle-orm/mysql2/migrator` inside `scripts/db-migrate.mjs`; intentionally absent from `schema.server.ts` and `0014_snapshot.json`).
- **= 48 total physical tables** visible via `SHOW TABLES` in live MariaDB 11.4.

### Why Earlier Reports Varied (`48` vs `47` vs `31`)

| Metric | Count | Exact Meaning | Source |
| --- | ---: | --- | --- |
| Physical DB tables (`SHOW TABLES`) | **48** | `46 crm_*` + `_crm_schema_meta` + `__drizzle_migrations` | Live MariaDB 11.4 post-`db:migrate` (B10C-QA / B11A live suites) |
| Drizzle schema & snapshot tables | **47** | `46 crm_*` + `_crm_schema_meta` | `schema.server.ts`, `0014_snapshot.json` |
| Business `crm_*` tables | **46** | All `crm_*`-prefixed entities | `0014_snapshot.json` |
| Data Vault logical entity inventory | **31** | Logical Owner backup/cutover entities (tracked in `VAULT_ENTITIES_INVENTORY`; excludes runtime infrastructure tables like sessions, rate limits, idempotency locks) | `src/server/vault/vaultService.server.ts` |

### Complete Migration & Table Breakdown (`0000` .. `0014`)

| Migration File | Domain | New Tables | Exact Tables Added |
| --- | --- | ---: | --- |
| `0000_b1b_owner_auth.sql` | Owner Auth & Metadata | 5 | `_crm_schema_meta`, `crm_users`, `crm_sessions`, `crm_auth_audit`, `crm_auth_rate_limits` |
| `0001_b2a_core_crm.sql` | Core Leads, Follow-ups, Custom Fields, Tags | 8 | `crm_leads`, `crm_lead_activities`, `crm_follow_ups`, `crm_custom_fields`, `crm_lead_field_values`, `crm_tag_defs`, `crm_lead_tags`, `crm_idempotency_keys` |
| `0002_b2b1_widen_idempotency_scope.sql` | Idempotency Schema Alteration | 0 | *(Alters `crm_idempotency_keys` only)* |
| `0003_b2b3_call_logs.sql` | Call Logging | 1 | `crm_call_logs` |
| `0004_b2b4_whatsapp_logs.sql` | WhatsApp Logging | 1 | `crm_whatsapp_logs` |
| `0005_b3a_finance_ledger.sql` | Deals, Milestones, Payments, Ledger | 4 | `crm_deals`, `crm_deal_milestones`, `crm_payments`, `crm_finance_events` |
| `0006_b3b_payment_proofs.sql` | Payment Proof Metadata | 1 | `crm_payment_proofs` |
| `0007_b4a_quotations.sql` | Quotations & Templates | 6 | `crm_quotation_templates`, `crm_quotations`, `crm_quotation_revisions`, `crm_quotation_items`, `crm_quotation_milestones`, `crm_quotation_audit_events` |
| `0008_b5a_projects.sql` | Projects, Tasks, Deliverables, Tickets | 8 | `crm_project_templates`, `crm_projects`, `crm_project_milestones`, `crm_project_tasks`, `crm_project_deliverables`, `crm_project_deliverable_revisions`, `crm_client_support_tickets`, `crm_project_audit_events` |
| `0009_b6a_settings_goals.sql` | Owner Settings & Sales Goals | 4 | `crm_owner_settings`, `crm_settings_audit_events`, `crm_sales_goals`, `crm_sales_goal_revisions` |
| `0010_b8a_saved_views.sql` | Saved Views | 1 | `crm_saved_views` |
| `0011_b9a_smart_inbox_relationships.sql` | Smart Inbox, Dupes & Lead Graph | 4 | `crm_lead_inbox_items`, `crm_duplicate_candidates`, `crm_lead_relationships`, `crm_lead_relationship_history` |
| `0012_b10a_automation_rules.sql` | Automation Rules, Revisions, Runs, Reminders | 4 | `crm_automation_rules`, `crm_automation_rule_revisions`, `crm_automation_runs`, `crm_internal_reminders` |
| `0013_b10c_automation_execution.sql` | Execution Dedupe Hardening | 0 | *(Adds `execution_key` + unique index on `crm_automation_runs`)* |
| `0014_b11a_proof_storage_hardening.sql` | Proof Verification Metadata | 0 | *(Adds `storage_status`, `storage_provider_id`, `verified_at`, `verification_error`, and index on `crm_payment_proofs`)* |
| **Drizzle Snapshot Total** | **`0000` .. `0014`** | **47** | **`46 crm_*` + `1 _crm_schema_meta`** |
| **Runtime Migrator Total** | **`scripts/db-migrate.mjs`** | **+1** | **`__drizzle_migrations` -> `48` total physical MariaDB tables** |

---

## 3. Hostinger Infrastructure Audit (Evidence-Separated)

All claims below strictly separate direct account telemetry, published documentation, untested staging items, and unavailable figures.

### 3A. Confirmed from Hostinger Account Inspection (Read-Only MCP Audit of `u256504187`)

- **Active Hosting Plan:** `hostinger_business_v3` ("Business Web Hosting"), Order ID `1010060772`, Subscription `16CSSOVVmrRpcB7fN`, billed at **₹699/month** (`69900` paise INR, auto-renew monthly, next billing date `2026-11-20T18:37:03Z`).
- **Provisioned VPS Instances:** **`0`** (`vps_virtual-machines_list` returns `[]`).
- **Websites & Node.js App Saturation:** `6` total sites exist under `u256504187`:
  - **`5` `website_type: "nodejs"` apps (AT HARD PLAN CEILING):**
    1. `crm.joinscaleflow.in` (**Live CRM V1 — MUST REMAIN UNTOUCHED**)
    2. `khaki-butterfly-345144.hostingersite.com` (staging/placeholder Node app; currently has `[]` / `0` environment variables, HTTPS redirect enabled, SSL active, CDN enabled, cache disabled)
    3. `minddesk.joinscaleflow.in`
    4. `affordaindia.com`
    5. `antiquewhite-camel-510685.hostingersite.com`
  - `1` `website_type: "other"` site (`darkgray-louse-574826.hostingersite.com`).
- **Observed Live Node Deployment Pipeline (`crm.joinscaleflow.in` logs):** Git clone -> install & build -> `Copying build output to version <uuid>` -> `Switching "current" to the new version` -> `Syncing public_html` -> restart Node process.
- **Databases:** `4` MySQL databases on shared DB server `srv469.hstgr.io:3306` (`max_size_mb: 3072` = 3 GB per DB). Hostinger-hosted Node apps connect via loopback `127.0.0.1:3306` (`localhost` socket paths can differ inside containers).
- **Cron & File API Inspection:** `hosting_cron-jobs_list` returns `[]`. Hostinger file listing API restricts `directory` to `public_html` (`".."` rejected with HTTP `422`).
- **Hostinger Product Catalog & Regions (`billing_catalog_list` / `vps_data-centers_list`):**
  - Zero managed S3 / object storage SKU exists in the catalog API.
  - Mumbai 2, India datacenter (`mum2`, ID `23`) is available for VPS provisioning.
  - Verified INR catalog pricing:
    - **KVM 1** (`1 vCPU`, `4 GB RAM`, `50 GB NVMe`, `4 TB` bandwidth): **₹999** 1st month (`₹1,649/mo` renewal); **₹8,388** 1st year (`₹699/mo`, `₹13,788/yr` renewal = `₹1,149/mo`); **₹14,376** 1st 2yr (`₹599/mo`, `₹23,976/2yr` renewal = `₹999/mo`).
    - **KVM 2** (`2 vCPU`, `8 GB RAM`, `100 GB NVMe`, `8 TB` bandwidth): **₹1,299** 1st month (`₹2,099/mo` renewal); **₹11,148** 1st year (`₹16,788/yr` renewal); **₹18,696** 1st 2yr (`₹28,776/2yr` renewal).
    - **Cloud Startup** (for pricing context): **₹1,699/mo** (`1yr`: `₹9,588` first year, `₹19,188/yr` renewal).

### 3B. Confirmed from Official Hostinger Documentation (`support.hostinger.com`)

- **Business Web Hosting Boundaries & Caps:**
  - Hard ceiling of **5 Node.js web apps** (`u256504187` is already at 5/5).
  - Shared/plan caps: `2` CPU cores, `3 GB` RAM, `50 GB` NVMe, `600,000` inodes, `150` databases (`3 GB` max per DB), `75` max concurrent MySQL user connections, `120` total processes (`NPROC`, `60` entry processes), `120s` HTTP request timeout.
  - **No always-running background daemons/workers** and **no inbound WebSockets** supported on shared Node hosting.
  - SSH is available; cron jobs execute in **UTC**, enforce a `255`-character command cap, forbid `%`, time out at `30` minutes, and require explicit `--env-file=hbuilds/config/.env`.
  - Automated daily backups on Business retain **7 days** and cover **`public_html` files + MySQL databases**.
  - Hostinger documentation explicitly warns **against storing private runtime uploads inside `hbuilds/` or `public_html/`** because versioned builds and `public_html` sync overwrite them on redeploy.
- **Hostinger VPS Capabilities & Constraints:**
  - Full root Linux VM (`Ubuntu`/`Debian`) with persistent block storage outside web deploy directories.
  - **Free automated weekly backups** included; **automated daily backups** is a paid upgrade selectable in hPanel (retains up to `4` recovery points: `2` daily + `2` weekly); `1` manual snapshot slot (`1`-day automatic expiry, wiped on restore/OS reinstall).
  - **CRITICAL SECURITY FINDING:** Hostinger documentation explicitly states **Hostinger does NOT encrypt VPS backups or snapshots at rest** (encryption applies only in transit).
  - Plan upgrades (~10 minutes downtime) preserve existing files and configuration; post-upgrade disk expansion requires SSH partition resizing (`lsblk`/`parted`).
  - Supports Hostinger Cloud Firewall (edge), OS UFW firewall, SSH key authentication, non-root `sudo` user isolation, and Monarx malware scanner.

### 3C. Requires Staging Verification (`NOT YET EXECUTED`)

- Real redeploy survival + reboot recovery + restore verification on a provisioned Hostinger KVM 1 staging VPS (`mum2`).
- End-to-end encrypted bundle generation time/size (`mariadb-dump` + `/var/lib/scaleflow-crm/private-proofs`) and off-VPS pull + clean-target restore round-trip.
- Exact Nginx + systemd + Nitro (`NODE_OPTIONS`) + local MariaDB 11.4 memory footprint under 4 GB KVM 1 RAM.

### 3D. Unknown (Must Verify Before Purchase / Never Invented)

- **Exact INR price of Hostinger's VPS Daily Backups add-on:** Not returned by `billing_catalog_list` MCP API; must be verified directly in the hPanel VPS checkout/upgrade screen before purchasing.
- **Whether Hostinger Business daily backups include arbitrary home sibling directories outside `public_html`:** Official documentation specifically cites `public_html` files + MySQL DBs; non-`public_html` sibling paths remain unproven and uninspectable via API (`422` above `public_html`).

---

## 4. Architecture Options Evaluation (11-Criteria Decision Matrix)

Three Hostinger-exclusive options were evaluated cleanly:

- **Option A — Hostinger Business Web Hosting (`u256504187` existing plan):** Attempt to run CRM V2 alongside CRM V1 on shared `hostinger_business_v3` using a non-`public_html` sibling folder on shared filesystem + shared DB server.
- **Option B — Dedicated Hostinger KVM 1 VPS (`mum2` Mumbai 2) for CRM V2 Only:** Provision one dedicated Hostinger KVM 1 VPS running Nginx TLS proxy -> Nitro Node 22 server + local MariaDB 11.4 + `/var/lib/scaleflow-crm/private-proofs` + systemd timer for encrypted off-VPS backups (and future bounded B10C automation), leaving CRM V1 untouched on Business `u256504187`.
- **Option C — Split Architecture (Hostinger Business Frontend + Hostinger VPS Backend/Storage):** Keep static/SSR frontend on `hostinger_business_v3` and split API + proof storage + MariaDB onto a VPS.

| # | Decision Criterion | Option A: Hostinger Business (`u256504187`) | Option B: Dedicated Hostinger KVM 1 VPS (`mum2`) — **RECOMMENDED** | Option C: Business Frontend + VPS Backend/Storage — **REJECTED** |
| --- | --- | --- | --- | --- |
| 1 | **Durability across redeployments** | **NOT PROVEN / RISKY.** `hbuilds` symlink wipes app dir on deploy; non-`public_html` sibling dirs lack managed ownership/monitoring. | **HIGH.** `/opt/scaleflow-crm/releases/<sha>` symlink deploys are strictly isolated from persistent `/var/lib/scaleflow-crm/private-proofs/`. | **MIXED.** Proof binaries stay durable on VPS, but frontend deploys and API schema deploys on separate hosts introduce version-skew risk. |
| 2 | **Automated backup coverage** | **INCOMPLETE FOR PROOFS.** Docs guarantee `public_html` + MySQL; inclusion of private sibling dirs outside `public_html` is unproven. | **FULL (Layered).** App timer exports consistent DB dump + proof binaries every night; optional hPanel daily backups + off-VPS encrypted pull. | **FRAGMENTED.** Backup coordination split between shared hosting (`u256504187`) and VPS. |
| 3 | **Backup encryption at rest** | Shared platform-managed backups; no Owner-held offline private key separation for archive bundles. | **STRONG WITH APP ENCRYPTION.** Compensates for Hostinger's unencrypted VPS backups using `age`/AEAD encryption before off-VPS retention; private key stays offline with Owner. | Same VPS encryption requirement + extra frontend artifact state. |
| 4 | **Restore recoverability** | **UNVERIFIED.** Cannot cleanly wipe/re-test isolated non-`public_html` restores or simulate clean OS recovery via API. | **TESTABLE END-TO-END.** Full clean-slate MariaDB + proof restore drill verifiable via CLI in B11C before go-live. | Requires cross-host restore coordination and DNS re-sync. |
| 5 | **Security isolation from web root** | **WEAK.** Shared hosting pool (`u256504187`) across 6 sites; file API cannot audit outside `public_html`; no dedicated OS firewall rules per service. | **STRONG.** Nginx proxies only `127.0.0.1:3000`; `crmapp` OS user `0700` dir outside Nginx/release roots; UFW + Cloud Firewall + MariaDB bound to `127.0.0.1`. | **WEAKER.** Requires cross-origin CORS/proxy tunneling and wider VPS public API attack surface. |
| 6 | **Compatibility with B11A storage code (`hostinger-private-fs`)** | Config works in code only if sibling path avoids `UNSAFE_SEGMENTS`, but fails operational durability proof. | **100% NATIVE.** `PROOF_STORAGE_DRIVER=hostinger-private-fs` + `/var/lib/scaleflow-crm/private-proofs` + `LocalFsProofStorage` works with **zero** storage rewrite. | Same backend compatibility on VPS, but UI must keep same-origin proxy rules intact. |
| 7 | **Future B10C automation execution compatibility** | **POOR.** No always-running background worker; cron capped (`30m`, UTC, `255` chars); process cap shared with 5 sites (`120` `NPROC`). | **NATIVE.** Dedicated `systemd` timers (`OnCalendar`, `flock`/MariaDB `execution_key` dedupe) execute bounded CRM automations cleanly on loopback. | Same VPS timer capability, unnecessary cross-host complexity. |
| 8 | **Operational complexity for Owner** | Low server OS work, **high ceiling conflict** (5/5 Node apps hit, cannot deploy a 6th Node app cleanly without removing/disrupting existing sites). | **CLEAN SINGLE-BOX OPS.** One VPS, one release directory, one systemd unit, one DB, one Nginx config, documented backup drill runbook. | **HIGHEST.** Two deploy pipelines, two environments, cross-host TLS/origin/cookie troubleshooting. |
| 9 | **Failure modes** | Shared `600k` inode / `120` `NPROC` / `75` DB conn exhaustion breaks CRM V1 (`crm.joinscaleflow.in`) + other sites simultaneously; unbacked-up proof loss risk. | Isolated disk-full / OOM risk stays bounded to CRM V2; mitigated by monitoring alerts (`70%`/`85%`), bit-rot checksums, atomic writes, and off-VPS encrypted backups. | **CRITICAL CODE INCOMPATIBILITY.** `buildSessionCookie` uses `SameSite=Lax` and `verifyCsrfAndOrigin` rejects `Sec-Fetch-Site !== "same-origin"` (`src/server/auth/security.server.ts:203-256`). Cross-origin cookies/CSRF break unless proxied back through same-origin anyway. |
| 10 | **Hostinger cost structure (INR)** | **₹699/mo** existing Business plan — **BLOCKED** unless existing site removed (5/5 Node cap reached); upgrading to Cloud Startup costs `₹1,699/mo` (`₹19,188/yr` renewal) and still lacks root/systemd/VPS isolation. | **KVM 1:** `₹999` 1st mo / `₹1,649/mo` renewal, or **`₹8,388` 1st yr (`₹699/mo`) / `₹13,788/yr` renewal (`₹1,149/mo`)**. Keeps Business `₹699/mo` untouched for CRM V1. | Pays **both** Business slot + full KVM 1 VPS with zero cost savings and double complexity. |
| 11 | **Isolation from CRM V1 (`crm.joinscaleflow.in`)** | **ZERO ISOLATION.** Shares container resources, inode pool, process pool, and DB host with CRM V1. | **100% ISOLATED.** Zero CPU, RAM, disk, deploy, DB, cron, or port overlap with CRM V1 on `u256504187`. | Partial isolation — still consumes a Node/web slot on `u256504187`. |

### Architectural Decision

- **Select Option B (Dedicated Hostinger KVM 1 VPS in `mum2` Mumbai 2, India)** for CRM V2 staging (`B11C`) and production (`B12`/`B13`).
- **Reject Option A** (`NOT PROVEN / NOT RECOMMENDED`): Plan `u256504187` has reached its hard 5-Node-app cap, co-mingles CRM V1 production availability, lacks persistent background worker guarantees, and leaves non-`public_html` proof backups unproven.
- **Reject Option C** (`UNNECESSARY COMPLEXITY`): TanStack Start + Nitro compiles SSR and API into a single same-origin server (`.output/server/index.mjs`); splitting frontend and backend conflicts with strict `SameSite=Lax` and `Sec-Fetch-Site === "same-origin"` protections in [`src/server/auth/security.server.ts`](../src/server/auth/security.server.ts#L203-L256).

---

## 5. Private Storage Architecture & Isolation Boundaries

Strict filesystem and network isolation boundaries for the recommended KVM 1 VPS layout:

| Boundary Zone | Filesystem Path / Bind | Owner & Mode | Web / Network Exposure | Lifetime & Backup Scope |
| --- | --- | --- | --- | --- |
| **1. Immutable App Releases** | `/opt/scaleflow-crm/releases/<git-sha>/` + symlink `/opt/scaleflow-crm/current` | `deploy:crmapp` (`0755` dir, `0644` files) | Served internally by Nitro on `127.0.0.1:3000`; Nginx proxies HTTP only | Replaced cleanly on each release; previous 3 releases retained for rollback |
| **2. Runtime Environment & Config** | `/etc/scaleflow-crm/crm.env` | `root:crmapp` (`0640`) | Never inside `/opt/.../current` or web root; loaded via systemd `EnvironmentFile` | Replicated separately into Owner encrypted vault (excluded from plaintext backups) |
| **3. Private Uploaded Proofs** | `/var/lib/scaleflow-crm/private-proofs/` (`prf_<uuid>.<ext>`) | `crmapp:crmapp` (`0700` dir, `0600` files) | **ZERO** Nginx `alias`/`root`; streamed exclusively via `GET /api/v1/payments/:id/proof/download` with `nosniff`, `private, no-store`, CSP sandbox headers | Permanent across deploys & reboots; included in nightly encrypted backup |
| **4. Temporary Upload Staging** | `/var/lib/scaleflow-crm/private-proofs/staging/` | `crmapp:crmapp` (`0700`) | Server-process internal only | Transient (`fsync` -> SHA-256 verify -> move/clean); stale temps cleaned by `reconcileOrphanProofFiles` |
| **5. MariaDB 11.4 Data & Sockets** | `/var/lib/mysql/` | `mysql:mysql` (`0700`) | `bind-address = 127.0.0.1` (port `3306` unreachable from public internet / UFW denied) | Persistent volume; logical point-in-time `mariadb-dump --single-transaction` |
| **6. Staging / Outbound Backup Archives** | `/var/backups/scaleflow-crm/` (encrypted `.tar.zst.age` only) | `crmbackup:crmbackup` (`0700`) | No web/HTTP route; pulled/pushed over SSH key channel to off-VPS storage | Local staging purged immediately after verified off-VPS copy (or short local ring of encrypted files only) |

### Key Structural Safety Guarantees

1. **Zero Deploy Path Collision:** B11A's `UNSAFE_SEGMENTS` (`public_html`, `public`, `.output`, `dist`, `hbuilds`) in [`src/server/storage/proofStorage.server.ts`](../src/server/storage/proofStorage.server.ts) rejects any misconfiguration attempting to point `PROOF_STORAGE_DIR` under `/opt/scaleflow-crm/releases/.../.output`.
2. **Nginx Hardening:** Nginx serves **no** static files directly from `/var/lib/` or `/etc/`. It terminates TLS (`certbot` / Let's Encrypt) and reverse-proxies all traffic to `http://127.0.0.1:3000` with `client_max_body_size 12m;` (margin above `MAX_PROOF_BYTES = 10 MiB`), passing `X-Forwarded-For` / `X-Forwarded-Proto` matching `AUTH_TRUST_PROXY=true`.
3. **Hostinger Firewall + UFW:** Allow public inbound only on `22/tcp` (rate-limited SSH key-only, optional IP allowlist / non-root `sudo` user), `80/tcp` (ACME HTTP-01 + 301 to HTTPS), and `443/tcp` (HTTPS). Deny `3000` and `3306` externally.

---

## 6. Encryption, Backup & Threat Model

### 6A. Critical Baseline Reality

1. **Hostinger Platform Risk:** Hostinger official docs confirm **VPS backups and manual snapshots are NOT encrypted at rest** inside Hostinger's backup storage infrastructure. Anyone with Hostinger panel/storage access could theoretically read unencrypted disk images.
2. **Application Code Status Today:**
   - Proof storage integrity (`sha256` + `byteSize` + `verifyPrivateObject`) verifies **integrity (anti-corruption)** — **it is NOT encryption at rest**.
   - B7A Data Vault exporter (`buildBackupZipArchive` in `src/server/backup/archive.server.ts`) currently produces **unencrypted ZIP packages** (explicitly flagged by Data Vault blocker `"blocker-backup-encryption"` in [`src/server/vault/vaultService.server.ts`](../src/server/vault/vaultService.server.ts#L468-L474)).

### 6B. Target Encrypted Backup Architecture (VPS + B12 Alignment)

To eliminate unencrypted data exposure and ransomware single-point failures:

1. **Asymmetric / Hybrid Backup Encryption (`age` recommended):**
   - Generate an `age` keypair offline on the Owner's secure workstation.
   - Store **ONLY the public recipient key (`age1...`)** on the VPS backup timer config.
   - Store the **private decryption identity (`AGE-SECRET-KEY-...`) offline in Owner's password manager / cold backup** — **NEVER store the decryption key on the VPS!**
   - Even if an attacker compromises root on the VPS, they **cannot decrypt** already-created `.tar.zst.age` backup archives.
2. **Consistent Backup Bundle Contents (Single Atomic Snapshot):**
   - Step 1: Run `mariadb-dump --single-transaction --quick --hex-blob` across all **48** tables (`crm_*`, `_crm_schema_meta`, `__drizzle_migrations`) into a temporary pipe.
   - Step 2: Collect `/var/lib/scaleflow-crm/private-proofs/` excluding transient `staging/`.
   - Step 3: Write `backup-manifest.json` containing schema version (`0014`), physical table count (`48`), row counts per table, and SHA-256 digests of the SQL dump and every `prf_*` proof binary.
   - Step 4: Stream `tar` + `zstd` directly into `age -r <OWNER_PUBLIC_KEY> -o crm-backup-<timestamp>.tar.zst.age` (zero unencrypted SQL dump or proof tarball ever rests on disk, minimizing plaintext exposure in Hostinger's unencrypted VPS snapshots).
   - *(Note on `crm.env` secrets: `AUTH_SECRET`, DB passwords, and session signing keys remain isolated in Owner's offline password manager rather than bundled inside automated data backups.)*
3. **Off-VPS Retention & Ransomware Immutability (3-2-1 Policy):**
   - **Live Tier:** Local VPS NVMe (`/var/lib/mysql` + `/var/lib/scaleflow-crm/private-proofs`).
   - **Platform Tier:** Hostinger weekly VPS backups (or paid daily backups once price verified in hPanel checkout) — treated purely as encrypted/OS recovery aid, never as the sole backup of CRM PII.
   - **Off-VPS Immutable Tier (Minimum 30-Day Retention):** Encrypted `.tar.zst.age` bundle is pulled nightly over SSH/SFTP (`ForceCommand` / append-only landing account on an Owner workstation/NAS or a separate Owner-approved storage target) so compromised VPS root credentials **cannot delete historical off-VPS backups**. Any third-party cloud destination (S3/R2/B2) remains forbidden unless Owner signs an explicit exception ADR.
4. **Data Vault In-App Exports (`B12`):** Upgrade `buildBackupZipArchive` in `B12` to wrap Owner-downloaded ZIP exports in authenticated **AES-256-GCM** encryption (resolving `"blocker-backup-encryption"`) before production customer exports begin.

### 6C. Threat & Failure Scenario Matrix

| Threat / Failure Mode | Impact Without Mitigation | B11B / B12 Mitigation |
| --- | --- | --- |
| **Unencrypted Hostinger VPS snapshot leaked** | Full customer PII + financial + proof binary exposure | Keep runtime clean (no leftover plaintext dumps in `/tmp` or `/var/backups`), export encrypted `.tar.zst.age` off-VPS immediately; consider LUKS-encrypted `/var/lib/scaleflow-crm` loop/block volume only if unlock workflow fits Owner reboot tolerance (evaluated in B11C/B12). |
| **VPS compromised + ransomware wipes disk & local backups** | Permanent business data loss | Off-VPS **pull-based** encrypted `.tar.zst.age` retention (`30` days min) where VPS holds zero delete credentials on the backup destination + `age` public-key encryption. |
| **Silent NVMe bit-rot / truncated write** | Corrupt invoice image served or broken audit trail | B11A `fsync` + SHA-256 & container checks on write + `getPrivateObject` / `GET /proof/verify` check on every read + manifest verification on restore. |
| **Missing private key / forgotten passphrase** | Backup archive permanently unrecoverable | Owner maintains dual offline recovery copies (password manager + printed/encrypted USB cold copy) + mandatory quarterly decrypt-and-restore drill verifies key validity. |
| **Key Compromise / Developer Rotation** | Unauthorized decrypt access to older backups | Rotate `age` public/private keypair immediately; re-encrypt active 30-day archive ring under new public key; rotate DB/`AUTH_SECRET` credentials on VPS; audit `crm_auth_audit`. |

---

## 7. Controlled Deployment, Migration & Rollback Pipeline

Production deployments follow an explicit, manually triggered, non-destructive release protocol (**zero automatic deployment from unapproved `main` pushes**):

1. **Local / CI Release Gate:** Run `npm ci`, `npm run typecheck`, `npm run db:check`, `npm test`, and `npm run build` (`scripts/build-prod.mjs` -> forces `NODE_ENV=production` into `.output/server/index.mjs`).
2. **Pre-Deploy Consistent Backup:** Execute encrypted `crm-backup-pre-<sha>.tar.zst.age` snapshot of MariaDB + `/var/lib/scaleflow-crm/private-proofs` and verify archive exit status (`sha256sum`) **before** touching the running version or schema.
3. **Immutable Release Staging:** Upload/unpack new build to `/opt/scaleflow-crm/releases/<short-sha>/` (`npm ci --omit=dev`). Existing `/var/lib/scaleflow-crm/private-proofs` and `/etc/scaleflow-crm/crm.env` are **untouched**.
4. **Forward Schema Migration:** Run `npm run db:migrate` (`scripts/db-migrate.mjs`) pointing at `127.0.0.1:3306` (additive/forward-only SQL in `0000`..`0014+`). Abort deployment immediately if `db:migrate` fails before switching the active symlink.
5. **Atomic Activation & Service Restart:** Update `/opt/scaleflow-crm/current -> /opt/scaleflow-crm/releases/<short-sha>` and execute `systemctl restart scaleflow-crm`.
6. **Post-Deploy Health & Smoke Verification:**
   - Assert `GET /api/v1/health` returns `200`, `runtime.env === "production"`, `database.status === "configured"`, `storage.productionReady === true`, `storage.failClosed === false`.
   - Verify Owner login + read check + sample proof `GET /proof/verify` `200 OK`.
7. **Rollback Safety Rules:**
   - **Code-only rollback (schema backward-compatible):** Re-point `/opt/scaleflow-crm/current` to `<prev-sha>` and `systemctl restart scaleflow-crm`.
   - **Schema-incompatible rollback:** **NEVER blindly run code against a newer incompatible schema or drop tables manually.** Stop `scaleflow-crm` (`systemctl stop`), restore the consistent pre-deploy DB dump + proof binary pair (`crm-backup-pre-<sha>`), restore `<prev-sha>` symlink, restart service, and re-verify `SHOW TABLES` and `/proof/verify`.
8. **CRM V1 Isolation Guarantee:** All CRM V2 releases stay on the dedicated KVM 1 VPS (`mum2`) and dedicated subdomain (`v2.crm.joinscaleflow.in` or Owner-chosen subdomain), completely decoupled from `u256504187` (`crm.joinscaleflow.in`), `khaki-butterfly-345144.hostingersite.com`, shared DB `srv469.hstgr.io`, and GitHub pushes until Owner approval in B13.

---

## 8. Future Internal Automation Scheduling Runtime Assessment

### Current State (Preserved in B11B)

- Unattended background automation execution and schedulers remain **STRICTLY DISABLED** in B11B (per `B10C-QA` verification in [`src/server/http/crmRoutes.server.ts`](../src/server/http/crmRoutes.server.ts#L4867-L4920) and [`src/server/config/env.server.ts`](../src/server/config/env.server.ts#L93-L145)).
- `POST /api/v1/automations/:id/execute-test` enforces `NODE_ENV !== "production"`, `DEV_LEAD_PILOT === true`, loopback DB host, exact `AUTOMATION_TEST_DB_ALLOWLIST` match, and DB-backed rate limits (`crm_auth_rate_limits`), returning `404 PILOT_DISABLED` in production.

### Future Option B VPS Runtime vs Option A Limitations

| Requirement | Option A (Business Shared Hosting) | Option B (Dedicated KVM 1 VPS `mum2`) |
| --- | --- | --- |
| **Execution Host** | Cron only (`30m` max, UTC-only, `255` char cmd limit, no persistent daemon, shared `120` `NPROC`) | **Dedicated `systemd` timer + oneshot CLI worker** (`OnCalendar=*:0/5` or `1m` tick) running outside HTTP request lifecycle on loopback |
| **Duplicate Prevention & Concurrency** | Fragile under overlapping cron ticks if job stalls | **`flock` OS lock** + MariaDB `GET_LOCK` + existing B10C `uq_crm_auto_runs_owner_exec_key` (`crm_automation_runs.execution_key`) guarantees strict single execution per event |
| **Crash / Lock Recovery** | Orphaned jobs hold process budget until timeout | `systemd` `TimeoutStartSec=120` + transactional rollback in `executeAutomationRuleRecord` + stale lock expiry |
| **Safety Bounds** | Risk of DB connection starvation against web traffic | Preserves B10C limits (`MAX_EXECUTION_DEPTH = 3`, `MAX_ACTIONS_PER_EVENT = 5`, internal `followup` / `reminder` / `tag` only) + separate low `connectionLimit: 2` CLI pool |
| **Monitoring & Alerts** | No built-in structured service alerting | `journald` logs + `crm_automation_runs` failure audit + `OnFailure=` alert hook to Owner |

**Scope Boundary:** Outbound WhatsApp APIs, outbound emails, and external webhooks remain **deferred and forbidden** until dedicated Owner-approved checkpoints (**B14+**).

---

## 9. Transparent Cost & Operations Breakdown

### Cost Comparison (Verified INR Figures Only)

| Line Item | Plan / Resource | Verified INR Price (from Hostinger Catalog / Account API) | Notes |
| --- | --- | --- | --- |
| **Existing CRM V1 Hosting** | `hostinger_business_v3` (`u256504187`, Order `1010060772`) | **₹699/month** (`auto-renew`) | Retains CRM V1 (`crm.joinscaleflow.in`) + 4 existing Node apps untouched |
| **Option A Upgrade Alternative** | Cloud Startup (`u256504187`) | `₹1,699/mo` (`1y`: `₹9,588` 1st yr / `₹19,188/yr` renewal) | **Not recommended:** still lacks VPS root isolation, systemd timers, and non-`public_html` backup SLA |
| **Option B VPS (Recommended)** | **Hostinger KVM 1 (`mum2` Mumbai 2)** — `1 vCPU`, `4 GB RAM`, `50 GB NVMe`, `4 TB BW` | **Monthly:** `₹999` 1st mo / `₹1,649/mo` renewal<br>**1-Year Term:** `₹8,388` 1st yr (`₹699/mo`) / `₹13,788/yr` renewal (`₹1,149/mo`)<br>**2-Year Term:** `₹14,376` 1st 2yr (`₹599/mo`) / `₹23,976` renewal (`₹999/mo`) | Cleanest fit for CRM V2 (1 Owner + Node 22 Nitro + MariaDB 11.4 + private proofs); excludes GST if added at checkout |
| **Option B Headroom Tier (Optional)** | Hostinger KVM 2 (`mum2`) — `2 vCPU`, `8 GB RAM`, `100 GB NVMe` | Monthly: `₹1,299` / `₹2,099/mo` renewal<br>1-Year: `₹11,148` / `₹16,788/yr` renewal | Unnecessary at launch; KVM 1 upgrades cleanly later (~10m downtime + disk expand) |
| **VPS Daily Backups Add-on** | Paid Hostinger hPanel VPS add-on | **`UNKNOWN` — Must check hPanel checkout before purchase** | Not exposed via `billing_catalog_list` API; weekly VPS backups are included free |
| **Off-VPS Encrypted Storage** | Owner NAS / encrypted workstation pull OR secondary target | `₹0` (existing Owner machine pull) or separate approved SKU | Required for 30-day ransomware-resilient off-VPS encrypted copy |

### Self-Managed VPS Operational Duties (Transferred to Owner / Engineering)

1. Unattended OS security patching (`unattended-upgrades`), SSH key-only authentication (`PasswordAuthentication no`), and UFW + Hostinger Cloud Firewall upkeep.
2. Systemd service + Certbot Let's Encrypt TLS certificate auto-renewal verification.
3. Disk usage threshold checks (`/var/lib/scaleflow-crm` & `/var/lib/mysql` alerts at `70%` warn / `85%` critical).
4. Quarterly backup decryption + disposable-target restore verification drill.
5. Note on Malware Scanning: ClamAV is currently **not** integrated; can optionally be installed on KVM 1 (`4 GB` RAM may require tuned/on-demand `clamscan` rather than resident `clamd`, to be benchmarked if Owner requests AV scanning later).

---

## 10. B11A Code Compatibility & Minimum B11C Configuration Surface

Inspected directly against [`src/server/storage/proofStorage.server.ts`](../src/server/storage/proofStorage.server.ts), [`src/server/config/env.server.ts`](../src/server/config/env.server.ts), [`src/server/health/health.server.ts`](../src/server/health/health.server.ts), [`src/server/auth/security.server.ts`](../src/server/auth/security.server.ts), [`src/lib/api/financeApi.ts`](../src/lib/api/financeApi.ts), and [`src/components/pilot/PilotProofViewer.tsx`](../src/components/pilot/PilotProofViewer.tsx):

- **Storage Driver Contract (`hostinger-private-fs`):** Already fully implemented via `LocalFsProofStorage` implementing `ProofStorageBackend` (`stageUpload`, `persistStagedProof`, `putPrivateObject`, `getPrivateObject`, `headPrivateObject`, `verifyPrivateObject`, `deletePrivateObject`, `listOrphanedObjects`, `readProofStream`).
- **Environment Gate (`assessProofStorageEnv`):** Setting these exact variables inside `/etc/scaleflow-crm/crm.env` cleanly switches `/api/v1/health` and proof routes to `productionReady: true`, `failClosed: false`, `durabilityStatus: "production_verified_private_dir"` **with zero core storage code changes**:
  - `NODE_ENV="production"`
  - `DEV_LEAD_PILOT="false"`
  - `APP_ORIGIN="https://<approved-crm2-domain>"`
  - `AUTH_TRUST_PROXY="true"` *(mandatory behind Nginx TLS termination so HTTPS `Secure` cookies and `getClientIp` rate limiting work accurately)*
  - `PROOF_STORAGE_DRIVER="hostinger-private-fs"`
  - `PROOF_STORAGE_DIR="/var/lib/scaleflow-crm/private-proofs"`
  - `PROOF_PRODUCTION_DURABLE_CONFIRMED="true"` *(**ONLY** flip to `"true"` in B11C after all 20 staging tests pass!)*
- **Frontend UI & Size Limits:** `PilotProofViewer` and `financeApi.ts` already use relative same-origin endpoints (`/api/v1/payments/:id/proof*`, `/download`) cleanly aligned with Option B's single-origin Nginx -> Nitro deployment, and `MAX_PROOF_BYTES` (`10 MiB`) matches Nginx's `client_max_body_size 12m;`.
- **Minimum Additional Engineering Work Needed in B11C / B12:**
  - **B11C:** Ops provisioning (Nginx config, systemd service + backup script, off-VPS encrypted backup sync) + running the 20-point staging suite + documenting Staging Pass Certificate before flipping `blocker-storage-durability` status in Data Vault.
  - **B12:** Implementing AES-256-GCM encrypted ZIP archive generation for in-app Data Vault downloads (clearing `"blocker-backup-encryption"`) + dry-run browser `localStorage` / IndexedDB migration tooling.

---

## 11. Checkpoint B11C Reproducible Staging Durability Test Plan

> **EXECUTION STATUS: `NOT YET EXECUTED`** — Do not claim staging or production durability until an authorized Owner provisions a staging VPS target and every check below passes with recorded terminal/HTTP evidence.

| # | Staging Test Scenario | Procedure & Verification Command | Exact Pass Criteria |
| --- | --- | --- | --- |
| **T01** | **Baseline KVM 1 OS & Service Setup** | Provision Ubuntu 24.04 staging KVM 1 (`mum2`), install Node >= 22.12, MariaDB 11.4, Nginx; create `crmapp` user & `/var/lib/scaleflow-crm/private-proofs` (`0700`) | `systemctl is-active mariadb nginx`, `stat -c '%U:%G %a'` returns `crmapp:crmapp 700` |
| **T02** | **Fail-Closed Before Verification** | Boot built Nitro `.output/server/index.mjs` with `NODE_ENV=production`, `PROOF_STORAGE_DRIVER=hostinger-private-fs`, `PROOF_PRODUCTION_DURABLE_CONFIRMED=false` | `GET /api/v1/health` -> `productionReady: false`, `failClosed: true`; proof `POST` -> `503 storage_durability_blocked` |
| **T03** | **Unsafe Web/Build Path Rejection** | Temporarily configure `PROOF_STORAGE_DIR=/opt/scaleflow-crm/current/.output/private-proofs` and `PROOF_PRODUCTION_DURABLE_CONFIRMED=true` | Health `isolationSafe: false`, `failClosed: true`; upload rejected `503 storage_not_configured` without creating directory |
| **T04** | **Nginx Proxy, TLS, Proxy IP & Session Cookie** | Enable HTTPS (`APP_ORIGIN=https://...`, `AUTH_TRUST_PROXY=true`), login as Owner via `POST /api/v1/auth/login` | Response sets `HttpOnly; SameSite=Lax; Secure`; cross-origin `Sec-Fetch-Site: cross-site` rejected with `csrf_rejected`; MariaDB `crm_auth_audit` records real client IP prefix |
| **T05** | **Direct Web-Root Exposure Block** | Attempt unauthenticated `GET https://<host>/var/lib/scaleflow-crm/private-proofs/...` and `/private-proofs/prf_*.pdf` | Returns `404` / `403` (zero filesystem access via Nginx); private proof files never appear under `/opt/.../current` or Nginx root |
| **T06** | **Migration & 48-Table Verification** | Execute `npm run db:migrate` cleanly against empty MariaDB 11.4 staging DB and check `SHOW TABLES` + `npm run db:check` | Zero errors; `SHOW TABLES` lists **48** tables (`46 crm_*` + `_crm_schema_meta` + `__drizzle_migrations`) |
| **T07** | **4-Format Upload & Structural Rejection** | Upload valid `JPEG`, `PNG`, `WebP`, `PDF` proofs (`<= 10 MiB`), then upload `0`-byte, `10 MiB + 1 byte`, renamed fake EXE, and truncated JPEG missing `FF D9` | Valid 4 formats return `201`; invalid/corrupted/oversized fail cleanly with `400` / `413` and zero orphaned DB rows or files |
| **T08** | **Download Security Headers & CSP Sandbox** | Fetch active proof via authenticated `GET /api/v1/payments/:id/proof/download` (both image and PDF) | `200 OK`; headers include `X-Content-Type-Options: nosniff`, `Cache-Control: private, no-store, must-revalidate`, `X-Frame-Options: DENY`, and `Content-Security-Policy` sandbox |
| **T09** | **Atomic Replace & Audit History Retention** | Execute `POST /api/v1/payments/:id/proof/replace` and `DELETE /api/v1/payments/:id/proof` with mandatory reason; fetch `/history` | Only 1 active proof exists (`crm_payment_proofs`); historical files remain verifiable on disk; audit history preserves SHA-256 chain |
| **T10** | **Code Redeploy Symlink Persistence Drill** | Upload new proofs under release `rel-1`, deploy fresh build to `releases/rel-2`, swap `current -> rel-2`, restart `scaleflow-crm` | All proofs download cleanly (`200 OK`) and pass `GET /api/v1/payments/:id/proof/verify` with exact SHA-256 match |
| **T11** | **Full VPS Reboot Survival Drill** | Run `systemctl reboot`, wait for MariaDB + Nginx + Nitro automatic systemd startup | `/api/v1/health` returns `200`; Owner logs in; pre-reboot proof downloads and verifies SHA-256 without errors |
| **T12** | **Bit-Rot Corruption Detection** | Flip 1 byte in an existing proof binary on staging disk; execute `GET /proof/download` and `GET /proof/verify?persist=1` | Download fails closed (`500 file_corrupted`, zero corrupt bytes streamed); `verify?persist=1` updates `storage_status = 'corrupted'` |
| **T13** | **Missing File & Secret-Free Error Hygiene** | Rename/move a staging proof binary away; execute `GET /proof/download` and `GET /proof/verify?persist=1` | Returns `500 storage_error`; `verify?persist=1` records `storage_status = 'missing'`; JSON body exposes **zero** OS paths or `storageKey` |
| **T14** | **DB / Storage Failure Atomicity Drill** | Simulate staging directory read-only during upload -> inspect DB; verify zero orphan proof records; test idempotency replay temp cleanup | Read-only error rolls back DB cleanly; idempotency replay leaves `0` extra files in `staging/` |
| **T15** | **Encrypted Bundle Creation (`age` Public Key)** | Run automated backup script (`mariadb-dump --single-transaction` + `/var/lib/scaleflow-crm/private-proofs` -> `tar/zstd` -> `age -r <pub>`) | `.tar.zst.age` archive produced cleanly; VPS has **zero** private key and **zero** plaintext `.sql` files remain in `/tmp` or backup dir |
| **T16** | **Off-VPS Pull & Encrypted Unreadability Check** | Pull `.tar.zst.age` to off-VPS destination; try inspecting headers or strings without private key; decrypt off-VPS using Owner offline private key | File unreadable on VPS (`age` encrypted); off-VPS decrypt succeeds with valid `backup-manifest.json` matching every binary SHA-256 |
| **T17** | **Full Clean-Target Disaster Recovery Drill** | Spin clean staging DB + clean `/var/lib/.../private-proofs-restore`; restore solely from off-VPS decrypted backup archive; point app at restored DB & dir | App boots `200`; `SHOW TABLES = 48`; exact paise payment ledger matches; `100%` of non-corrupted proofs pass `GET /proof/verify` |
| **T18** | **Disk Headroom & `70%` / `85%` Alert Test** | Test backup/logrotate/monitoring script against simulated threshold and small staging partition | Threshold monitor emits alert; no log file or unpurged backup fills OS root partition |
| **T19** | **Production Isolation & Automation Lockout** | On staging VPS with `NODE_ENV=production`, call `/api/v1/pilot/*` and `POST /api/v1/automations/:id/execute-test`; check active systemd timers | Pilot and `/execute-test` return `404 PILOT_DISABLED` (or `403`); zero unintended automation timers enabled |
| **T20** | **CRM V1 & Browser-Local Zero-Impact Check** | Inspect Hostinger `u256504187` websites/DBs/deployments and CRM V1 `https://crm.joinscaleflow.in` | CRM V1, existing `u256504187` Node apps, MariaDBs, and local browser IndexedDB/localStorage remain 100% unchanged |

---

## 12. Prioritized Post-B11B Roadmap (`B11C -> B12 -> B13 -> B14`)

1. **Checkpoint B11C — Hostinger VPS Provisioning & 20-Point Staging Verification (NEXT AFTER OWNER APPROVAL):**
   - Owner approves KVM 1 (`mum2`) provisioning, staging domain, and off-VPS encrypted backup target.
   - Configure hardened Ubuntu + MariaDB 11.4 + Nginx TLS + Nitro systemd service + `age`-encrypted off-VPS backup pipeline.
   - Execute **all 20 staging durability tests (`T01`–`T20`)**.
   - **Exit Gate:** `PROOF_PRODUCTION_DURABLE_CONFIRMED=true` validated exclusively by completed staging drill evidence before unblocking `blocker-storage-durability`.
2. **Checkpoint B12 — Encrypted Data Vault & Controlled Local-to-Server Migration Tooling:**
   - Implement AES-256-GCM authenticated encryption for downloaded Data Vault ZIP exports (resolving `"blocker-backup-encryption"`).
   - Build dry-run + idempotent CLI/Owner cutover utility migrating live browser `localStorage` (`scale-flow-crm-2-demo`) and IndexedDB (`scale-flow-payment-proofs`) records into MariaDB + VPS private proofs with deterministic checksum reconciliation.
   - Verify rollback restore on staging before touching real customer data.
3. **Checkpoint B13 — Production Cutover & Owner Go-Live Acceptance:**
   - Execute pre-cutover backup, apply production deploy, run controlled customer data cutover, run live `/api/v1/health` + financial reconciliation + `/proof/verify` verification.
   - Keep CRM V1 (`crm.joinscaleflow.in`) safely running/isolated until Owner explicitly directs retirement.
4. **Checkpoint B14 — Bounded Internal Automation Scheduling (Deferred Until Post-Cutover Stability):**
   - Enable `systemd` timer + `flock`/`execution_key` worker strictly for Owner-approved internal CRM follow-up/reminder/tag rules (`MAX_EXECUTION_DEPTH = 3`, `MAX_ACTIONS_PER_EVENT = 5`).
   - Outbound WhatsApp API, Team multi-user CRM, and external OpenRouter AI remain separate explicitly approved future checkpoints.
