package api

import (
	"context"
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"strconv"
	"time"

	"github.com/manuelvega/warden/wardend/internal/auth"
	"github.com/manuelvega/warden/wardend/internal/backup"
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

// listInstances answers with the instances the caller has a grant on (ADR-017 §4); the rest are
// invisible rather than forbidden.
func (s *server) listInstances(w http.ResponseWriter, r *http.Request) {
	p, _ := auth.FromContext(r.Context())
	list := s.Manager.List()
	out := make([]instanceSummary, 0, len(list))
	for _, i := range list {
		if p == nil || !p.CanSee(i.Manifest.ID) {
			continue
		}
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

// applyDefaults fills what create and import share when the client leaves it out.
func (r *createInstanceReq) applyDefaults() {
	if r.Name == "" {
		r.Name = r.ID
	}
	if r.MemoryMB == 0 {
		r.MemoryMB = 2048
	}
	if r.Port == 0 {
		r.Port = 25565
	}
	if r.JVMPreset == "" {
		r.JVMPreset = "aikar"
	}
	if r.RestartPolicy == "" {
		r.RestartPolicy = "on-crash"
	}
	if r.JavaRuntime == "auto" {
		r.JavaRuntime = ""
	}
}

// newManifest is the manifest for a fresh instance: a random RCON password, RCON on port+10.
func newManifest(req createInstanceReq) *instance.Manifest {
	rcon := make([]byte, 16)
	_, _ = rand.Read(rcon)
	return &instance.Manifest{
		ID: req.ID, Name: req.Name, Software: req.Software, MCVersion: req.MCVersion, Build: req.Build,
		MemoryMB: req.MemoryMB, JVMPreset: req.JVMPreset, JVMFlags: req.JVMFlags, JavaRuntime: req.JavaRuntime, JavaPath: req.JavaPath,
		Port: req.Port, RconPort: req.Port + 10, RconPassword: hex.EncodeToString(rcon),
		Autostart: req.Autostart, RestartPolicy: req.RestartPolicy,
		StopTimeoutS: 60, Plugins: []instance.InstalledPlugin{}, CreatedAt: time.Now().UTC(),
	}
}

func createErrStatus(err error) int {
	switch {
	case errors.Is(err, instance.ErrInvalidID):
		return 400
	case errors.Is(err, instance.ErrExists), errors.Is(err, instance.ErrPortInUse):
		return 409
	}
	return 500
}

func createErrCode(err error) string {
	switch {
	case errors.Is(err, instance.ErrInvalidID):
		return "invalid_id"
	case errors.Is(err, instance.ErrExists), errors.Is(err, instance.ErrPortInUse):
		return "conflict"
	}
	return "create_failed"
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
	if req.Software == "" {
		req.Software = "paper"
	}
	if _, err := s.Catalog.Provider(req.Software); err != nil {
		writeError(w, 400, "unknown_provider", err.Error())
		return
	}
	req.applyDefaults()
	inst, err := s.Manager.Create(newManifest(req))
	if err != nil {
		writeError(w, createErrStatus(err), createErrCode(err), err.Error())
		return
	}
	task := s.runInstall(r.Context(), inst, instance.InstallOptions{AcceptEULA: req.AcceptEULA, Properties: req.Properties})
	writeJSON(w, 202, map[string]any{"instance": summary(inst), "task": task})
}

// importInstance creates an instance from an uploaded server directory (multipart/form-data: the
// text fields first, then exactly one "file" — a .zip, .tar, .tar.gz or .tar.zst). The archive
// streams to disk under <data>/imports and an "import" task unpacks it. Responds like createInstance.
func (s *server) importInstance(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, instance.MaxImportBytes)
	mr, err := r.MultipartReader()
	if err != nil {
		writeError(w, 400, "bad_request", "multipart/form-data expected: "+err.Error())
		return
	}
	fields := map[string]string{}
	var inst *instance.Instance
	var opts instance.ImportOptions
	fail := func(status int, code, msg string) {
		if inst != nil {
			_ = s.Manager.Delete(r.Context(), inst.Manifest.ID, true)
		}
		if opts.Archive != "" {
			os.Remove(opts.Archive)
		}
		writeError(w, status, code, msg)
	}
	for {
		part, err := mr.NextPart()
		if err == io.EOF {
			break
		}
		if err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				fail(413, "too_large", fmt.Sprintf("upload exceeds %d GB", instance.MaxImportBytes>>30))
				return
			}
			fail(400, "bad_request", err.Error())
			return
		}
		if inst != nil {
			// Everything the instance needs must come before the archive: a second file or a
			// trailing field would be ignored (or worse, act on the wrong instance).
			fail(400, "bad_request", "\"file\" must be the last part of the form")
			return
		}
		if part.FormName() != "file" {
			b, err := io.ReadAll(io.LimitReader(part, 4096))
			if err != nil {
				fail(400, "bad_request", err.Error())
				return
			}
			fields[part.FormName()] = string(b)
			continue
		}
		format, err := backup.DetectFormat(part.FileName())
		if err != nil {
			fail(400, "bad_request", err.Error())
			return
		}
		req, err := importFields(fields)
		if err != nil {
			fail(400, "bad_request", err.Error())
			return
		}
		opts = instance.ImportOptions{
			Format: format, AcceptEULA: req.AcceptEULA,
			Software: req.Software, MCVersion: req.MCVersion, Build: req.Build,
		}
		if opts.Software != "" {
			if _, err := s.Catalog.Provider(opts.Software); err != nil {
				fail(400, "unknown_provider", err.Error())
				return
			}
			if opts.MCVersion == "" {
				fail(400, "bad_request", "mcVersion is required with software")
				return
			}
		}
		// Software and version are filled in by the task once it has looked at the archive.
		req.Software, req.MCVersion, req.Build = "", "", 0
		if inst, err = s.Manager.Create(newManifest(req)); err != nil {
			fail(createErrStatus(err), createErrCode(err), err.Error())
			return
		}
		if err := os.MkdirAll(s.Config.ImportsDir(), 0o750); err != nil {
			fail(500, "import_failed", err.Error())
			return
		}
		f, err := os.CreateTemp(s.Config.ImportsDir(), inst.Manifest.ID+"-*."+string(format))
		if err != nil {
			fail(500, "import_failed", err.Error())
			return
		}
		opts.Archive = f.Name()
		_, err = io.Copy(f, part)
		f.Close()
		if err != nil {
			var tooBig *http.MaxBytesError
			if errors.As(err, &tooBig) {
				fail(413, "too_large", fmt.Sprintf("upload exceeds %d GB", instance.MaxImportBytes>>30))
				return
			}
			fail(400, "upload_failed", err.Error())
			return
		}
	}
	if inst == nil {
		fail(400, "bad_request", "multipart field \"file\" is required")
		return
	}
	task := s.Tasks.Run(r.Context(), "import", inst.Manifest.ID, func(ctx context.Context, report tasks.Reporter) error {
		return inst.Import(ctx, s.Catalog, opts, report)
	})
	writeJSON(w, 202, map[string]any{"instance": summary(inst), "task": task})
}

