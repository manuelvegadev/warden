package instance

import (
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"os"
	"path/filepath"
	"strings"

	"github.com/manuelvega/warden/wardend/internal/agent"
	"github.com/manuelvega/warden/wardend/internal/catalog"
)

// LiveView is the per-instance state of the live world view (ADR-018). The agent is part of the
// product: it is installed on every server that can load it, so there is no switch here.
type LiveView struct {
	// AgentToken authenticates the agent plugin on wardend's agent listener. Generated once.
	AgentToken string `json:"agentToken,omitempty"`
}

// VoiceSettings is the instance's voice chat configuration (ADR-019): how players learn that
// somebody in Beacon listens or speaks. `notify` tells them in-game; `ask` asks each player once.
type VoiceSettings struct {
	Policy string `json:"policy"`
	// NoAutoInstall: the admin removed Simple Voice Chat, so wardend does not install it again
	// (voiceplugin.go). Installing it from the Plugins tab clears this.
	NoAutoInstall bool `json:"noAutoInstall,omitempty"`
}

// Voice policies the agent understands.
const (
	VoicePolicyNotify = "notify"
	VoicePolicyAsk    = "ask"
)

// Valid reports whether the policy is one the agent understands.
func (v *VoiceSettings) Valid() bool {
	return v != nil && (v.Policy == VoicePolicyNotify || v.Policy == VoicePolicyAsk)
}

// VoicePolicy is the configured consent policy, `notify` when never set. It reaches the agent
// through config.yml, rewritten before every start.
func (i *Instance) VoicePolicy() string {
	i.mu.RLock()
	defer i.mu.RUnlock()
	if i.Manifest.Voice == nil || i.Manifest.Voice.Policy == "" {
		return VoicePolicyNotify
	}
	return i.Manifest.Voice.Policy
}

// agentDeps is what an instance needs to install the agent: where it should connect, the jar, and
// which software can load it.
type agentDeps struct {
	url    string
	jar    func() (data []byte, version string, err error)
	traits func(software string) catalog.Traits
}

const agentSource = "warden"

// SetAgent wires the agent listener URL, the embedded jar and the software traits (main), and
// brings every loaded instance's plugins/ up to date, so an existing server gets the agent too.
func (m *Manager) SetAgent(url string, jar func() ([]byte, string, error), traits func(string) catalog.Traits) {
	m.mu.Lock()
	m.agent = &agentDeps{url: url, jar: jar, traits: traits}
	all := make([]*Instance, 0, len(m.byID))
	for _, i := range m.byID {
		i.agent = m.agent
		all = append(all, i)
	}
	m.mu.Unlock()
	for _, i := range all {
		if err := i.ensureAgent(); err != nil {
			slog.Warn("live view agent", "id", i.Manifest.ID, "err", err)
		}
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
		if lv == nil || lv.AgentToken == "" || !inst.LiveViewSupported() {
			continue
		}
		if subtle.ConstantTimeCompare([]byte(lv.AgentToken), []byte(token)) == 1 {
			return id, true
		}
	}
	return "", false
}

// LiveViewSupported: the agent is a Bukkit plugin, so the software must load those (catalog traits).
func (i *Instance) LiveViewSupported() bool { return i.loadsPlugins() }

// loadsPlugins reports whether this instance's software loads Bukkit plugins, by the catalog's traits.
func (i *Instance) loadsPlugins() bool {
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

// ensureAgent installs the agent (jar and config) on a server that can load it, minting the token
// the first time. On software without plugins it does nothing.
func (i *Instance) ensureAgent() error {
	if !i.LiveViewSupported() {
		return nil
	}
	i.mu.Lock()
	if i.Manifest.LiveView == nil {
		i.Manifest.LiveView = &LiveView{}
	}
	var err error
	if i.Manifest.LiveView.AgentToken == "" {
		i.Manifest.LiveView.AgentToken = newToken()
		err = i.Manifest.save(i.Dir)
	}
	i.mu.Unlock()
	if err != nil {
		return err
	}
	return i.installAgent()
}

// refreshAgent keeps plugins/ in step before a start: the embedded jar when the installed one
// differs, and config.yml always (the daemon's agent URL can change). Returns a console line to
// show, or "".
func (i *Instance) refreshAgent() string {
	if err := i.ensureAgent(); err != nil {
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

// writeAgentConfig writes the managed keys of plugins/WardenAgent/config.yml (the URL, the token
// and the voice consent policy) and keeps every other line: the tuning keys and their defaults
// belong to the plugin.
func (i *Instance) writeAgentConfig(url string) error {
	lv := i.LiveView()
	policy := i.VoicePolicy()
	dir := filepath.Join(i.pluginsDir(), "WardenAgent")
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return err
	}
	path := filepath.Join(dir, "config.yml")
	existing, _ := os.ReadFile(path)
	var b strings.Builder
	b.WriteString("# url, token and voice-consent are written by wardend before every start (ADR-018, ADR-019); the other keys are yours.\n")
	fmt.Fprintf(&b, "url: %s\n", url)
	fmt.Fprintf(&b, "token: %q\n", lv.AgentToken)
	fmt.Fprintf(&b, "voice-consent: %s\n", policy)
	for _, line := range strings.Split(string(existing), "\n") {
		t := strings.TrimSpace(line)
		if t == "" || strings.HasPrefix(t, "#") || strings.HasPrefix(t, "url:") || strings.HasPrefix(t, "token:") || strings.HasPrefix(t, "voice-consent:") {
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
