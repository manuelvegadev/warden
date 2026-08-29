package api

import (
	"errors"
	"io"
	"net/http"
	"os"
	"strconv"
	"strings"

	"github.com/manuelvega/warden/wardend/internal/instance"
)

func (s *server) listLogs(w http.ResponseWriter, r *http.Request) {
	inst, err := s.Manager.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return
	}
	files, err := inst.LogFiles()
	if err != nil {
		writeError(w, 500, "logs_failed", err.Error())
		return
	}
	writeJSON(w, 200, files)
}

// getLog: ?tail=N returns the last N lines as JSON; ?download=1 streams the raw file (gz kept as is);
// otherwise streams the decompressed text.
func (s *server) getLog(w http.ResponseWriter, r *http.Request) {
	inst, err := s.Manager.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return
	}
	name := r.PathValue("file")
	if tail, _ := strconv.Atoi(r.URL.Query().Get("tail")); tail > 0 {
		if tail > 5000 {
			tail = 5000
		}
		lines, err := inst.TailLog(name, tail)
		if err != nil {
			s.logErr(w, err)
			return
		}
		writeJSON(w, 200, map[string]any{"file": name, "lines": lines})
		return
	}
	if r.URL.Query().Get("download") == "1" {
		if !strings.HasSuffix(name, ".gz") && !strings.HasSuffix(name, ".log") {
			writeError(w, 400, "bad_request", "invalid log file name")
			return
		}
		f, err := os.Open(inst.ServerDir() + "/logs/" + name)
		if err != nil {
			s.logErr(w, err)
			return
		}
		defer f.Close()
		w.Header().Set("Content-Type", "application/octet-stream")
		w.Header().Set("Content-Disposition", `attachment; filename="`+inst.Manifest.ID+"-"+name+`"`)
		_, _ = io.Copy(w, f)
		return
	}
	rc, err := inst.OpenLog(name)
	if err != nil {
		s.logErr(w, err)
		return
	}
	defer rc.Close()
	w.Header().Set("Content-Type", "text/plain; charset=utf-8")
	_, _ = io.Copy(w, rc)
}

func (s *server) logErr(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, instance.ErrBadLogName):
		writeError(w, 400, "bad_request", err.Error())
	case os.IsNotExist(err):
		writeError(w, 404, "log_not_found", "log file not found")
	default:
		writeError(w, 500, "logs_failed", err.Error())
	}
}
