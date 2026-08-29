// Package installer implements `wardend install`: an interactive, self-contained setup of the
// daemon on a systemd host — user, directories, binary, environment file, unit, service, health —
// and, when Docker is present, the Beacon panel next to it.
package installer

import (
	"context"
	"crypto/rand"
	"crypto/tls"
	_ "embed"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"time"

	"github.com/charmbracelet/huh"
	"github.com/manuelvega/warden/wardend/internal/config"
	"github.com/manuelvega/warden/wardend/internal/tlsconf"
)

const (
	serviceUser = "warden"
	binPath     = "/usr/local/bin/wardend"
	envDir      = "/etc/warden"
	envPath     = "/etc/warden/wardend.env"
	unitPath    = "/etc/systemd/system/wardend.service"
	logDir      = "/var/log/warden"
)

//go:embed wardend.service
var unitTemplate string

// Settings is everything the installer asks for; it becomes /etc/warden/wardend.env.
type Settings struct {
	DataDir        string
	Port           int
	Contact        string
	PanelIssuer    string
	PanelKey       string
	AllowedOrigins string
	TLSMode        string
	TLSHosts       string
	TLSEmail       string
	TLSCert        string
	TLSKey         string
}

// envVars is the single table mapping WARDEND_* keys to Settings fields (read and write).
func (s *Settings) envVars() []struct {
	key string
	ptr *string
} {
	return []struct {
		key string
		ptr *string
	}{
		{"WARDEND_DATA_DIR", &s.DataDir}, {"WARDEND_CONTACT", &s.Contact},
		{"WARDEND_PANEL_ISSUER", &s.PanelIssuer}, {"WARDEND_PANEL_KEY", &s.PanelKey},
		{"WARDEND_ALLOWED_ORIGINS", &s.AllowedOrigins}, {"WARDEND_TLS", &s.TLSMode},
		{"WARDEND_TLS_HOSTS", &s.TLSHosts}, {"WARDEND_TLS_EMAIL", &s.TLSEmail},
		{"WARDEND_TLS_CERT", &s.TLSCert}, {"WARDEND_TLS_KEY", &s.TLSKey},
	}
}

func (s Settings) scheme() string {
	if s.TLSMode == tlsconf.ModeOff {
		return "http"
	}
	return "https"
}

// publicHost is the first configured TLS host, else the fallback (the machine's hostname).
func (s Settings) publicHost(fallback string) string {
	if hosts := config.SplitList(s.TLSHosts); len(hosts) > 0 {
		return hosts[0]
	}
	return fallback
}

func defaults() Settings {
	return Settings{DataDir: "/var/lib/warden", Port: 8443, TLSMode: tlsconf.ModeACME, PanelKey: hex.EncodeToString(randomBytes(32))}
}

func randomBytes(n int) []byte {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return b
}

