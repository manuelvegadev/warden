// Package catalog implements download providers: Paper (Fill v3) now, Hangar and Modrinth later.
// See docs/external-apis.md and ADR-005.
package catalog

import (
	"context"
	"crypto/md5"
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
	"net/url"
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
	Hash    Checksum  `json:"hash"` // empty Algo when the upstream publishes no digest
	URL     string    `json:"url"`
	Changes []string  `json:"changes"`
}

// VersionList is the set of Minecraft versions a provider can serve.
type VersionList struct {
	Versions []string `json:"versions"`
	Latest   string   `json:"latest"`
}

// Traits are the per-software facts the rest of the daemon and the panel need; providers own them.
type Traits struct {
	Plugins     bool `json:"plugins"`     // loads Bukkit/Paper plugins from plugins/
	TPSCommand  bool `json:"tpsCommand"`  // answers the Paper-style `tps` command
	SingleBuild bool `json:"singleBuild"` // one build per Minecraft version (build id is meaningless)
}

// ServerProvider serves server jars: Paper, Purpur, Fabric and Vanilla.
type ServerProvider interface {
	ID() string
	Name() string
	Traits() Traits
	Versions(ctx context.Context, includePre bool) (VersionList, error)
	Builds(ctx context.Context, mcVersion string) ([]Build, error)
}

// Registry holds providers, a shared HTTP client for their APIs and the clients downloads go
// through: one held to the trusted hosts, one for Hangar external links (fetch.go).
type Registry struct {
	client    *http.Client
	trusted   downloader
	external  downloader
	userAgent string
	providers map[string]ServerProvider
	plugins   map[string]PluginSource
}

func NewRegistry(userAgent string) *Registry {
	r := &Registry{
		client:    &http.Client{Timeout: 30 * time.Second},
		trusted:   newDownloader(downloadPolicy{hosts: trustedHosts}, defaultTransport()),
		external:  newDownloader(downloadPolicy{public: true}, defaultTransport()),
		userAgent: userAgent,
		providers: map[string]ServerProvider{},
	}
	for _, p := range []ServerProvider{newPaper(r), newPurpur(r), newFabric(r), newVanilla(r)} {
		r.providers[p.ID()] = p
	}
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

// TraitsOf returns the traits for a software id; unknown ids get zero traits.
func (r *Registry) TraitsOf(software string) Traits {
	if p, ok := r.providers[software]; ok {
		return p.Traits()
	}
	return Traits{}
}

// firstLine trims a commit message to its (non-empty) first line for change lists.
func firstLine(msg string) string { return strings.TrimSpace(strings.SplitN(msg, "\n", 2)[0]) }

// cached returns the entry under key, computing and storing it with fn on a miss.
func cached[T any](c *cache, key string, fn func() (T, error)) (T, error) {
	if v, ok := c.get(key); ok {
		return v.(T), nil
	}
	v, err := fn()
	if err == nil {
		c.set(key, v)
	}
	return v, err
}

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

// FetchImage downloads an image of at most max bytes from a trusted host and returns its bytes
// plus the file extension for its type.
func (r *Registry) FetchImage(ctx context.Context, url string, max int64) ([]byte, string, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	resp, err := r.fetch(ctx, r.trusted, url, "image/*")
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

// Checksum names a digest to verify a download against. Algo is "sha256", "sha512", "sha1" or "md5"; empty = skip.
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
	case "md5":
		return md5.New()
	}
	return nil
}

// fetch GETs url through d once its policy allows it; d's client holds the redirects to the same policy.
func (r *Registry) fetch(ctx context.Context, d downloader, rawURL, accept string) (*http.Response, error) {
	u, err := url.Parse(rawURL)
	if err != nil {
		return nil, err
	}
	if err := d.policy.check(u); err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", r.userAgent)
	if accept != "" {
		req.Header.Set("Accept", accept)
	}
	resp, err := d.client.Do(req)
	if err != nil {
		return nil, err
	}
	if resp.StatusCode != http.StatusOK {
		resp.Body.Close()
		return nil, fmt.Errorf("GET %s: %s", u.Redacted(), resp.Status)
	}
	return resp, nil
}

// Download fetches url from a trusted host into dest atomically and verifies it against sum when
// one is given.
func (r *Registry) Download(ctx context.Context, url string, sum Checksum, dest string, progress Progress) error {
	return r.download(ctx, r.trusted, url, sum, dest, progress)
}

// DownloadExternal fetches a Hangar external link: any host on the public internet, over HTTPS.
// There is no hash to check it against; the caller checks what it got (a jar with a descriptor).
func (r *Registry) DownloadExternal(ctx context.Context, url, dest string, progress Progress) error {
	return r.download(ctx, r.external, url, Checksum{}, dest, progress)
}

func (r *Registry) download(ctx context.Context, d downloader, url string, sum Checksum, dest string, progress Progress) error {
	ctx, cancel := context.WithTimeout(ctx, 15*time.Minute)
	defer cancel()
	resp, err := r.fetch(ctx, d, url, "")
	if err != nil {
		return err
	}
	defer resp.Body.Close()
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

// cache is a tiny TTL cache for provider responses. The panel searches as the admin types, so every
// prefix of every query lands here: it holds at most cacheMax entries, dropping the expired ones
// first and then those closest to expiring.
type cache struct {
	mu    sync.Mutex
	ttl   time.Duration
	items map[string]cacheItem
}

type cacheItem struct {
	exp time.Time
	val any
}

const cacheMax = 512

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
	defer c.mu.Unlock()
	now := time.Now()
	if _, ok := c.items[key]; !ok && len(c.items) >= cacheMax {
		c.evict(now)
	}
	c.items[key] = cacheItem{exp: now.Add(c.ttl), val: val}
}

// evict makes room for one entry. Called with the lock held on a full cache.
func (c *cache) evict(now time.Time) {
	for k, it := range c.items {
		if now.After(it.exp) {
			delete(c.items, k)
		}
	}
	if len(c.items) < cacheMax {
		return
	}
	var soonest string
	var exp time.Time
	for k, it := range c.items {
		if soonest == "" || it.exp.Before(exp) {
			soonest, exp = k, it.exp
		}
	}
	delete(c.items, soonest)
}
