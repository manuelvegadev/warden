package catalog

import (
	"context"
	"fmt"
	"strconv"
	"strings"
	"time"
)

// paper talks to PaperMC Fill v3. The legacy api.papermc.io/v2 stopped receiving builds on 2025-12-31.
type paper struct {
	reg   *Registry
	base  string
	cache *cache
}

func newPaper(r *Registry) *paper {
	return &paper{reg: r, base: "https://fill.papermc.io/v3/projects/paper", cache: newCache(10 * time.Minute)}
}

func (p *paper) ID() string   { return "paper" }
func (p *paper) Name() string { return "Paper" }

type fillProject struct {
	Versions map[string][]string `json:"versions"` // family ("1.21") -> versions, newest first
}

type fillBuild struct {
	ID      int       `json:"id"`
	Time    time.Time `json:"time"`
	Channel string    `json:"channel"`
	Commits []struct {
		Message string `json:"message"`
	} `json:"commits"`
	Downloads map[string]struct {
		Name      string            `json:"name"`
		Checksums map[string]string `json:"checksums"`
		Size      int64             `json:"size"`
		URL       string            `json:"url"`
	} `json:"downloads"`
}

func isPreRelease(v string) bool {
	return strings.Contains(v, "-pre") || strings.Contains(v, "-rc") || strings.Contains(v, "-snapshot")
}

// versionLess orders versions numerically by dotted components (26.2 > 1.21.11 > 1.21.8).
func versionLess(a, b string) bool {
	pa, pb := strings.Split(strings.SplitN(a, "-", 2)[0], "."), strings.Split(strings.SplitN(b, "-", 2)[0], ".")
	for i := 0; i < len(pa) || i < len(pb); i++ {
		var x, y int
		if i < len(pa) {
			x, _ = strconv.Atoi(pa[i])
		}
		if i < len(pb) {
			y, _ = strconv.Atoi(pb[i])
		}
		if x != y {
			return x < y
		}
	}
	return isPreRelease(a) && !isPreRelease(b)
}

func (p *paper) Versions(ctx context.Context, includePre bool) (VersionList, error) {
	key := "versions"
	var proj fillProject
	if v, ok := p.cache.get(key); ok {
		proj = v.(fillProject)
	} else {
		if err := p.reg.getJSON(ctx, p.base, &proj); err != nil {
			return VersionList{}, fmt.Errorf("fill project: %w", err)
		}
		p.cache.set(key, proj)
	}
	var all []string
	for _, vs := range proj.Versions {
		for _, v := range vs {
			if includePre || !isPreRelease(v) {
				all = append(all, v)
			}
		}
	}
	// newest first
	for i := 0; i < len(all); i++ {
		for j := i + 1; j < len(all); j++ {
			if versionLess(all[i], all[j]) {
				all[i], all[j] = all[j], all[i]
			}
		}
	}
	out := VersionList{Versions: all}
	for _, v := range all {
		if !isPreRelease(v) {
			out.Latest = v
			break
		}
	}
	return out, nil
}

func (p *paper) Builds(ctx context.Context, mc string) ([]Build, error) {
	key := "builds:" + mc
	if v, ok := p.cache.get(key); ok {
		return v.([]Build), nil
	}
	var raw []fillBuild
	if err := p.reg.getJSON(ctx, p.base+"/versions/"+mc+"/builds", &raw); err != nil {
		return nil, fmt.Errorf("fill builds: %w", err)
	}
	out := make([]Build, 0, len(raw))
	for _, b := range raw {
		d, ok := b.Downloads["server:default"]
		if !ok {
			continue
		}
		bld := Build{ID: b.ID, Channel: b.Channel, Time: b.Time, Name: d.Name, Size: d.Size, SHA256: d.Checksums["sha256"], URL: d.URL}
		for _, c := range b.Commits {
			if line := strings.TrimSpace(strings.SplitN(c.Message, "\n", 2)[0]); line != "" {
				bld.Changes = append(bld.Changes, line)
			}
		}
		out = append(out, bld)
	}
	p.cache.set(key, out)
	return out, nil
}

// LatestBuild returns the newest build in channel STABLE or RECOMMENDED (or any if none).
func LatestBuild(builds []Build) (Build, bool) {
	for _, b := range builds {
		if b.Channel == "STABLE" || b.Channel == "RECOMMENDED" {
			return b, true
		}
	}
	if len(builds) > 0 {
		return builds[0], true
	}
	return Build{}, false
}