// Run is the entry point of `wardend install`.
func Run(version string, args []string) error {
	fs := flag.NewFlagSet("wardend install", flag.ContinueOnError)
	yes := fs.Bool("yes", false, "reuse "+envPath+" without prompting (upgrades, scripts)")
	beaconImage := fs.String("beacon-image", "", "Beacon container image (default: the one used last time, else "+defaultBeaconImage+")")
	if err := fs.Parse(args); err != nil {
		return err
	}

	ui := NewUI(os.Stdout)
	ui.Title("Warden daemon installer " + version)
	ui.Dim("Sets up wardend as a systemd service running as the `" + serviceUser + "` user. Ctrl+C aborts at any time.")
	ui.Blank()

	if err := preflight(); err != nil {
		ui.Failure(err.Error())
		return err
	}
	logFile, err := openLog()
	if err != nil {
		return err
	}
	defer logFile.Close()
	ui.Dim("Detailed log: " + logFile.Name())
	ui.Blank()

	s := defaults()
	existing, hadConfig := readEnv(envPath)
	if hadConfig {
		s.fromEnv(existing)
	}
	b := BeaconSettings{Secret: base64.StdEncoding.EncodeToString(randomBytes(32)), Image: *beaconImage}
	if prev, ok := readEnv(beaconEnvPath); ok { // previous panel install: keep its secret, URL and image
		if prev["BETTER_AUTH_SECRET"] != "" {
			b.Secret = prev["BETTER_AUTH_SECRET"]
		}
		b.URL = prev["BETTER_AUTH_URL"]
		if b.Image == "" {
			b.Image = prev["BEACON_IMAGE"]
		}
	}
	if b.Image == "" {
		b.Image = defaultBeaconImage
	}
	switch {
	case *yes && !hadConfig:
		return errors.New("--yes needs an existing " + envPath)
	case *yes:
		if b.URL == "" {
			b.URL = s.PanelIssuer // the panel URL is the issuer the daemon already trusts
		}
		b.Enabled = dockerAvailable() && containerExists(beaconContainer) && b.URL != "" // keep an installed panel updated
	default:
		if !NewUI(os.Stdin).interactive {
			return errors.New("interactive setup needs a terminal; re-run with --yes to reuse " + envPath)
		}
		keep := false
		if hadConfig {
			if err := huh.NewConfirm().Title("Existing configuration found").
				Description(envPath + " will be reused; choose No to review every value.").
				Affirmative("Keep it").Negative("Review").Value(&keep).Run(); err != nil {
				return err
			}
		}
		// The panel question is asked even when the daemon config is kept: it is a separate choice.
		if err := askBeacon(&b, hostname()); err != nil {
			return err
		}
		if b.Enabled && s.PanelIssuer == "" {
			s.PanelIssuer = strings.TrimRight(b.URL, "/")
		}
		if !keep {
			if err := ask(&s); err != nil {
				return err
			}
		}
	}

	run := runner{log: logFile}
	err = ui.Steps([]Step{
		{"Create system user " + serviceUser, func() error { return ensureUser(run) }},
		{"Create directories", func() error { return ensureDirs(s.DataDir) }},
		{"Install binary to " + binPath, installBinary},
		{"Write " + envPath, func() error { return writeEnvFile(envPath, s.envLines(existing)) }},
		{"Write systemd unit", func() error {
			return os.WriteFile(unitPath, []byte(strings.ReplaceAll(unitTemplate, "{{DATA_DIR}}", s.DataDir)), 0o644)
		}},
		{"Reload systemd and enable the service", func() error {
			if err := run.cmd("systemctl", "daemon-reload"); err != nil {
				return err
			}
			return run.cmd("systemctl", "enable", "wardend")
		}},
		{"Start wardend", func() error { return run.cmd("systemctl", "restart", "wardend") }},
	})
	if err != nil {
		ui.Dim("See " + logFile.Name() + " and `journalctl -u wardend`.")
		return err
	}
	if err := ui.Progress("Waiting for the daemon to answer", 30*time.Second, func() (bool, string) {
		return probe(fmt.Sprintf("%s://127.0.0.1:%d/api/v1/health", s.scheme(), s.Port))
	}); err != nil {
		ui.Dim("journalctl -u wardend -n 50")
		return err
	}

	if b.Enabled {
		ui.Blank()
		if err := installBeacon(ui, run, s, b); err != nil {
			ui.Dim("See " + logFile.Name() + "; if the container was created: docker logs " + beaconContainer)
			return err
		}
	}

	ui.Blank()
	summary(ui, s, b)
	fmt.Fprintf(logFile, "install finished %s\n", time.Now().Format(time.RFC3339))
	return nil
}

func preflight() error {
	if runtime.GOOS != "linux" {
		return errors.New("wardend install only supports Linux with systemd")
	}
	if os.Geteuid() != 0 {
		return errors.New("run as root: sudo ./wardend install")
	}
	if _, err := exec.LookPath("systemctl"); err != nil {
		return errors.New("systemctl not found: this installer targets systemd hosts")
	}
	return nil
}

