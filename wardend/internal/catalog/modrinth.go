package catalog

import (
	"context"
	"encoding/json"
	"fmt"
	"net/url"
	"strconv"
	"time"
)

// modrinth talks to https://api.modrinth.com/v2 (300 req/min per IP). See docs/external-apis.md.
type modrinth struct {
	reg   *Registry
	base  string
	cache *cache
}

func newModrinth(r *Registry) *modrinth {
	return &modrinth{reg: r, base: "https://api.modrinth.com/v2", cache: newCache(10 * time.Minute)}
}

func (m *modrinth) ID() string { return "modrinth" }

func (m *modrinth) getJSON(ctx context.Context, path string, v any) error {
	return m.reg.getJSON(ctx, m.base+path, v)
}

type modrinthHit struct {
	ProjectID   string   `json:"project_id"`
	Slug        string   `json:"slug"`
	Title       string   `json:"title"`
	Description string   `json:"description"`
	Author      string   `json:"author"`
	IconURL     string   `json:"icon_url"`
	Downloads   int64    `json:"downloads"`
	Categories  []string `json:"categories"`
}

func (h modrinthHit) hit() PluginHit {
	return PluginHit{Source: "modrinth", ID: h.ProjectID, Name: h.Title, Author: h.Author, Description: h.Description,
		IconURL: h.IconURL, Downloads: h.Downloads, Categories: h.Categories, URL: "https://modrinth.com/plugin/" + h.Slug}
}

func (m *modrinth) Search(ctx context.Context, query, mc string, limit, offset int) (SearchResult, error) {
	facets := `[["project_type:plugin"],["categories:paper"]`
	if mc != "" {
		facets += `,["versions:` + mc + `"]`
	}
	facets += `]`
	params := q(map[string]string{"query": query, "limit": strconv.Itoa(limit), "offset": strconv.Itoa(offset), "facets": facets, "index": "relevance"})
	if v, ok := m.cache.get("search:" + params); ok {
		return v.(SearchResult), nil
	}
	var body struct {
		Hits      []modrinthHit `json:"hits"`
		TotalHits int           `json:"total_hits"`
	}
	if err := m.getJSON(ctx, "/search?"+params, &body); err != nil {
		return SearchResult{}, err
	}
	out := SearchResult{Total: body.TotalHits, Hits: make([]PluginHit, 0, len(body.Hits))}
	for _, h := range body.Hits {
		out.Hits = append(out.Hits, h.hit())
	}
	m.cache.set("search:"+params, out)
	return out, nil
}

func (m *modrinth) Get(ctx context.Context, id string) (PluginHit, error) {
	key := "get:" + id
	if v, ok := m.cache.get(key); ok {
		return v.(PluginHit), nil
	}
	// Author comes from the team members (best effort), fetched alongside the project.
	var members []struct {
		Role string `json:"role"`
		User struct {
			Username string `json:"username"`
		} `json:"user"`
	}
	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = m.getJSON(ctx, "/project/"+url.PathEscape(id)+"/members", &members)
	}()
	var p struct {
		ID          string   `json:"id"`
		Slug        string   `json:"slug"`
		Title       string   `json:"title"`
		Description string   `json:"description"`
		Body        string   `json:"body"`
		SourceURL   string   `json:"source_url"`
		IconURL     string   `json:"icon_url"`
		Downloads   int64    `json:"downloads"`
		Categories  []string `json:"categories"`
	}
	if err := m.getJSON(ctx, "/project/"+url.PathEscape(id), &p); err != nil {
		return PluginHit{}, err
	}
	if p.ID == "" {
		return PluginHit{}, fmt.Errorf("modrinth project %q not found", id)
	}
	hit := PluginHit{Source: "modrinth", ID: p.ID, Name: p.Title, Description: p.Description, IconURL: p.IconURL,
		Downloads: p.Downloads, Categories: p.Categories, URL: "https://modrinth.com/plugin/" + p.Slug, SourceURL: p.SourceURL, Body: p.Body}
	<-done
	for _, mb := range members {
		if mb.Role == "Owner" || hit.Author == "" {
			hit.Author = mb.User.Username
		}
	}
	m.cache.set(key, hit)
	return hit, nil
}

