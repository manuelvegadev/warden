package api

import (
	"encoding/json"
	"errors"
	"net/http"
	"time"

	"github.com/manuelvega/warden/wardend/internal/instance"
)

type instanceSummary struct {
	ID        string         `json:"id"`
	Name      string         `json:"name"`
	Software  string         `json:"software"`
	MCVersion string         `json:"mcVersion"`
	Build     int            `json:"build"`
	State     instance.State `json:"state"`
	Port      int            `json:"port"`
	Autostart bool           `json:"autostart"`
}

func summary(i *instance.Instance) instanceSummary {
	m := i.Manifest
	return instanceSummary{ID: m.ID, Name: m.Name, Software: m.Software, MCVersion: m.MCVersion,
		Build: m.Build, State: i.State(), Port: m.Port, Autostart: m.Autostart}
}

func (s *server) listInstances(w http.ResponseWriter, _ *http.Request) {
	list := s.mgr.List()
	out := make([]instanceSummary, 0, len(list))
	for _, i := range list {
		out = append(out, summary(i))
	}
	writeJSON(w, 200, out)
}

func (s *server) getInstance(w http.ResponseWriter, r *http.Request) {
	inst, err := s.mgr.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return
	}
	writeJSON(w, 200, map[string]any{"manifest": inst.Manifest, "state": inst.State()})
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
	JavaPath      string            `json:"javaPath"`
	Port          int               `json:"port"`
	Autostart     bool              `json:"autostart"`
	RestartPolicy string            `json:"restartPolicy"`
	AcceptEula    bool              `json:"acceptEula"`
	Properties    map[string]string `json:"properties"`
}

func (s *server) createInstance(w http.ResponseWriter, r *http.Request) {
	var req createInstanceReq
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, 400, "bad_json", err.Error())
		return
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
	man := &instance.Manifest{
		ID: req.ID, Name: req.Name, Software: req.Software, MCVersion: req.MCVersion, Build: req.Build,
		MemoryMB: req.MemoryMB, JVMPreset: req.JVMPreset, JVMFlags: req.JVMFlags, JavaPath: req.JavaPath,
		Port: req.Port, RconPort: req.Port + 10, Autostart: req.Autostart, RestartPolicy: req.RestartPolicy,
		StopTimeoutS: 60, Plugins: []instance.InstalledPlugin{}, CreatedAt: time.Now().UTC(),
	}
	// TODO: generar RconPassword aleatoria, validar puertos libres, resolver build "latest" vía catalog.
	inst, err := s.mgr.Create(man)
	if err != nil {
		if errors.Is(err, instance.ErrInvalidID) {
			writeError(w, 400, "invalid_id", err.Error())
			return
		}
		writeError(w, 409, "create_failed", err.Error())
		return
	}
	// TODO: lanzar tarea de instalación (descarga jar Fill v3 + eula + server.properties) y devolver 202 {task}.
	writeJSON(w, 201, summary(inst))
}

func (s *server) startInstance(w http.ResponseWriter, r *http.Request) {
	s.instanceAction(w, r, func(i *instance.Instance) error { return i.Start(r.Context()) })
}

func (s *server) stopInstance(w http.ResponseWriter, r *http.Request) {
	s.instanceAction(w, r, func(i *instance.Instance) error { return i.Stop(r.Context()) })
}

func (s *server) sendCommand(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Command string `json:"command"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil || body.Command == "" {
		writeError(w, 400, "bad_request", "command requerido")
		return
	}
	s.instanceAction(w, r, func(i *instance.Instance) error { return i.SendCommand(body.Command) })
}

func (s *server) instanceAction(w http.ResponseWriter, r *http.Request, fn func(*instance.Instance) error) {
	inst, err := s.mgr.Get(r.PathValue("id"))
	if err != nil {
		writeError(w, 404, "instance_not_found", err.Error())
		return
	}
	if err := fn(inst); err != nil {
		switch {
		case errors.Is(err, instance.ErrAlreadyRunning), errors.Is(err, instance.ErrNotRunning):
			writeError(w, 409, "invalid_state", err.Error())
		default:
			writeError(w, 500, "action_failed", err.Error())
		}
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
