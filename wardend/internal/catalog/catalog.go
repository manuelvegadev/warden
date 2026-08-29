// Package catalog implements download providers: Paper (Fill v3) now, Hangar and Modrinth later.
// See docs/external-apis.md and ADR-005.
package catalog

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"sync"
	"time"
)

// Build is one downloadable server build.
type Build struct {
	ID      int       `json:"id"`
	Channel string    `json:"channel"`
	Time    time.Time `json:"time"`
	Name    string    `json:"name"`
	Size    int64     `json:"size"`
	SHA256  string    `json:"sha256"`
	URL     string    `json:"url"`
	Changes []string  `json:"changes"`
}

// VersionList is the set of Minecraft versions a provider can serve.
type VersionList struct {
	Versions []string `json:"versions"`
	Latest   string   `json:"latest"`
}

// ServerProvider serves server jars (Paper, later Purpur/Fabric/Vanilla).
type ServerProvider interface {
	ID() string
	Name() string
	Versions(ctx context.Context, includePre bool) (VersionList, error)
	Builds(ctx context.Context, mcVersion string) ([]Build, error)
}

// Registry holds providers and a shared HTTP client.
type Registry struct {
	client    *http.Client
	userAgent string
	providers map[string]ServerProvider
}

func NewRegistry(userAgent string) *Registry {
	r := &Registry{
		client:    &http.Client{Timeout: 30 * time.Second},
		userAgent: userAgent,
		providers: map[string]ServerProvider{},
	}
	r.providers["paper"] = newPaper(r)
	return r
}

func (r *Registry) Providers() []ServerProvider {
	out := make([]ServerProvider, 0, len(r.providers))
	for _, p := range r.providers {
		out = append(out, p)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ID() < out[j].ID() })
	return out
}

var ErrUnknownProvider = errors.New("unknown provider")

func (r *Registry) Provider(id string) (ServerProvider, error) {
	p, ok := r.providers[id]
	if !ok {
		return nil, ErrUnknownProvider
	}
	return p, nil
}

func (r *Registry) get(ctx context.Context, url string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", r.userAgent)
	req.Header.Set("Accept", "application/json")
	resp, err := r.client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("GET %s: %s", url, resp.Status)
	}
	return resp, nil
}

// Progress reports bytes downloaded so far and the total (-1 if unknown).
type Progress func(done, total int64)

// Download fetches url into dest atomically and verifies its SHA-256 when sha256Hex is non-empty.
func (r *Registry) Download(ctx context.Context, url, sha256Hex, dest string, progress Progress) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	req.Header.Set("User-Agent", r.userAgent)
	resp, err := (&http.Client{Timeout: 15 * time.Minute}).Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("GET %s: %s", url, resp.Status)
	}
	if err := os.MkdirAll(filepath.Dir(dest), 0o750); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(filepath.Dir(dest), ".download-*")
	if err != nil {
		return err
	}
	defer os.Remove(tmp.Name())

	h := sha256.New()
	var done int64
	buf := make([]byte, 256*1024)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := tmp.Write(buf[:n]); werr != nil {
				tmp.Close()
				return werr
			}
			h.Write(buf[:n])
			done += int64(n)
			if progress != nil {
				progress(done, resp.ContentLength)
			}
		}
		if rerr == io.EOF {
			break
		}
		if rerr != nil {
			tmp.Close()
			return rerr
		}
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if sha256Hex != "" {
		if got := hex.EncodeToString(h.Sum(nil)); got != sha256Hex {
			return fmt.Errorf("sha256 mismatch for %s: got %s want %s", filepath.Base(dest), got, sha256Hex)
		}
	}
	return os.Rename(tmp.Name(), dest)
}

// cache is a tiny TTL cache for provider responses.
type cache struct {
	mu    sync.Mutex
	ttl   time.Duration
	items map[string]cacheItem
}

type cacheItem struct {
	exp time.Time
	val any
}

func newCache(ttl time.Duration) *cache { return &cache{ttl: ttl, items: map[string]cacheItem{}} }

func (c *cache) get(key string) (any, bool) {
	c.mu.Lock()
	defer c.mu.Unlock()
	it, ok := c.items[key]
	if !ok || time.Now().After(it.exp) {
		return nil, false
	}
	return it.val, true
}

func (c *cache) set(key string, val any) {
	c.mu.Lock()
	c.items[key] = cacheItem{exp: time.Now().Add(c.ttl), val: val}
	c.mu.Unlock()
}