func openLog() (*os.File, error) {
	if err := os.MkdirAll(logDir, 0o755); err != nil {
		return nil, err
	}
	return os.OpenFile(filepath.Join(logDir, "install.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o640)
}

func nonEmpty(name string) func(string) error {
	return func(v string) error {
		if strings.TrimSpace(v) == "" {
			return errors.New(name + " is required")
		}
		return nil
	}
}

// httpURL validates a full http(s) URL and returns its parts.
func httpURL(v string) (*url.URL, error) {
	u, err := url.Parse(strings.TrimSpace(v))
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, errors.New("must be a full URL, e.g. https://beacon.example.com")
	}
	return u, nil
}

func fileExists(p string) error {
	if _, err := os.Stat(p); err != nil {
		return errors.New("file not found")
	}
	return nil
}

// ask runs the interactive form, editing s in place.
func ask(s *Settings) error {
	port := strconv.Itoa(s.Port)
	form := huh.NewForm(
		huh.NewGroup(
			huh.NewInput().Title("Data directory").Description("Servers, backups, Java runtimes and the database.").
				Value(&s.DataDir).Validate(nonEmpty("data directory")),
			huh.NewInput().Title("Port").Description("443 with Let's Encrypt; any free port otherwise.").
				Value(&port).Validate(func(v string) error {
				n, err := strconv.Atoi(v)
				if err != nil || n < 1 || n > 65535 {
					return errors.New("port must be 1-65535")
				}
				return nil
			}),
			huh.NewInput().Title("Contact email").Description("Sent in the User-Agent to PaperMC, Hangar, Modrinth and Mojang.").
				Value(&s.Contact).Validate(nonEmpty("contact")),
		).Title("Daemon"),
		huh.NewGroup(
			huh.NewInput().Title("Beacon URL").Description("Public URL of the panel; JWTs are verified against its JWKS.").
				Placeholder("https://beacon.example.com").Value(&s.PanelIssuer).Validate(func(v string) error {
				_, err := httpURL(v)
				return err
			}),
			huh.NewInput().Title("Panel key").Description("Shared secret; paste the same value into Beacon's WARDEND_PANEL_KEY. A random one is proposed.").
				Value(&s.PanelKey).Validate(nonEmpty("panel key")),
		).Title("Panel"),
		huh.NewGroup(
			huh.NewSelect[string]().Title("TLS").Description("The browser opens the console WebSocket directly against the daemon, so it needs HTTPS.").
				Options(
					huh.NewOption("Let's Encrypt (public DNS name, ports 443+80)", tlsconf.ModeACME),
					huh.NewOption("Self-signed (LAN / testing; browsers must trust it)", tlsconf.ModeSelfSigned),
					huh.NewOption("Certificate files I provide", tlsconf.ModeFiles),
					huh.NewOption("Off (reverse proxy on this box terminates TLS)", tlsconf.ModeOff),
				).Value(&s.TLSMode),
		).Title("Transport"),
	)
	if err := form.Run(); err != nil {
		return err
	}
	s.Port, _ = strconv.Atoi(port)
	if s.AllowedOrigins == "" {
		s.AllowedOrigins = strings.TrimRight(s.PanelIssuer, "/")
	}
	var fields []huh.Field
	switch s.TLSMode {
	case tlsconf.ModeACME:
		if s.Port == 8443 {
			s.Port = 443
		}
		fields = append(fields,
			huh.NewInput().Title("Domain(s)").Description("Comma-separated DNS names pointing at this box.").Placeholder("mc.example.com").
				Value(&s.TLSHosts).Validate(nonEmpty("domain")),
			huh.NewInput().Title("ACME account email").Value(&s.TLSEmail).Validate(nonEmpty("email")))
	case tlsconf.ModeSelfSigned:
		fields = append(fields,
			huh.NewInput().Title("Extra names/IPs for the certificate").Description("Comma-separated; how browsers reach this box (LAN name, IP). localhost is always included.").
				Placeholder("server.local,192.168.1.10").Value(&s.TLSHosts))
	case tlsconf.ModeFiles:
		fields = append(fields,
			huh.NewInput().Title("Certificate file (PEM)").Value(&s.TLSCert).Validate(fileExists),
			huh.NewInput().Title("Private key file (PEM)").Value(&s.TLSKey).Validate(fileExists))
	}
	if len(fields) > 0 {
		return huh.NewForm(huh.NewGroup(fields...).Title("TLS details")).Run()
	}
	return nil
}

// runner executes commands, keeping their output in the log instead of the terminal.
type runner struct{ log io.Writer }

func (r runner) cmd(name string, args ...string) error {
	fmt.Fprintf(r.log, "$ %s %s\n", name, strings.Join(args, " "))
	c := exec.Command(name, args...)
	c.Stdout, c.Stderr = r.log, r.log
	if err := c.Run(); err != nil {
		return fmt.Errorf("%s %s: %w", name, strings.Join(args, " "), err)
	}
	return nil
}

func ensureUser(r runner) error {
	if _, err := user.Lookup(serviceUser); err == nil {
		return nil
	}
	return r.cmd("useradd", "--system", "--home-dir", "/var/lib/warden", "--shell", "/usr/sbin/nologin", serviceUser)
}

func ensureDirs(dataDir string) error {
	u, err := user.Lookup(serviceUser)
	if err != nil {
		return err
	}
	uid, _ := strconv.Atoi(u.Uid)
	gid, _ := strconv.Atoi(u.Gid)
	if err := os.MkdirAll(dataDir, 0o750); err != nil {
		return err
	}
	if err := os.Chown(dataDir, uid, gid); err != nil {
		return err
	}
	return os.MkdirAll(envDir, 0o750)
}

// installBinary copies the running executable into place (skips when already running from there).
func installBinary() error {
	self, err := os.Executable()
	if err != nil {
		return err
	}
	if self, err = filepath.EvalSymlinks(self); err != nil {
		return err
	}
	if self == binPath {
		return nil
	}
	src, err := os.Open(self)
	if err != nil {
		return err
	}
	defer src.Close()
	tmp := binPath + ".new"
	dst, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		return err
	}
	if err := dst.Close(); err != nil {
		return err
	}
	return os.Rename(tmp, binPath) // atomic; a running service keeps its old inode until restart
}

