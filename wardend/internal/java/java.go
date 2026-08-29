// Package java manages Java runtimes for instances without touching the OS: Eclipse Temurin (OpenJDK)
// builds from the Adoptium API are downloaded into <data>/java/<id>/ and used by their absolute path.
// See ADR-010.
package java

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"runtime"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/manuelvega/warden/wardend/internal/catalog"
	"github.com/manuelvega/warden/wardend/internal/tasks"
)

// Runtime is an installed Java runtime usable by instances.
type Runtime struct {
	ID        string    `json:"id"`      // "temurin-25" or "system"
	Vendor    string    `json:"vendor"`  // "temurin" | "system"
	Major     int       `json:"major"`   // 25
	Version   string    `json:"version"` // "25.0.4+1"
	Path      string    `json:"path"`    // absolute path to the java binary
	Managed   bool      `json:"managed"` // true when installed under <data>/java
	Dir       string    `json:"dir,omitempty"`
	Size      int64     `json:"size,omitempty"`
	Installed time.Time `json:"installedAt,omitempty"`
}

// Release is a major version offered by Adoptium.
type Release struct {
	Major int  `json:"major"`
	LTS   bool `json:"lts"`
}

var ErrNotFound = errors.New("java runtime not found")
var ErrUnsupportedPlatform = errors.New("no Temurin build for this platform")

type Manager struct {
	dir   string
	reg   *catalog.Registry
	ua    string
	http  *http.Client
	mu    sync.Mutex // serializes installs
	sysMu sync.Mutex
	sys   *Runtime
	sysAt time.Time
}

func NewManager(dataDir string, reg *catalog.Registry, userAgent string) *Manager {
	return &Manager{dir: filepath.Join(dataDir, "java"), reg: reg, ua: userAgent, http: &http.Client{Timeout: 30 * time.Second}}
}

// RequiredMajor returns the minimum Java major for a Minecraft version (https://docs.papermc.io/paper/getting-started/).
func RequiredMajor(mc string) int {
	parts := strings.Split(strings.SplitN(mc, "-", 2)[0], ".")
	n := func(i int) int {
		if i < len(parts) {
			v, _ := strconv.Atoi(parts[i])
			return v
		}
		return 0
	}
	a, b, c := n(0), n(1), n(2)
	switch {
	case a >= 26: // 26.1+ requires Java 25
		return 25
	case a == 1 && (b > 20 || (b == 20 && c >= 5)): // 1.20.5+
		return 21
	case a == 1 && b >= 17: // 1.17–1.20.4
		return 17
	default:
		return 8
	}
}

// List returns managed runtimes plus the system `java` (if any), newest major first.
func (m *Manager) List() ([]Runtime, error) {
	var out []Runtime
	entries, err := os.ReadDir(m.dir)
	if err != nil && !os.IsNotExist(err) {
		return nil, err
	}
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		b, err := os.ReadFile(filepath.Join(m.dir, e.Name(), "runtime.json"))
		if err != nil {
			continue
		}
		var r Runtime
		if json.Unmarshal(b, &r) == nil && r.Path != "" {
			if _, err := os.Stat(r.Path); err == nil {
				out = append(out, r)
			}
		}
	}
	if sys := m.System(); sys != nil {
		out = append(out, *sys)
	}
	sort.Slice(out, func(i, j int) bool {
		if out[i].Major != out[j].Major {
			return out[i].Major > out[j].Major
		}
		return out[i].Managed && !out[j].Managed
	})
	return out, nil
}

// Get resolves a runtime id.
func (m *Manager) Get(id string) (*Runtime, error) {
	list, err := m.List()
	if err != nil {
		return nil, err
	}
	for _, r := range list {
		if r.ID == id {
			return &r, nil
		}
	}
	return nil, ErrNotFound
}

// Best returns the newest installed runtime satisfying the minimum major, or nil.
func (m *Manager) Best(minMajor int) *Runtime {
	list, _ := m.List()
	for _, r := range list { // sorted newest first, managed before system
		if r.Major >= minMajor {
			return &r
		}
	}
	return nil
}

var versionRe = regexp.MustCompile(`version "([^"]+)"`)

