package catalog

import (
	"context"
	"fmt"
	"strconv"
	"time"

	"golang.org/x/sync/errgroup"
)

// purpur talks to https://api.purpurmc.org/v2. Purpur is a Paper fork, so Paper plugins apply.
// Build details (timestamp, md5, commits) live one request per build; they are fetched
// concurrently and cached.
type purpur struct {
	reg   *Registry
	base  string
	cache *cache
}

func newPurpur(r *Registry) *purpur {
	return &purpur{reg: r, base: "https://api.purpurmc.org/v2/purpur", cache: newCache(10 * time.Minute)}
}

func (p *purpur) ID() string     { return "purpur" }
func (p *purpur) Name() string   { return "Purpur" }
func (p *purpur) Traits() Traits { return Traits{Plugins: true, TPSCommand: true} }

func (p *purpur) Versions(ctx context.Context, _ bool) (VersionList, error) {
	return cached(p.cache, "versions", func() (VersionList, error) {
		var proj struct {
			Versions []string `json:"versions"`
		}
		if err := p.reg.getJSON(ctx, p.base, &proj); err != nil {
			return VersionList{}, fmt.Errorf("purpur project: %w", err)
		}
		return versionList(proj.Versions), nil
	})
}

type purpurBuild struct {
	Build     string `json:"build"`
	Result    string `json:"result"`
	Timestamp int64  `json:"timestamp"`
	MD5       string `json:"md5"`
	Commits   []struct {
		Description string `json:"description"`
	} `json:"commits"`
}

// maxPurpurBuilds bounds the per-build detail requests; older builds are rarely wanted.
const maxPurpurBuilds = 20

func (p *purpur) Builds(ctx context.Context, mc string) ([]Build, error) {
	return cached(p.cache, "builds:"+mc, func() ([]Build, error) {
		var ver struct {
			Builds struct {
				All []string `json:"all"` // oldest first
			} `json:"builds"`
		}
		if err := p.reg.getJSON(ctx, p.base+"/"+mc, &ver); err != nil {
			return nil, fmt.Errorf("purpur builds: %w", err)
		}
		ids := ver.Builds.All
		if len(ids) > maxPurpurBuilds {
			ids = ids[len(ids)-maxPurpurBuilds:]
		}
		details := make([]purpurBuild, len(ids))
		g, gctx := errgroup.WithContext(ctx)
		g.SetLimit(6)
		for i, id := range ids {
			g.Go(func() error {
				if err := p.reg.getJSON(gctx, p.base+"/"+mc+"/"+id, &details[i]); err != nil {
					return fmt.Errorf("purpur build %s: %w", id, err)
				}
				return nil
			})
		}
		if err := g.Wait(); err != nil {
			return nil, err
		}
		out := make([]Build, 0, len(ids))
		for i := len(ids) - 1; i >= 0; i-- { // newest first
			d := details[i]
			if d.Result != "SUCCESS" {
				continue
			}
			n, _ := strconv.Atoi(d.Build)
			b := Build{ID: n, Channel: "STABLE", Time: time.UnixMilli(d.Timestamp).UTC(),
				Name: fmt.Sprintf("purpur-%s-%s.jar", mc, d.Build), Hash: Checksum{Algo: "md5", Value: d.MD5},
				URL: fmt.Sprintf("%s/%s/%s/download", p.base, mc, d.Build)}
			for _, c := range d.Commits {
				if line := firstLine(c.Description); line != "" {
					b.Changes = append(b.Changes, line)
				}
			}
			out = append(out, b)
		}
		return out, nil
	})
}
