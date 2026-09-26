package api

import (
	"errors"
	"net/http"
	"strconv"

	"github.com/manuelvega/warden/wardend/internal/instance"
	"github.com/manuelvega/warden/wardend/internal/mc"
	"github.com/manuelvega/warden/wardend/internal/sqlview"
)

// Views of files the panel cannot read as text (ADR-020): what a jar is, a zip's files, an NBT
// document, a SQLite database. All read-only; paths are confined like the rest of the file manager.

// maxArchiveListing caps the entries a zip listing returns; Total still counts them all.
const maxArchiveListing = 5000

// fsFile resolves ?path= to the confined file on disk, or answers the error itself.
func (s *server) fsFile(w http.ResponseWriter, r *http.Request) (string, bool) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return "", false
	}
	f, _, err := inst.OpenFile(r.URL.Query().Get("path"))
	if err != nil {
		writeFSError(w, err, err.Error())
		return "", false
	}
	defer f.Close()
	return f.Name(), true
}

// fsJar: GET /instances/{id}/fs/jar?path=plugins/X.jar — the plugin or mod the jar is.
func (s *server) fsJar(w http.ResponseWriter, r *http.Request) {
	name, ok := s.fsFile(w, r)
	if !ok {
		return
	}
	info, err := mc.ReadJarInfo(name)
	if err != nil {
		writeError(w, 400, "not_an_archive", err.Error())
		return
	}
	writeJSON(w, 200, info)
}

// fsArchive: GET /instances/{id}/fs/archive?path=[&entry=] — a zip's files, or one of them.
func (s *server) fsArchive(w http.ResponseWriter, r *http.Request) {
	name, ok := s.fsFile(w, r)
	if !ok {
		return
	}
	entry := r.URL.Query().Get("entry")
	if entry == "" {
		l, err := mc.ListArchive(name, maxArchiveListing)
		if err != nil {
			writeError(w, 400, "not_an_archive", err.Error())
			return
		}
		writeJSON(w, 200, l)
		return
	}
	data, truncated, err := mc.ReadArchiveEntry(name, entry)
	switch {
	case errors.Is(err, mc.ErrNoSuchEntry):
		writeError(w, 404, "not_found", err.Error())
		return
	case err != nil:
		writeError(w, 400, "not_an_archive", err.Error())
		return
	}
	w.Header().Set("Content-Type", instance.ContentType(entry, func() []byte { return data[:min(len(data), 512)] }))
	w.Header().Set("Cache-Control", "no-store")
	if truncated {
		w.Header().Set("X-Truncated", "1")
	}
	_, _ = w.Write(data)
}

// fsNBT: GET /instances/{id}/fs/nbt?path=world/level.dat — the document as a tree.
func (s *server) fsNBT(w http.ResponseWriter, r *http.Request) {
	name, ok := s.fsFile(w, r)
	if !ok {
		return
	}
	root, compression, err := mc.ReadNBTFile(name)
	switch {
	case errors.Is(err, mc.ErrNBTTooLarge):
		writeError(w, 413, "too_large", err.Error())
	case errors.Is(err, mc.ErrNBTInvalid):
		writeError(w, 400, "not_nbt", err.Error())
	case err != nil:
		writeFSError(w, err, err.Error())
	default:
		writeJSON(w, 200, map[string]any{"root": root, "compression": compression})
	}
}

// fsSQLite: GET /instances/{id}/fs/sqlite?path=[&table=&limit=&offset=] — the tables, or a page of one.
func (s *server) fsSQLite(w http.ResponseWriter, r *http.Request) {
	name, ok := s.fsFile(w, r)
	if !ok {
		return
	}
	q := r.URL.Query()
	var (
		out any
		err error
	)
	if table := q.Get("table"); table == "" {
		var tables []sqlview.Table
		tables, err = sqlview.Tables(r.Context(), name)
		out = map[string]any{"tables": tables}
	} else {
		limit, _ := strconv.Atoi(q.Get("limit"))
		offset, _ := strconv.Atoi(q.Get("offset"))
		out, err = sqlview.Rows(r.Context(), name, table, limit, offset)
	}
	switch {
	case errors.Is(err, sqlview.ErrNotSQLite):
		writeError(w, 400, "not_sqlite", err.Error())
	case errors.Is(err, sqlview.ErrNoSuchTable):
		writeError(w, 404, "not_found", err.Error())
	case err != nil:
		writeError(w, 400, "sqlite_failed", err.Error())
	default:
		writeJSON(w, 200, out)
	}
}
