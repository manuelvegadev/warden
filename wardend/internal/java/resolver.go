package java

import (
	"context"
	"fmt"

	"github.com/manuelvega/warden/wardend/internal/instance"
)

// ResolveJava implements instance.JavaResolver.
func (m *Manager) ResolveJava(ctx context.Context, man *instance.Manifest, install bool, report func(int, string)) (string, error) {
	if report == nil {
		report = func(int, string) {}
	}
	need := RequiredMajor(man.MCVersion)
	if man.JavaRuntime != "" {
		r, err := m.Get(man.JavaRuntime)
		if err != nil {
			return "", fmt.Errorf("%w: %s", err, man.JavaRuntime)
		}
		if r.Major < need {
			return "", fmt.Errorf("runtime %s is Java %d but Minecraft %s requires Java %d or newer", r.ID, r.Major, man.MCVersion, need)
		}
		return r.Path, nil
	}
	if r := m.Best(need); r != nil {
		return r.Path, nil
	}
	if !install {
		return "", fmt.Errorf("no Java %d+ runtime installed for Minecraft %s; install one from Settings → Java", need, man.MCVersion)
	}
	r, err := m.Install(ctx, need, report)
	if err != nil {
		return "", err
	}
	man.JavaRuntime = r.ID
	return r.Path, nil
}
