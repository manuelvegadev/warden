package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"time"

	"github.com/manuelvega/warden/wardend/internal/instance"
	"github.com/manuelvega/warden/wardend/internal/tasks"
)

type instanceSummary struct {
	ID        string          `json:"id"`
	Name      string          `json:"name"`
	Software  string          `json:"software"`
	MCVersion string          `json:"mcVersion"`
	Build     int             `json:"build"`
	Status    instance.Status `json:"status"`
	Port      int             `json:"port"`
	MemoryMB  int             `json:"memoryMb"`
	Autostart bool            `json:"autostart"`
}

func summary(i *instance.Instance) instanceSummary {
	m := i.Manifest
	return instanceSummary{ID: m.ID, Name: m.Name, Software: m.Software, MCVersion: m.MCVersion,
		Build: m.Build, Status: i.Status(), Port: m.Port, MemoryMB: m.MemoryMB, Autostart: m.Autostart}
}

func (s *server) listInstances(w http.ResponseWriter, _ *http.Request) {
	list := s.Manager.List()
	out := make([]instanceSummary, 0, len(list))
	for _, i := range list {
		out = append(out, summary(i))
	}
	writeJSON(w, 200, out)
}

func (s *server) getInstance(w http.ResponseWriter, r *http.Request) {
	inst, err := s.Manager.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"manifest": inst.Manifest, "status": inst.Status(), "metrics": s.Metrics.Latest(inst.Manifest.ID)})
}

type createInstanceReq struct {
	ID            string            `json:"id"`
	Name          string            `json:"name"`
	Software      string            `json:"software"`
	MCVersion     string            `json:"mcVersion"`
	Build         int               `json:"build"`
	MemoryMB      int               `json:"memoryMb"`
	JVMPreset     string            `json:"jvmFlagsPreset"`
	JVMFlags      []string          `json:"jvmFlags"`
	JavaRuntime   string            `json:"javaRuntime"` // "" or "auto" = pick/install by MC version
	JavaPath      string            `json:"javaPath"`
	Port          int               `json:"port"`
	Autostart     bool              `json:"autostart"`
	RestartPolicy string            `json:"restartPolicy"`
	AcceptEULA    bool              `json:"acceptEula"`
	Properties    map[string]string `json:"properties"`
}

func (s *server) createInstance(w http.ResponseWriter, r *http.Request) {
	var req createInstanceReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "bad_json", err.Error())
		return
	}
	if req.MCVersion == "" {
		writeError(w, 400, "bad_request", "mcVersion is required")
		return
	}
	if req.Name == "" {
		req.Name = req.ID
	}
	if req.Software == "" {
		req.Software = "paper"
	}
	if req.MemoryMB == 0 {
		req.MemoryMB = 2048
	}
	if req.Port == 0 {
		req.Port = 25565
	}
	if req.JVMPreset == "" {
		req.JVMPreset = "aikar"
	}
	if req.RestartPolicy == "" {
		req.RestartPolicy = "on-crash"
	}
	if _, err := s.Catalog.Provider(req.Software); err != nil {
		writeError(w, 400, "unknown_provider", err.Error())
		return
	}
	if req.JavaRuntime == "auto" {
		req.JavaRuntime = ""
	}
	rcon := make([]byte, 16)
	_, _ = rand.Read(rcon)
	man := &instance.Manifest{
		ID: req.ID, Name: req.Name, Software: req.Software, MCVersion: req.MCVersion, Build: req.Build,
		MemoryMB: req.MemoryMB, JVMPreset: req.JVMPreset, JVMFlags: req.JVMFlags, JavaRuntime: req.JavaRuntime, JavaPath: req.JavaPath,
		Port: req.Port, RconPort: req.Port + 10, RconPassword: hex.EncodeToString(rcon),
		Autostart: req.Autostart, RestartPolicy: req.RestartPolicy,
		StopTimeoutS: 60, Plugins: []instance.InstalledPlugin{}, CreatedAt: time.Now().UTC(),
	}
	inst, err := s.Manager.Create(man)
	if err != nil {
		switch {
		case errors.Is(err, instance.ErrInvalidID):
			writeError(w, 400, "invalid_id", err.Error())
		case errors.Is(err, instance.ErrExists), errors.Is(err, instance.ErrPortInUse):
			writeError(w, 409, "conflict", err.Error())
		default:
			writeError(w, 500, "create_failed", err.Error())
		}
		return
	}
	task := s.runInstall(r.Context(), inst, instance.InstallOptions{AcceptEULA: req.AcceptEULA, Properties: req.Properties})
	writeJSON(w, 202, map[string]any{"instance": summary(inst), "task": task})
}

func (s *server) runInstall(ctx context.Context, inst *instance.Instance, opts instance.InstallOptions) *tasks.Task {
	return s.Tasks.Run(ctx, "install", inst.Manifest.ID, func(ctx context.Context, report tasks.Reporter) error {
		return inst.Install(ctx, s.Catalog, opts, report)
	})
}

