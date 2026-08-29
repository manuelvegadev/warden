package instance

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/manuelvega/warden/wardend/internal/catalog"
	"github.com/manuelvega/warden/wardend/internal/mc"
	"github.com/manuelvega/warden/wardend/internal/tasks"
)

var (
	jarNameRe  = regexp.MustCompile(`^[A-Za-z0-9._+ -]+\.jar$`)
	safeNameRe = regexp.MustCompile(`[^A-Za-z0-9._-]`)
)

var (
	ErrBadJarName = errors.New("invalid jar file name")
	// ErrPluginNotFound is returned for file names that are not in server/plugins.
	ErrPluginNotFound = errors.New("plugin not found")
)

const (
	maxIconBytes = 2 << 20
	// MaxPluginBytes caps a single plugin jar, uploaded or extracted from a bundle.
	MaxPluginBytes = 128 << 20
)

func (i *Instance) pluginsDir() string { return filepath.Join(i.ServerDir(), "plugins") }

// iconsDir holds plugin icons fetched from the catalog, outside the server directory.
func (i *Instance) iconsDir() string { return filepath.Join(i.Dir, "icons") }

// PluginFile is one jar in server/plugins, joined with its descriptor and, when wardend installed
// it, the manifest record.
type PluginFile struct {
	FileName string           `json:"fileName"`
	Enabled  bool             `json:"enabled"`
	Size     int64            `json:"size"`
	Meta     *mc.PluginMeta   `json:"meta,omitempty"`    // from plugin.yml / paper-plugin.yml
	IconURL  string           `json:"iconUrl,omitempty"` // API path of the icon fetched at install time
	Source   *InstalledPlugin `json:"source,omitempty"`
}

// PluginUpdate names a newer catalog release than the installed one.
type PluginUpdate struct {
	FileName  string `json:"fileName"`
	Version   string `json:"version"`
	VersionID string `json:"versionId"`
}

// InstalledPlugin returns the manifest record for a jar wardend installed or uploaded.
func (i *Instance) InstalledPlugin(fileName string) (InstalledPlugin, bool) {
	i.mu.RLock()
	defer i.mu.RUnlock()
	for _, p := range i.Manifest.Plugins {
		if p.FileName == fileName {
			return p, true
		}
	}
	return InstalledPlugin{}, false
}

// PluginIconPath returns the on-disk icon for an installed jar, or "" when there is none.
func (i *Instance) PluginIconPath(fileName string) string {
	if p, ok := i.InstalledPlugin(fileName); ok && p.Icon != "" {
		return filepath.Join(i.iconsDir(), p.Icon)
	}
	return ""
}

// updatePlugins rewrites the manifest's plugin records: entries for which drop returns true are
// removed (their icon deleted), then add (if any) is appended. Saves the manifest.
func (i *Instance) updatePlugins(drop func(InstalledPlugin) bool, add *InstalledPlugin) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	i.Manifest.Plugins = slices.DeleteFunc(i.Manifest.Plugins, func(p InstalledPlugin) bool {
		if !drop(p) {
			return false
		}
		if p.Icon != "" && (add == nil || add.Icon != p.Icon) {
			_ = os.Remove(filepath.Join(i.iconsDir(), p.Icon))
		}
		return true
	})
	if add != nil {
		i.Manifest.Plugins = append(i.Manifest.Plugins, *add)
	}
	return i.Manifest.save(i.Dir)
}

// fetchIcon stores the project icon as <source>-<project>.<ext>; failures are not fatal.
func (i *Instance) fetchIcon(ctx context.Context, reg *catalog.Registry, source, projectID, iconURL string) string {
	if iconURL == "" {
		return ""
	}
	ctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	defer cancel()
	data, ext, err := reg.FetchImage(ctx, iconURL, maxIconBytes)
	if err != nil {
		return ""
	}
	if err := os.MkdirAll(i.iconsDir(), 0o750); err != nil {
		return ""
	}
	name := source + "-" + safeNameRe.ReplaceAllString(projectID, "_") + ext
	if err := os.WriteFile(filepath.Join(i.iconsDir(), name), data, 0o640); err != nil {
		return ""
	}
	return name
}

