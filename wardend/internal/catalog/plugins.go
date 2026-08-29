package catalog

import (
	"context"
	"errors"
	"fmt"
	"net/url"
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
}

// SearchResult is one page of hits.
type SearchResult struct {
	Hits  []PluginHit `json:"hits"`
	Total int         `json:"total"`
}

// PluginSource is a plugin repository (Hangar, Modrinth). mc filters by Minecraft version when non-empty.
type PluginSource interface {
	ID() string
	Search(ctx context.Context, query, mc string, limit, offset int) (SearchResult, error)
	Get(ctx context.Context, id string) (PluginHit, error)
	Versions(ctx context.Context, id, mc string) ([]PluginVersion, error)
}

var ErrUnknownSource = errors.New("unknown plugin source")

func (r *Registry) PluginSource(id string) (PluginSource, error) {
	p, ok := r.plugins[id]
	if !ok {
		return nil, ErrUnknownSource
	}
	return p, nil
}

// SearchPlugins queries one source, or all of them concurrently when source == "" or "all".
func (r *Registry) SearchPlugins(ctx context.Context, source, query, mc string, limit, offset int) (SearchResult, error) {
	if source != "" && source != "all" {
		src, err := r.PluginSource(source)
		if err != nil {
			return SearchResult{}, err
		}
		return src.Search(ctx, query, mc, limit, offset)
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
			res, err := src.Search(ctx, query, mc, limit, offset)
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
	return out, nil
}

// FindVersion resolves a version id (or "latest" for the newest compatible release).
func FindVersion(versions []PluginVersion, id string) (PluginVersion, bool) {
	if id == "" || id == "latest" {
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
	for _, v := range versions {
		if v.ID == id || v.Name == id {
			return v, true
		}
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
