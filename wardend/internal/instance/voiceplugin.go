package instance

import (
	"context"
	"errors"
	"strings"
	"time"

	"github.com/manuelvega/warden/wardend/internal/catalog"
)

// Beacon's calls speak Simple Voice Chat's protocol, and the Warden Agent is an addon to it
// (ADR-019): without that plugin on the server there is no voice at all. So wardend installs it
// itself, from the same catalog the Plugins tab uses, the first time a server that can load
// plugins starts. Afterwards it is an ordinary catalog install: the tab shows it, offers its
// updates and can remove it, and a removal is remembered so it does not come back.
const (
	voicePluginSource  = "modrinth"
	voicePluginProject = "simple-voice-chat"
	// The name the plugin registers under, so a jar an admin dropped in by hand counts as installed.
	voicePluginName = "voicechat"
	// How long a start waits for the download before going on without voice.
	voicePluginTimeout = 45 * time.Second
)

// VoicePluginProject is the catalog project wardend installs for voice, for the API to name it.
const VoicePluginProject = voicePluginProject

// hasVoicePlugin reports whether Simple Voice Chat is already on the server, whether wardend
// installed it or somebody else did: by the catalog record, or by the name inside the jars.
func (i *Instance) hasVoicePlugin() bool {
	i.mu.RLock()
	for _, p := range i.Manifest.Plugins {
		if p.ProjectID == voicePluginProject {
			i.mu.RUnlock()
			return true
		}
	}
	i.mu.RUnlock()
	files, err := i.Plugins()
	if err != nil {
		return true // cannot tell: leave plugins/ alone rather than install a second copy
	}
	for _, f := range files {
		if f.Meta != nil && strings.EqualFold(f.Meta.Name, voicePluginName) {
			return true
		}
	}
	return false
}

// wantsVoicePlugin: a server that loads plugins, with a catalog to fetch from, without the plugin
// already, and whose admin has not taken it out.
func (i *Instance) wantsVoicePlugin() bool {
	i.mu.RLock()
	off := i.Manifest.Voice != nil && i.Manifest.Voice.NoAutoInstall
	i.mu.RUnlock()
	if off || i.reg == nil || !i.loadsPlugins() {
		return false
	}
	return !i.hasVoicePlugin()
}

// ensureVoicePlugin installs Simple Voice Chat when the instance wants it, and returns a console
// line to show. A failure is never fatal: the server starts, without voice, and the Plugins tab is
// there to do it by hand.
func (i *Instance) ensureVoicePlugin(ctx context.Context) string {
	if !i.wantsVoicePlugin() {
		return ""
	}
	i.system("Voice chat: installing Simple Voice Chat, which Beacon's calls need on the server")
	ctx, cancel := context.WithTimeout(ctx, voicePluginTimeout)
	defer cancel()
	v, exact, err := i.voicePluginVersion(ctx)
	if err == nil {
		hit := catalog.PluginHit{Source: voicePluginSource, ID: voicePluginProject, Name: "Simple Voice Chat"}
		err = i.installPluginVersion(ctx, i.reg, voicePluginSource, hit, v, []string{voicePluginProject}, "", nil,
			func(int, string) {})
	}
	if err != nil {
		return "Voice chat: Simple Voice Chat could not be installed (" + firstLine(err.Error()) +
			"); install it from the Plugins tab to enable calls"
	}
	if !exact {
		return "Voice chat: Simple Voice Chat " + v.Name + " installed — the catalog lists no build for Minecraft " +
			i.Manifest.MCVersion + ", so this is its newest release"
	}
	return "Voice chat: Simple Voice Chat " + v.Name + " installed"
}

// voicePluginVersion picks the release to install: the newest one the catalog lists for this
// server's Minecraft version, or, when it lists none, the newest release there is. The plugin's
// Bukkit build is one jar for every version it supports, and a version the catalog has not caught
// up with is the ordinary case on a server that runs a fresh Minecraft.
func (i *Instance) voicePluginVersion(ctx context.Context) (v catalog.PluginVersion, exact bool, err error) {
	src, err := i.reg.PluginSource(voicePluginSource)
	if err != nil {
		return v, false, err
	}
	versions, err := src.Versions(ctx, voicePluginProject, i.Manifest.MCVersion)
	if err != nil {
		return v, false, err
	}
	if v, ok := catalog.FindVersion(versions, ""); ok {
		return v, true, nil
	}
	if versions, err = src.Versions(ctx, voicePluginProject, ""); err != nil {
		return v, false, err
	}
	v, ok := catalog.FindVersion(versions, "")
	if !ok {
		return v, false, errors.New("the catalog lists no release of Simple Voice Chat")
	}
	return v, false, nil
}

// forgetVoicePlugin remembers that the admin removed Simple Voice Chat, so the next start does not
// put it back. Installing it again from the Plugins tab clears the mark.
func (i *Instance) forgetVoicePlugin(removed bool) error {
	i.mu.Lock()
	if i.Manifest.Voice == nil {
		i.Manifest.Voice = &VoiceSettings{}
	}
	if i.Manifest.Voice.NoAutoInstall == removed {
		i.mu.Unlock()
		return nil
	}
	i.Manifest.Voice.NoAutoInstall = removed
	err := i.Manifest.save(i.Dir)
	i.mu.Unlock()
	return err
}

// isVoicePlugin reports whether a plugin file is Simple Voice Chat, by its catalog record or its
// descriptor: what the admin removed or installed by hand.
func (i *Instance) isVoicePlugin(fileName string) bool {
	i.mu.RLock()
	for _, p := range i.Manifest.Plugins {
		if p.FileName == fileName {
			match := p.ProjectID == voicePluginProject
			i.mu.RUnlock()
			return match
		}
	}
	i.mu.RUnlock()
	files, err := i.Plugins()
	if err != nil {
		return false
	}
	for _, f := range files {
		if f.FileName == fileName {
			return f.Meta != nil && strings.EqualFold(f.Meta.Name, voicePluginName)
		}
	}
	return false
}

// firstLine keeps a console line to one line.
func firstLine(msg string) string { return strings.TrimSpace(strings.SplitN(msg, "\n", 2)[0]) }
