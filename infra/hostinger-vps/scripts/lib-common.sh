#!/usr/bin/env bash
# Shared safety guards, logging, and env-validation helpers for Scale Flow CRM V2 VPS scripts.
# Sourced by infra/hostinger-vps/scripts/01..08. Never executed directly on local dev machines
# without explicit VPS execution gates.

readonly SCALEFLOW_CRM_V1_DOMAIN="crm.joinscaleflow.in"
readonly SCALEFLOW_APP_USER="crmapp"
readonly SCALEFLOW_APP_GROUP="crmapp"
readonly SCALEFLOW_DEPLOY_USER="deploy"
readonly SCALEFLOW_OPT_ROOT="/opt/scaleflow-crm"
readonly SCALEFLOW_RELEASES_DIR="/opt/scaleflow-crm/releases"
readonly SCALEFLOW_CURRENT_LINK="/opt/scaleflow-crm/current"
readonly SCALEFLOW_VAR_ROOT="/var/lib/scaleflow-crm"
readonly SCALEFLOW_PROOF_DIR="/var/lib/scaleflow-crm/private-proofs"
readonly SCALEFLOW_STAGING_DIR="/var/lib/scaleflow-crm/staging"
readonly SCALEFLOW_ETC_DIR="/etc/scaleflow-crm"
readonly SCALEFLOW_ENV_FILE="/etc/scaleflow-crm/crm.env"
readonly SCALEFLOW_LOG_DIR="/var/log/scaleflow-crm"
readonly SCALEFLOW_BACKUP_DIR="/var/backups/scaleflow-crm"

log_info() {
  printf '[scaleflow-vps][INFO] %s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*"
}

log_warn() {
  printf '[scaleflow-vps][WARN] %s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
}

die() {
  printf '[scaleflow-vps][FAIL] %s %s\n' "$(date -u '+%Y-%m-%dT%H:%M:%SZ')" "$*" >&2
  exit 1
}

# Require explicit Owner-approved execution flag before performing real VPS actions.
require_vps_execution_gate() {
  local action_name="${1:-operation}"
  if [[ "${ALLOW_REAL_VPS_CHANGES:-false}" != "true" ]]; then
    die "Refusing to execute '${action_name}' cleanly (safety gate). Set ALLOW_REAL_VPS_CHANGES=true ONLY on an Owner-approved Ubuntu VPS after review."
  fi
  if [[ "${EUID:-$(id -u)}" -ne 0 ]]; then
    die "Action '${action_name}' requires root privileges (run with sudo on the approved Ubuntu VPS)."
  fi
  if [[ ! -f /etc/os-release ]] || ! grep -qi 'ubuntu' /etc/os-release; then
    die "Refusing to run '${action_name}' outside Ubuntu Linux host (/etc/os-release)."
  fi
}

# Require explicit typed confirmation for destructive or irreversible operations.
require_confirmation_phrase() {
  local expected_phrase="$1"
  local prompt_summary="$2"

  if [[ "${NON_INTERACTIVE_CONFIRM:-}" == "${expected_phrase}" ]]; then
    return 0
  fi

  if [[ ! -t 0 ]]; then
    die "Confirmation phrase '${expected_phrase}' required for ${prompt_summary}, but stdin is not interactive."
  fi

  printf '\n[CONFIRMATION REQUIRED] %s\n' "${prompt_summary}" >&2
  printf 'Type exact phrase "%s" to continue: ' "${expected_phrase}" >&2
  local reply=""
  read -r reply
  if [[ "${reply}" != "${expected_phrase}" ]]; then
    die "Confirmation phrase mismatch. Aborting safely with zero changes."
  fi
}

# Hard isolation guard: never allow any CRM V2 VPS config to touch CRM V1 domain.
assert_not_crm_v1_domain() {
  local value="${1:-}"
  local normalized="${value,,}"
  if [[ "${normalized}" == *"${SCALEFLOW_CRM_V1_DOMAIN}"* ]]; then
    die "FORBIDDEN TARGET: '${value}' matches CRM V1 (${SCALEFLOW_CRM_V1_DOMAIN}). CRM V1 must remain completely untouched on Hostinger Business."
  fi
}

