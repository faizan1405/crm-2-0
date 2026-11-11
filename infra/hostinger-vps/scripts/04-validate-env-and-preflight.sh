#!/usr/bin/env bash
set -Eeuo pipefail

# Checkpoint B11C — Non-destructive Environment, Permissions, MariaDB & Disk Preflight Validator (Phase 1 Hardened)
# Never prints environment secrets. Safely fails closed if any prerequisite is missing.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib-common.sh
source "${SCRIPT_DIR}/lib-common.sh"

ENV_FILE="${SCALEFLOW_ENV_FILE}"
REQUIRE_DURABLE="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file)
      ENV_FILE="$2"
      shift 2
      ;;
    --require-durable-confirmed)
      REQUIRE_DURABLE="true"
      shift
      ;;
    *)
      die "Unknown argument: $1"
      ;;
  esac
done

log_info "Running non-destructive preflight validation on ${ENV_FILE}..."
validate_crm_env_file "${ENV_FILE}" "${REQUIRE_DURABLE}"

env_perm="$(stat -c '%U:%G %a' "${ENV_FILE}")"
[[ "${env_perm}" == "root:${SCALEFLOW_APP_GROUP} 640" ]] || die "${ENV_FILE} must be owned root:${SCALEFLOW_APP_GROUP} mode 640 (got '${env_perm}')."

proof_dir="$(read_env_value "${ENV_FILE}" "PROOF_STORAGE_DIR")"
[[ -d "${proof_dir}" ]] || die "Private proof directory missing: ${proof_dir}"
proof_perm="$(stat -c '%U:%G %a' "${proof_dir}")"
[[ "${proof_perm}" == "${SCALEFLOW_APP_USER}:${SCALEFLOW_APP_GROUP} 700" ]] || die "${proof_dir} must be ${SCALEFLOW_APP_USER}:${SCALEFLOW_APP_GROUP} mode 700 (got '${proof_perm}')."

if [[ -d "${SCALEFLOW_STAGING_DIR}" ]]; then
  staging_perm="$(stat -c '%U:%G %a' "${SCALEFLOW_STAGING_DIR}")"
  [[ "${staging_perm}" == "${SCALEFLOW_APP_USER}:${SCALEFLOW_APP_GROUP} 700" ]] || die "${SCALEFLOW_STAGING_DIR} must be ${SCALEFLOW_APP_USER}:${SCALEFLOW_APP_GROUP} mode 700 (got '${staging_perm}')."
fi

if [[ -d "${SCALEFLOW_BACKUP_DIR}" ]]; then
  bkp_perm="$(stat -c '%U:%G %a' "${SCALEFLOW_BACKUP_DIR}")"
  [[ "${bkp_perm}" == "root:root 700" ]] || die "${SCALEFLOW_BACKUP_DIR} must be root:root mode 700 (got '${bkp_perm}')."
fi

# Verify minimum 5 GB free disk headroom on storage mount
avail_kb="$(df -Pk "${proof_dir}" | awk 'NR==2 { print $4 }')"
if [[ -z "${avail_kb}" || "${avail_kb}" -lt 5242880 ]]; then
  die "Insufficient free disk space on ${proof_dir} mount (< 5 GiB available)."
fi

# Verify MariaDB loopback connection using read-only SELECT 1 (avoid leaking password in ps args)
db_host="$(read_env_value "${ENV_FILE}" "DB_HOST")"
db_port="$(read_env_value "${ENV_FILE}" "DB_PORT")"
db_name="$(read_env_value "${ENV_FILE}" "DB_NAME")"
db_user="$(read_env_value "${ENV_FILE}" "DB_USER")"
db_pass="$(read_env_value "${ENV_FILE}" "DB_PASSWORD")"

MYSQL_PWD="${db_pass}" mariadb --protocol=tcp -h "${db_host}" -P "${db_port}" -u "${db_user}" -D "${db_name}" -e "SELECT 1 AS ok;" >/dev/null
unset db_pass

log_info "Preflight succeeded cleanly (storage=${proof_perm}, disk_avail_kb=${avail_kb}, mariadb=OK)."