// System detects `java` on PATH (cached 1 minute).
func (m *Manager) System() *Runtime {
	m.sysMu.Lock()
	defer m.sysMu.Unlock()
	if time.Since(m.sysAt) < time.Minute {
		return m.sys
	}
	m.sysAt = time.Now()
	m.sys = nil
	path, err := exec.LookPath("java")
	if err != nil {
		return nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	out, err := exec.CommandContext(ctx, path, "-version").CombinedOutput()
	if err != nil {
		return nil
	}
	mm := versionRe.FindSubmatch(out)
	if mm == nil {
		return nil
	}
	ver := string(mm[1])
	major := majorOf(ver)
	m.sys = &Runtime{ID: "system", Vendor: "system", Major: major, Version: ver, Path: path}
	return m.sys
}

func majorOf(ver string) int {
	parts := strings.Split(ver, ".")
	a, _ := strconv.Atoi(parts[0])
	if a == 1 && len(parts) > 1 { // "1.8.0_392"
		b, _ := strconv.Atoi(strings.SplitN(parts[1], "_", 2)[0])
		return b
	}
	return a
}

// Available lists majors from Adoptium.
func (m *Manager) Available(ctx context.Context) ([]Release, error) {
	var info struct {
		LTS []int `json:"available_lts_releases"`
		All []int `json:"available_releases"`
	}
	if err := m.getJSON(ctx, "https://api.adoptium.net/v3/info/available_releases", &info); err != nil {
		return nil, err
	}
	lts := map[int]bool{}
	for _, v := range info.LTS {
		lts[v] = true
	}
	out := make([]Release, 0, len(info.All))
	for _, v := range info.All {
		if v >= 8 {
			out = append(out, Release{Major: v, LTS: lts[v]})
		}
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Major > out[j].Major })
	return out, nil
}

type asset struct {
	ReleaseName string `json:"release_name"`
	Version     struct {
		Semver string `json:"semver"`
	} `json:"version"`
	Binary struct {
		Package struct {
			Name     string `json:"name"`
			Link     string `json:"link"`
			Checksum string `json:"checksum"`
			Size     int64  `json:"size"`
		} `json:"package"`
	} `json:"binary"`
}

func platform() (osName, arch string, err error) {
	switch runtime.GOOS {
	case "linux":
		osName = "linux"
	case "darwin":
		osName = "mac"
	default:
		return "", "", ErrUnsupportedPlatform
	}
	switch runtime.GOARCH {
	case "amd64":
		arch = "x64"
	case "arm64":
		arch = "aarch64"
	default:
		return "", "", ErrUnsupportedPlatform
	}
	return
}

// Install downloads and extracts Temurin JRE <major>. Safe to call inside a tasks.Manager task.
func (m *Manager) Install(ctx context.Context, major int, report tasks.Reporter) (*Runtime, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if r, err := m.Get(fmt.Sprintf("temurin-%d", major)); err == nil {
		report(100, "Temurin "+strconv.Itoa(major)+" already installed")
		return r, nil
	}
	osName, arch, err := platform()
	if err != nil {
		return nil, err
	}
	report(1, fmt.Sprintf("Resolving Temurin %d for %s/%s", major, osName, arch))
	var assets []asset
	url := fmt.Sprintf("https://api.adoptium.net/v3/assets/latest/%d/hotspot?os=%s&architecture=%s&image_type=jre&vendor=eclipse", major, osName, arch)
	if err := m.getJSON(ctx, url, &assets); err != nil {
		return nil, err
	}
	if len(assets) == 0 {
		return nil, fmt.Errorf("%w: Temurin %d %s/%s", ErrUnsupportedPlatform, major, osName, arch)
	}
	a := assets[0]
	pkg := a.Binary.Package

	id := fmt.Sprintf("temurin-%d", major)
	dest := filepath.Join(m.dir, id)
	tmpDir := dest + ".tmp"
	_ = os.RemoveAll(tmpDir)
	if err := os.MkdirAll(tmpDir, 0o750); err != nil {
		return nil, err
	}
	defer os.RemoveAll(tmpDir)

	archive := filepath.Join(tmpDir, pkg.Name)
	report(3, "Downloading "+pkg.Name)
	err = m.reg.Download(ctx, pkg.Link, catalog.Checksum{Algo: "sha256", Value: pkg.Checksum}, archive, func(done, total int64) {
		if total > 0 {
			report(3+int(done*77/total), fmt.Sprintf("Downloading %s (%d/%d MB)", pkg.Name, done>>20, total>>20))
		}
	})
	if err != nil {
		return nil, err
	}
	report(82, "Extracting")
	if err := extractTarGz(archive, tmpDir); err != nil {
		return nil, err
	}
	_ = os.Remove(archive)

	bin, err := findJava(tmpDir)
	if err != nil {
		return nil, err
	}
	_ = os.RemoveAll(dest)
	if err := os.Rename(tmpDir, dest); err != nil {
		return nil, err
	}
	bin = filepath.Join(dest, strings.TrimPrefix(bin, tmpDir))
	r := Runtime{ID: id, Vendor: "temurin", Major: major, Version: a.Version.Semver, Path: bin, Managed: true, Dir: dest, Size: dirSize(dest), Installed: time.Now().UTC()}
	b, _ := json.MarshalIndent(r, "", "  ")
	if err := os.WriteFile(filepath.Join(dest, "runtime.json"), b, 0o640); err != nil {
		return nil, err
	}
	report(100, "Installed Temurin "+a.Version.Semver)
	return &r, nil
}

