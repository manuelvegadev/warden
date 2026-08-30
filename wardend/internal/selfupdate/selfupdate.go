// Package selfupdate upgrades the daemon binary from GitHub Releases in two halves that match the
// systemd hardening (the service cannot write /usr/local/bin): the daemon, as the service user,
// downloads and verifies the new binary into <data>/update; a root oneshot unit triggered by a
// path unit re-verifies it against the release's SHA256SUMS, installs it and restarts the service.
// See docs/adr/016-daemon-self-update.md.
package selfupdate

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"
)

const (
	Repo = "manuelvegadev/warden"
	// BinPath is where `wardend install` puts the binary and what the unit runs.
	BinPath = "/usr/local/bin/wardend"
	// StageDirName is the folder under the data dir the daemon stages a verified binary in.
	StageDirName = "update"
	tagFile      = "tag"
	binFile      = "wardend"
	userAgent    = "wardend (+https://github.com/" + Repo + ")"
)

// Release is what the daemon knows about the newest published version.
type Release struct {
	Tag         string    `json:"tag"` // "v0.4.0"
	PublishedAt time.Time `json:"publishedAt"`
	URL         string    `json:"url"`
}

// AssetName is the release asset for this platform.
func AssetName() string { return "wardend-" + runtime.GOOS + "-" + runtime.GOARCH }

// Supported reports whether releases ship a binary for this platform.
func Supported() bool {
	return runtime.GOOS == "linux" && (runtime.GOARCH == "amd64" || runtime.GOARCH == "arm64")
}

var (
	latestMu   sync.Mutex
	latest     Release
	latestAt   time.Time
	latestErr  error
	latestFor  = 10 * time.Minute
	httpClient = &http.Client{Timeout: 30 * time.Second}
)

// Latest returns the newest release, cached for ten minutes (GitHub rate-limits anonymous calls).
func Latest(ctx context.Context) (Release, error) {
	latestMu.Lock()
	defer latestMu.Unlock()
	if time.Since(latestAt) < latestFor && (latest.Tag != "" || latestErr != nil) {
		return latest, latestErr
	}
	latest, latestErr = fetchLatest(ctx)
	latestAt = time.Now()
	return latest, latestErr
}

