package catalog

import (
	"context"
	"fmt"
	"sort"
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

func (p *paper) ID() string     { return "paper" }
func (p *paper) Name() string   { return "Paper" }
func (p *paper) Traits() Traits { return Traits{Plugins: true, TPSCommand: true} }

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
	proj, err := cached(p.cache, "versions", func() (proj fillProject, err error) {
		if err = p.reg.getJSON(ctx, p.base, &proj); err != nil {
			err = fmt.Errorf("fill project: %w", err)
		}
		return
	})
	if err != nil {
		return VersionList{}, err
	}
	var all []string
	for _, vs := range proj.Versions {
		for _, v := range vs {
			if includePre || !isPreRelease(v) {
				all = append(all, v)
			}
		}
	}
	return versionList(all), nil
}

// versionList sorts versions newest first and picks the newest non-pre-release as Latest.
func versionList(all []string) VersionList {
	sort.SliceStable(all, func(i, j int) bool { return versionLess(all[j], all[i]) })
	out := VersionList{Versions: all}
	for _, v := range all {
		if !isPreRelease(v) {
			out.Latest = v
			break
		}
	}
	return out
}

func (p *paper) Builds(ctx context.Context, mc string) ([]Build, error) {
	return cached(p.cache, "builds:"+mc, func() ([]Build, error) {
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
			bld := Build{ID: b.ID, Channel: b.Channel, Time: b.Time, Name: d.Name, Size: d.Size, Hash: Checksum{Algo: "sha256", Value: d.Checksums["sha256"]}, URL: d.URL}
			for _, c := range b.Commits {
				if line := firstLine(c.Message); line != "" {
					bld.Changes = append(bld.Changes, line)
				}
			}
			out = append(out, bld)
		}
		return out, nil
	})
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
