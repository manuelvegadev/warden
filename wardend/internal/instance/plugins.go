package instance

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/manuelvega/warden/wardend/internal/catalog"
	"github.com/manuelvega/warden/wardend/internal/tasks"
)

var (
	jarNameRe  = regexp.MustCompile(`^[A-Za-z0-9._+ -]+\.jar$`)
	safeNameRe = regexp.MustCompile(`[^A-Za-z0-9._-]`)
)

var ErrBadJarName = errors.New("invalid jar file name")

const maxIconBytes = 2 << 20

func (i *Instance) pluginsDir() string { return filepath.Join(i.ServerDir(), "plugins") }

// iconsDir holds plugin icons fetched from the catalog, outside the server directory.
func (i *Instance) iconsDir() string { return filepath.Join(i.Dir, "icons") }

// PluginIconPath returns the on-disk icon for an installed jar, or "" when there is none.
func (i *Instance) PluginIconPath(fileName string) string {
	i.mu.RLock()
	defer i.mu.RUnlock()
	for _, p := range i.Manifest.Plugins {
		if p.FileName == fileName && p.Icon != "" {
			return filepath.Join(i.iconsDir(), p.Icon)
		}
	}
	return ""
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

// InstallPlugin downloads a plugin version into server/plugins and records it in the manifest.
// Meant to run inside a tasks.Manager task; a restart is needed for the server to load it.
func (i *Instance) InstallPlugin(ctx context.Context, reg *catalog.Registry, source, projectID, versionID string, report tasks.Reporter) error {
	src, err := reg.PluginSource(source)
	if err != nil {
		return err
	}
	report(2, "Resolving "+projectID)
	// Project metadata (name + icon) is independent of the jar download; fetch it alongside.
	var name, icon string
	meta := make(chan struct{})
	go func() {
		defer close(meta)
		if hit, err := src.Get(ctx, projectID); err == nil {
			name = hit.Name
			icon = i.fetchIcon(ctx, reg, source, projectID, hit.IconURL)
		}
	}()
	versions, err := src.Versions(ctx, projectID, i.Manifest.MCVersion)
	if err != nil {
		return err
	}
	v, ok := catalog.FindVersion(versions, versionID)
	if !ok {
		return fmt.Errorf("no version %q of %s for Minecraft %s", versionID, projectID, i.Manifest.MCVersion)
	}
	fileName := filepath.Base(v.FileName)
	if !jarNameRe.MatchString(fileName) {
		return fmt.Errorf("%w: %s", ErrBadJarName, fileName)
	}
	if err := os.MkdirAll(i.pluginsDir(), 0o750); err != nil {
		return err
	}
	dest := filepath.Join(i.pluginsDir(), fileName)
	report(5, "Downloading "+fileName)
	err = reg.Download(ctx, v.URL, v.Hash, dest, func(done, total int64) {
		if total > 0 {
			report(5+int(done*90/total), fmt.Sprintf("Downloading %s (%d/%d KB)", fileName, done>>10, total>>10))
		}
	})
	if err != nil {
		return err
	}
	<-meta

	// Replace an earlier version of the same project (its file name may differ).
	i.mu.Lock()
	kept := i.Manifest.Plugins[:0]
	for _, p := range i.Manifest.Plugins {
		if p.Source == source && p.ProjectID == projectID && p.FileName != fileName {
			_ = os.Remove(filepath.Join(i.pluginsDir(), p.FileName))
			continue
		}
		if p.FileName == fileName {
			continue
		}
		kept = append(kept, p)
	}
	i.Manifest.Plugins = append(kept, InstalledPlugin{
		FileName: fileName, Source: source, ProjectID: projectID, Name: name, VersionID: v.ID, Version: v.Name,
		HashAlgo: v.Hash.Algo, Hash: v.Hash.Value, Icon: icon, InstalledAt: time.Now().UTC(),
	})
	err = i.Manifest.save(i.Dir)
	i.mu.Unlock()
	if err != nil {
		return err
	}
	report(100, "Installed "+fileName+" — restart the server to load it")
	return nil
}

// PluginFile is one jar in server/plugins, joined with the manifest record when wardend installed it.
type PluginFile struct {
	FileName string           `json:"fileName"`
	Enabled  bool             `json:"enabled"`
	Size     int64            `json:"size"`
	IconURL  string           `json:"iconUrl,omitempty"` // API path of the icon fetched at install time
	Source   *InstalledPlugin `json:"source,omitempty"`
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
		enabled := strings.HasSuffix(name, ".jar")
		base := strings.TrimSuffix(name, ".disabled")
		pf := PluginFile{FileName: base, Enabled: enabled, Size: info.Size()}
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
