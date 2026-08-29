#!/usr/bin/env bash
# Installs or upgrades wardend on Ubuntu/Debian: system user, directories, binary, unit, env file.
# Usage: sudo deploy/install.sh path/to/wardend-linux-amd64
set -euo pipefail

BIN="${1:-}"
if [[ -z "$BIN" || ! -f "$BIN" ]]; then
  echo "usage: sudo $0 <wardend binary>" >&2
  exit 1
fi
if [[ $EUID -ne 0 ]]; then
  echo "run as root (sudo)" >&2
  exit 1
fi
HERE="$(cd "$(dirname "$0")" && pwd)"

# Dedicated user without a login shell; servers never run as root.
if ! id warden >/dev/null 2>&1; then
  useradd --system --home-dir /var/lib/warden --shell /usr/sbin/nologin warden
fi
install -d -o warden -g warden -m 0750 /var/lib/warden
install -d -o root -g root -m 0750 /etc/warden

install -o root -g root -m 0755 "$BIN" /usr/local/bin/wardend
install -o root -g root -m 0644 "$HERE/wardend.service" /etc/systemd/system/wardend.service
if [[ ! -f /etc/warden/wardend.env ]]; then
  install -o root -g root -m 0640 "$HERE/wardend.env.example" /etc/warden/wardend.env
  echo "Created /etc/warden/wardend.env — edit it before starting (panel issuer/key, TLS)."
fi

systemctl daemon-reload
systemctl enable wardend >/dev/null
if systemctl is-active --quiet wardend; then
  systemctl restart wardend
  echo "wardend restarted."
else
  echo "Next: edit /etc/warden/wardend.env, then: sudo systemctl start wardend && journalctl -u wardend -f"
fi
