package instance

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"time"

	"github.com/manuelvega/warden/wardend/internal/backup"
	"github.com/manuelvega/warden/wardend/internal/catalog"
	"github.com/manuelvega/warden/wardend/internal/tasks"
)

// ErrMustBeStopped is returned when an operation needs the server process gone.
var ErrMustBeStopped = errors.New("server must be stopped")

// UpgradeOptions selects the target: an empty MCVersion keeps the current one; Build 0 = newest.
type UpgradeOptions struct {
	MCVersion string
	Build     int
}

// UpgradeCheck reports what the catalog offers relative to the installed jar.
type UpgradeCheck struct {
	Current       Target  `json:"current"`
	LatestBuild   *Target `json:"latestBuild,omitempty"`   // newer build of the same Minecraft version
	LatestVersion *Target `json:"latestVersion,omitempty"` // newest Minecraft version with a build
}

type Target struct {
	MCVersion string    `json:"mcVersion"`
	Build     int       `json:"build"`
	Channel   string    `json:"channel,omitempty"`
	Time      time.Time `json:"time,omitzero"`
	Changes   []string  `json:"changes,omitempty"`
}

func target(mc string, b catalog.Build) *Target {
	return &Target{MCVersion: mc, Build: b.ID, Channel: b.Channel, Time: b.Time, Changes: b.Changes}
}

// CheckUpgrade compares the manifest with the newest build for its version and the newest version.
// The two catalog lookups that only depend on the manifest run concurrently.
func (i *Instance) CheckUpgrade(ctx context.Context, reg *catalog.Registry) (UpgradeCheck, error) {
	m := i.Manifest
	prov, err := reg.Provider(m.Software)
	if err != nil {
		return UpgradeCheck{}, err
	}
	out := UpgradeCheck{Current: Target{MCVersion: m.MCVersion, Build: m.Build}}
	var (
		versions catalog.VersionList
		verr     error
		done     = make(chan struct{})
	)
	go func() {
		defer close(done)
		versions, verr = prov.Versions(ctx, false)
	}()
	builds, err := prov.Builds(ctx, m.MCVersion)
	if err != nil {
		return out, err
	}
	if latest, ok := catalog.LatestBuild(builds); ok && latest.ID > m.Build {
		out.LatestBuild = target(m.MCVersion, latest)
	}
	<-done
	if verr != nil {
		return out, verr
	}
	if versions.Latest != "" && versions.Latest != m.MCVersion {
		if latest, err := resolveBuild(ctx, prov, m.Software, versions.Latest, 0); err == nil {
			out.LatestVersion = target(versions.Latest, latest)
		}
	}
	return out, nil
}

// Upgrade replaces the server jar with another build/version. The server must be stopped. Before
// touching anything it archives the jar, server.properties, the config files and every world to
// <instance>/backups/pre-upgrade-<time>.tar.gz — a version upgrade migrates world data irreversibly.
// Meant to run inside a tasks.Manager task.
func (i *Instance) Upgrade(ctx context.Context, reg *catalog.Registry, opts UpgradeOptions, report tasks.Reporter) error {
	if err := i.requireStopped(); err != nil {
		return err
	}
	m := i.Manifest
	prov, err := reg.Provider(m.Software)
	if err != nil {
		return err
	}
	mcVersion := opts.MCVersion
	if mcVersion == "" {
		mcVersion = m.MCVersion
	}
	report(2, "Resolving builds for "+mcVersion)
	build, err := resolveBuild(ctx, prov, m.Software, mcVersion, opts.Build)
	if err != nil {
		return err
	}
	if mcVersion == m.MCVersion && build.ID == m.Build {
		return fmt.Errorf("already on %s build %d", mcVersion, build.ID)
	}

	report(5, "Backing up jar, configuration and worlds")
	backupPath, err := i.backupBeforeUpgrade(ctx, func(pct int) { report(5+pct*35/100, "Backing up worlds…") })
	if err != nil {
		return fmt.Errorf("backup: %w", err)
	}

	staged := filepath.Join(i.ServerDir(), ".upgrade-"+build.Name)
	defer os.Remove(staged)
	if err := downloadBuild(ctx, reg, build, staged, report, 40, 90); err != nil {
		return err
	}
	if err := os.Rename(staged, filepath.Join(i.ServerDir(), build.Name)); err != nil {
		return err
	}
	if m.Jar != "" && m.Jar != build.Name {
		_ = os.Remove(filepath.Join(i.ServerDir(), m.Jar))
	}
	i.mu.Lock()
	m.Upgrades = append(m.Upgrades, UpgradeRecord{
		FromVersion: m.MCVersion, FromBuild: m.Build, ToVersion: mcVersion, ToBuild: build.ID,
		Backup: filepath.Base(backupPath), At: time.Now().UTC(),
	})
	m.MCVersion, m.Build, m.Jar = mcVersion, build.ID, build.Name
	err = m.save(i.Dir)
	i.mu.Unlock()
	if err != nil {
		return err
	}
	if err := i.ensureJava(ctx, report, 92, 99); err != nil {
		return err
	}
	report(100, fmt.Sprintf("Upgraded to %s build %d — backup at %s", mcVersion, build.ID, filepath.Base(backupPath)))
	return nil
}

// backupBeforeUpgrade archives the jar, the server/Bukkit/Paper configs and every world.
func (i *Instance) backupBeforeUpgrade(ctx context.Context, progress func(pct int)) (string, error) {
	root := i.ServerDir()
	var paths []string
	for _, rel := range append([]string{i.Manifest.Jar, "server.properties", "bukkit.yml", "spigot.yml", "commands.yml", "config"}, backup.WorldDirs(root)...) {
		if rel == "" {
			continue
		}
		if _, err := os.Stat(filepath.Join(root, rel)); err == nil {
			paths = append(paths, rel)
		}
	}
	dest := filepath.Join(i.Dir, "backups", "pre-upgrade-"+time.Now().UTC().Format("20060102-150405")+".tar.gz")
	if err := backup.Create(ctx, root, dest, paths, progress); err != nil {
		return "", err
	}
	return dest, nil
}
