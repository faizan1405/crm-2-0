#!/usr/bin/env bash
set -Eeuo pipefail

# Checkpoint B11C-PRE — Controlled Application Release Deployment Script
# Deploys a built CRM V2 release artifact into /opt/scaleflow-crm/releases/<id>, runs preflight,
# captures pre-deploy encrypted backup, runs db:migrate, swaps `current` symlink, restarts systemd,
# and verifies /api/v1/health without touching private proofs or crm.env.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib-common.sh
source "${SCRIPT_DIR}/lib-common.sh"

ARTIFACT_PATH=""
RELEASE_ID=""
ENV_FILE="${SCALEFLOW_ENV_FILE}"
DRY_RUN="false"
ALLOW_INITIAL_EMPTY="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --tarball) ARTIFACT_PATH="$2"; shift 2 ;;
    --release-id) RELEASE_ID="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --dry-run) DRY_RUN="true"; shift ;;
    --allow-initial-empty) ALLOW_INITIAL_EMPTY="true"; shift ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ -n "${ARTIFACT_PATH}" && -n "${RELEASE_ID}" ]] || die "Usage: $0 --tarball <release.tar.gz> --release-id <git-sha-tag> [--dry-run] [--allow-initial-empty]"
[[ "${RELEASE_ID}" =~ ^[a-zA-Z0-9._-]{3,64}$ ]] || die "Invalid --release-id '${RELEASE_ID}'."
[[ -f "${ARTIFACT_PATH}" ]] || die "Release artifact missing: ${ARTIFACT_PATH}"

require_vps_execution_gate "05-deploy-release"

"${SCRIPT_DIR}/04-validate-env-and-preflight.sh" --env-file "${ENV_FILE}"

RELEASE_DIR="${SCALEFLOW_RELEASES_DIR}/${RELEASE_ID}"
[[ ! -e "${RELEASE_DIR}" ]] || die "Release directory already exists: ${RELEASE_DIR}. Use a new unique release-id."

if [[ "${DRY_RUN}" == "true" ]]; then
  log_info "[DRY-RUN] Verified preflight, artifact '${ARTIFACT_PATH}', and target '${RELEASE_DIR}'. Zero changes applied."
  exit 0
fi

require_confirmation_phrase "DEPLOY CRM RELEASE ${RELEASE_ID}" "Deploy CRM V2 release '${RELEASE_ID}' with forward migrations and systemd restart"

# Capture mandatory pre-deploy encrypted backup unless bootstrapping an empty uninitialized DB
db_host="$(read_env_value "${ENV_FILE}" "DB_HOST")"
db_port="$(read_env_value "${ENV_FILE}" "DB_PORT")"
db_name="$(read_env_value "${ENV_FILE}" "DB_NAME")"
db_user="$(read_env_value "${ENV_FILE}" "DB_USER")"
db_pass="$(read_env_value "${ENV_FILE}" "DB_PASSWORD")"
table_count="$(MYSQL_PWD="${db_pass}" mariadb -N -s --protocol=tcp -h "${db_host}" -P "${db_port}" -u "${db_user}" -D "${db_name}" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();")"
unset db_pass

if [[ "${table_count:-0}" -gt 0 ]]; then
  log_info "Existing schema detected (${table_count} tables). Running mandatory pre-deploy encrypted backup..."
  "${SCRIPT_DIR}/07-backup-encrypted.sh" --env-file "${ENV_FILE}" --tag "pre-${RELEASE_ID}"
elif [[ "${ALLOW_INITIAL_EMPTY}" != "true" ]]; then
  die "Database '${db_name}' has 0 tables; re-run with --allow-initial-empty for initial bootstrap deploy."
fi

PREV_TARGET=""
if [[ -L "${SCALEFLOW_CURRENT_LINK}" ]]; then
  PREV_TARGET="$(readlink -f "${SCALEFLOW_CURRENT_LINK}" || true)"
fi

log_info "Unpacking release into ${RELEASE_DIR}..."
mkdir -p "${RELEASE_DIR}"
tar -xzf "${ARTIFACT_PATH}" -C "${RELEASE_DIR}"
[[ -f "${RELEASE_DIR}/.output/server/index.mjs" ]] || die "Compiled Nitro server missing at ${RELEASE_DIR}/.output/server/index.mjs"
[[ -f "${RELEASE_DIR}/scripts/db-migrate.mjs" ]] || die "Migration script missing at ${RELEASE_DIR}/scripts/db-migrate.mjs"

node_ver="$(node -v | sed 's/^v//')"
node_major="${node_ver%%.*}"
[[ "${node_major}" -ge 22 ]] || die "Node.js >=22.12.0 required (found v${node_ver})."

chown -R "${SCALEFLOW_DEPLOY_USER}:${SCALEFLOW_APP_GROUP}" "${RELEASE_DIR}"

log_info "Installing production Node dependencies if node_modules is absent..."
if [[ ! -d "${RELEASE_DIR}/node_modules" ]]; then
  (cd "${RELEASE_DIR}" && su -s /bin/bash "${SCALEFLOW_DEPLOY_USER}" -c "npm ci --omit=dev")
fi

log_info "Running Drizzle forward migrations against ${db_name}@${db_host}:${db_port}..."
(
  cd "${RELEASE_DIR}"
  set -a
  # shellcheck disable=SC1090
  source "${ENV_FILE}"
  set +a
  node scripts/db-migrate.mjs
)

log_info "Atomically switching symlink ${SCALEFLOW_CURRENT_LINK} -> ${RELEASE_DIR}..."
ln -sfn "${RELEASE_DIR}" "${SCALEFLOW_CURRENT_LINK}"
systemctl restart scaleflow-crm

port="$(read_env_value "${ENV_FILE}" "PORT")"
health_ok="false"
for _ in $(seq 1 20); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${port}/api/v1/health" | jq -e '.ok == true and .status == "ok"' >/dev/null 2>&1; then
    health_ok="true"
    break
  fi
  sleep 1
done

if [[ "${health_ok}" != "true" ]]; then
  log_warn "Health check failed after restart!"
  if [[ -n "${PREV_TARGET}" && -d "${PREV_TARGET}" ]]; then
    log_warn "Attempting symlink revert to ${PREV_TARGET} (check DB migrations separately via 08-restore-verify.sh if schema changed!)."
    ln -sfn "${PREV_TARGET}" "${SCALEFLOW_CURRENT_LINK}"
    systemctl restart scaleflow-crm || true
  fi
  die "Deployment health check failed on http://127.0.0.1:${port}/api/v1/health. Inspect journalctl -u scaleflow-crm."
fi

log_info "Release ${RELEASE_ID} deployed cleanly and healthy! Pruning releases beyond 5..."
active_real="$(readlink -f "${SCALEFLOW_CURRENT_LINK}")"
mapfile -t all_releases < <(find "${SCALEFLOW_RELEASES_DIR}" -mindepth 1 -maxdepth 1 -type d -printf '%T@ %p\n' | sort -nr | awk '{print $2}')
idx=0
for r in "${all_releases[@]}"; do
  idx=$((idx + 1))
  if [[ "${idx}" -gt 5 && "${r}" != "${active_real}" ]]; then
    rm -rf "${r}"
  fi
done
