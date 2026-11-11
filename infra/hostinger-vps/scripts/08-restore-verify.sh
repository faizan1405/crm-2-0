#!/usr/bin/env bash
set -Eeuo pipefail

# Checkpoint B11C-PRE — Encrypted Archive Verification, Clean-Target Restore & Proof Reconciliation
# Supports safe clean-target verification (`--mode staging-clean-verify`) AND explicit gated
# production restore (`--mode overwrite-live`).

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib-common.sh
source "${SCRIPT_DIR}/lib-common.sh"

MODE=""
ARCHIVE_FILE=""
AGE_IDENTITY_FILE=""
VERIFY_DB="scaleflow_crm_restore_verify"
VERIFY_PROOF_DIR="/var/lib/scaleflow-crm/staging/restore-verify"
ENV_FILE="${SCALEFLOW_ENV_FILE}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --mode) MODE="$2"; shift 2 ;;
    --archive) ARCHIVE_FILE="$2"; shift 2 ;;
    --age-identity) AGE_IDENTITY_FILE="$2"; shift 2 ;;
    --verify-db) VERIFY_DB="$2"; shift 2 ;;
    --verify-proof-dir) VERIFY_PROOF_DIR="$2"; shift 2 ;;
    --env-file) ENV_FILE="$2"; shift 2 ;;
    *) die "Unknown argument: $1" ;;
  esac
done

[[ "${MODE}" == "staging-clean-verify" || "${MODE}" == "overwrite-live" ]] || die "Specify --mode staging-clean-verify | overwrite-live"
[[ -f "${ARCHIVE_FILE}" ]] || die "Archive not found: ${ARCHIVE_FILE}"
[[ -f "${AGE_IDENTITY_FILE}" ]] || die "Owner offline age private identity file not provided/found: ${AGE_IDENTITY_FILE}"

require_vps_execution_gate "08-restore-verify"
umask 077

command -v age >/dev/null || die "'age' binary missing."
command -v zstd >/dev/null || die "'zstd' binary missing."

if [[ -f "${ARCHIVE_FILE}.sha256" ]]; then
  (cd "$(dirname "${ARCHIVE_FILE}")" && sha256sum -c "$(basename "${ARCHIVE_FILE}.sha256")")
fi

WORK_DIR="$(mktemp -d "${SCALEFLOW_STAGING_DIR}/rst_XXXXXX")"
chmod 0700 "${WORK_DIR}"
cleanup_restore_tmp() {
  rm -rf "${WORK_DIR}"
}
trap cleanup_restore_tmp EXIT

log_info "Decrypting and unpacking ${ARCHIVE_FILE} into temporary isolated workspace..."
age -d -i "${AGE_IDENTITY_FILE}" "${ARCHIVE_FILE}" | zstd -d -q | tar -C "${WORK_DIR}" -xf -

EXTRACTED_DIR="$(find "${WORK_DIR}" -mindepth 1 -maxdepth 1 -type d | head -n 1)"
[[ -n "${EXTRACTED_DIR}" && -f "${EXTRACTED_DIR}/manifest.json" ]] || die "Decrypted bundle missing manifest.json."

expected_db_sha="$(jq -r '.databaseDump.sha256' "${EXTRACTED_DIR}/manifest.json")"
actual_db_sha="$(sha256sum "${EXTRACTED_DIR}/database.sql" | awk '{print $1}')"
[[ "${expected_db_sha}" == "${actual_db_sha}" ]] || die "Database dump SHA-256 mismatch! Expected ${expected_db_sha}, got ${actual_db_sha}."

if [[ -s "${EXTRACTED_DIR}/metadata/proof-files.sha256" ]]; then
  (cd "${EXTRACTED_DIR}" && sha256sum -c metadata/proof-files.sha256 >/dev/null)
fi
log_info "Manifest cryptographic verification passed for SQL dump and all proof binaries."

db_host="$(read_env_value "${ENV_FILE}" "DB_HOST")"
db_port="$(read_env_value "${ENV_FILE}" "DB_PORT")"
live_db_name="$(read_env_value "${ENV_FILE}" "DB_NAME")"
db_user="$(read_env_value "${ENV_FILE}" "DB_USER")"
db_pass="$(read_env_value "${ENV_FILE}" "DB_PASSWORD")"
live_proof_root="$(read_env_value "${ENV_FILE}" "PROOF_STORAGE_DIR")"

