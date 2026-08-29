#!/usr/bin/env bash
# Installs wardend on Ubuntu: user, directories, binary and systemd unit. Run as root.
set -euo pipefail
BIN=${1:-./wardend}
id -u warden &>/dev/null || useradd --system --home /var/lib/warden --shell /usr/sbin/nologin warden
install -d -o warden -g warden -m 750 /var/lib/warden
install -m 755 "$BIN" /usr/local/bin/wardend
install -m 644 "$(dirname "$0")/wardend.service" /etc/systemd/system/wardend.service
systemctl daemon-reload
systemctl enable --now wardend
echo "wardend installed. Edit /etc/systemd/system/wardend.service (WARDEND_ALLOWED_ORIGINS, WARDEND_CONTACT) and run 'systemctl restart wardend'."