func fetchLatest(ctx context.Context) (Release, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.github.com/repos/"+Repo+"/releases/latest", nil)
	if err != nil {
		return Release{}, err
	}
	req.Header.Set("User-Agent", userAgent)
	req.Header.Set("Accept", "application/vnd.github+json")
	resp, err := httpClient.Do(req)
	if err != nil {
		return Release{}, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return Release{}, fmt.Errorf("github releases: %s", resp.Status)
	}
	var body struct {
		Tag         string    `json:"tag_name"`
		PublishedAt time.Time `json:"published_at"`
		URL         string    `json:"html_url"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return Release{}, err
	}
	return Release{Tag: body.Tag, PublishedAt: body.PublishedAt, URL: body.URL}, nil
}

// Newer reports whether tag is a higher semver than current ("dev" and unparsable versions never update).
func Newer(current, tag string) bool {
	c, okC := semver(current)
	t, okT := semver(tag)
	if !okC || !okT {
		return false
	}
	for i := range 3 {
		if t[i] != c[i] {
			return t[i] > c[i]
		}
	}
	return false
}

func semver(v string) ([3]int, bool) {
	var out [3]int
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	v, _, _ = strings.Cut(v, "-") // "0.4.0-3-gabc" (git describe) counts as 0.4.0
	parts := strings.Split(v, ".")
	if len(parts) != 3 {
		return out, false
	}
	for i, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return out, false
		}
		out[i] = n
	}
	return out, true
}

func validTag(tag string) bool {
	_, ok := semver(tag)
	return ok && strings.HasPrefix(tag, "v")
}

func assetURL(tag, name string) string {
	return "https://github.com/" + Repo + "/releases/download/" + tag + "/" + name
}

// expectedSum fetches the release's SHA256SUMS and returns the digest for this platform's asset.
func expectedSum(ctx context.Context, tag string) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, assetURL(tag, "SHA256SUMS"), nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := httpClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("SHA256SUMS for %s: %s", tag, resp.Status)
	}
	sc := bufio.NewScanner(resp.Body)
	for sc.Scan() {
		f := strings.Fields(sc.Text())
		if len(f) == 2 && strings.TrimPrefix(f[1], "*") == AssetName() {
			return strings.ToLower(f[0]), nil
		}
	}
	return "", fmt.Errorf("%s not listed in SHA256SUMS of %s", AssetName(), tag)
}

func fileSum(path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	if _, err := io.Copy(h, f); err != nil {
		return "", err
	}
	return hex.EncodeToString(h.Sum(nil)), nil
}

// Stage downloads tag's binary into stageDir, verifies it against the release's SHA256SUMS and
// writes the tag marker that triggers the root installer unit. Progress is 0-100 of the download.
func Stage(ctx context.Context, stageDir, tag string, progress func(pct int)) error {
	if !Supported() {
		return errors.New("no release binary for " + runtime.GOOS + "/" + runtime.GOARCH)
	}
	if !validTag(tag) {
		return fmt.Errorf("invalid release tag %q", tag)
	}
	if err := os.MkdirAll(stageDir, 0o750); err != nil {
		return err
	}
	// A leftover marker from an earlier attempt must not fire the installer mid-download.
	os.Remove(filepath.Join(stageDir, tagFile))
	want, err := expectedSum(ctx, tag)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, assetURL(tag, AssetName()), nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", userAgent)
	resp, err := (&http.Client{Timeout: 10 * time.Minute}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: %s", AssetName(), resp.Status)
	}
	tmp := filepath.Join(stageDir, binFile+".tmp")
	f, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o750)
	if err != nil {
		return err
	}
	h := sha256.New()
	var done int64
	buf := make([]byte, 256<<10)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, err := f.Write(buf[:n]); err != nil {
				f.Close()
				return err
			}
			h.Write(buf[:n])
			done += int64(n)
			if progress != nil && resp.ContentLength > 0 {
				progress(int(done * 100 / resp.ContentLength))
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			f.Close()
			return rerr
		}
	}
	if err := f.Close(); err != nil {
		return err
	}
	if got := hex.EncodeToString(h.Sum(nil)); got != want {
		os.Remove(tmp)
		return fmt.Errorf("checksum mismatch for %s (expected %s, got %s)", AssetName(), want, got)
	}
	if err := os.Rename(tmp, filepath.Join(stageDir, binFile)); err != nil {
		return err
	}
	// The marker goes last: the path unit fires on it.
	return os.WriteFile(filepath.Join(stageDir, tagFile), []byte(tag+"\n"), 0o640)
}

// Apply is `wardend update-apply`, run as root by wardend-update.service: it trusts nothing in
// the stage dir but the tag, re-verifies the staged binary against GitHub, installs it over
// BinPath and restarts the service.
func Apply(ctx context.Context, stageDir string, log io.Writer) error {
	tagB, err := os.ReadFile(filepath.Join(stageDir, tagFile))
	if err != nil {
		return fmt.Errorf("no staged update: %w", err)
	}
	tag := strings.TrimSpace(string(tagB))
	staged := filepath.Join(stageDir, binFile)
	// Whatever happens, a stale marker must not retrigger the unit.
	defer os.Remove(filepath.Join(stageDir, tagFile))
	if !validTag(tag) {
		return fmt.Errorf("invalid staged tag %q", tag)
	}
	want, err := expectedSum(ctx, tag)
	if err != nil {
		return err
	}
	got, err := fileSum(staged)
	if err != nil {
		return err
	}
	if got != want {
		os.Remove(staged)
		return fmt.Errorf("staged binary does not match %s's SHA256SUMS", tag)
	}
	fmt.Fprintf(log, "installing wardend %s to %s\n", tag, BinPath)
	src, err := os.Open(staged)
	if err != nil {
		return err
	}
	defer src.Close()
	tmp := BinPath + ".new"
	dst, err := os.OpenFile(tmp, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o755)
	if err != nil {
		return err
	}
	if _, err := io.Copy(dst, src); err != nil {
		dst.Close()
		os.Remove(tmp)
		return err
	}
	if err := dst.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmp, BinPath); err != nil {
		return err
	}
	os.Remove(staged)
	fmt.Fprintln(log, "restarting wardend")
	// --no-block: this oneshot must not wait on (or be stopped by) the restart it asks for.
	cmd := exec.CommandContext(ctx, "systemctl", "--no-block", "restart", "wardend")
	cmd.Stdout, cmd.Stderr = log, log
	return cmd.Run()
}

// Installed reports whether the root installer units are in place, i.e. a staged update will be applied.
func Installed() bool {
	_, err := os.Stat("/etc/systemd/system/wardend-update.path")
	return err == nil
}
