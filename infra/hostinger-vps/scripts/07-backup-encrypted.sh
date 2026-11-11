#!/usr/bin/env bash
set -Eeuo pipefail

# Checkpoint B11C-PRE — Authenticated Encrypted Backup Runner (`age` Public-Key Mode)
# Covers MariaDB (all 48 tables + data), private payment proofs (/proofs only, excluding /staging),
# non-secret config key inventory, and SHA-256 manifest. NEVER keeps decryption private keys on VPS.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib-common.sh
source "${SCRIPT_DIR}/lib-common.sh"

ENV_FILE="${SCALEFLOW_ENV_FILE}"
BACKUP_TAG="scheduled"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --tag) BACKUP_TAG="$2"; shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ "${BACKUP_TAG}" =~ ^[a-zA-Z0-9._-]{1,40}$ ]] || die "Invalid --tag '${BACKUP_TAG}'."
require_vps_execution_gate "07-backup-encrypted"
validate_crm_env_file "${ENV_FILE}" "false"

umask 077

AGE_RECIPIENT="$(read_env_value "${ENV_FILE}" "BACKUP_AGE_RECIPIENT")"
ARCHIVE_DIR="$(read_env_value "${ENV_FILE}" "BACKUP_ARCHIVE_DIR" || printf '%s' "${SCALEFLOW_BACKUP_DIR}")"
RETENTION_DAYS="$(read_env_value "${ENV_FILE}" "BACKUP_RETENTION_DAYS" || printf '30')"
PROOF_ROOT="$(read_env_value "${ENV_FILE}" "PROOF_STORAGE_DIR")"
PROOFS_SUBDIR="${PROOF_ROOT}/proofs"
DB_HOST="$(read_env_value "${ENV_FILE}" "DB_HOST")"
DB_PORT="$(read_env_value "${ENV_FILE}" "DB_PORT")"
DB_NAME="$(read_env_value "${ENV_FILE}" "DB_NAME")"
DB_USER="$(read_env_value "${ENV_FILE}" "DB_USER")"
DB_PASS="$(read_env_value "${ENV_FILE}" "DB_PASSWORD")"
APP_ORIGIN="$(read_env_value "${ENV_FILE}" "APP_ORIGIN")"

command -v age >/dev/null || die "'age' binary missing; run 01-bootstrap-vps.sh."
command -v zstd >/dev/null || die "'zstd' binary missing; run 01-bootstrap-vps.sh."
command -v mariadb-dump >/dev/null || die "'mariadb-dump' missing; run 02-install-node-mariadb.sh."

install -d -m 0700 "${ARCHIVE_DIR}"
WORK_DIR="$(mktemp -d "${SCALEFLOW_STAGING_DIR}/bkp_XXXXXX")"
chmod 0700 "${WORK_DIR}"

cleanup_workdir() {
  rm -rf "${WORK_DIR}"
}
trap cleanup_workdir EXIT

TS="$(date -u '+%Y%m%dT%H%M%SZ')"
BUNDLE_NAME="scaleflow-crm-${BACKUP_TAG}-${TS}"
BUNDLE_STAGE="${WORK_DIR}/${BUNDLE_NAME}"
mkdir -p "${BUNDLE_STAGE}/files/proofs" "${BUNDLE_STAGE}/metadata"

log_info "Dumping consistent point-in-time MariaDB snapshot for '${DB_NAME}'..."
MYSQL_PWD="${DB_PASS}" mariadb-dump \
  --protocol=tcp -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" \
  --single-transaction --quick --hex-blob --routines --triggers \
  "${DB_NAME}" > "${BUNDLE_STAGE}/database.sql"

table_count="$(MYSQL_PWD="${DB_PASS}" mariadb -N -s --protocol=tcp -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -D "${DB_NAME}" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();")"
proof_db_count="$(MYSQL_PWD="${DB_PASS}" mariadb -N -s --protocol=tcp -h "${DB_HOST}" -P "${DB_PORT}" -u "${DB_USER}" -D "${DB_NAME}" -e "SELECT COUNT(*) FROM crm_payment_proofs;" 2>/dev/null || printf '0')"
unset DB_PASS

