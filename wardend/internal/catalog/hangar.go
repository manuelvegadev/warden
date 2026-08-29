package catalog

import (
	"context"
	"fmt"
	"net/url"
	"slices"
	"strconv"
	"strings"
	"time"
)

// hangar talks to PaperMC's plugin repository (https://hangar.papermc.io/api-docs). See docs/external-apis.md.
type hangar struct {
	reg   *Registry
	base  string
	cache *cache
}

func newHangar(r *Registry) *hangar {
	return &hangar{reg: r, base: "https://hangar.papermc.io/api/v1", cache: newCache(10 * time.Minute)}
}

func (h *hangar) ID() string { return "hangar" }

type hangarProject struct {
	Name      string `json:"name"`
	Namespace struct {
		Owner string `json:"owner"`
		Slug  string `json:"slug"`
	} `json:"namespace"`
	Description string `json:"description"`
	AvatarURL   string `json:"avatarUrl"`
	Category    string `json:"category"`
	Stats       struct {
		Downloads int64 `json:"downloads"`
	} `json:"stats"`
	Settings struct {
		Tags  []string `json:"tags"`
		Links []struct {
			Links []struct {
				Name string `json:"name"`
				URL  string `json:"url"`
			} `json:"links"`
		} `json:"links"`
	} `json:"settings"`
}

// sourceURL picks the link named "Source", else the first one pointing at a code host.
func (p hangarProject) sourceURL() string {
	var fallback string
	for _, g := range p.Settings.Links {
		for _, l := range g.Links {
			if strings.EqualFold(l.Name, "source") {
				return l.URL
			}
			if fallback == "" && (strings.Contains(l.URL, "github.com") || strings.Contains(l.URL, "gitlab.com") || strings.Contains(l.URL, "codeberg.org")) {
				fallback = l.URL
			}
		}
	}
	return fallback
}

func (p hangarProject) hit() PluginHit {
	cats := []string{strings.ToLower(p.Category)}
	for _, t := range p.Settings.Tags {
		cats = append(cats, strings.ToLower(t))
	}
	return PluginHit{
		Source: "hangar", ID: p.Namespace.Slug, Name: p.Name, Author: p.Namespace.Owner, Description: p.Description,
		IconURL: p.AvatarURL, Downloads: p.Stats.Downloads, Categories: cats,
		URL: "https://hangar.papermc.io/" + p.Namespace.Owner + "/" + p.Namespace.Slug, SourceURL: p.sourceURL(),
	}
}

func (h *hangar) getJSON(ctx context.Context, path string, v any) error {
	return h.reg.getJSON(ctx, h.base+path, v)
}

func (h *hangar) Search(ctx context.Context, query, mc string, limit, offset int) (SearchResult, error) {
	var body struct {
		Pagination struct {
			Count int `json:"count"`
		} `json:"pagination"`
		Result []hangarProject `json:"result"`
	}
	params := q(map[string]string{"q": query, "platform": "PAPER", "version": mc, "limit": strconv.Itoa(limit), "offset": strconv.Itoa(offset), "sort": "-downloads"})
	if v, ok := h.cache.get("search:" + params); ok {
		return v.(SearchResult), nil
	}
	if err := h.getJSON(ctx, "/projects?"+params, &body); err != nil {
		return SearchResult{}, err
	}
	out := SearchResult{Total: body.Pagination.Count, Hits: make([]PluginHit, 0, len(body.Result))}
	for _, p := range body.Result {
		out.Hits = append(out.Hits, p.hit())
	}
	h.cache.set("search:"+params, out)
	return out, nil
}

func (h *hangar) Get(ctx context.Context, id string) (PluginHit, error) {
	key := "get:" + id
	if v, ok := h.cache.get(key); ok {
		return v.(PluginHit), nil
	}
	// The project and its main page (the README, served as Markdown text) are independent; the README is best effort.
	var body string
	done := make(chan struct{})
	go func() {
		defer close(done)
		body, _ = h.reg.getText(ctx, h.base+"/pages/main/"+url.PathEscape(id), 512<<10)
	}()
	var p hangarProject
	if err := h.getJSON(ctx, "/projects/"+url.PathEscape(id), &p); err != nil {
		return PluginHit{}, err
	}
	if p.Namespace.Slug == "" {
		return PluginHit{}, fmt.Errorf("hangar project %q not found", id)
	}
	<-done
	hit := p.hit()
	hit.Body = body
	h.cache.set(key, hit)
	return hit, nil
}

type hangarVersion struct {
	Name      string    `json:"name"`
	CreatedAt time.Time `json:"createdAt"`
	Channel   struct {
		Name string `json:"name"`
	} `json:"channel"`
	Downloads map[string]struct {
		FileInfo struct {
			Name      string `json:"name"`
			SizeBytes int64  `json:"sizeBytes"`
			SHA256    string `json:"sha256Hash"`
		} `json:"fileInfo"`
		ExternalURL string `json:"externalUrl"`
		DownloadURL string `json:"downloadUrl"`
	} `json:"downloads"`
	PlatformDependencies map[string][]string `json:"platformDependencies"`
	PluginDependencies   map[string][]struct {
		Name     string `json:"name"`
		Required bool   `json:"required"`
	} `json:"pluginDependencies"`
}

func (h *hangar) Versions(ctx context.Context, id, mc string) ([]PluginVersion, error) {
	key := "versions:" + id + ":" + mc
	if v, ok := h.cache.get(key); ok {
		return v.([]PluginVersion), nil
	}
	var body struct {
		Result []hangarVersion `json:"result"`
	}
	if err := h.getJSON(ctx, "/projects/"+url.PathEscape(id)+"/versions?platform=PAPER&limit=25", &body); err != nil {
		return nil, err
	}
	out := make([]PluginVersion, 0, len(body.Result))
	for _, v := range body.Result {
		d, ok := v.Downloads["PAPER"]
		if !ok {
			continue
		}
		mcs := v.PlatformDependencies["PAPER"]
		if mc != "" && len(mcs) > 0 && !slices.Contains(mcs, mc) {
			continue
		}
		pv := PluginVersion{
			ID: v.Name, Name: v.Name, Channel: hangarChannel(v.Channel.Name), MCVersions: mcs,
			FileName: d.FileInfo.Name, Size: d.FileInfo.SizeBytes, URL: d.DownloadURL, PublishedAt: v.CreatedAt,
		}
		if d.ExternalURL != "" { // hosted elsewhere (e.g. GitHub): no hash available
			pv.URL = d.ExternalURL
		} else {
			pv.Hash = Checksum{Algo: "sha256", Value: d.FileInfo.SHA256}
		}
		if pv.FileName == "" {
			pv.FileName = id + "-" + v.Name + ".jar"
		}
		for _, dep := range v.PluginDependencies["PAPER"] {
			pv.Dependencies = append(pv.Dependencies, PluginDependency{Name: dep.Name, Required: dep.Required})
		}
		out = append(out, pv)
	}
	h.cache.set(key, out)
	return out, nil
}

// hangarChannel normalizes channel names to release | beta | alpha.
func hangarChannel(name string) string {
	if n := strings.ToLower(name); n != "snapshot" && n != "dev" {
		return n
	}
	return "alpha"
}
