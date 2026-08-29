/** Every outbound link on the landing page, in one place. */
const REPO = "https://github.com/manuelvegadev/warden";

/** Shown in the hero badge; bump with each release. */
export const VERSION = "v0.2.0";

export const LINKS = {
  repo: REPO,
  docs: `${REPO}/tree/main/docs`,
  architecture: `${REPO}/blob/main/docs/architecture.md`,
  adrs: `${REPO}/tree/main/docs/adr`,
  api: `${REPO}/blob/main/docs/api.md`,
  changelog: `${REPO}/releases`,
} as const;

/** One-liner served by this site (public/install.sh): downloads, verifies and runs `wardend install`. */
export const INSTALL_SCRIPT = `curl -fsSL ${new URL("/install.sh", import.meta.env.SITE).href} | sudo bash`;

export const BEACON_ENV_EXAMPLE = `${REPO}/raw/main/deploy/beacon.env.example`;
export const BEACON_COMPOSE = `${REPO}/raw/main/deploy/beacon.compose.yaml`;

/** The two supported topologies shown in the Install section. */
export const INSTALL_OPTIONS = [
  {
    id: "same-box",
    label: "Beacon on the same box",
    summary:
      "The installer sets up wardend as a systemd service and, when Docker is present, offers to run the Beacon panel as a container next to it.",
    commands: ["# on the Ubuntu box that will run the servers", INSTALL_SCRIPT],
    note: 'Answer yes to "Run Beacon here?"; the panel is then at http://<box>:3000.',
  },
  {
    id: "separate",
    label: "Beacon elsewhere (Docker / Dokploy)",
    summary:
      "wardend on the game box, the panel wherever you host containers. Beacon only needs the daemon's public HTTPS URL and a shared panel key.",
    commands: [
      "# 1. on the game box (skip the Beacon step; use a public TLS certificate)",
      INSTALL_SCRIPT,
      "# 2. on the Docker host: compose file + env file (daemon URL, panel key)",
      "mkdir -p warden-beacon && cd warden-beacon",
      `curl -fsSLO ${BEACON_COMPOSE}`,
      `curl -fsSL ${BEACON_ENV_EXAMPLE} -o beacon.env && nano beacon.env`,
      "docker compose -f beacon.compose.yaml up -d",
    ],
    note: "beacon.env.example documents every variable. Then set WARDEND_PANEL_ISSUER to Beacon's URL in /etc/warden/wardend.env and restart wardend. Dokploy: same image and variables.",
  },
] as const;