// Remove deletes a managed runtime.
func (m *Manager) Remove(id string) error {
	r, err := m.Get(id)
	if err != nil {
		return err
	}
	if !r.Managed {
		return errors.New("the system runtime cannot be removed by wardend")
	}
	return os.RemoveAll(r.Dir)
}

func (m *Manager) getJSON(ctx context.Context, url string, v any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", m.ua)
	resp, err := m.http.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: %s", url, resp.Status)
	}
	return json.NewDecoder(resp.Body).Decode(v)
}

// extractTarGz unpacks into dir, rejecting entries that escape it.
func extractTarGz(archive, dir string) error {
	f, err := os.Open(archive)
	if err != nil {
		return err
	}
	defer f.Close()
	gz, err := gzip.NewReader(f)
	if err != nil {
		return err
	}
	defer gz.Close()
	tr := tar.NewReader(gz)
	root := filepath.Clean(dir) + string(os.PathSeparator)
	for {
		h, err := tr.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return err
		}
		target := filepath.Join(dir, h.Name)
		if !strings.HasPrefix(target+string(os.PathSeparator), root) && target != filepath.Clean(dir) {
			return fmt.Errorf("archive entry escapes target dir: %s", h.Name)
		}
		switch h.Typeflag {
		case tar.TypeDir:
			if err := os.MkdirAll(target, 0o755); err != nil {
				return err
			}
		case tar.TypeReg:
			if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
				return err
			}
			out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, fs.FileMode(h.Mode)&0o777)
			if err != nil {
				return err
			}
			if _, err := io.Copy(out, tr); err != nil {
				out.Close()
				return err
			}
			out.Close()
		case tar.TypeSymlink:
			if filepath.IsAbs(h.Linkname) || strings.Contains(h.Linkname, "..") {
				continue // never follow links outside the runtime
			}
			_ = os.MkdirAll(filepath.Dir(target), 0o755)
			_ = os.Remove(target)
			if err := os.Symlink(h.Linkname, target); err != nil {
				return err
			}
		}
	}
}

// findJava locates bin/java (Linux: <root>/bin/java; macOS: <root>/Contents/Home/bin/java).
func findJava(dir string) (string, error) {
	var found string
	err := filepath.WalkDir(dir, func(p string, d fs.DirEntry, err error) error {
		if err != nil || found != "" {
			return nil
		}
		if !d.IsDir() && d.Name() == "java" && filepath.Base(filepath.Dir(p)) == "bin" {
			found = p
			return filepath.SkipAll
		}
		return nil
	})
	if err != nil {
		return "", err
	}
	if found == "" {
		return "", errors.New("bin/java not found in archive")
	}
	return found, nil
}

func dirSize(dir string) int64 {
	var n int64
	_ = filepath.WalkDir(dir, func(_ string, d fs.DirEntry, err error) error {
		if err == nil && !d.IsDir() {
			if i, err := d.Info(); err == nil {
				n += i.Size()
			}
		}
		return nil
	})
	return n
}
