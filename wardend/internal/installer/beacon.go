package installer

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/huh"
	"github.com/manuelvega/warden/wardend/internal/tlsconf"
)

// Beacon (the panel) runs as a container next to the daemon when Docker is available on the box.
// The image is published by CI; `--beacon-image` overrides it (e.g. an image built locally).

const (
	beaconEnvPath      = "/etc/warden/beacon.env" // keeps BETTER_AUTH_SECRET stable across re-runs
	beaconContainer    = "warden-beacon"
	beaconVolume       = "warden-beacon-data"
	defaultBeaconImage = "ghcr.io/manuelvegadev/warden-beacon:latest"
	// Containers reach the host through this name; the self-signed certificate always includes it.
	hostGateway = "host.docker.internal"
)

// BeaconSettings is filled by the form when the operator opts in.
type BeaconSettings struct {
	Enabled bool
	URL     string // browser-facing panel URL, also BETTER_AUTH_URL and the daemon's issuer
	Secret  string // BETTER_AUTH_SECRET
	Image   string
}

func dockerAvailable() bool {
	return exec.Command("docker", "version", "--format", "{{.Server.Version}}").Run() == nil
}

func containerExists(name string) bool {
	return exec.Command("docker", "container", "inspect", name).Run() == nil
}

// askBeacon offers the panel when Docker is present. It runs before the daemon form so the
// panel URL can seed the issuer/origins.
func askBeacon(b *BeaconSettings, host string) error {
	if !dockerAvailable() {
		return nil
	}
	if err := huh.NewConfirm().Title("Install the Beacon panel with Docker too?").
		Description("Runs the panel as a container on this box (port 3000) pointed at this daemon. Choose No when Beacon lives elsewhere, e.g. Dokploy.").
		Affirmative("Yes").Negative("No").Value(&b.Enabled).Run(); err != nil {
		return err
	}
	if !b.Enabled {
		return nil
	}
	if b.URL == "" {
		b.URL = "http://" + host + ":3000"
	}
	return huh.NewForm(huh.NewGroup(
		huh.NewInput().Title("Panel URL").Description("How browsers will open Beacon. http:// on a LAN is fine; put it behind HTTPS to expose it.").
			Value(&b.URL).Validate(func(v string) error {
			_, err := httpURL(v)
			return err
		}),
	).Title("Beacon")).Run()
}

// panelPort is the published port: the URL's port, else 80/443 by scheme.
func panelPort(rawURL string) int {
	u, err := httpURL(rawURL)
	if err != nil {
		return 3000
	}
	if p, err := strconv.Atoi(u.Port()); err == nil {
		return p
	}
	if u.Scheme == "https" {
		return 443
	}
	return 80
}

// installBeacon writes /etc/warden/beacon.env, (re)creates the container and waits for its health.
func installBeacon(ui *UI, run runner, s Settings, b BeaconSettings) error {
	port := panelPort(b.URL)
	env := []string{
		"# Written by `wardend install`. Edit, then: docker restart " + beaconContainer,
		"# BEACON_IMAGE is remembered for the next `wardend install`; BETTER_AUTH_SECRET encrypts the JWKS keys in the volume.",
		"BEACON_IMAGE=" + b.Image,
		"BETTER_AUTH_SECRET=" + b.Secret,
		"BETTER_AUTH_URL=" + strings.TrimRight(b.URL, "/"),
		"DATABASE_PATH=/data/beacon.db",
		"BEACON_OPEN_SIGNUP=false",
		fmt.Sprintf("WARDEND_URL=%s://%s:%d", s.scheme(), hostGateway, s.Port),
		"WARDEND_PANEL_KEY=" + s.PanelKey,
		fmt.Sprintf("WARDEND_PUBLIC_WS_URL=%s://%s:%d", strings.Replace(s.scheme(), "http", "ws", 1), s.publicHost(hostname()), s.Port),
	}
	args := []string{"run", "-d", "--name", beaconContainer, "--restart", "unless-stopped",
		"--add-host", hostGateway + ":host-gateway",
		"-p", strconv.Itoa(port) + ":3000",
		"-v", beaconVolume + ":/data",
		"--env-file", beaconEnvPath,
	}
	if s.TLSMode == tlsconf.ModeSelfSigned {
		env = append(env, "NODE_EXTRA_CA_CERTS=/certs/wardend.crt")
		args = append(args, "-v", filepath.Join(s.DataDir, "tls", "wardend.crt")+":/certs/wardend.crt:ro")
	}
	args = append(args, b.Image)

	err := ui.Steps([]Step{
		{"Write " + beaconEnvPath, func() error { return writeEnvFile(beaconEnvPath, env) }},
		{"Image " + b.Image, func() error {
			if exec.Command("docker", "image", "inspect", b.Image).Run() == nil {
				return nil // already present (e.g. built locally)
			}
			return run.cmd("docker", "pull", b.Image)
		}},
		{"Create container " + beaconContainer, func() error {
			_ = run.cmd("docker", "rm", "-f", beaconContainer) // replace a previous install
			return run.cmd("docker", args...)
		}},
	})
	if err != nil {
		return err
	}
	return ui.Progress("Waiting for Beacon to answer", 90*time.Second, func() (bool, string) {
		return probe(fmt.Sprintf("http://127.0.0.1:%d/api/auth/ok", port))
	})
}
