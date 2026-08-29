package instance

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"

	"github.com/manuelvega/warden/wardend/internal/backup"
	"github.com/manuelvega/warden/wardend/internal/mc"
	"github.com/manuelvega/warden/wardend/internal/tasks"
)

// BackupSettings is the per-instance schedule and retention, stored in the manifest.
type BackupSettings struct {
	Enabled    bool   `json:"enabled"`
	EveryHours int    `json:"everyHours"` // 1, 6, 12, 24 …
	Keep       int    `json:"keep"`       // scheduled + manual backups to retain (0 = unlimited)
	MaxTotalMB int    `json:"maxTotalMb"` // oldest rotating backups go first when exceeded (0 = unlimited)
	Scope      string `json:"scope"`      // full | worlds
}

// ErrBackupBusy means another backup or restore is already running for the instance.
var ErrBackupBusy = errors.New("a backup or restore is already in progress")

var backupNameRe = regexp.MustCompile(`^[A-Za-z0-9._-]+\.tar\.zst$`)

// serverStateFiles is everything worth keeping besides worlds and plugins: the config files the
// panel edits plus the player lists. The jar is skipped (re-downloadable from the recorded build).
var serverStateFiles = func() []string {
	out := []string{"server.properties", "config", "plugins", mc.WhitelistFile, mc.OpsFile, mc.BannedPlayersFile, mc.BannedIPsFile, mc.UserCacheFile}
	for _, f := range fixedConfigFiles {
		if !strings.HasPrefix(f.path, "config/") {
			out = append(out, f.path)
		}
	}
	return out
}()

func (i *Instance) backupsDir() string { return filepath.Join(i.Dir, "backups") }

func (i *Instance) backupSettings() BackupSettings {
	i.mu.RLock()
	defer i.mu.RUnlock()
	return i.Manifest.Backups
}

// backupPaths picks what goes into an archive: worlds only, or worlds plus server state.
func (i *Instance) backupPaths(scope string) []string {
	var candidates []string
	if scope != "worlds" {
		candidates = append(candidates, serverStateFiles...)
	}
	candidates = append(candidates, backup.WorldDirs(i.ServerDir())...)
	var out []string
	for _, rel := range candidates {
		if _, err := os.Stat(filepath.Join(i.ServerDir(), rel)); err == nil {
			out = append(out, rel)
		}
	}
	return out
}

// archive writes one backup with the given trigger and scope and returns its sidecar info.
func (i *Instance) archive(ctx context.Context, trigger, scope string, progress func(int)) (backup.Info, error) {
	now := time.Now().UTC()
	info := backup.Info{Trigger: trigger, Scope: scope, Paths: i.backupPaths(scope), MCVersion: i.Manifest.MCVersion, Build: i.Manifest.Build, CreatedAt: now}
	return backup.Create(ctx, i.ServerDir(), filepath.Join(i.backupsDir(), backup.Name(trigger, now)), info, progress)
}

// Backups lists the instance's archives, newest first.
func (i *Instance) Backups() ([]backup.Info, error) { return backup.List(i.backupsDir()) }

// BackupPath validates a name and returns the archive path.
func (i *Instance) BackupPath(name string) (string, error) {
	if !backupNameRe.MatchString(name) {
		return "", fmt.Errorf("invalid backup name")
	}
	p := filepath.Join(i.backupsDir(), name)
	if _, err := os.Stat(p); err != nil {
		return "", err
	}
	return p, nil
}

func (i *Instance) DeleteBackup(name string) error {
	if _, err := i.BackupPath(name); err != nil {
		return err
	}
	return backup.Remove(i.backupsDir(), name)
}

// StartBackup runs Backup as a task. Manual and scheduled backups share this entry point.
func StartBackup(ctx context.Context, tm *tasks.Manager, inst *Instance, trigger, scope string) *tasks.Task {
	return tm.Run(ctx, "backup", inst.Manifest.ID, func(ctx context.Context, report tasks.Reporter) error {
		_, err := inst.Backup(ctx, trigger, scope, report)
		return err
	})
}

// Backup archives the instance. scope "" uses the schedule's scope. With the server running it
// first flushes the worlds and pauses auto-save (save-off / save-all flush / save-on) so the
// region files are consistent. Meant to run inside a tasks.Manager task.
func (i *Instance) Backup(ctx context.Context, trigger, scope string, report tasks.Reporter) (backup.Info, error) {
	if i.State() == StateInstalling || i.Manifest.Jar == "" {
		return backup.Info{}, ErrNotInstalled
	}
	if !i.backupLock.TryLock() {
		return backup.Info{}, ErrBackupBusy
	}
	defer i.backupLock.Unlock()
	if scope == "" {
		scope = i.backupSettings().Scope
	}
	if i.State() == StateRunning {
		report(2, "Flushing worlds to disk")
		if err := i.SendCommand("save-off"); err != nil {
			return backup.Info{}, err
		}
		defer func() { _ = i.SendCommand("save-on") }()
		if err := i.SendCommand("save-all flush"); err != nil {
			return backup.Info{}, err
		}
		if err := i.awaitLine(ctx, "Saved the game", 90*time.Second); err != nil {
			return backup.Info{}, fmt.Errorf("waiting for save-all: %w", err)
		}
	}
	report(5, "Archiving")
	info, err := i.archive(ctx, trigger, scope, func(pct int) { report(5+pct*90/100, "Archiving…") })
	if err != nil {
		return info, err
	}
	if trigger == "schedule" || trigger == "manual" {
		i.rotateBackups()
	}
	report(100, fmt.Sprintf("Backup %s (%d MB)", info.Name, info.Size>>20))
	return info, nil
}

// rotateBackups applies Keep / MaxTotalMB to scheduled and manual backups. pre-upgrade and
// pre-restore archives are safety nets that only a human deletes.
func (i *Instance) rotateBackups() {
	list, err := backup.List(i.backupsDir())
	if err != nil {
		return
	}
	cfg := i.backupSettings()
	var rotating []backup.Info // newest first
	var total int64
	for _, b := range list {
		total += b.Size
		if b.Trigger == "schedule" || b.Trigger == "manual" {
			rotating = append(rotating, b)
		}
	}
	for idx := len(rotating) - 1; idx >= 0; idx-- { // oldest first
		overCount := cfg.Keep > 0 && idx >= cfg.Keep
		overSize := cfg.MaxTotalMB > 0 && total > int64(cfg.MaxTotalMB)<<20
		if !overCount && !overSize {
			break
		}
		if backup.Remove(i.backupsDir(), rotating[idx].Name) == nil {
			total -= rotating[idx].Size
		}
	}
}

// Restore replaces the instance's files with an archive. The server must be stopped. A
// pre-restore backup is taken first so the operation can itself be undone.
func (i *Instance) Restore(ctx context.Context, name string, report tasks.Reporter) error {
	if err := i.RequireStopped(); err != nil {
		return err
	}
	archive, err := i.BackupPath(name)
	if err != nil {
		return err
	}
	if !i.backupLock.TryLock() {
		return ErrBackupBusy
	}
	defer i.backupLock.Unlock()
	report(2, "Backing up current state")
	if _, err := i.archive(ctx, "pre-restore", "full", func(pct int) { report(2+pct*38/100, "Backing up current state…") }); err != nil {
		return fmt.Errorf("pre-restore backup: %w", err)
	}
	report(40, "Restoring "+name)
	if err := backup.Extract(ctx, archive, i.ServerDir(), func(pct int) { report(40+pct*58/100, "Restoring…") }); err != nil {
		return err
	}
	report(100, "Restored "+name)
	return nil
}
