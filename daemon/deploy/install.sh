#!/usr/bin/env bash
# Instala mcd en Ubuntu: usuario, directorios, binario y unidad systemd. Ejecutar como root.
set -euo pipefail
BIN=${1:-./mcd}
id -u minecraft &>/dev/null || useradd --system --home /var/lib/mc-server-gui --shell /usr/sbin/nologin minecraft
install -d -o minecraft -g minecraft -m 750 /var/lib/mc-server-gui
install -m 755 "$BIN" /usr/local/bin/mcd
install -m 644 "$(dirname "$0")/mcd.service" /etc/systemd/system/mcd.service
systemctl daemon-reload
systemctl enable --now mcd
echo "mcd instalado. Edita /etc/systemd/system/mcd.service (MCD_ALLOWED_ORIGINS, MCD_CONTACT) y 'systemctl restart mcd'."