// installInstance retries a failed install (e.g. network error during download).
func (s *server) installInstance(w http.ResponseWriter, r *http.Request) {
	inst, err := s.Manager.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return
	}
	if st := inst.State(); st != instance.StateInstalling && st != instance.StateStopped && st != instance.StateCrashed {
		writeError(w, 409, "invalid_state", "instance must be stopped")
		return
	}
	var opts instance.InstallOptions
	_ = json.NewDecoder(r.Body).Decode(&opts)
	writeJSON(w, 202, map[string]any{"task": s.runInstall(r.Context(), inst, opts)})
}

type patchInstanceReq struct {
	Name          *string  `json:"name"`
	MemoryMB      *int     `json:"memoryMb"`
	JVMPreset     *string  `json:"jvmFlagsPreset"`
	JVMFlags      []string `json:"jvmFlags"`
	JavaRuntime   *string  `json:"javaRuntime"`
	JavaPath      *string  `json:"javaPath"`
	Autostart     *bool    `json:"autostart"`
	RestartPolicy *string  `json:"restartPolicy"`
	StopTimeoutS  *int     `json:"stopTimeoutSeconds"`
}

func (s *server) patchInstance(w http.ResponseWriter, r *http.Request) {
	inst, err := s.Manager.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return
	}
	var req patchInstanceReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "bad_json", err.Error())
		return
	}
	m := inst.Manifest
	if req.Name != nil {
		m.Name = *req.Name
	}
	if req.MemoryMB != nil {
		m.MemoryMB = *req.MemoryMB
	}
	if req.JVMPreset != nil {
		m.JVMPreset = *req.JVMPreset
	}
	if req.JVMFlags != nil {
		m.JVMFlags = req.JVMFlags
	}
	if req.JavaRuntime != nil {
		m.JavaRuntime = *req.JavaRuntime
		if m.JavaRuntime == "auto" {
			m.JavaRuntime = ""
		}
	}
	if req.JavaPath != nil {
		m.JavaPath = *req.JavaPath
	}
	if req.Autostart != nil {
		m.Autostart = *req.Autostart
	}
	if req.RestartPolicy != nil {
		m.RestartPolicy = *req.RestartPolicy
	}
	if req.StopTimeoutS != nil {
		m.StopTimeoutS = *req.StopTimeoutS
	}
	if err := inst.SaveManifest(); err != nil {
		writeError(w, 500, "save_failed", err.Error())
		return
	}
	writeJSON(w, 200, summary(inst))
}

func (s *server) deleteInstance(w http.ResponseWriter, r *http.Request) {
	purge := r.URL.Query().Get("purge") == "true"
	if err := s.Manager.Delete(r.Context(), r.PathValue("id"), purge); err != nil {
		if errors.Is(err, instance.ErrNotFound) {
			writeError(w, 404, "instance_not_found", err.Error())
			return
		}
		writeError(w, 500, "delete_failed", err.Error())
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

func (s *server) startInstance(w http.ResponseWriter, r *http.Request) {
	s.instanceAction(w, r, func(i *instance.Instance) error { return i.Start(context.Background()) })
}

func (s *server) stopInstance(w http.ResponseWriter, r *http.Request) {
	s.instanceAction(w, r, func(i *instance.Instance) error {
		go func() { _ = i.Stop(context.Background()) }() // staged stop can take a minute; don't block the request
		return nil
	})
}

func (s *server) restartInstance(w http.ResponseWriter, r *http.Request) {
	s.instanceAction(w, r, func(i *instance.Instance) error {
		go func() { _ = i.Restart(context.Background()) }()
		return nil
	})
}

func (s *server) killInstance(w http.ResponseWriter, r *http.Request) {
	s.instanceAction(w, r, func(i *instance.Instance) error { return i.Kill() })
}

func (s *server) sendCommand(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Command string `json:"command"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Command == "" {
		writeError(w, 400, "bad_request", "command is required")
		return
	}
	s.instanceAction(w, r, func(i *instance.Instance) error { return i.SendCommand(body.Command) })
}

func (s *server) console(w http.ResponseWriter, r *http.Request) {
	inst, err := s.Manager.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return
	}
	n, _ := strconv.Atoi(r.URL.Query().Get("lines"))
	if n <= 0 || n > 2000 {
		n = 500
	}
	writeJSON(w, 200, inst.History(n))
}

func (s *server) instanceMetrics(w http.ResponseWriter, r *http.Request) {
	inst, err := s.Manager.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return
	}
	rng, _ := time.ParseDuration(r.URL.Query().Get("range"))
	if rng <= 0 {
		rng = time.Hour
	}
	writeJSON(w, 200, s.Metrics.History(r.Context(), inst.Manifest.ID, time.Now().Add(-rng)))
}

func (s *server) eula(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Accept bool `json:"accept"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		writeError(w, 400, "bad_json", err.Error())
		return
	}
	s.instanceAction(w, r, func(i *instance.Instance) error { return i.AcceptEULA(body.Accept) })
}

func (s *server) instanceAction(w http.ResponseWriter, r *http.Request, fn func(*instance.Instance) error) {
	inst, err := s.Manager.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return
	}
	if err := fn(inst); err != nil {
		switch {
		case errors.Is(err, instance.ErrAlreadyRunning), errors.Is(err, instance.ErrNotRunning), errors.Is(err, instance.ErrNotInstalled):
			writeError(w, 409, "invalid_state", err.Error())
		default:
			writeError(w, 500, "action_failed", err.Error())
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
