package api

import (
	"encoding/json"
	"errors"
	"io"
	"mime"
	"net/http"
	"os"

	"github.com/manuelvega/warden/wardend/internal/instance"
)

// The file manager (ADR-020): the server directory as the panel browses it. Paths are relative to
// server/ and travel in `?path=`; the instance package confines them.

// listFiles: GET /instances/{id}/fs?path=plugins
func (s *server) listFiles(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	l, err := inst.ListDir(r.URL.Query().Get("path"))
	if err != nil {
		writeFSError(w, err, err.Error())
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	writeJSON(w, 200, l)
}

// getFile: GET /instances/{id}/fs/content?path=logs/latest.log[&download=1] streams the file with
// ranges and conditional requests; `download=1` makes it an attachment.
func (s *server) getFile(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	f, info, err := inst.OpenFile(r.URL.Query().Get("path"))
	if err != nil {
		writeFSError(w, err, err.Error())
		return
	}
	defer f.Close()
	// The first bytes are read only for a file whose extension does not settle the type.
	head := func() []byte {
		buf := make([]byte, 512)
		n, _ := io.ReadFull(f, buf)
		_, _ = f.Seek(0, io.SeekStart)
		return buf[:n]
	}
	w.Header().Set("Content-Type", instance.ContentType(info.Name(), head))
	w.Header().Set("Cache-Control", "no-store")
	if r.URL.Query().Get("download") == "1" {
		w.Header().Set("Content-Disposition", mime.FormatMediaType("attachment", map[string]string{"filename": info.Name()}))
	}
	http.ServeContent(w, r, info.Name(), info.ModTime(), f)
}

// putFile: PUT /instances/{id}/fs/content?path= with the new content as the body.
func (s *server) putFile(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, instance.MaxEditBytes+1))
	if err != nil {
		writeError(w, 400, "bad_request", err.Error())
		return
	}
	restart, err := inst.WriteFile(r.URL.Query().Get("path"), body)
	if err != nil {
		writeFSError(w, err, err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"restartRequired": restart})
}

// uploadFiles: POST /instances/{id}/fs/upload?path=plugins[&overwrite=1], multipart with one or
// more `file` parts streamed to disk as they arrive. Answers with the entries written; the first
// failure stops the request (what came before it stays on disk).
func (s *server) uploadFiles(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	dir := r.URL.Query().Get("path")
	overwrite := r.URL.Query().Get("overwrite") == "1"
	r.Body = http.MaxBytesReader(w, r.Body, instance.MaxUploadBytes)
	mr, err := r.MultipartReader()
	if err != nil {
		writeError(w, 400, "bad_request", "multipart body required: "+err.Error())
		return
	}
	entries := []instance.Entry{}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			writeError(w, 400, "bad_request", err.Error())
			return
		}
		if part.FormName() != "file" || part.FileName() == "" {
			continue
		}
		e, err := inst.SaveUpload(dir, part.FileName(), part, overwrite)
		if err != nil {
			writeFSError(w, err, part.FileName()+": "+err.Error())
			return
		}
		entries = append(entries, e)
	}
	if len(entries) == 0 {
		writeError(w, 400, "bad_request", "multipart field \"file\" is required")
		return
	}
	writeJSON(w, 201, map[string]any{"entries": entries})
}

// mkdir: POST /instances/{id}/fs/mkdir {"path":"plugins/MyPlugin"}
func (s *server) mkdir(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	var in struct{ Path string }
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, 400, "bad_request", err.Error())
		return
	}
	e, err := inst.Mkdir(in.Path)
	if err != nil {
		writeFSError(w, err, err.Error())
		return
	}
	writeJSON(w, 201, map[string]any{"entry": e})
}

// renameFile: POST /instances/{id}/fs/rename {"from":"a.yml","to":"plugins/a.yml"}
func (s *server) renameFile(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	var in struct{ From, To string }
	if err := json.NewDecoder(r.Body).Decode(&in); err != nil {
		writeError(w, 400, "bad_request", err.Error())
		return
	}
	if err := inst.Rename(in.From, in.To); err != nil {
		writeFSError(w, err, err.Error())
		return
	}
	w.WriteHeader(204)
}

// removeFile: DELETE /instances/{id}/fs?path=world_old
func (s *server) removeFile(w http.ResponseWriter, r *http.Request) {
	inst, ok := s.instanceOr404(w, r)
	if !ok {
		return
	}
	if err := inst.Remove(r.URL.Query().Get("path")); err != nil {
		writeFSError(w, err, err.Error())
		return
	}
	w.WriteHeader(204)
}

// fsErr maps a file operation's failure to the HTTP status and the error code the panel reacts to
// (asking before overwriting, say). Used by the config editor's handlers as well.
func fsErr(err error) (status int, code string) {
	var maxErr *http.MaxBytesError
	switch {
	case errors.Is(err, os.ErrNotExist):
		return 404, "not_found"
	case errors.Is(err, instance.ErrFileNotAllowed):
		return 403, "forbidden"
	case errors.Is(err, instance.ErrFileExists):
		return 409, "exists"
	case errors.Is(err, instance.ErrProtected):
		return 409, "protected"
	case errors.As(err, &maxErr):
		return 413, "too_large"
	case errors.Is(err, instance.ErrFileTooLarge):
		return 400, "too_large"
	case errors.Is(err, instance.ErrInvalidSyntax):
		return 400, "invalid_syntax"
	case errors.Is(err, instance.ErrNotDir), errors.Is(err, instance.ErrIsDir), errors.Is(err, instance.ErrBadFileName),
		errors.Is(err, instance.ErrRootPath):
		return 400, "bad_request"
	}
	return 500, "fs_failed"
}

func writeFSError(w http.ResponseWriter, err error, msg string) {
	status, code := fsErr(err)
	writeError(w, status, code, msg)
}