# Reject dangerous webroots, build folders, temp dirs, traversal segments, or control whitespace.
assert_safe_nonpublic_path() {
  local label="$1"
  local dir_path="${2:-}"
  [[ "${dir_path}" == /* ]] || die "${label} must be an absolute path: '${dir_path}'"
  if [[ "${dir_path}" =~ [[:space:][:cntrl:]] ]]; then
    die "${label} cannot contain whitespace or control characters."
  fi
  if [[ "${dir_path}" == *".."* ]]; then
    die "${label} cannot contain '..' traversal segments: '${dir_path}'"
  fi
  local lower="/${dir_path,,}/"
  local seg
  for seg in "public_html" "public" ".output" "dist" "hbuilds" "var/www" "opt/scaleflow-crm" "etc/scaleflow-crm"; do
    if [[ "${lower}" == *"/${seg}/"* ]]; then
      die "${label} ('${dir_path}') overlaps forbidden web/deploy/config path '${seg}'."
    fi
  done
  case "${dir_path}" in
    /tmp|/tmp/*|/var/tmp|/var/tmp/*|/dev/shm|/dev/shm/*|/root|/root/*)
      die "${label} ('${dir_path}') cannot use temporary or /root directories."
      ;;
  esac
}

# Validate private storage path mirrors B11A UNSAFE_SEGMENTS + systemd ReadWritePaths rules.
assert_safe_private_storage_path() {
  local dir_path="${1:-}"
  assert_safe_nonpublic_path "PROOF_STORAGE_DIR" "${dir_path}"
  if [[ "${dir_path}" != "${SCALEFLOW_VAR_ROOT}/"* ]]; then
    die "PROOF_STORAGE_DIR ('${dir_path}') must live inside ${SCALEFLOW_VAR_ROOT}/ to match systemd ReadWritePaths."
  fi
  if [[ "${dir_path}" == "${SCALEFLOW_STAGING_DIR}" || "${dir_path}" == "${SCALEFLOW_STAGING_DIR}/"* ]]; then
    die "PROOF_STORAGE_DIR ('${dir_path}') cannot point inside operational staging dir ${SCALEFLOW_STAGING_DIR}."
  fi
  if [[ "${dir_path}" == "${SCALEFLOW_BACKUP_DIR}" || "${dir_path}" == "${SCALEFLOW_BACKUP_DIR}/"* ]]; then
    die "PROOF_STORAGE_DIR ('${dir_path}') cannot point inside backup archive dir ${SCALEFLOW_BACKUP_DIR}."
  fi
}

assert_safe_backup_archive_path() {
  local archive_dir="${1:-}"
  local proof_dir="${2:-${SCALEFLOW_PROOF_DIR}}"
  assert_safe_nonpublic_path "BACKUP_ARCHIVE_DIR" "${archive_dir}"
  if [[ "${archive_dir}" == "${proof_dir}" || "${archive_dir}" == "${proof_dir}/"* ]]; then
    die "BACKUP_ARCHIVE_DIR ('${archive_dir}') cannot overlap PROOF_STORAGE_DIR ('${proof_dir}')."
  fi
}

# Parse crm.env strictly as key=value (last definition wins) without shell evaluation.
read_env_value() {
  local env_file="$1"
  local target_key="$2"
  [[ -r "${env_file}" ]] || return 1
  local line val="" found="false"
  while IFS= read -r line || [[ -n "${line}" ]]; do
    line="${line%%$'\r'}"
    [[ -z "${line}" || "${line}" =~ ^[[:space:]]*# ]] && continue
    if [[ "${line}" == "${target_key}="* ]]; then
      val="${line#${target_key}=}"
      val="${val#\"}"
      val="${val%\"}"
      val="${val#\'}"
      val="${val%\'}"
      found="true"
    fi
  done < "${env_file}"
  if [[ "${found}" == "true" ]]; then
    printf '%s' "${val}"
    return 0
  fi
  return 1
}

assert_no_placeholder_value() {
  local key="$1"
  local val="${2:-}"
  if [[ -z "${val}" || "${val}" == *"__REPLACE"* || "${val}" == *"__PROPOSED"* || "${val}" == *"CHANGE_ME"* ]]; then
    die "Configuration key '${key}' is missing or still contains an unreplaced template placeholder."
  fi
}

validate_crm_env_file() {
  local env_file="${1:-${SCALEFLOW_ENV_FILE}}"
  local require_durable="${2:-false}"

  [[ -f "${env_file}" ]] || die "Missing environment file: ${env_file}"

  local node_env port nitro_port host nitro_host app_origin tz
  local db_host db_port db_name db_user db_pass db_ssl
  local driver storage_dir durable_confirmed trust_proxy auth_secret dev_pilot age_rec archive_dir

  node_env="$(read_env_value "${env_file}" "NODE_ENV" || true)"
  port="$(read_env_value "${env_file}" "PORT" || true)"
  nitro_port="$(read_env_value "${env_file}" "NITRO_PORT" || true)"
  host="$(read_env_value "${env_file}" "HOST" || true)"
  nitro_host="$(read_env_value "${env_file}" "NITRO_HOST" || true)"
  app_origin="$(read_env_value "${env_file}" "APP_ORIGIN" || true)"
  tz="$(read_env_value "${env_file}" "BUSINESS_TIMEZONE" || true)"
  db_host="$(read_env_value "${env_file}" "DB_HOST" || true)"
  db_port="$(read_env_value "${env_file}" "DB_PORT" || true)"
  db_name="$(read_env_value "${env_file}" "DB_NAME" || true)"
  db_user="$(read_env_value "${env_file}" "DB_USER" || true)"
  db_pass="$(read_env_value "${env_file}" "DB_PASSWORD" || true)"
  db_ssl="$(read_env_value "${env_file}" "DB_SSL_MODE" || true)"
  driver="$(read_env_value "${env_file}" "PROOF_STORAGE_DRIVER" || true)"
  storage_dir="$(read_env_value "${env_file}" "PROOF_STORAGE_DIR" || true)"
  durable_confirmed="$(read_env_value "${env_file}" "PROOF_PRODUCTION_DURABLE_CONFIRMED" || true)"
  trust_proxy="$(read_env_value "${env_file}" "AUTH_TRUST_PROXY" || true)"
  auth_secret="$(read_env_value "${env_file}" "AUTH_SECRET" || true)"
  dev_pilot="$(read_env_value "${env_file}" "DEV_LEAD_PILOT" || true)"
  age_rec="$(read_env_value "${env_file}" "BACKUP_AGE_RECIPIENT" || true)"
  archive_dir="$(read_env_value "${env_file}" "BACKUP_ARCHIVE_DIR" || true)"

  [[ "${node_env}" == "production" ]] || die "NODE_ENV must be 'production' in ${env_file} (got '${node_env}')."
  [[ "${dev_pilot}" == "false" ]] || die "DEV_LEAD_PILOT must be 'false' in ${env_file} (got '${dev_pilot}')."
  [[ "${port}" =~ ^[0-9]+$ ]] && [[ "${port}" -ge 1024 && "${port}" -le 65535 ]] || die "Invalid PORT='${port}'."
  if [[ -n "${nitro_port}" && "${nitro_port}" != "${port}" ]]; then
    die "NITRO_PORT ('${nitro_port}') must match PORT ('${port}') to stay aligned with Nginx upstream."
  fi
  [[ "${host}" == "127.0.0.1" ]] || die "HOST must bind strictly to '127.0.0.1' behind Nginx (got '${host}')."
  if [[ -n "${nitro_host}" && "${nitro_host}" != "127.0.0.1" ]]; then
    die "NITRO_HOST must bind strictly to '127.0.0.1' (got '${nitro_host}')."
  fi
  [[ "${tz}" == "Asia/Kolkata" ]] || die "BUSINESS_TIMEZONE must be 'Asia/Kolkata' (got '${tz}')."
  [[ "${trust_proxy}" == "true" ]] || die "AUTH_TRUST_PROXY must be 'true' behind Nginx TLS termination."

  assert_no_placeholder_value "APP_ORIGIN" "${app_origin}"
  [[ "${app_origin}" == https://* ]] || die "APP_ORIGIN must use https:// (got '${app_origin}')."
  assert_not_crm_v1_domain "${app_origin}"

  [[ "${db_host}" == "127.0.0.1" ]] || die "DB_HOST must be IPv4 loopback '127.0.0.1' (got '${db_host}')."
  [[ "${db_port}" =~ ^[0-9]+$ ]] && [[ "${db_port}" -ge 1 && "${db_port}" -le 65535 ]] || die "Invalid DB_PORT='${db_port}'."
  if [[ -n "${db_ssl}" && ! "${db_ssl}" =~ ^(disabled|preferred|required)$ ]]; then
    die "Invalid DB_SSL_MODE='${db_ssl}'."
  fi
  assert_no_placeholder_value "DB_NAME" "${db_name}"
  assert_no_placeholder_value "DB_USER" "${db_user}"
  assert_no_placeholder_value "DB_PASSWORD" "${db_pass}"
  [[ "${#db_pass}" -ge 20 ]] || die "DB_PASSWORD must be at least 20 characters."

  assert_no_placeholder_value "AUTH_SECRET" "${auth_secret}"
  [[ "${#auth_secret}" -ge 32 ]] || die "AUTH_SECRET must be at least 32 characters."

  if [[ -n "$(read_env_value "${env_file}" "AUTOMATION_TEST_DB_ALLOWLIST" || true)" ]]; then
    die "AUTOMATION_TEST_DB_ALLOWLIST must NEVER be configured on staging or production VPS."
  fi
  if [[ -n "$(read_env_value "${env_file}" "PROOF_TEST_STORAGE_ALLOWLIST" || true)" ]]; then
    die "PROOF_TEST_STORAGE_ALLOWLIST must NEVER be configured on staging or production VPS."
  fi

  [[ "${driver}" == "hostinger-private-fs" ]] || die "PROOF_STORAGE_DRIVER must be 'hostinger-private-fs' (got '${driver}')."
  assert_no_placeholder_value "PROOF_STORAGE_DIR" "${storage_dir}"
  assert_safe_private_storage_path "${storage_dir}"

  if [[ -n "${archive_dir}" ]]; then
    assert_safe_backup_archive_path "${archive_dir}" "${storage_dir}"
  fi

  if [[ "${require_durable}" == "true" && "${durable_confirmed}" != "true" ]]; then
    die "PROOF_PRODUCTION_DURABLE_CONFIRMED must remain 'false' until B11C 20/20 durability tests pass and Owner approves."
  fi

  assert_no_placeholder_value "BACKUP_AGE_RECIPIENT" "${age_rec}"
  [[ "${age_rec}" == age1* ]] || die "BACKUP_AGE_RECIPIENT must be a public 'age1...' recipient key (never store AGE-SECRET-KEY on VPS!)."
  if grep -Eq '^[[:space:]]*[^#].*AGE-SECRET-KEY-' "${env_file}"; then
    die "CRITICAL SECURITY VIOLATION: Private AGE-SECRET-KEY detected inside ${env_file}. Move decryption key offline immediately."
  fi

  log_info "Env validation passed (origin=${app_origin}, db=${db_name}@${db_host}:${db_port}, driver=${driver}, durable=${durable_confirmed:-false})."
}
