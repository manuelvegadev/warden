#!/usr/bin/env bash
# Warden installer bootstrap — https://warden.manuelvega.dev/install.sh
#
#   curl -fsSL https://warden.manuelvega.dev/install.sh | sudo bash
#   curl -fsSL https://warden.manuelvega.dev/install.sh | sudo bash -s -- --yes     # re-run / upgrade, keep the configuration
#
# Downloads the latest wardend release for this CPU from GitHub, verifies its SHA-256 against the
# release's SHA256SUMS, then hands over to `wardend install` (interactive; every flag after `--` is
# passed through). Ubuntu with systemd; needs root. Source: landing/public/install.sh in the repo.
set -euo pipefail

REPO="manuelvegadev/warden"
BASE="https://github.com/${REPO}/releases/latest/download"

say() { printf '\033[1m%s\033[0m\n' "$*"; }
die() { printf 'install.sh: %s\n' "$*" >&2; exit 1; }

[ "$(uname -s)" = "Linux" ] || die "wardend runs on Linux (Ubuntu with systemd); got $(uname -s)."
case "$(uname -m)" in
  x86_64 | amd64) ARCH=amd64 ;;
  aarch64 | arm64) ARCH=arm64 ;;
  *) die "unsupported CPU architecture $(uname -m) (releases ship linux/amd64 and linux/arm64)." ;;
esac
command -v curl >/dev/null || die "curl is required."
[ "$(id -u)" -eq 0 ] || die "run as root: curl -fsSL https://warden.manuelvega.dev/install.sh | sudo bash"

TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
BIN="wardend-linux-${ARCH}"

say "Downloading ${BIN} (latest release)…"
curl -fsSL "${BASE}/${BIN}" -o "${TMP}/wardend"
curl -fsSL "${BASE}/SHA256SUMS" -o "${TMP}/SHA256SUMS"

say "Verifying checksum…"
EXPECTED="$(awk -v f="$BIN" '$2 == f { print $1 }' "${TMP}/SHA256SUMS")"
[ -n "$EXPECTED" ] || die "${BIN} not listed in SHA256SUMS."
ACTUAL="$(sha256sum "${TMP}/wardend" | awk '{ print $1 }')"
[ "$EXPECTED" = "$ACTUAL" ] || die "checksum mismatch for ${BIN} (expected ${EXPECTED}, got ${ACTUAL})."
chmod +x "${TMP}/wardend"
say "$("${TMP}/wardend" version 2>/dev/null || echo 'wardend (version unknown)') verified."

# `wardend install` asks questions; when this script is piped into bash, stdin is the pipe, so give
# the installer the terminal instead. It copies itself to /usr/local/bin/wardend.
if [ -t 0 ]; then
  exec "${TMP}/wardend" install "$@"
elif ( : < /dev/tty ) 2>/dev/null; then # readable only when a terminal is attached (not under plain ssh host 'cmd')
  exec "${TMP}/wardend" install "$@" < /dev/tty
else
  exec "${TMP}/wardend" install --yes "$@"
fi
