package instance

import (
	"context"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/manuelvega/warden/wardend/internal/backup"
	"github.com/manuelvega/warden/wardend/internal/lod"
)

type lodSettings = lod.Settings

// LOD is the instance's LOD state (ADR-025); the zero value when never set.
func (i *Instance) LOD() lod.Settings {
	i.mu.RLock()
	defer i.mu.RUnlock()
	if i.Manifest.LOD == nil {
		return lod.Settings{}
	}
	return i.Manifest.LOD.Clone()
}

// UpdateLOD changes the LOD state and saves the manifest.
func (i *Instance) UpdateLOD(fn func(*lod.Settings)) error {
	i.mu.Lock()
	defer i.mu.Unlock()
	if i.Manifest.LOD == nil {
		i.Manifest.LOD = &lod.Settings{}
	}
	fn(i.Manifest.LOD)
	return i.Manifest.save(i.Dir)
}

// Running reports whether the server runs, and since when (a restart changes it).
func (i *Instance) Running() (bool, time.Time) {
	st := i.Status()
	if st.State != StateRunning || st.StartedAt == nil {
		return false, time.Time{}
	}
	return true, *st.StartedAt
}

// Worlds are the world directories (those with a level.dat), by name.
func (i *Instance) Worlds() []string { return backup.WorldDirs(i.ServerDir()) }

// LODInstalled are the LOD plugins among the installed jars.
func (i *Instance) LODInstalled() []lod.Installed {
	files, err := i.Plugins()
	if err != nil {
		return nil
	}
	jars := make([]lod.Jar, 0, len(files))
	for _, f := range files {
		j := lod.Jar{FileName: f.FileName, Enabled: f.Enabled}
		if f.Meta != nil {
			j.Name, j.Version = f.Meta.Name, f.Meta.Version
		}
		jars = append(jars, j)
	}
	return lod.Detect(jars)
}

// LODStores are the stores of every installed LOD plugin, enabled or not: a disabled plugin's data
// is still on disk.
func (i *Instance) LODStores() []lod.Store {
	var out []lod.Store
	worlds := i.Worlds()
	for _, in := range i.LODInstalled() {
		out = append(out, in.Provider.Stores(in.Brand, worlds)...)
	}
	return out
}

// under reports whether rel is one of paths, or nested under one of them.
func under(rel string, paths []string) bool {
	for _, p := range paths {
		if rel == p || strings.HasPrefix(rel, p+"/") {
			return true
		}
	}
	return false
}

// storeDBFiles are a store's database file and its journal/WAL/shared-memory siblings — the only
// files an include-mode backup leaves out of a store's directory; anything else there is archived
// as is.
func storeDBFiles(db string) []string {
	return []string{db, db + "-journal", db + "-wal", db + "-shm"}
}

// lodBackupPlan is what a backup leaves out for the LOD stores that fall under the backup's own
// paths (a worlds-scope backup never touches a plugin's database), and — when the instance keeps
// them — the snapshots to archive in their place. In exclude mode a store's whole Paths are
// genuinely missing (excluded); in include mode only its database and siblings are skipped from
// the walk, replaced by an Extra under the same name (skip, not excluded — nothing is missing). A
// store whose snapshot fails falls back to exclude mode: listed in excluded, with a console line,
// and the backup goes on. cleanup removes the snapshots.
func (i *Instance) lodBackupPlan(ctx context.Context, paths []string, include bool) (skip, excluded []string, extra []backup.Extra, cleanup func(), err error) {
	cleanup = func() {}
	var stores []lod.Store
	for _, s := range i.LODStores() {
		if under(s.DB, paths) {
			stores = append(stores, s)
		}
	}
	if !include {
		for _, s := range stores {
			excluded = append(excluded, s.Paths...)
		}
		return nil, excluded, nil, cleanup, nil
	}
	if len(stores) == 0 {
		return nil, nil, nil, cleanup, nil
	}
	tmp, tmpErr := os.MkdirTemp(i.Dir, "lod-snapshot-")
	if tmpErr == nil {
		cleanup = func() { os.RemoveAll(tmp) }
	}
	for n, s := range stores {
		src := filepath.Join(i.ServerDir(), filepath.FromSlash(s.DB))
		if _, err := os.Stat(src); err != nil {
			continue // no store yet
		}
		snapErr := tmpErr
		dst := ""
		if snapErr == nil {
			dst = filepath.Join(tmp, strconv.Itoa(n)+".db")
			snapErr = backup.SnapshotSQLite(ctx, src, dst)
		}
		if ctx.Err() != nil {
			return nil, nil, nil, cleanup, ctx.Err()
		}
		if snapErr != nil {
			// A snapshot that fails (the plugin holding a lock, a full disk) costs this store, not
			// the backup: it is left out as in exclude mode, and the console says so.
			if dst != "" {
				os.Remove(dst)
			}
			excluded = append(excluded, s.Paths...)
			slog.Warn("LOD store snapshot", "instance", i.Manifest.ID, "store", s.DB, "err", snapErr)
			i.system(fmt.Sprintf("Backup: could not snapshot the LOD data in %s (%v); it is left out of this backup and will be rebuilt", s.DB, snapErr))
			continue
		}
		skip = append(skip, storeDBFiles(s.DB)...)
		extra = append(extra, backup.Extra{Rel: s.DB, Path: dst})
	}
	return skip, excluded, extra, cleanup, nil
}
