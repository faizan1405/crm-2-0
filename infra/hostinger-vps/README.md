# Scale Flow CRM V2 — Hostinger VPS Deployment Package (Checkpoint B11C-PRE)

> **LOCAL PREPARATION ONLY.** Do **not** execute these scripts until the Owner explicitly provisions a dedicated Hostinger VPS and approves staging execution (`B11C`). Every operational script fails closed unless `ALLOW_REAL_VPS_CHANGES=true` on Ubuntu Linux and interactive confirmation phrases are provided.
> **CRM V1 Protection:** Scripts enforce a hard domain block against `crm.joinscaleflow.in` so CRM V1 cannot be overwritten or reconfigured.

## Contents

- [`templates/crm.env.example`](./templates/crm.env.example) — Secret-free `/etc/scaleflow-crm/crm.env` configuration template (keeps `PROOF_PRODUCTION_DURABLE_CONFIRMED=false` until B11C passes `20/20`).
- [`templates/nginx-scaleflow-crm.conf.template`](./templates/nginx-scaleflow-crm.conf.template) — HTTPS reverse proxy (`127.0.0.1:3000`, `12m` max body, denies dotfiles and `/private-proofs`).
- [`templates/scaleflow-crm.service.template`](./templates/scaleflow-crm.service.template) — Unprivileged `crmapp` systemd unit with `ProtectSystem=strict` filesystem isolation and 4 GB memory caps.
- [`templates/mariadb-crm.cnf.template`](./templates/mariadb-crm.cnf.template) — Loopback-only (`127.0.0.1:3306`) MariaDB 11.4 config with UTC timezone and 768M baseline buffer pool.
- [`templates/logrotate-scaleflow-crm.template`](./templates/logrotate-scaleflow-crm.template) — 14-day compressed rotation inside `/var/log/scaleflow-crm/`.
- `scripts/lib-common.sh` — Shared guards, secret-free env validator, placeholder blocker, CRM V1 isolation check.
- `scripts/01-bootstrap-vps.sh` — Initial Ubuntu LTS hardening, 2 GB swapfile safeguard, `crmapp`/`deploy` users, SSH-key-only check, UFW, isolated directory layout.
- `scripts/02-install-node-mariadb.sh` — Node.js 22 LTS (`>=22.12.0`) + MariaDB 11.4 setup & least-privilege `crm_app`@`127.0.0.1` grants.
- `scripts/03-configure-nginx-tls.sh` — DNS verification, Let's Encrypt Certbot TLS, Nginx, systemd & logrotate installation.
- `scripts/04-validate-env-and-preflight.sh` — Non-destructive preflight verification of `crm.env`, permissions, disk headroom (`>= 5 GiB`), and MariaDB reachability.
- `scripts/05-deploy-release.sh` — Pre-deploy backup, immutable `/opt/scaleflow-crm/releases/<id>` unpack, `db:migrate`, symlink flip, systemd restart & `/api/v1/health` gate.
- `scripts/06-rollback-release.sh` — Explicit confirmation + schema-compatibility-checked release symlink rollback.
- `scripts/07-backup-encrypted.sh` — Atomic `mariadb-dump` + `proofs/` + SHA-256 `manifest.json` streamed into `age` public-key encryption (private key stays offline off-VPS).
- `scripts/08-restore-verify.sh` — Clean-target encrypted restore & `crm_payment_proofs` reconciliation verifier (`staging-clean-verify` and gated `overwrite-live`).

## Authoritative Runbook

See [`docs/crm-b11c-pre-vps-deployment-prep.md`](../../docs/crm-b11c-pre-vps-deployment-prep.md) and [`scripts/b11c-staging-durability-harness.mjs`](../../scripts/b11c-staging-durability-harness.mjs).