// envLines renders the daemon environment. Keys the installer does not manage (hand-added
// overrides such as WARDEND_PANEL_JWKS_URL or WARDEND_LOG_LEVEL) are carried over from existing.
func (s Settings) envLines(existing map[string]string) []string {
	managed := map[string]string{
		"WARDEND_LISTEN":        ":" + strconv.Itoa(s.Port),
		"WARDEND_TLS_HTTP_ADDR": "",
	}
	if s.TLSMode == tlsconf.ModeACME {
		managed["WARDEND_TLS_HTTP_ADDR"] = ":80"
	}
	copyS := s
	for _, v := range copyS.envVars() {
		managed[v.key] = *v.ptr
	}
	lines := []string{"# Written by `wardend install` on " + time.Now().Format(time.RFC3339) + ". Edit and `systemctl restart wardend`."}
	order := []string{"WARDEND_LISTEN", "WARDEND_DATA_DIR", "WARDEND_CONTACT", "WARDEND_PANEL_ISSUER", "WARDEND_PANEL_KEY", "WARDEND_ALLOWED_ORIGINS",
		"WARDEND_TLS", "WARDEND_TLS_HOSTS", "WARDEND_TLS_EMAIL", "WARDEND_TLS_CERT", "WARDEND_TLS_KEY", "WARDEND_TLS_HTTP_ADDR"}
	for _, k := range order {
		lines = append(lines, k+"="+managed[k])
	}
	for k, v := range existing {
		if _, own := managed[k]; !own {
			lines = append(lines, k+"="+v)
		}
	}
	return lines
}

// fromEnv loads the operator's values from a previous run.
func (s *Settings) fromEnv(e map[string]string) {
	if p, err := strconv.Atoi(strings.TrimPrefix(e["WARDEND_LISTEN"], ":")); err == nil {
		s.Port = p
	}
	for _, v := range s.envVars() {
		if val, ok := e[v.key]; ok && val != "" {
			*v.ptr = val
		}
	}
}

// writeEnvFile writes KEY=value lines readable by root only.
func writeEnvFile(path string, lines []string) error {
	return os.WriteFile(path, []byte(strings.Join(lines, "\n")+"\n"), 0o640)
}

// readEnv parses KEY=value lines (no shell semantics).
func readEnv(path string) (map[string]string, bool) {
	b, err := os.ReadFile(path)
	if err != nil {
		return nil, false
	}
	out := map[string]string{}
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		if k, v, ok := strings.Cut(line, "="); ok {
			out[strings.TrimSpace(k)] = strings.TrimSpace(v)
		}
	}
	return out, true
}

// probeClient is shared by every health poll (self-signed daemon: verification off on loopback).
var probeClient = &http.Client{Timeout: 2 * time.Second, Transport: &http.Transport{TLSClientConfig: &tls.Config{InsecureSkipVerify: true}}} //nolint:gosec // local health probe

func probe(u string) (bool, string) {
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodGet, u, nil)
	resp, err := probeClient.Do(req)
	if err != nil {
		return false, "starting…"
	}
	resp.Body.Close()
	return resp.StatusCode == http.StatusOK, resp.Status
}

func summary(ui *UI, s Settings, b BeaconSettings) {
	daemonURL := fmt.Sprintf("%s://%s:%d", s.scheme(), s.publicHost(hostname()), s.Port)
	lines := []string{
		styleTitle.Render("wardend is running"),
		"",
		KV("Health", daemonURL+"/api/v1/health"),
		KV("Data", s.DataDir),
		KV("Config", envPath),
		KV("Logs", "journalctl -u wardend -f"),
	}
	if b.Enabled {
		lines = append(lines, "",
			styleTitle.Render("Beacon is running"),
			KV("Open", b.URL),
			KV("Config", beaconEnvPath),
			KV("Container", beaconContainer+" (docker logs "+beaconContainer+")"),
			"",
			styleDim.Render("First visit: create the administrator account."))
	} else {
		lines = append(lines, "",
			styleTitle.Render("Beacon environment (docs/deploy.md)"),
			KV("WARDEND_URL", daemonURL),
			KV("WARDEND_PANEL_KEY", s.PanelKey),
			KV("WARDEND_PUBLIC_WS_URL", strings.Replace(daemonURL, "http", "ws", 1)),
			KV("BETTER_AUTH_URL", s.PanelIssuer))
	}
	if s.TLSMode == tlsconf.ModeSelfSigned {
		lines = append(lines, "", styleDim.Render("Self-signed: open "+daemonURL+"/api/v1/health once in each browser and accept the certificate."))
	}
	ui.Box(lines)
}

func hostname() string {
	h, err := os.Hostname()
	if err != nil || h == "" {
		return "localhost"
	}
	return h
}
