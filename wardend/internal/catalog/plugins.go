package catalog

import (
	"context"
	"errors"
	"fmt"
	"net/url"
	"slices"
	"sort"
	"sync"
	"time"
)

// PluginHit is a search result / project summary from a plugin source.
type PluginHit struct {
	Source      string   `json:"source"` // hangar | modrinth
	ID          string   `json:"id"`     // Hangar slug or Modrinth project id
	Name        string   `json:"name"`
	Author      string   `json:"author"`
	Description string   `json:"description"`
	IconURL     string   `json:"iconUrl,omitempty"`
	Downloads   int64    `json:"downloads"`
	Categories  []string `json:"categories"`
	URL         string   `json:"url"`
	SourceURL   string   `json:"sourceUrl,omitempty"` // repository link, when the project publishes one
	Body        string   `json:"body,omitempty"`      // project README (Markdown); only filled by Get
	// Listed says whether the project lists the Minecraft version searched for (unset without one);
	// NewestMC is the newest version it lists. The search does not leave out the rest: a plugin
	// that has not caught up with a new Minecraft often runs on it all the same (ADR-022).
	Listed     *bool    `json:"listed,omitempty"`
	NewestMC   string   `json:"newestMc,omitempty"`
	MCVersions []string `json:"-"`
}

type PluginDependency struct {
	Name     string `json:"name"`
	Required bool   `json:"required"`
}

// PluginVersion is a downloadable release of a plugin.
type PluginVersion struct {
	ID           string             `json:"id"`
	Name         string             `json:"name"`
	Channel      string             `json:"channel"` // release | beta | alpha | snapshot
	MCVersions   []string           `json:"mcVersions"`
	FileName     string             `json:"fileName"`
	Size         int64              `json:"size"`
	Hash         Checksum           `json:"hash"`
	URL          string             `json:"url"`
	Dependencies []PluginDependency `json:"dependencies"`
	PublishedAt  time.Time          `json:"publishedAt"`
	// Listed: the release lists the Minecraft version asked about (MarkListed), or lists none.
	Listed bool `json:"listed"`
}

// SearchResult is one page of hits.
type SearchResult struct {
	Hits  []PluginHit `json:"hits"`
	Total int         `json:"total"`
}

// PluginSource is a plugin repository (Hangar, Modrinth). Neither searches nor versions are
// filtered by Minecraft version: hits carry the versions they list (MCVersions), and the registry
// marks what fits a server (SearchPlugins, MarkListed).
type PluginSource interface {
	ID() string
	Search(ctx context.Context, query string, limit, offset int) (SearchResult, error)
	Get(ctx context.Context, id string) (PluginHit, error)
	Versions(ctx context.Context, id string) ([]PluginVersion, error)
}

var ErrUnknownSource = errors.New("unknown plugin source")

func (r *Registry) PluginSource(id string) (PluginSource, error) {
	p, ok := r.plugins[id]
	if !ok {
		return nil, ErrUnknownSource
	}
	return p, nil
}

// SearchPlugins queries one source, or all of them concurrently when source == "" or "all". With a
// Minecraft version, each hit says whether it lists it. The order stays the sources' own: a
// popular plugin a release behind is still what most searches are after (ADR-022).
func (r *Registry) SearchPlugins(ctx context.Context, source, query, mc string, limit, offset int) (SearchResult, error) {
	if source != "" && source != "all" {
		src, err := r.PluginSource(source)
		if err != nil {
			return SearchResult{}, err
		}
		res, err := src.Search(ctx, query, limit, offset)
		res.Hits = markHits(res.Hits, mc)
		return res, err
	}
	var (
		mu   sync.Mutex
		wg   sync.WaitGroup
		out  SearchResult
		errs []error
	)
	for _, src := range r.plugins {
		wg.Add(1)
		go func(src PluginSource) {
			defer wg.Done()
			res, err := src.Search(ctx, query, limit, offset)
			mu.Lock()
			defer mu.Unlock()
			if err != nil {
				errs = append(errs, fmt.Errorf("%s: %w", src.ID(), err))
				return
			}
			out.Hits = append(out.Hits, res.Hits...)
			out.Total += res.Total
		}(src)
	}
	wg.Wait()
	if len(out.Hits) == 0 && len(errs) > 0 {
		return out, errors.Join(errs...)
	}
	sort.SliceStable(out.Hits, func(i, j int) bool { return out.Hits[i].Downloads > out.Hits[j].Downloads })
	out.Hits = markHits(out.Hits, mc)
	return out, nil
}

// markHits sets what each hit lists against mc. A hit whose source lists no versions counts as listing it.
func markHits(hits []PluginHit, mc string) []PluginHit {
	for i := range hits {
		hits[i].NewestMC = NewestMC(hits[i].MCVersions)
		if mc != "" {
			listed := len(hits[i].MCVersions) == 0 || slices.Contains(hits[i].MCVersions, mc)
			hits[i].Listed = &listed
		}
	}
	return hits
}

// MarkListed is a copy of the releases with Listed set against mc: a release lists it, or lists
// no versions at all (nothing to contradict). Without mc every release counts as listed.
func MarkListed(versions []PluginVersion, mc string) []PluginVersion {
	out := slices.Clone(versions)
	for i := range out {
		out[i].Listed = mc == "" || len(out[i].MCVersions) == 0 || slices.Contains(out[i].MCVersions, mc)
	}
	return out
}

// PluginVersions is a project's releases, newest first, marked against the server's Minecraft version.
func (r *Registry) PluginVersions(ctx context.Context, source, id, mc string) ([]PluginVersion, error) {
	src, err := r.PluginSource(source)
	if err != nil {
		return nil, err
	}
	versions, err := src.Versions(ctx, id)
	return MarkListed(versions, mc), err
}

// FindVersion resolves a version id, or "latest" (or "") for the newest listed release — the
// newest listed pre-release when no release is listed, nothing when none is. Versions come newest
// first, marked (MarkListed). Choosing a release that is not listed takes its id.
func FindVersion(versions []PluginVersion, id string) (PluginVersion, bool) {
	if id == "" || id == "latest" {
		var listed []PluginVersion
		for _, v := range versions {
			if v.Listed {
				listed = append(listed, v)
			}
		}
		return NewestRelease(listed)
	}
	for _, v := range versions {
		if v.ID == id || v.Name == id {
			return v, true
		}
	}
	return PluginVersion{}, false
}

// NewestRelease is the first release of a newest-first list, or its first entry when it has no release.
func NewestRelease(versions []PluginVersion) (PluginVersion, bool) {
	for _, v := range versions {
		if v.Channel == "release" {
			return v, true
		}
	}
	if len(versions) > 0 {
		return versions[0], true
	}
	return PluginVersion{}, false
}

func q(params map[string]string) string {
	v := url.Values{}
	for k, val := range params {
		if val != "" {
			v.Set(k, val)
		}
	}
	return v.Encode()
}
