package instance

import (
	"archive/zip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strconv"
	"strings"

	"github.com/manuelvega/warden/wardend/internal/backup"
	"github.com/manuelvega/warden/wardend/internal/catalog"
	"github.com/manuelvega/warden/wardend/internal/mc"
	"github.com/manuelvega/warden/wardend/internal/tasks"
)

// Limits for uploaded server archives: a modded server with a big world is a few GB.
const (
	MaxImportBytes         = 16 << 30 // upload
	MaxImportUnpackedBytes = 64 << 30 // after decompression
	MaxImportEntries       = 2_000_000
)

// ErrNoServerJar is returned when the archive has no recognisable server jar and no software /
// version was given to download one.
var ErrNoServerJar = errors.New("no server jar found in the archive; pick the software and Minecraft version to download one")

// ImportOptions are the one-off inputs for the import task.
type ImportOptions struct {
	Archive    string // uploaded file, removed when the task ends
	Format     backup.Format
	AcceptEULA bool
	// What the user said the server is. With no jar in the archive this build is downloaded;
	// with a jar the daemon cannot identify it labels the jar; a recognised jar wins over it.
	Software  string
	MCVersion string
	Build     int
}

// Detected is what an existing server directory reveals about itself.
type Detected struct {
	Jar       string // file name in the server dir, "" when none
	Software  string
	MCVersion string
	Build     int
}

// Standard Fabric installer layout: this launcher next to the vanilla server.jar it wraps.
const fabricLaunchJar = "fabric-server-launch.jar"

var (
	paperJarRe   = regexp.MustCompile(`^paper-(.+)-(\d+)\.jar$`)
	purpurJarRe  = regexp.MustCompile(`^purpur-(.+)-(\d+)\.jar$`)
	fabricJarRe  = regexp.MustCompile(`^fabric-server-mc\.(.+)-loader\.(.+)-launcher\..+\.jar$`)
	vanillaJarRe = regexp.MustCompile(`^minecraft_server\.?(.*)\.jar$`)
	// .paper/version_history.json: {"currentVersion":"26.2-112-c9e894d (MC: 26.2)"}
	paperHistoryRe = regexp.MustCompile(`^(.+?)-(\d+)-[0-9a-f]+ \(MC: (.+)\)$`)
)

// DetectServer inspects a server directory: the jar at its root and, from the jar's name (or the
// Paper version history, or the jar's own version.json), the software, Minecraft version and build.
func DetectServer(dir string) Detected {
	var d Detected
	entries, err := os.ReadDir(dir)
	if err != nil {
		return d
	}
	var jars []string
	for _, e := range entries {
		if !e.IsDir() && strings.HasSuffix(strings.ToLower(e.Name()), ".jar") {
			jars = append(jars, e.Name())
		}
	}
	// Named jars first, so a stray library jar next to paper-*.jar does not win.
	for _, j := range jars {
		if m := paperJarRe.FindStringSubmatch(j); m != nil {
			d.Jar, d.Software, d.MCVersion, d.Build = j, "paper", m[1], atoi(m[2])
			return d
		}
		if m := purpurJarRe.FindStringSubmatch(j); m != nil {
			d.Jar, d.Software, d.MCVersion, d.Build = j, "purpur", m[1], atoi(m[2])
			return d
		}
		if m := fabricJarRe.FindStringSubmatch(j); m != nil {
			d.Jar, d.Software, d.MCVersion, d.Build = j, "fabric", m[1], catalog.LoaderBuildID(m[2])
			return d
		}
		if m := vanillaJarRe.FindStringSubmatch(j); m != nil {
			d.Jar, d.Software, d.MCVersion = j, "vanilla", m[1]
		}
	}
	// Fabric installer layout: the launcher plus the vanilla jar it wraps (which knows the version).
	if slices.Contains(jars, fabricLaunchJar) {
		d.Jar, d.Software = fabricLaunchJar, "fabric"
		for _, j := range jars {
			if j == fabricLaunchJar {
				continue
			}
			if v := jarVersion(filepath.Join(dir, j)); v != "" {
				d.MCVersion = v
				break
			}
		}
		return d
	}
	// A renamed jar (server.jar): the first one that carries a Mojang version.json.
	if d.Jar == "" {
		for _, j := range jars {
			if v := jarVersion(filepath.Join(dir, j)); v != "" {
				d.Jar, d.MCVersion = j, v
				break
			}
		}
	}
	if d.Jar == "" && len(jars) == 1 {
		d.Jar = jars[0]
	}
	if d.Jar == "" {
		return d
	}
	// A renamed jar could be Paper: it records what it last ran. Trusted only when that matches
	// the jar's own version, so a stale history from an earlier install cannot relabel it.
	if h := paperHistory(dir); h.Software != "" && (d.MCVersion == "" || d.MCVersion == h.MCVersion) {
		d.Software, d.Build = h.Software, h.Build
		if d.MCVersion == "" {
			d.MCVersion = h.MCVersion
		}
	}
	if d.Software == "" && d.MCVersion != "" {
		d.Software = "vanilla"
	}
	return d
}

