package catalog

import (
	"context"
	"fmt"
	"time"
)

// vanilla serves Mojang's own server jar from the piston-meta version manifest. There is one
// build per version (ID 1); snapshots count as pre-releases.
type vanilla struct {
	reg   *Registry
	base  string
	cache *cache
}

func newVanilla(r *Registry) *vanilla {
	return &vanilla{reg: r, base: "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json", cache: newCache(10 * time.Minute)}
}

func (v *vanilla) ID() string     { return "vanilla" }
func (v *vanilla) Name() string   { return "Vanilla" }
func (v *vanilla) Traits() Traits { return Traits{SingleBuild: true} }

type pistonManifest struct {
	Latest struct {
		Release string `json:"release"`
	} `json:"latest"`
	Versions []struct {
		ID   string `json:"id"`
		Type string `json:"type"` // release, snapshot, old_beta, old_alpha
		URL  string `json:"url"`
	} `json:"versions"`
}

func (v *vanilla) manifest(ctx context.Context) (pistonManifest, error) {
	return cached(v.cache, "manifest", func() (m pistonManifest, err error) {
		if err = v.reg.getJSON(ctx, v.base, &m); err != nil {
			err = fmt.Errorf("mojang manifest: %w", err)
		}
		return
	})
}

func (v *vanilla) Versions(ctx context.Context, includePre bool) (VersionList, error) {
	m, err := v.manifest(ctx)
	if err != nil {
		return VersionList{}, err
	}
	out := VersionList{Latest: m.Latest.Release}
	for _, x := range m.Versions { // manifest is newest first
		if x.Type == "release" || (includePre && x.Type == "snapshot") {
			out.Versions = append(out.Versions, x.ID)
		}
	}
	return out, nil
}

func (v *vanilla) Builds(ctx context.Context, mc string) ([]Build, error) {
	return cached(v.cache, "builds:"+mc, func() ([]Build, error) {
		m, err := v.manifest(ctx)
		if err != nil {
			return nil, err
		}
		var url string
		for _, x := range m.Versions {
			if x.ID == mc {
				url = x.URL
				break
			}
		}
		if url == "" {
			return nil, fmt.Errorf("vanilla: unknown version %s", mc)
		}
		var meta struct {
			ReleaseTime time.Time `json:"releaseTime"`
			Downloads   struct {
				Server struct {
					SHA1 string `json:"sha1"`
					Size int64  `json:"size"`
					URL  string `json:"url"`
				} `json:"server"`
			} `json:"downloads"`
		}
		if err := v.reg.getJSON(ctx, url, &meta); err != nil {
			return nil, fmt.Errorf("mojang version %s: %w", mc, err)
		}
		if meta.Downloads.Server.URL == "" {
			return nil, fmt.Errorf("vanilla: no server jar for %s", mc)
		}
		return []Build{{ID: 1, Channel: "STABLE", Time: meta.ReleaseTime, Name: "minecraft_server." + mc + ".jar",
			Size: meta.Downloads.Server.Size, Hash: Checksum{Algo: "sha1", Value: meta.Downloads.Server.SHA1},
			URL: meta.Downloads.Server.URL}}, nil
	})
}
