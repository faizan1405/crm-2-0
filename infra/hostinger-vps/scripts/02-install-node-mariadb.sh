#!/usr/bin/env bash
set -Eeuo pipefail

# Checkpoint B11C-PRE — Install Node.js 22 LTS + MariaDB 11.4 and configure local CRM database.
# Never modifies any existing external/Hostinger shared DB or CRM V1.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$(cd "${SCRIPT_DIR}/../templates" && pwd)"
# shellcheck source=./lib-common.sh
source "${SCRIPT_DIR}/lib-common.sh"

require_vps_execution_gate "02-install-node-mariadb"
require_confirmation_phrase "INSTALL NODE AND MARIADB" "Install Node.js 22 LTS + MariaDB 11.4 and write local loopback configuration"

TARGET_DB_NAME="${CRM_DB_NAME:-scaleflow_crm_staging}"
TARGET_DB_USER="${CRM_DB_USER:-crm_app}"
[[ "${TARGET_DB_NAME}" =~ ^[a-z0-9_]{3,64}$ ]] || die "Invalid CRM_DB_NAME='${TARGET_DB_NAME}'."
[[ "${TARGET_DB_USER}" =~ ^[a-z0-9_]{3,32}$ ]] || die "Invalid CRM_DB_USER='${TARGET_DB_USER}'."
if [[ "${TARGET_DB_NAME}" =~ ^u[0-9]{6,}_ ]]; then
  die "Refusing shared Hostinger database naming pattern '${TARGET_DB_NAME}'."
fi

log_info "Installing Node.js 22.x LTS from NodeSource (satisfies engines.node >=22.12.0)..."
export DEBIAN_FRONTEND=noninteractive
install -d -m 0755 /etc/apt/keyrings
if [[ ! -f /etc/apt/keyrings/nodesource.gpg ]]; then
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
fi
printf 'deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_22.x nodistro main\n' \
  > /etc/apt/sources.list.d/nodesource.list
apt-get update -y
apt-get install -y nodejs
node -v

log_info "Installing MariaDB 11.4 server and client..."
UBUNTU_CODENAME="$(. /etc/os-release && printf '%s' "${VERSION_CODENAME:-noble}")"
if [[ ! -f /etc/apt/keyrings/mariadb-keyring.pgp ]]; then
  curl -fsSL https://mariadb.org/mariadb_release_signing_key.pgp -o /etc/apt/keyrings/mariadb-keyring.pgp
fi
cat <<EOF > /etc/apt/sources.list.d/mariadb.list
deb [signed-by=/etc/apt/keyrings/mariadb-keyring.pgp] https://deb.mariadb.org/11.4/ubuntu ${UBUNTU_CODENAME} main
EOF
apt-get update -y
apt-get install -y mariadb-server mariadb-client

# Guarantee MariaDB log folder ownership matches 60-scaleflow-crm.cnf
install -d -o mysql -g adm -m 0750 "${SCALEFLOW_LOG_DIR}/mariadb"
cp "${TEMPLATE_DIR}/mariadb-crm.cnf.template" /etc/mysql/mariadb.conf.d/60-scaleflow-crm.cnf
chmod 0644 /etc/mysql/mariadb.conf.d/60-scaleflow-crm.cnf
systemctl enable --now mariadb
systemctl restart mariadb

log_info "Hardening local MariaDB grants and creating '${TARGET_DB_NAME}'..."
if [[ -z "${CRM_DB_PASSWORD:-}" ]]; then
  if [[ ! -t 0 ]]; then
    die "Set CRM_DB_PASSWORD via secure env/prompt (min 20 chars) before configuring MariaDB user."
  fi
  printf 'Enter strong password for MySQL user %s@127.0.0.1 (hidden): ' "${TARGET_DB_USER}" >&2
  read -r -s CRM_DB_PASSWORD
  printf '\n' >&2
fi
[[ "${#CRM_DB_PASSWORD}" -ge 20 ]] || die "CRM_DB_PASSWORD must be at least 20 characters."
# Reject characters that break SQL literal escaping without extra quoting
if [[ "${CRM_DB_PASSWORD}" == *"'"* || "${CRM_DB_PASSWORD}" == *'\\'* ]]; then
  die "Avoid single quotes or backslashes inside CRM_DB_PASSWORD."
fi

mariadb --protocol=socket -u root <<SQL
DELETE FROM mysql.global_priv WHERE User='';
DELETE FROM mysql.global_priv WHERE User='root' AND Host NOT IN ('localhost', '127.0.0.1', '::1');
DROP DATABASE IF EXISTS test;
CREATE DATABASE IF NOT EXISTS \`${TARGET_DB_NAME}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER IF NOT EXISTS '${TARGET_DB_USER}'@'127.0.0.1' IDENTIFIED BY '${CRM_DB_PASSWORD}';
ALTER USER '${TARGET_DB_USER}'@'127.0.0.1' IDENTIFIED BY '${CRM_DB_PASSWORD}';
GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, INDEX, REFERENCES ON \`${TARGET_DB_NAME}\`.* TO '${TARGET_DB_USER}'@'127.0.0.1';
FLUSH PRIVILEGES;
SQL
unset CRM_DB_PASSWORD

log_info "MariaDB 11.4 configured cleanly on 127.0.0.1:3306 for '${TARGET_DB_NAME}'."