// paperHistory reads .paper/version_history.json ("26.2-112-c9e894d (MC: 26.2)").
func paperHistory(dir string) Detected {
	b, err := os.ReadFile(filepath.Join(dir, ".paper", "version_history.json"))
	if err != nil {
		return Detected{}
	}
	var h struct {
		Current string `json:"currentVersion"`
	}
	if json.Unmarshal(b, &h) != nil {
		return Detected{}
	}
	m := paperHistoryRe.FindStringSubmatch(h.Current)
	if m == nil {
		return Detected{}
	}
	return Detected{Software: "paper", MCVersion: m[3], Build: atoi(m[2])}
}

// jarVersion reads the `id` of the version.json Mojang ships inside every server jar ("" if absent).
func jarVersion(jar string) string {
	if jar == "" {
		return ""
	}
	zr, err := zip.OpenReader(jar)
	if err != nil {
		return ""
	}
	defer zr.Close()
	for _, f := range zr.File {
		if f.Name != "version.json" {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			return ""
		}
		defer rc.Close()
		var v struct {
			ID string `json:"id"`
		}
		if json.NewDecoder(rc).Decode(&v) == nil {
			return v.ID
		}
		return ""
	}
	return ""
}

func atoi(s string) int { n, _ := strconv.Atoi(s); return n }

// Import unpacks an uploaded server directory into server/, works out what it is, downloads a jar
// if it has none, and finishes exactly like Install (Java, eula, network properties). Meant to run
// inside a tasks.Manager task; the instance stays "installing" if it fails.
func (i *Instance) Import(ctx context.Context, reg *catalog.Registry, opts ImportOptions, report tasks.Reporter) error {
	defer os.Remove(opts.Archive)
	m := i.Manifest
	i.setState(StateInstalling)

	report(2, "Extracting archive")
	// Unpack next to server/ (same filesystem), unwrap a single root folder, then move the files
	// in: server/ already holds the empty dirs Create made, so an in-place unpack could not tell a
	// wrapper folder from a real one.
	stage := filepath.Join(i.Dir, "import-stage")
	os.RemoveAll(stage)
	if err := os.MkdirAll(stage, 0o750); err != nil {
		return err
	}
	defer os.RemoveAll(stage)
	limits := backup.UnpackLimits{MaxBytes: MaxImportUnpackedBytes, MaxEntries: MaxImportEntries}
	stats, err := backup.Unpack(ctx, opts.Archive, opts.Format, stage, limits, func(pct int) {
		report(2+pct*68/100, fmt.Sprintf("Extracting archive (%d%%)", pct))
	})
	if err != nil {
		return fmt.Errorf("extract: %w", err)
	}
	if _, err := backup.FlattenRoot(stage); err != nil {
		return err
	}
	if err := moveInto(stage, i.ServerDir()); err != nil {
		return err
	}
	report(70, fmt.Sprintf("Extracted %d files (%d MB)", stats.Files, stats.Bytes>>20))

	d := DetectServer(i.ServerDir())
	switch {
	case d.Jar != "" && d.Software != "" && d.MCVersion != "":
		m.Jar, m.Software, m.MCVersion, m.Build = d.Jar, d.Software, d.MCVersion, d.Build
		report(72, fmt.Sprintf("Found %s (%s %s)", d.Jar, m.Software, m.MCVersion))
	case d.Jar != "":
		// A jar the daemon cannot place: the user's answer labels it (a version is a must for Java).
		if opts.MCVersion == "" && d.MCVersion == "" {
			return fmt.Errorf("could not tell the Minecraft version of %s; pick the software and version", d.Jar)
		}
		m.Jar, m.Software, m.MCVersion, m.Build = d.Jar, opts.Software, opts.MCVersion, opts.Build
		if m.Software == "" {
			m.Software = "vanilla"
		}
		if m.MCVersion == "" {
			m.MCVersion = d.MCVersion
		}
		report(72, fmt.Sprintf("Found %s, using it as %s %s", d.Jar, m.Software, m.MCVersion))
	default:
		if opts.Software == "" || opts.MCVersion == "" {
			return ErrNoServerJar
		}
		m.Software, m.MCVersion, m.Build = opts.Software, opts.MCVersion, opts.Build
		prov, err := reg.Provider(m.Software)
		if err != nil {
			return err
		}
		build, err := resolveBuild(ctx, prov, m.Software, m.MCVersion, m.Build)
		if err != nil {
			return err
		}
		m.Build = build.ID
		if err := downloadBuild(ctx, reg, build, filepath.Join(i.ServerDir(), build.Name), report, 72, 88); err != nil {
			return err
		}
		m.Jar = build.Name
	}
	// Keep an EULA the server already agreed to; otherwise record the answer given now.
	eula, _ := mc.ReadProperties(filepath.Join(i.ServerDir(), "eula.txt"))
	if err := i.finishInstall(ctx, opts.AcceptEULA || eula["eula"] == "true", nil, report, 88); err != nil {
		return err
	}
	report(100, fmt.Sprintf("Imported %s %s", m.Software, m.MCVersion))
	return nil
}

// moveInto moves every entry of src into dst, replacing what is there.
func moveInto(src, dst string) error {
	entries, err := os.ReadDir(src)
	if err != nil {
		return err
	}
	for _, e := range entries {
		target := filepath.Join(dst, e.Name())
		if err := os.RemoveAll(target); err != nil {
			return err
		}
		if err := os.Rename(filepath.Join(src, e.Name()), target); err != nil {
			return err
		}
	}
	return nil
}