// stage creates a temp file inside server/plugins (same filesystem as the destination, so the
// final step is an atomic rename) and returns its path. Callers remove it when done.
func (i *Instance) stage(pattern string) (string, error) {
	if err := os.MkdirAll(i.pluginsDir(), 0o750); err != nil {
		return "", err
	}
	f, err := os.CreateTemp(i.pluginsDir(), pattern)
	if err != nil {
		return "", err
	}
	f.Close()
	return f.Name(), nil
}

// placePlugin is the single path by which a jar enters server/plugins: it validates the staged
// file (a real archive with a plugin descriptor), moves it to fileName, drops superseded records
// (same file, or any for which supersedes returns true, deleting their jars) and records rec.
func (i *Instance) placePlugin(staged, fileName string, rec InstalledPlugin, supersedes func(InstalledPlugin) bool) (PluginFile, error) {
	if !jarNameRe.MatchString(fileName) {
		return PluginFile{}, fmt.Errorf("%w: %s", ErrBadJarName, fileName)
	}
	meta, ok, err := mc.ReadPluginMeta(staged)
	if err != nil || !ok {
		return PluginFile{}, fmt.Errorf("%s is not a plugin jar (no plugin.yml or paper-plugin.yml)", fileName)
	}
	info, err := os.Stat(staged)
	if err != nil {
		return PluginFile{}, err
	}
	dest := filepath.Join(i.pluginsDir(), fileName)
	if err := os.Rename(staged, dest); err != nil {
		return PluginFile{}, err
	}
	os.Remove(dest + ".disabled") // a fresh jar supersedes a disabled copy
	rec.FileName = fileName
	if rec.Name == "" {
		rec.Name = meta.Name
	}
	if rec.Version == "" {
		rec.Version = meta.Version
	}
	rec.InstalledAt = time.Now().UTC()
	err = i.updatePlugins(func(p InstalledPlugin) bool {
		if p.FileName == fileName {
			return true
		}
		if supersedes != nil && supersedes(p) {
			_ = os.Remove(filepath.Join(i.pluginsDir(), p.FileName))
			_ = os.Remove(filepath.Join(i.pluginsDir(), p.FileName+".disabled"))
			return true
		}
		return false
	}, &rec)
	if err != nil {
		return PluginFile{}, err
	}
	return PluginFile{FileName: fileName, Enabled: true, Size: info.Size(), Meta: &meta, Source: &rec}, nil
}

// InstallPlugin downloads a plugin version into server/plugins and records it in the manifest.
// Meant to run inside a tasks.Manager task; a restart is needed for the server to load it.
func (i *Instance) InstallPlugin(ctx context.Context, reg *catalog.Registry, source, projectID, versionID string, report tasks.Reporter) error {
	src, err := reg.PluginSource(source)
	if err != nil {
		return err
	}
	report(2, "Resolving "+projectID)
	// Sources accept slugs and ids; the manifest keys on the canonical id so later installs of the
	// same project replace the earlier jar. Records written by slug before this rule still match.
	hit, err := src.Get(ctx, projectID)
	if err != nil {
		return err
	}
	ids := []string{hit.ID, projectID}
	var icon string
	iconDone := make(chan struct{})
	go func() {
		defer close(iconDone)
		icon = i.fetchIcon(ctx, reg, source, hit.ID, hit.IconURL)
	}()
	versions, err := src.Versions(ctx, hit.ID, i.Manifest.MCVersion)
	if err != nil {
		return err
	}
	v, ok := catalog.FindVersion(versions, versionID)
	if !ok {
		return fmt.Errorf("no version %q of %s for Minecraft %s", versionID, hit.Name, i.Manifest.MCVersion)
	}
	fileName := filepath.Base(v.FileName)
	staged, err := i.stage(".download-*")
	if err != nil {
		return err
	}
	defer os.Remove(staged)
	report(5, "Downloading "+fileName)
	err = reg.Download(ctx, v.URL, v.Hash, staged, func(done, total int64) {
		if total > 0 {
			report(5+int(done*90/total), fmt.Sprintf("Downloading %s (%d/%d KB)", fileName, done>>10, total>>10))
		}
	})
	if err != nil {
		return err
	}
	<-iconDone
	rec := InstalledPlugin{Source: source, ProjectID: hit.ID, Name: hit.Name, VersionID: v.ID, Version: v.Name,
		HashAlgo: v.Hash.Algo, Hash: v.Hash.Value, Icon: icon}
	_, err = i.placePlugin(staged, fileName, rec, func(p InstalledPlugin) bool {
		return p.Source == source && slices.Contains(ids, p.ProjectID)
	})
	if err != nil {
		// External downloads (Hangar "externalUrl") can be a web page rather than the jar itself.
		return fmt.Errorf("%w — the download link may point to a web page; install it manually from %s", err, v.URL)
	}
	report(100, "Installed "+fileName+" — restart the server to load it")
	return nil
}

