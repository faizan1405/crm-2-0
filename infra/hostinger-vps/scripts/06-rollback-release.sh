#!/usr/bin/env bash
set -Eeuo pipefail

# Checkpoint B11C — Controlled Application Symlink Rollback Script (Phase 1 Hardened)
# Enforces explicit confirmation that any applied DB migrations are backward-compatible.
# For schema-incompatible rollbacks, use 08-restore-verify.sh against the pre-deploy backup!

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib-common.sh
source "${SCRIPT_DIR}/lib-common.sh"

TARGET_RELEASE=""
ACK_SCHEMA="false"
ENV_FILE="${SCALEFLOW_ENV_FILE}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --to-release) TARGET_RELEASE="$2"; shift 2 ;;
    --ack-schema-compatible) ACK_SCHEMA="true"; shift ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

require_vps_execution_gate "06-rollback-release"
[[ -n "${TARGET_RELEASE}" ]] || die "Usage: $0 --to-release <release-id> --ack-schema-compatible"
[[ "${TARGET_RELEASE}" =~ ^[a-zA-Z0-9._-]{3,64}$ ]] || die "Invalid --to-release '${TARGET_RELEASE}'."

if [[ "${ACK_SCHEMA}" != "true" ]]; then
  die "Rollback blocked: confirm code-only schema compatibility with --ack-schema-compatible, OR run 08-restore-verify.sh to restore the paired pre-deploy DB+proof backup."
fi

"${SCRIPT_DIR}/04-validate-env-and-preflight.sh" --env-file "${ENV_FILE}"

TARGET_DIR="${SCALEFLOW_RELEASES_DIR}/${TARGET_RELEASE}"
[[ -d "${TARGET_DIR}" && -f "${TARGET_DIR}/.output/server/index.mjs" ]] || die "Target release invalid or missing .output/server/index.mjs: ${TARGET_DIR}"

require_confirmation_phrase "ROLLBACK CRM RELEASE" "Switch active symlink to '${TARGET_RELEASE}' and restart scaleflow-crm.service"

ln -sfn "${TARGET_DIR}" "${SCALEFLOW_CURRENT_LINK}"
systemctl restart scaleflow-crm

port="$(read_env_value "${ENV_FILE}" "PORT")"
for _ in $(seq 1 20); do
  if curl -fsS --max-time 2 "http://127.0.0.1:${port}/api/v1/health" | jq -e '.ok == true and .status == "ok"' >/dev/null 2>&1; then
    log_info "Rollback to '${TARGET_RELEASE}' succeeded cleanly and passed /api/v1/health."
    exit 0
  fi
  sleep 1
done

die "Rolled back service failed /api/v1/health on 127.0.0.1:${port}. Inspect journalctl -u scaleflow-crm."
