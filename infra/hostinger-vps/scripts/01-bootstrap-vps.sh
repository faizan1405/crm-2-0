#!/usr/bin/env bash
set -Eeuo pipefail

# Checkpoint B11C — Initial Hostinger KVM 1 Ubuntu LTS VPS Bootstrap (Phase 1 Hardened)
# Prepares OS packages, swap, `crmapp` & `deploy` users, SSH key-only hardening, UFW firewall,
# and hardened directory layout without touching application code or external services.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=./lib-common.sh
source "${SCRIPT_DIR}/lib-common.sh"

require_vps_execution_gate "01-bootstrap-vps"
require_confirmation_phrase "BOOTSTRAP CRM VPS" "Initial OS hardening, swap, SSH, UFW firewall, and filesystem layout creation"

SSH_ALLOW_PORT="${SSH_PORT:-22}"
[[ "${SSH_ALLOW_PORT}" =~ ^[0-9]+$ ]] && [[ "${SSH_ALLOW_PORT}" -ge 1 && "${SSH_ALLOW_PORT}" -le 65535 ]] || die "Invalid SSH_PORT='${SSH_ALLOW_PORT}'."

log_info "Updating apt indexes and installing baseline Ubuntu security tooling..."
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y --no-install-recommends \
  ca-certificates \
  curl \
  gnupg \
  lsb-release \
  ufw \
  fail2ban \
  unattended-upgrades \
  nginx \
  certbot \
  age \
  zstd \
  jq \
  acl

log_info "Configuring 2 GB swapfile safeguard (only if no active swap exists)..."
if ! swapon --show | grep -q '/swapfile'; then
  if [[ ! -f /swapfile ]]; then
    if ! fallocate -l 2G /swapfile 2>/dev/null; then
      dd if=/dev/zero of=/swapfile bs=1M count=2048 status=none
    fi
    chmod 0600 /swapfile
    mkswap /swapfile
  fi
  swapon /swapfile
  if ! grep -q '^/swapfile ' /etc/fstab; then
    printf '/swapfile none swap sw 0 0\n' >> /etc/fstab
  fi
  printf 'vm.swappiness=10\n' > /etc/sysctl.d/90-scaleflow-swap.conf
  sysctl -p /etc/sysctl.d/90-scaleflow-swap.conf >/dev/null
fi

log_info "Creating unprivileged '${SCALEFLOW_APP_USER}' and '${SCALEFLOW_DEPLOY_USER}' accounts..."
if ! getent group "${SCALEFLOW_APP_GROUP}" >/dev/null; then
  groupadd --system "${SCALEFLOW_APP_GROUP}"
fi
if ! id -u "${SCALEFLOW_APP_USER}" >/dev/null 2>&1; then
  useradd --system --gid "${SCALEFLOW_APP_GROUP}" --no-create-home --home-dir "${SCALEFLOW_OPT_ROOT}" --shell /usr/sbin/nologin "${SCALEFLOW_APP_USER}"
fi
if ! id -u "${SCALEFLOW_DEPLOY_USER}" >/dev/null 2>&1; then
  useradd --create-home --shell /bin/bash --groups "${SCALEFLOW_APP_GROUP}" "${SCALEFLOW_DEPLOY_USER}"
fi

log_info "Creating hardened directory hierarchy with strict isolation permissions..."
install -d -o "${SCALEFLOW_DEPLOY_USER}" -g "${SCALEFLOW_APP_GROUP}" -m 0755 "${SCALEFLOW_OPT_ROOT}" "${SCALEFLOW_RELEASES_DIR}"
install -d -o root -g "${SCALEFLOW_APP_GROUP}" -m 0750 "${SCALEFLOW_ETC_DIR}"
install -d -o "${SCALEFLOW_APP_USER}" -g "${SCALEFLOW_APP_GROUP}" -m 0700 "${SCALEFLOW_VAR_ROOT}" "${SCALEFLOW_PROOF_DIR}" "${SCALEFLOW_PROOF_DIR}/proofs" "${SCALEFLOW_PROOF_DIR}/staging" "${SCALEFLOW_STAGING_DIR}"
install -d -o root -g adm -m 0750 "${SCALEFLOW_LOG_DIR}"
install -d -o mysql -g adm -m 0750 "${SCALEFLOW_LOG_DIR}/mariadb" 2>/dev/null || install -d -o root -g adm -m 0750 "${SCALEFLOW_LOG_DIR}/mariadb"
install -d -o root -g root -m 0700 "${SCALEFLOW_BACKUP_DIR}"
touch "${SCALEFLOW_LOG_DIR}/app.log" "${SCALEFLOW_LOG_DIR}/app-error.log" "${SCALEFLOW_LOG_DIR}/backup.log"
chown "${SCALEFLOW_APP_USER}:adm" "${SCALEFLOW_LOG_DIR}/app.log" "${SCALEFLOW_LOG_DIR}/app-error.log"
chown root:root "${SCALEFLOW_LOG_DIR}/backup.log"
chmod 0640 "${SCALEFLOW_LOG_DIR}/app.log" "${SCALEFLOW_LOG_DIR}/app-error.log" "${SCALEFLOW_LOG_DIR}/backup.log"

# Ensure SSH keys exist before disabling password auth so operator is never locked out!
if [[ -s /root/.ssh/authorized_keys ]] || [[ -s "/home/${SCALEFLOW_DEPLOY_USER}/.ssh/authorized_keys" ]]; then
  log_info "Verified SSH public key present; applying SSH-key-only hardening drop-in..."
  install -d -m 0755 /etc/ssh/sshd_config.d
  cat <<'EOF' > /etc/ssh/sshd_config.d/99-scaleflow-hardening.conf
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
PermitRootLogin prohibit-password
PubkeyAuthentication yes
X11Forwarding no
AllowAgentForwarding no
MaxAuthTries 4
EOF
  sshd -t
  systemctl reload ssh || systemctl reload sshd
else
  log_warn "No SSH authorized_keys found in /root/.ssh or /home/${SCALEFLOW_DEPLOY_USER}/.ssh. Leaving PasswordAuthentication unchanged to prevent lockout — add SSH key then re-run!"
fi

log_info "Configuring UFW firewall (allow ${SSH_ALLOW_PORT}/tcp, 80/tcp, 443/tcp; deny 3000 & 3306)..."
ufw default deny incoming
ufw default allow outgoing
ufw limit "${SSH_ALLOW_PORT}/tcp" comment 'Rate-limited SSH'
ufw allow 80/tcp comment 'HTTP ACME and HTTPS redirect'
ufw allow 443/tcp comment 'HTTPS TLS Nginx'
ufw deny 3000/tcp comment 'Block direct external Nitro access'
ufw deny 3306/tcp comment 'Block direct external MariaDB access'
ufw --force enable

systemctl enable --now fail2ban
dpkg-reconfigure -f noninteractive unattended-upgrades || true

log_info "VPS bootstrap complete. Proceed to 02-install-node-mariadb.sh after Owner checks firewall/SSH access."
