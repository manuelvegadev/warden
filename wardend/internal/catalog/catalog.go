// Package catalog implements download providers: Paper (Fill v3) now, Hangar and Modrinth later.
// See docs/external-apis.md and ADR-005.
package catalog

import (
	"context"
	"crypto/sha1"
	"crypto/sha256"
	"crypto/sha512"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"hash"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strings"
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
	plugins   map[string]PluginSource
}

func NewRegistry(userAgent string) *Registry {
	r := &Registry{
		client:    &http.Client{Timeout: 30 * time.Second},
		userAgent: userAgent,
		providers: map[string]ServerProvider{},
	}
	r.providers["paper"] = newPaper(r)
	r.plugins = map[string]PluginSource{"hangar": newHangar(r), "modrinth": newModrinth(r)}
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

// get performs a GET with the registry's User-Agent and the given Accept header; callers close the body.
func (r *Registry) get(ctx context.Context, url, accept string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", r.userAgent)
	req.Header.Set("Accept", accept)
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

// getJSON decodes a JSON document from a provider URL.
func (r *Registry) getJSON(ctx context.Context, url string, v any) error {
	resp, err := r.get(ctx, url, "application/json")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
	return json.NewDecoder(resp.Body).Decode(v)
}

// getText fetches a plain-text document (e.g. a Markdown README) capped at max bytes.
func (r *Registry) getText(ctx context.Context, url string, max int64) (string, error) {
	resp, err := r.get(ctx, url, "text/plain")
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	b, err := io.ReadAll(io.LimitReader(resp.Body, max))
	return string(b), err
}

var imageExt = map[string]string{"image/png": ".png", "image/jpeg": ".jpg", "image/webp": ".webp", "image/gif": ".gif", "image/svg+xml": ".svg"}

// FetchImage downloads an image of at most max bytes and returns its bytes plus the file extension for its type.
func (r *Registry) FetchImage(ctx context.Context, url string, max int64) ([]byte, string, error) {
	resp, err := r.get(ctx, url, "image/*")
	if err != nil {
		return nil, "", err
	}
	defer resp.Body.Close()
	ct, _, _ := strings.Cut(resp.Header.Get("Content-Type"), ";")
	ext, ok := imageExt[strings.TrimSpace(ct)]
	if !ok {
		return nil, "", fmt.Errorf("unsupported image type %q", ct)
	}
	data, err := io.ReadAll(io.LimitReader(resp.Body, max+1))
	if err != nil {
		return nil, "", err
	}
	if len(data) == 0 || int64(len(data)) > max {
		return nil, "", fmt.Errorf("image size out of range")
	}
	return data, ext, nil
}

// Progress reports bytes downloaded so far and the total (-1 if unknown).
type Progress func(done, total int64)

// Checksum names a digest to verify a download against. Algo is "sha256", "sha512" or "sha1"; empty = skip.
type Checksum struct {
	Algo  string `json:"algo"`
	Value string `json:"value"`
}

func (c Checksum) hasher() hash.Hash {
	switch strings.ToLower(c.Algo) {
	case "sha512":
		return sha512.New()
	case "sha1":
		return sha1.New()
	case "sha256":
		return sha256.New()
	}
	return nil
}

// Download fetches url into dest atomically and verifies it against sum when one is given.
func (r *Registry) Download(ctx context.Context, url string, sum Checksum, dest string, progress Progress) error {
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

	h := sum.hasher()
	var done int64
	// Progress is throttled: every callback becomes a task snapshot broadcast over the socket.
	lastReport, lastPct := time.Now(), -1
	buf := make([]byte, 256*1024)
	for {
		n, rerr := resp.Body.Read(buf)
		if n > 0 {
			if _, werr := tmp.Write(buf[:n]); werr != nil {
				tmp.Close()
				return werr
			}
			if h != nil {
				h.Write(buf[:n])
			}
			done += int64(n)
			if progress != nil {
				pct := -1
				if resp.ContentLength > 0 {
					pct = int(done * 100 / resp.ContentLength)
				}
				if pct != lastPct && time.Since(lastReport) >= 250*time.Millisecond {
					lastReport, lastPct = time.Now(), pct
					progress(done, resp.ContentLength)
				}
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
	if h != nil && sum.Value != "" {
		if got := hex.EncodeToString(h.Sum(nil)); !strings.EqualFold(got, sum.Value) {
			return fmt.Errorf("%s mismatch for %s: got %s want %s", sum.Algo, filepath.Base(dest), got, sum.Value)
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