// importFields turns the multipart text fields into a create request; numbers must parse.
func importFields(fields map[string]string) (createInstanceReq, error) {
	req := createInstanceReq{
		ID: fields["id"], Name: fields["name"], JVMPreset: fields["jvmFlagsPreset"], JavaRuntime: fields["javaRuntime"],
		RestartPolicy: fields["restartPolicy"], Software: fields["software"], MCVersion: fields["mcVersion"],
		Autostart: fields["autostart"] == "true", AcceptEULA: fields["acceptEula"] == "true",
	}
	for _, f := range []struct {
		key string
		dst *int
	}{{"memoryMb", &req.MemoryMB}, {"port", &req.Port}, {"build", &req.Build}} {
		if v := fields[f.key]; v != "" {
			n, err := strconv.Atoi(v)
			if err != nil {
				return req, fmt.Errorf("%s: not a number", f.key)
			}
			*f.dst = n
		}
	}
	req.applyDefaults()
	return req, nil
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
		writeError(w, 409, "invalid_state", instance.ErrMustBeStopped.Error())
		return
	}
	if s.Tasks.Active(inst.Manifest.ID) {
		writeError(w, 409, "task_running", "another task is still running for this instance")
		return
	}
	if inst.Manifest.Software == "" || inst.Manifest.MCVersion == "" {
		writeError(w, 409, "invalid_state", "nothing to install: the import did not identify the server; delete it and import again")
		return
	}
	var opts instance.InstallOptions
	_ = json.NewDecoder(r.Body).Decode(&opts)
	writeJSON(w, 202, map[string]any{"task": s.runInstall(r.Context(), inst, opts)})
}

type patchInstanceReq struct {
	Name          *string                  `json:"name"`
	MemoryMB      *int                     `json:"memoryMb"`
	JVMPreset     *string                  `json:"jvmFlagsPreset"`
	JVMFlags      []string                 `json:"jvmFlags"`
	JavaRuntime   *string                  `json:"javaRuntime"`
	JavaPath      *string                  `json:"javaPath"`
	Autostart     *bool                    `json:"autostart"`
	RestartPolicy *string                  `json:"restartPolicy"`
	StopTimeoutS  *int                     `json:"stopTimeoutSeconds"`
	Backups       *instance.BackupSettings `json:"backups"`
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
	if req.Backups != nil {
		req.Backups.Normalize()
		m.Backups = *req.Backups
	}
	if err := inst.SaveManifest(); err != nil {
		writeError(w, 500, "save_failed", err.Error())
		return
	}
	writeJSON(w, 200, summary(inst))
}

func (s *server) deleteInstance(w http.ResponseWriter, r *http.Request) {
	purge := r.URL.Query().Get("purge") == "true"
	// A running import/install would recreate the directory after it is removed.
	s.Tasks.CancelInstance(r.PathValue("id"))
	if err := s.Manager.Delete(r.Context(), r.PathValue("id"), purge); err != nil {
		if errors.Is(err, instance.ErrNotFound) {
			writeError(w, 404, "instance_not_found", err.Error())
			return
		}
		writeError(w, 500, "delete_failed", err.Error())
		return
	}
	// The live-view cache and its agent connection go with the instance (ADR-018).
	if s.World != nil {
		s.World.Forget(r.PathValue("id"))
	}
	if s.Store != nil {
		_ = s.Store.DeleteChunks(r.Context(), r.PathValue("id"))
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
		case errors.Is(err, instance.ErrAlreadyRunning), errors.Is(err, instance.ErrNotRunning), errors.Is(err, instance.ErrNotInstalled), errors.Is(err, instance.ErrMustBeStopped):
			writeError(w, 409, "invalid_state", err.Error())
		case errors.Is(err, instance.ErrBadName), errors.Is(err, instance.ErrBadIP):
			writeError(w, 400, "bad_request", err.Error())
		default:
			writeError(w, 500, "action_failed", err.Error())
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// launchCommand shows the exact command Start runs for this instance.
func (s *server) launchCommand(w http.ResponseWriter, r *http.Request) {
	s.instanceJSON(w, r, func(i *instance.Instance) (any, error) { return i.LaunchCommand(), nil })
}