if [[ "${MODE}" == "staging-clean-verify" ]]; then
  [[ "${VERIFY_DB}" != "${live_db_name}" ]] || die "Refusing --verify-db matching active DB '${live_db_name}' in clean verify mode!"
  [[ "${VERIFY_DB}" =~ ^[a-z0-9_]{3,64}$ ]] || die "Invalid --verify-db '${VERIFY_DB}'."

  log_info "Restoring into clean disposable verification DB '${VERIFY_DB}' and dir '${VERIFY_PROOF_DIR}'..."
  mariadb --protocol=socket -u root -e "DROP DATABASE IF EXISTS \`${VERIFY_DB}\`; CREATE DATABASE \`${VERIFY_DB}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; GRANT ALL PRIVILEGES ON \`${VERIFY_DB}\`.* TO '${db_user}'@'127.0.0.1'; FLUSH PRIVILEGES;"
  MYSQL_PWD="${db_pass}" mariadb --protocol=tcp -h "${db_host}" -P "${db_port}" -u "${db_user}" "${VERIFY_DB}" < "${EXTRACTED_DIR}/database.sql"

  rm -rf "${VERIFY_PROOF_DIR}"
  mkdir -p "${VERIFY_PROOF_DIR}/proofs"
  cp -a "${EXTRACTED_DIR}/files/proofs/." "${VERIFY_PROOF_DIR}/proofs/" 2>/dev/null || true

  restored_tables="$(MYSQL_PWD="${db_pass}" mariadb -N -s --protocol=tcp -h "${db_host}" -P "${db_port}" -u "${db_user}" -D "${VERIFY_DB}" -e "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = DATABASE();")"
  [[ "${restored_tables}" -ge 48 ]] || die "Expected >=48 physical tables after restore, found ${restored_tables}."

  log_info "Reconciling crm_payment_proofs rows against restored binary files..."
  mismatch_count=0
  while IFS=$'\t' read -r proof_id storage_key expected_sha expected_bytes; do
    [[ -z "${proof_id}" ]] && continue
    target_bin="${VERIFY_PROOF_DIR}/proofs/${storage_key}"
    if [[ ! -f "${target_bin}" ]]; then
      log_warn "Missing proof binary for ${proof_id}: ${storage_key}"
      mismatch_count=$((mismatch_count + 1))
      continue
    fi
    actual_sha="$(sha256sum "${target_bin}" | awk '{print $1}')"
    actual_bytes="$(stat -c '%s' "${target_bin}")"
    if [[ "${actual_sha}" != "${expected_sha}" || "${actual_bytes}" != "${expected_bytes}" ]]; then
      log_warn "Integrity mismatch on ${proof_id} (${storage_key})"
      mismatch_count=$((mismatch_count + 1))
    fi
  done < <(MYSQL_PWD="${db_pass}" mariadb -N -B --protocol=tcp -h "${db_host}" -P "${db_port}" -u "${db_user}" -D "${VERIFY_DB}" -e "SELECT id, storage_key, sha256_hash, file_size FROM crm_payment_proofs WHERE storage_status NOT IN ('corrupted', 'missing');")
  unset db_pass

  [[ "${mismatch_count}" -eq 0 ]] || die "Proof-to-DB reconciliation failed with ${mismatch_count} mismatch(es)."
  log_info "Clean restore verification PASSED (${restored_tables} physical tables, 0 payment-proof mismatches)."
  exit 0
fi

# MODE == overwrite-live
require_confirmation_phrase "RESTORE OVERWRITE LIVE CRM" "Stop scaleflow-crm and overwrite live DB '${live_db_name}' and '${live_proof_root}/proofs'"

log_info "Stopping scaleflow-crm before live database and proof restore..."
systemctl stop scaleflow-crm

MYSQL_PWD="${db_pass}" mariadb --protocol=tcp -h "${db_host}" -P "${db_port}" -u "${db_user}" "${live_db_name}" < "${EXTRACTED_DIR}/database.sql"
mkdir -p "${live_proof_root}/proofs"
rm -rf "${live_proof_root}/proofs/"*
cp -a "${EXTRACTED_DIR}/files/proofs/." "${live_proof_root}/proofs/" 2>/dev/null || true
chown -R "${SCALEFLOW_APP_USER}:${SCALEFLOW_APP_GROUP}" "${live_proof_root}"
find "${live_proof_root}" -type d -exec chmod 0700 {} +
find "${live_proof_root}/proofs" -type f -exec chmod 0600 {} +
unset db_pass

systemctl start scaleflow-crm
log_info "Live restore complete. Verify /api/v1/health and proof verification checks immediately."
