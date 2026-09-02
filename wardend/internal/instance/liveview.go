package instance

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"

	"github.com/manuelvega/warden/wardend/internal/agent"
	"github.com/manuelvega/warden/wardend/internal/catalog"
)

// LiveView is the per-instance state of the live world view (ADR-018).
type LiveView struct {
	Enabled bool `json:"enabled"`
	// AgentToken authenticates the agent plugin on wardend's agent listener. Generated once.
	AgentToken string `json:"agentToken,omitempty"`
}

// agentDeps is what an instance needs to install the agent: where it should connect, the jar, and
// which software can load it.
type agentDeps struct {
	url    string
	jar    func() (data []byte, version string, err error)
	traits func(software string) catalog.Traits
}

// ErrLiveViewUnsupported: the software cannot load Bukkit plugins.
var ErrLiveViewUnsupported = errors.New("the live view needs a Paper or Purpur server")

const agentSource = "warden"

// SetAgent wires the agent listener URL, the embedded jar and the software traits (main).
func (m *Manager) SetAgent(url string, jar func() ([]byte, string, error), traits func(string) catalog.Traits) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.agent = &agentDeps{url: url, jar: jar, traits: traits}
	for _, i := range m.byID {
		i.agent = m.agent
	}
}

// InstanceByAgentToken implements world.Tokens: the instance whose live view owns the token.
func (m *Manager) InstanceByAgentToken(token string) (string, bool) {
	if token == "" {
		return "", false
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	for id, inst := range m.byID {
		inst.mu.RLock()
		lv := inst.Manifest.LiveView
		inst.mu.RUnlock()
		if lv == nil || !lv.Enabled || lv.AgentToken == "" {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(lv.AgentToken), []byte(token)) == 1 {
			return id, true
		}
	}
	return "", false
}

// LiveViewSupported: the agent is a Bukkit plugin, so the software must load those (catalog traits).
func (i *Instance) LiveViewSupported() bool {
	return i.agent != nil && i.agent.traits(i.Manifest.Software).Plugins
}

// LiveView returns the manifest state (never nil).
func (i *Instance) LiveView() LiveView {
	i.mu.RLock()
	defer i.mu.RUnlock()
	if i.Manifest.LiveView == nil {
		return LiveView{}
	}
	return *i.Manifest.LiveView
}

// SetLiveView enables (installing the agent jar and its config) or disables (removing the jar) the
// live view. The change takes effect on the next server start.
func (i *Instance) SetLiveView(enabled bool) error {
	if enabled && !i.LiveViewSupported() {
		return ErrLiveViewUnsupported
	}
	i.mu.Lock()
	if i.Manifest.LiveView == nil {
		i.Manifest.LiveView = &LiveView{}
	}
	lv := i.Manifest.LiveView
	lv.Enabled = enabled
	if enabled && lv.AgentToken == "" {
		lv.AgentToken = newToken()
	}
	err := i.Manifest.save(i.Dir)
	i.mu.Unlock()
	if err != nil {
		return err
	}
	if enabled {
		return i.installAgent()
	}
	if err := i.RemovePlugin(agent.FileName); err != nil && !errors.Is(err, ErrPluginNotFound) {
		return err
	}
	return nil
}

// refreshAgent keeps plugins/ in step with the manifest before a start: the embedded jar when the
// installed one is older, and config.yml always (the daemon's agent URL can change). Returns a
// console line to show, or "".
func (i *Instance) refreshAgent() string {
	lv := i.LiveView()
	if !lv.Enabled {
		return ""
	}
	if err := i.installAgent(); err != nil {
		return "Live view: " + err.Error()
	}
	return ""
}

// installAgent places the embedded jar (whenever the installed one differs by content: a rebuilt
// jar with the same version number counts) and writes the plugin config.
func (i *Instance) installAgent() error {
	deps := i.agent
	if deps == nil {
		return errors.New("agent not configured on this daemon")
	}
	data, version, err := deps.jar()
	if err != nil {
		return err
	}
	sum := sha256.Sum256(data)
	hash := hex.EncodeToString(sum[:])
	_, enabled, err := i.pluginPath(agent.FileName)
	if rec, ok := i.InstalledPlugin(agent.FileName); !ok || rec.Hash != hash || err != nil || !enabled {
		staged, err := i.stage(".agent-*")
		if err != nil {
			return err
		}
		defer os.Remove(staged)
		if err := os.WriteFile(staged, data, 0o640); err != nil {
			return err
		}
		rec := InstalledPlugin{Source: agentSource, ProjectID: "warden-agent", Name: "Warden Agent", Version: version,
			HashAlgo: "sha256", Hash: hash}
		if _, err := i.placePlugin(staged, agent.FileName, rec, nil); err != nil {
			return err
		}
	}
	return i.writeAgentConfig(deps.url)
}

// writeAgentConfig writes the two managed keys of plugins/WardenAgent/config.yml (the URL and the
// token) and keeps every other line: the tuning keys and their defaults belong to the plugin.
func (i *Instance) writeAgentConfig(url string) error {
	lv := i.LiveView()
	dir := filepath.Join(i.pluginsDir(), "WardenAgent")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return err
	}
	path := filepath.Join(dir, "config.yml")
	existing, _ := os.ReadFile(path)
	var b strings.Builder
	b.WriteString("# url and token are written by wardend before every start (ADR-018); the other keys are yours.\n")
	fmt.Fprintf(&b, "url: %s\n", url)
	fmt.Fprintf(&b, "token: %q\n", lv.AgentToken)
	for _, line := range strings.Split(string(existing), "\n") {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "#") || strings.HasPrefix(t, "url:") || strings.HasPrefix(t, "token:") {
			continue
		}
		b.WriteString(line)
		b.WriteByte('\n')
	}
	tmp := path + ".tmp"
	if err := os.WriteFile(tmp, []byte(b.String()), 0o640); err != nil {
		return err
	}
	return os.Rename(tmp, path)
}

func newToken() string {
	b := make([]byte, 24)
	if _, err := rand.Read(b); err != nil {
		panic(err) // the OS entropy source is gone; nothing sensible to do
	}
	return hex.EncodeToString(b)
}
