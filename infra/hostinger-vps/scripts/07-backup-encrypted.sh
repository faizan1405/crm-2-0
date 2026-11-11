#!/usr/bin/env bash
set -Eeuo pipefail

# Checkpoint B11C — Authenticated Encrypted Backup Runner (`age` Public-Key Mode, Phase 1 Hardened)
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
APP_ORIGIN="$(read_env_value "${ENV_FILE}" "APP_ORIGIN")"

assert_safe_backup_archive_path "${ARCHIVE_DIR}" "${PROOF_ROOT}"

command -v age >/dev/null || die "'age' binary missing; run 01-bootstrap-vps.sh."
command -v zstd >/dev/null || die "'zstd' binary missing; run 01-bootstrap-vps.sh."
command -v jq >/dev/null || die "'jq' binary missing; run 01-bootstrap-vps.sh."
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

log_info "Dumping consistent point-in-time MariaDB snapshot for '${DB_NAME}' via local root socket..."
mariadb-dump \
  --protocol=socket -u root \
  --single-transaction --quick --hex-blob --routines --triggers \
  "${DB_NAME}" > "${BUNDLE_STAGE}/database.sql"
[[ -s "${BUNDLE_STAGE}/database.sql" ]] || die "Database dump produced an empty database.sql."

table_count="$(mariadb -N -s --protocol=socket -u root -D "${DB_NAME}" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();")"
proof_db_count="$(mariadb -N -s --protocol=socket -u root -D "${DB_NAME}" -e "SELECT COUNT(*) FROM crm_payment_proofs;" 2>/dev/null || printf '0')"

log_info "Snapshotting private proof binaries from ${PROOFS_SUBDIR} (excluding /staging)..."
if [[ -d "${PROOFS_SUBDIR}" ]] && find "${PROOFS_SUBDIR}" -mindepth 1 -print -quit | grep -q .; then
  cp -a "${PROOFS_SUBDIR}/." "${BUNDLE_STAGE}/files/proofs/"
fi

# Secret-free configuration inventory (variable NAMES and operational metadata only — zero credentials!)
env_keys_json_array="$(awk -F= '/^[A-Za-z_][A-Za-z0-9_]*=/ { print $1 }' "${ENV_FILE}" | jq -R . | jq -s .)"
jq -n \
  --arg generatedAtUtc "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --arg appOrigin "${APP_ORIGIN}" \
  --arg dbHost "${DB_HOST}" \
  --argjson dbPort "${DB_PORT}" \
  --arg dbName "${DB_NAME}" \
  --arg proofStorageDir "${PROOF_ROOT}" \
  --argjson definedEnvKeysOnly "${env_keys_json_array}" \
  '{
    generatedAtUtc: $generatedAtUtc,
    appOrigin: $appOrigin,
    dbHost: $dbHost,
    dbPort: $dbPort,
    dbName: $dbName,
    proofStorageDriver: "hostinger-private-fs",
    proofStorageDir: $proofStorageDir,
    definedEnvKeysOnly: $definedEnvKeysOnly
  }' > "${BUNDLE_STAGE}/metadata/config-inventory.json"

db_sha256="$(sha256sum "${BUNDLE_STAGE}/database.sql" | awk '{print $1}')"
db_bytes="$(stat -c '%s' "${BUNDLE_STAGE}/database.sql")"
(
  cd "${BUNDLE_STAGE}"
  find files/proofs -type f -print0 | LC_ALL=C sort -z | xargs -0 -r sha256sum > metadata/proof-files.sha256
)
proof_file_count="$(wc -l < "${BUNDLE_STAGE}/metadata/proof-files.sha256" | tr -d ' ')"

jq -n \
  --arg createdAtUtc "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" \
  --arg tag "${BACKUP_TAG}" \
  --argjson physicalTableCount "${table_count:-0}" \
  --argjson proofRowsInDb "${proof_db_count:-0}" \
  --argjson proofFilesArchived "${proof_file_count:-0}" \
  --arg dbSha256 "${db_sha256}" \
  --argjson dbBytes "${db_bytes}" \
  '{
    formatVersion: 1,
    checkpoint: "b11c",
    createdAtUtc: $createdAtUtc,
    tag: $tag,
    physicalTableCount: $physicalTableCount,
    proofRowsInDb: $proofRowsInDb,
    proofFilesArchived: $proofFilesArchived,
    databaseDump: {
      file: "database.sql",
      sha256: $dbSha256,
      bytes: $dbBytes
    },
    proofHashesFile: "metadata/proof-files.sha256",
    configInventoryFile: "metadata/config-inventory.json"
  }' > "${BUNDLE_STAGE}/manifest.json"

OUT_FILE="${ARCHIVE_DIR}/${BUNDLE_NAME}.tar.zst.age"
log_info "Compressing and encrypting archive to ${OUT_FILE} using age public key..."
tar -C "${WORK_DIR}" -cf - "${BUNDLE_NAME}" | zstd -q -6 -T1 | age -r "${AGE_RECIPIENT}" -o "${OUT_FILE}"
chmod 0600 "${OUT_FILE}"
(cd "${ARCHIVE_DIR}" && sha256sum "$(basename "${OUT_FILE}")" > "$(basename "${OUT_FILE}").sha256")
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