log_info "Snapshotting private proof binaries from ${PROOFS_SUBDIR} (excluding /staging)..."
if [[ -d "${PROOFS_SUBDIR}" ]]; then
  cp -a "${PROOFS_SUBDIR}/." "${BUNDLE_STAGE}/files/proofs/" 2>/dev/null || true
fi

# Secret-free configuration inventory (variable NAMES and operational metadata only — zero credentials!)
env_keys_json="$(awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/ { printf "\"%s\",", $1 }' "${ENV_FILE}" | sed 's/,$//')"
cat <<EOF > "${BUNDLE_STAGE}/metadata/config-inventory.json"
{
  "generatedAtUtc": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "appOrigin": "${APP_ORIGIN}",
  "dbHost": "${DB_HOST}",
  "dbPort": ${DB_PORT},
  "dbName": "${DB_NAME}",
  "proofStorageDriver": "hostinger-private-fs",
  "proofStorageDir": "${PROOF_ROOT}",
  "definedEnvKeysOnly": [${env_keys_json}]
}
EOF

db_sha256="$(sha256sum "${BUNDLE_STAGE}/database.sql" | awk '{print $1}')"
db_bytes="$(stat -c '%s' "${BUNDLE_STAGE}/database.sql")"
(
  cd "${BUNDLE_STAGE}"
  find files/proofs -type f | sort | xargs -r sha256sum > metadata/proof-files.sha256
)
proof_file_count="$(wc -l < "${BUNDLE_STAGE}/metadata/proof-files.sha256" | tr -d ' ')"

cat <<EOF > "${BUNDLE_STAGE}/manifest.json"
{
  "formatVersion": 1,
  "checkpoint": "b11c-pre",
  "createdAtUtc": "$(date -u '+%Y-%m-%dT%H:%M:%SZ')",
  "tag": "${BACKUP_TAG}",
  "physicalTableCount": ${table_count:-0},
  "proofRowsInDb": ${proof_db_count:-0},
  "proofFilesArchived": ${proof_file_count:-0},
  "databaseDump": {
    "file": "database.sql",
    "sha256": "${db_sha256}",
    "bytes": ${db_bytes}
  },
  "proofHashesFile": "metadata/proof-files.sha256",
  "configInventoryFile": "metadata/config-inventory.json"
}
EOF

OUT_FILE="${ARCHIVE_DIR}/${BUNDLE_NAME}.tar.zst.age"
log_info "Compressing and encrypting archive to ${OUT_FILE} using age public key..."
tar -C "${WORK_DIR}" -cf - "${BUNDLE_NAME}" | zstd -q -6 -T1 | age -r "${AGE_RECIPIENT}" -o "${OUT_FILE}"
chmod 0600 "${OUT_FILE}"
sha256sum "${OUT_FILE}" > "${OUT_FILE}.sha256"
chmod 0600 "${OUT_FILE}.sha256"

# Immediate cleanup of plaintext bundle happens via EXIT trap too
rm -rf "${WORK_DIR}"

# Enforce local archive retention window cleanly
if [[ "${RETENTION_DAYS}" =~ ^[0-9]+$ && "${RETENTION_DAYS}" -gt 0 ]]; then
  find "${ARCHIVE_DIR}" -maxdepth 1 -type f \( -name 'scaleflow-crm-*.tar.zst.age' -o -name 'scaleflow-crm-*.sha256' \) -mtime "+${RETENTION_DAYS}" -delete
fi

off_vps_status="$(read_env_value "${ENV_FILE}" "BACKUP_OFF_VPS_STATUS" || printf 'UNRESOLVED_OWNER_DECISION')"
if [[ "${off_vps_status}" == "UNRESOLVED_OWNER_DECISION" ]]; then
  log_warn "Archive created locally at ${OUT_FILE}, but off-VPS retention destination is UNRESOLVED_OWNER_DECISION. Transfer off-VPS before production cutover!"
else
  log_info "Encrypted backup completed cleanly: ${OUT_FILE} (tables=${table_count}, proofs=${proof_file_count})."
fi