// AddPlugins stores an upload: a plugin jar, or a zip bundle from which every jar with a plugin
// descriptor is extracted. Uploaded jars are recorded with Source "manual" and replace same-named files.
func (i *Instance) AddPlugins(fileName string, r io.Reader) ([]PluginFile, error) {
	fileName = filepath.Base(fileName)
	staged, err := i.stage(".upload-*")
	if err != nil {
		return nil, err
	}
	defer os.Remove(staged)
	if err := copyTo(staged, r, MaxPluginBytes); err != nil {
		return nil, err
	}
	if strings.HasSuffix(strings.ToLower(fileName), ".zip") {
		return i.addPluginsFromZip(staged)
	}
	pf, err := i.placePlugin(staged, fileName, InstalledPlugin{Source: "manual"}, nil)
	if err != nil {
		return nil, err
	}
	return []PluginFile{pf}, nil
}

// addPluginsFromZip extracts each *.jar entry that carries a plugin descriptor.
func (i *Instance) addPluginsFromZip(zipPath string) ([]PluginFile, error) {
	zr, err := zip.OpenReader(zipPath)
	if err != nil {
		return nil, fmt.Errorf("not a zip archive")
	}
	defer zr.Close()
	var out []PluginFile
	for _, f := range zr.File {
		if f.FileInfo().IsDir() || !strings.HasSuffix(strings.ToLower(f.Name), ".jar") {
			continue
		}
		rc, err := f.Open()
		if err != nil {
			continue
		}
		staged, err := i.stage(".extract-*")
		if err != nil {
			rc.Close()
			return out, err
		}
		err = copyTo(staged, rc, MaxPluginBytes)
		rc.Close()
		if err == nil {
			// Entries without a descriptor (libraries, sources, docs) are skipped.
			if pf, err := i.placePlugin(staged, filepath.Base(f.Name), InstalledPlugin{Source: "manual"}, nil); err == nil {
				out = append(out, pf)
			}
		}
		os.Remove(staged)
	}
	if len(out) == 0 {
		return nil, fmt.Errorf("the archive contains no plugin jars")
	}
	return out, nil
}

func copyTo(path string, r io.Reader, max int64) error {
	f, err := os.OpenFile(path, os.O_WRONLY|os.O_TRUNC, 0o640)
	if err != nil {
		return err
	}
	defer f.Close()
	_, err = io.Copy(f, io.LimitReader(r, max))
	return err
}

// pluginPath resolves a validated jar name to its enabled or disabled file on disk.
func (i *Instance) pluginPath(fileName string) (path string, enabled bool, err error) {
	if !jarNameRe.MatchString(fileName) {
		return "", false, fmt.Errorf("%w: %s", ErrBadJarName, fileName)
	}
	path = filepath.Join(i.pluginsDir(), fileName)
	if _, err := os.Stat(path); err == nil {
		return path, true, nil
	}
	if _, err := os.Stat(path + ".disabled"); err == nil {
		return path + ".disabled", false, nil
	}
	return "", false, ErrPluginNotFound
}

// TogglePlugin renames .jar ↔ .jar.disabled; the change applies on the next server start.
func (i *Instance) TogglePlugin(fileName string) (enabled bool, err error) {
	path, wasEnabled, err := i.pluginPath(fileName)
	if err != nil {
		return false, err
	}
	target := filepath.Join(i.pluginsDir(), fileName)
	if wasEnabled {
		target += ".disabled"
	}
	if err := os.Rename(path, target); err != nil {
		return false, err
	}
	return !wasEnabled, nil
}

