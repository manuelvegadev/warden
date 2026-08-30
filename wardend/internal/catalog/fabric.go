package catalog

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// fabric talks to https://meta.fabricmc.net/v2. A "build" is a Fabric Loader version; the jar is
// the server launcher Fabric assembles for (game, loader, installer). Fabric Meta publishes no
// digests, so downloads are unverified. Fabric servers load mods, not Bukkit plugins.
type fabric struct {
	reg   *Registry
	base  string
	cache *cache
}

func newFabric(r *Registry) *fabric {
	return &fabric{reg: r, base: "https://meta.fabricmc.net/v2/versions", cache: newCache(10 * time.Minute)}
}

func (f *fabric) ID() string     { return "fabric" }
func (f *fabric) Name() string   { return "Fabric" }
func (f *fabric) Traits() Traits { return Traits{} }

type fabricVersion struct {
	Version string `json:"version"`
	Stable  bool   `json:"stable"`
}

func (f *fabric) Versions(ctx context.Context, includePre bool) (VersionList, error) {
	return cached(f.cache, "versions:"+strconv.FormatBool(includePre), func() (VersionList, error) {
		var games []fabricVersion
		if err := f.reg.getJSON(ctx, f.base+"/game", &games); err != nil {
			return VersionList{}, fmt.Errorf("fabric game versions: %w", err)
		}
		out := VersionList{}
		for _, g := range games { // newest first
			if g.Stable || includePre {
				out.Versions = append(out.Versions, g.Version)
			}
			if g.Stable && out.Latest == "" {
				out.Latest = g.Version
			}
		}
		return out, nil
	})
}

// LoaderBuildID turns a loader version like 0.16.14 into a monotonic build number (16014), so newer
// loaders compare greater and the manifest's integer Build keeps working.
func LoaderBuildID(version string) int { return loaderID(version) }

func loaderID(version string) int {
	parts := strings.Split(strings.SplitN(version, "-", 2)[0], ".")
	id := 0
	for i := 0; i < 3; i++ {
		n := 0
		if i < len(parts) {
			n, _ = strconv.Atoi(parts[i])
		}
		id = id*1000 + n
	}
	return id
}

// installer returns the newest stable Fabric installer version (shared by every game version).
func (f *fabric) installer(ctx context.Context) (string, error) {
	return cached(f.cache, "installer", func() (string, error) {
		var installers []fabricVersion
		if err := f.reg.getJSON(ctx, f.base+"/installer", &installers); err != nil {
			return "", fmt.Errorf("fabric installers: %w", err)
		}
		for _, i := range installers {
			if i.Stable {
				return i.Version, nil
			}
		}
		return "", fmt.Errorf("fabric: no stable installer")
	})
}

// maxFabricLoaders bounds the list; Fabric keeps every loader ever released (250+).
const maxFabricLoaders = 30

func (f *fabric) Builds(ctx context.Context, mc string) ([]Build, error) {
	return cached(f.cache, "builds:"+mc, func() ([]Build, error) {
		installer, err := f.installer(ctx)
		if err != nil {
			return nil, err
		}
		var loaders []struct {
			Loader fabricVersion `json:"loader"`
		}
		if err := f.reg.getJSON(ctx, f.base+"/loader/"+mc, &loaders); err != nil {
			return nil, fmt.Errorf("fabric loaders: %w", err)
		}
		if len(loaders) > maxFabricLoaders {
			loaders = loaders[:maxFabricLoaders]
		}
		out := make([]Build, 0, len(loaders))
		for _, l := range loaders { // newest first
			ch := "BETA"
			if l.Loader.Stable {
				ch = "STABLE"
			}
			out = append(out, Build{ID: loaderID(l.Loader.Version), Channel: ch,
				Name:    fmt.Sprintf("fabric-server-mc.%s-loader.%s-launcher.%s.jar", mc, l.Loader.Version, installer),
				URL:     fmt.Sprintf("%s/loader/%s/%s/%s/server/jar", f.base, mc, l.Loader.Version, installer),
				Changes: []string{"Fabric Loader " + l.Loader.Version}})
		}
		return out, nil
	})
}
