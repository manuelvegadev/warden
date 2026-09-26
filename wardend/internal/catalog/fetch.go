package catalog

import (
	"context"
	"errors"
	"fmt"
	"net"
	"net/http"
	"net/netip"
	"net/url"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Where downloads may go (ADR-023). Everything the sources host — server jars, Java runtimes,
// plugins, icons — comes from one of these hosts over HTTPS, redirects included.
var trustedHosts = map[string]bool{
	"fill-data.papermc.io":                 true, // Paper builds
	"api.purpurmc.org":                     true, // Purpur builds
	"meta.fabricmc.net":                    true, // Fabric server launchers
	"piston-data.mojang.com":               true, // Vanilla servers
	"launcher.mojang.com":                  true, // older Vanilla servers
	"github.com":                           true, // Adoptium JREs
	"release-assets.githubusercontent.com": true, // where github.com release downloads redirect
	"objects.githubusercontent.com":        true, // the same, for older releases
	"cdn.modrinth.com":                     true, // Modrinth files and icons
	"hangarcdn.papermc.io":                 true, // Hangar files and avatars
}

// ErrDownloadRefused marks a download stopped by the policy rather than by the network.
var ErrDownloadRefused = errors.New("download refused")

// downloadPolicy decides where a download may go.
type downloadPolicy struct {
	hosts  map[string]bool // allowed hosts; nil allows any
	public bool            // connect only to public addresses
}

// check vets one URL of a download: the first one and every redirect.
func (p downloadPolicy) check(u *url.URL) error {
	if u.Scheme != "https" {
		return fmt.Errorf("%w: %s is not HTTPS", ErrDownloadRefused, u.Redacted())
	}
	if p.hosts != nil && !p.hosts[strings.ToLower(u.Hostname())] {
		return fmt.Errorf("%w: %s is not a known download host", ErrDownloadRefused, u.Hostname())
	}
	return nil
}

// Addresses a Hangar external link must not reach, besides what netip classifies: shared address
// space (carrier-grade NAT) and "this network".
var nonPublic = []netip.Prefix{netip.MustParsePrefix("100.64.0.0/10"), netip.MustParsePrefix("0.0.0.0/8")}

// isPublic reports whether an address is on the public internet: not loopback, private, link-local
// (cloud metadata lives at 169.254.169.254), multicast or unspecified.
func isPublic(ip netip.Addr) bool {
	ip = ip.Unmap()
	if !ip.IsGlobalUnicast() || ip.IsPrivate() {
		return false
	}
	for _, p := range nonPublic {
		if p.Contains(ip) {
			return false
		}
	}
	return true
}

// refusePrivate is a dialer Control: it sees the address actually dialed, after DNS resolution,
// so a name that resolves somewhere else on a second lookup still cannot reach the local network.
func refusePrivate(_, address string, _ syscall.RawConn) error {
	ap, err := netip.ParseAddrPort(address)
	if err != nil {
		return fmt.Errorf("%w: %s: %v", ErrDownloadRefused, address, err)
	}
	if !isPublic(ap.Addr()) {
		return fmt.Errorf("%w: %s is not a public address", ErrDownloadRefused, ap.Addr())
	}
	return nil
}

// downloader is an HTTP client held, on every hop, to a policy.
type downloader struct {
	client *http.Client
	policy downloadPolicy
}

// newDownloader builds the client for p. With p.public, a proxy from the environment
// (HTTPS_PROXY) is still dialed wherever it is; the proxy then decides what it reaches. Timeouts
// come from the caller's context.
func newDownloader(p downloadPolicy, base *http.Transport) downloader {
	t := base.Clone()
	if p.public {
		var proxies sync.Map // addresses of the proxies in use, which may be on the local network
		if proxy := t.Proxy; proxy != nil {
			t.Proxy = func(req *http.Request) (*url.URL, error) {
				u, err := proxy(req)
				if u != nil {
					proxies.Store(hostPort(u), true)
				}
				return u, err
			}
		}
		direct := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second}
		guarded := &net.Dialer{Timeout: 30 * time.Second, KeepAlive: 30 * time.Second, Control: refusePrivate}
		t.DialContext = func(ctx context.Context, network, addr string) (net.Conn, error) {
			if _, ok := proxies.Load(addr); ok {
				return direct.DialContext(ctx, network, addr)
			}
			return guarded.DialContext(ctx, network, addr)
		}
	}
	return downloader{policy: p, client: &http.Client{
		Transport: t,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if len(via) >= 10 {
				return errors.New("stopped after 10 redirects")
			}
			return p.check(req.URL)
		},
	}}
}

// hostPort is the address a URL is dialed at, with the scheme's default port.
func hostPort(u *url.URL) string {
	port := u.Port()
	if port == "" {
		port = map[string]string{"http": "80", "https": "443", "socks5": "1080"}[u.Scheme]
	}
	return net.JoinHostPort(u.Hostname(), port)
}

func defaultTransport() *http.Transport { return http.DefaultTransport.(*http.Transport).Clone() }
