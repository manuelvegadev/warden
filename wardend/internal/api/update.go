package api

import (
	"context"
	"fmt"
	"net/http"
	"runtime"

	"github.com/manuelvega/warden/wardend/internal/selfupdate"
	"github.com/manuelvega/warden/wardend/internal/tasks"
)

// UpdateInfo is GET /system/update.
type UpdateInfo struct {
	Current   string `json:"current"`
	Latest    string `json:"latest,omitempty"`
	Published string `json:"publishedAt,omitempty"`
	URL       string `json:"url,omitempty"`
	Available bool   `json:"available"` // latest is newer than current
	// CanApply: this daemon can install it by itself (installed by `wardend install` on a
	// supported platform). Otherwise the operator re-runs the install script.
	CanApply bool   `json:"canApply"`
	Error    string `json:"error,omitempty"` // GitHub unreachable etc.; the rest is still valid
}

func (s *server) updateInfo(ctx context.Context) UpdateInfo {
	info := UpdateInfo{Current: s.Version, CanApply: selfupdate.Supported() && selfupdate.Installed()}
	rel, err := selfupdate.Latest(ctx)
	if err != nil {
		info.Error = err.Error()
		return info
	}
	info.Latest, info.URL = rel.Tag, rel.URL
	if !rel.PublishedAt.IsZero() {
		info.Published = rel.PublishedAt.UTC().Format("2006-01-02T15:04:05Z")
	}
	info.Available = selfupdate.Newer(s.Version, rel.Tag)
	return info
}

func (s *server) getUpdate(w http.ResponseWriter, r *http.Request) {
	writeJSON(w, 200, s.updateInfo(r.Context()))
}

// applyUpdate stages the newest release and lets wardend-update.service install it and restart
// the daemon. Admin only; 409 when there is nothing newer or the daemon cannot self-update.
func (s *server) applyUpdate(w http.ResponseWriter, r *http.Request) {
	info := s.updateInfo(r.Context())
	switch {
	case info.Error != "":
		writeError(w, 502, "upstream", info.Error)
		return
	case !info.CanApply:
		writeError(w, 409, "not_supported", fmt.Sprintf("this daemon cannot update itself (%s/%s, installer units missing); re-run the install script", runtime.GOOS, runtime.GOARCH))
		return
	case !info.Available:
		writeError(w, 409, "up_to_date", "wardend "+info.Current+" is the newest release")
		return
	}
	if s.Tasks.Active("") {
		writeError(w, 409, "task_running", "an update is already in progress")
		return
	}
	tag := info.Latest
	task := s.Tasks.Run(r.Context(), "daemon.update", "", func(ctx context.Context, report tasks.Reporter) error {
		report(1, "Downloading wardend "+tag)
		if err := selfupdate.Stage(ctx, s.Config.UpdateDir(), tag, func(pct int) {
			report(1+pct*97/100, fmt.Sprintf("Downloading wardend %s (%d%%)", tag, pct))
		}); err != nil {
			return err
		}
		report(99, "Verified; installing and restarting the daemon")
		return nil
	})
	writeJSON(w, 202, map[string]any{"task": task})
}
