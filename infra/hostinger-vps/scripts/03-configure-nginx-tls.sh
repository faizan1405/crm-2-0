#!/usr/bin/env bash
set -Eeuo pipefail

# Checkpoint B11C-PRE — Install systemd, logrotate, Nginx reverse proxy, and Let's Encrypt TLS.
# Enforces hard isolation from CRM V1 (crm.joinscaleflow.in) and verifies DNS before running Certbot.

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
TEMPLATE_DIR="$(cd "${SCRIPT_DIR}/../templates" && pwd)"
# shellcheck source=./lib-common.sh
source "${SCRIPT_DIR}/lib-common.sh"

require_vps_execution_gate "03-configure-nginx-tls"

TARGET_DOMAIN="${1:-${CRM_DOMAIN:-}}"
[[ -n "${TARGET_DOMAIN}" ]] || die "Usage: $0 <staging-v2.joinscaleflow.in | v2.crm.joinscaleflow.in>"
assert_not_crm_v1_domain "${TARGET_DOMAIN}"
[[ "${TARGET_DOMAIN}" =~ ^[a-zA-Z0-9.-]+$ ]] || die "Invalid domain format '${TARGET_DOMAIN}'."
[[ -n "${CERTBOT_EMAIL:-}" ]] || die "Set CERTBOT_EMAIL for Let's Encrypt certificate registration."

require_confirmation_phrase "CONFIGURE NGINX TLS" "Install systemd service, logrotate, and Nginx TLS config for '${TARGET_DOMAIN}'"

log_info "Installing systemd unit and logrotate configuration..."
cp "${TEMPLATE_DIR}/scaleflow-crm.service.template" /etc/systemd/system/scaleflow-crm.service
chmod 0644 /etc/systemd/system/scaleflow-crm.service
cp "${TEMPLATE_DIR}/logrotate-scaleflow-crm.template" /etc/logrotate.d/scaleflow-crm
chmod 0644 /etc/logrotate.d/scaleflow-crm
systemctl daemon-reload

log_info "Verifying public DNS resolution for '${TARGET_DOMAIN}' before touching Nginx/Certbot..."
resolved_ip="$(getent ahostsv4 "${TARGET_DOMAIN}" | awk 'NR==1 { print $1 }' || true)"
vps_public_ip="$(curl -4 -fsS --max-time 5 https://api.ipify.org || true)"
if [[ -z "${resolved_ip}" || -z "${vps_public_ip}" || "${resolved_ip}" != "${vps_public_ip}" ]]; then
  die "DNS precheck failed: '${TARGET_DOMAIN}' resolves to '${resolved_ip:-NONE}', expected VPS IPv4 '${vps_public_ip:-UNKNOWN}'. Create approved DNS A record first."
fi

log_info "Provisioning temporary HTTP server for ACME verification then full TLS vhost..."
sed "s/__DOMAIN__/${TARGET_DOMAIN}/g" "${TEMPLATE_DIR}/nginx-scaleflow-crm.conf.template" \
  > /etc/nginx/sites-available/scaleflow-crm.conf

if [[ ! -f "/etc/letsencrypt/live/${TARGET_DOMAIN}/fullchain.pem" ]]; then
  cat <<EOF > /etc/nginx/sites-available/scaleflow-crm-acme.conf
server {
    listen 80;
    listen [::]:80;
    server_name ${TARGET_DOMAIN};
    location /.well-known/acme-challenge/ { root /var/www/html; }
    location / { return 404; }
}
EOF
  ln -sfn /etc/nginx/sites-available/scaleflow-crm-acme.conf /etc/nginx/sites-enabled/scaleflow-crm.conf
  rm -f /etc/nginx/sites-enabled/default
  nginx -t && systemctl reload nginx
  certbot certonly --webroot -w /var/www/html -d "${TARGET_DOMAIN}" --non-interactive --agree-tos -m "${CERTBOT_EMAIL}"
  rm -f /etc/nginx/sites-available/scaleflow-crm-acme.conf
fi

ln -sfn /etc/nginx/sites-available/scaleflow-crm.conf /etc/nginx/sites-enabled/scaleflow-crm.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
systemctl enable --now nginx
systemctl reload nginx

log_info "Nginx TLS and systemd configs installed cleanly for https://${TARGET_DOMAIN}."