type modrinthVersion struct {
	ID            string    `json:"id"`
	Name          string    `json:"name"`
	VersionNumber string    `json:"version_number"`
	VersionType   string    `json:"version_type"`
	GameVersions  []string  `json:"game_versions"`
	DatePublished time.Time `json:"date_published"`
	Files         []struct {
		URL      string            `json:"url"`
		Filename string            `json:"filename"`
		Primary  bool              `json:"primary"`
		Size     int64             `json:"size"`
		Hashes   map[string]string `json:"hashes"`
	} `json:"files"`
	Dependencies []struct {
		ProjectID      string `json:"project_id"`
		DependencyType string `json:"dependency_type"`
	} `json:"dependencies"`
}

func (m *modrinth) Versions(ctx context.Context, id, mc string) ([]PluginVersion, error) {
	key := "versions:" + id + ":" + mc
	if v, ok := m.cache.get(key); ok {
		return v.([]PluginVersion), nil
	}
	params := `loaders=["paper"]`
	if mc != "" {
		params += `&game_versions=["` + mc + `"]`
	}
	var raw []modrinthVersion
	if err := m.getJSON(ctx, "/project/"+url.PathEscape(id)+"/version?"+url.PathEscape(params), &raw); err != nil {
		return nil, err
	}
	names := m.projectNames(ctx, raw)
	out := make([]PluginVersion, 0, len(raw))
	for _, v := range raw {
		if len(v.Files) == 0 {
			continue
		}
		f := v.Files[0]
		for _, x := range v.Files {
			if x.Primary {
				f = x
				break
			}
		}
		pv := PluginVersion{ID: v.ID, Name: v.VersionNumber, Channel: v.VersionType, MCVersions: v.GameVersions,
			FileName: f.Filename, Size: f.Size, URL: f.URL, PublishedAt: v.DatePublished}
		if h := f.Hashes["sha512"]; h != "" {
			pv.Hash = Checksum{Algo: "sha512", Value: h}
		} else if h := f.Hashes["sha1"]; h != "" {
			pv.Hash = Checksum{Algo: "sha1", Value: h}
		}
		for _, d := range v.Dependencies {
			if d.DependencyType == "required" || d.DependencyType == "optional" {
				name := names[d.ProjectID]
				if name == "" {
					name = d.ProjectID
				}
				pv.Dependencies = append(pv.Dependencies, PluginDependency{Name: name, Required: d.DependencyType == "required"})
			}
		}
		out = append(out, pv)
	}
	m.cache.set(key, out)
	return out, nil
}

// projectNames resolves the dependency project IDs referenced by versions to their titles with a
// single batched /projects?ids=[...] call. Failures degrade to showing the raw ID.
func (m *modrinth) projectNames(ctx context.Context, versions []modrinthVersion) map[string]string {
	seen := map[string]bool{}
	ids := make([]string, 0, 4)
	for _, v := range versions {
		for _, d := range v.Dependencies {
			if d.ProjectID != "" && !seen[d.ProjectID] {
				seen[d.ProjectID] = true
				ids = append(ids, d.ProjectID)
			}
		}
	}
	names := map[string]string{}
	if len(ids) == 0 {
		return names
	}
	quoted, _ := json.Marshal(ids)
	var projects []struct {
		ID    string `json:"id"`
		Title string `json:"title"`
	}
	if err := m.getJSON(ctx, "/projects?ids="+url.QueryEscape(string(quoted)), &projects); err != nil {
		return names
	}
	for _, p := range projects {
		names[p.ID] = p.Title
	}
	return names
}