// RemovePlugin deletes the jar (enabled or disabled), its icon and its manifest record.
func (i *Instance) RemovePlugin(fileName string) error {
	path, _, err := i.pluginPath(fileName)
	if err != nil {
		return err
	}
	if err := os.Remove(path); err != nil {
		return err
	}
	return i.updatePlugins(func(p InstalledPlugin) bool { return p.FileName == fileName }, nil)
}

// pluginMeta returns the jar descriptor, re-reading the archive only when size or mtime changed.
func (i *Instance) pluginMeta(path string, info os.FileInfo) *mc.PluginMeta {
	i.mu.RLock()
	c, hit := i.pluginMetas[path]
	i.mu.RUnlock()
	if hit && c.size == info.Size() && c.mtime.Equal(info.ModTime()) {
		return c.meta
	}
	var meta *mc.PluginMeta
	if m, ok, err := mc.ReadPluginMeta(path); err == nil && ok {
		meta = &m
	}
	i.mu.Lock()
	if i.pluginMetas == nil {
		i.pluginMetas = map[string]pluginMetaEntry{}
	}
	i.pluginMetas[path] = pluginMetaEntry{size: info.Size(), mtime: info.ModTime(), meta: meta}
	i.mu.Unlock()
	return meta
}

type pluginMetaEntry struct {
	size  int64
	mtime time.Time
	meta  *mc.PluginMeta
}

// Plugins lists jars (enabled = .jar, disabled = .jar.disabled) in server/plugins.
func (i *Instance) Plugins() ([]PluginFile, error) {
	entries, err := os.ReadDir(i.pluginsDir())
	if err != nil {
		if os.IsNotExist(err) {
			return []PluginFile{}, nil
		}
		return nil, err
	}
	i.mu.RLock()
	byFile := map[string]InstalledPlugin{}
	for _, p := range i.Manifest.Plugins {
		byFile[p.FileName] = p
	}
	i.mu.RUnlock()
	out := []PluginFile{}
	for _, e := range entries {
		name := e.Name()
		if e.IsDir() || !(strings.HasSuffix(name, ".jar") || strings.HasSuffix(name, ".jar.disabled")) {
			continue
		}
		info, err := e.Info()
		if err != nil {
			continue
		}
		base := strings.TrimSuffix(name, ".disabled")
		pf := PluginFile{FileName: base, Enabled: name == base, Size: info.Size()}
		pf.Meta = i.pluginMeta(filepath.Join(i.pluginsDir(), name), info)
		if rec, ok := byFile[base]; ok {
			pf.Source = &rec
			if rec.Icon != "" {
				pf.IconURL = "/api/v1/instances/" + i.Manifest.ID + "/plugins/" + url.PathEscape(base) + "/icon"
			}
		}
		out = append(out, pf)
	}
	return out, nil
}

// PluginUpdates compares each catalog-installed plugin with the newest compatible release. A few
// sources are queried at a time; lookup failures are ignored.
func (i *Instance) PluginUpdates(ctx context.Context, reg *catalog.Registry) []PluginUpdate {
	i.mu.RLock()
	records := slices.Clone(i.Manifest.Plugins)
	i.mu.RUnlock()
	var (
		wg  sync.WaitGroup
		mu  sync.Mutex
		sem = make(chan struct{}, 4)
		out = []PluginUpdate{}
	)
	for _, rec := range records {
		src, err := reg.PluginSource(rec.Source)
		if err != nil || rec.ProjectID == "" {
			continue
		}
		wg.Add(1)
		go func() {
			defer wg.Done()
			sem <- struct{}{}
			defer func() { <-sem }()
			versions, err := src.Versions(ctx, rec.ProjectID, i.Manifest.MCVersion)
			if err != nil {
				return
			}
			if latest, ok := catalog.FindVersion(versions, "latest"); ok && latest.ID != rec.VersionID {
				mu.Lock()
				out = append(out, PluginUpdate{FileName: rec.FileName, Version: latest.Name, VersionID: latest.ID})
				mu.Unlock()
			}
		}()
	}
	wg.Wait()
	return out
}
