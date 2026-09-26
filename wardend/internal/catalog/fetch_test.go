package catalog

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestIsPublic(t *testing.T) {
	tests := []struct {
		addr string
		want bool
	}{
		{"8.8.8.8", true},
		{"2606:4700::1111", true},
		{"127.0.0.1", false},
		{"::1", false},
		{"10.0.0.8", false},
		{"172.16.4.1", false},
		{"192.168.1.20", false},
		{"169.254.169.254", false}, // cloud metadata
		{"100.64.0.1", false},      // carrier-grade NAT
		{"0.0.0.0", false},
		{"0.1.2.3", false},
		{"fd00::1", false},
		{"fe80::1", false},
		{"224.0.0.1", false},
		{"::ffff:192.168.1.20", false}, // an IPv4 address written as IPv6
	}
	for _, tt := range tests {
		if got := isPublic(netip.MustParseAddr(tt.addr)); got != tt.want {
			t.Errorf("isPublic(%s) = %v, want %v", tt.addr, got, tt.want)
		}
	}
}

// fileServer serves a jar at /file.jar and redirects /to?url=… wherever it is told.
func fileServer(t *testing.T, body string) *httptest.Server {
	t.Helper()
	srv := httptest.NewTLSServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/to" {
			http.Redirect(w, r, r.URL.Query().Get("url"), http.StatusFound)
			return
		}
		_, _ = w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	return srv
}

// trustingOnly is a registry whose trusted downloads may go to the test server's 127.0.0.1 alone.
func trustingOnly(srv *httptest.Server) *Registry {
	r := NewRegistry("tests")
	r.trusted = newDownloader(downloadPolicy{hosts: map[string]bool{"127.0.0.1": true}}, srv.Client().Transport.(*http.Transport))
	r.external = newDownloader(downloadPolicy{public: true}, srv.Client().Transport.(*http.Transport))
	return r
}

func TestDownloadFromATrustedHostVerifiesTheHash(t *testing.T) {
	srv := fileServer(t, "jar bytes")
	reg := trustingOnly(srv)
	sum := sha256.Sum256([]byte("jar bytes"))
	dest := filepath.Join(t.TempDir(), "p.jar")
	if err := reg.Download(context.Background(), srv.URL+"/file.jar", Checksum{Algo: "sha256", Value: hex.EncodeToString(sum[:])}, dest, nil); err != nil {
		t.Fatal(err)
	}
	if b, _ := os.ReadFile(dest); string(b) != "jar bytes" {
		t.Errorf("got %q", b)
	}
	err := reg.Download(context.Background(), srv.URL+"/file.jar", Checksum{Algo: "sha256", Value: strings.Repeat("0", 64)}, dest+"2", nil)
	if err == nil || !strings.Contains(err.Error(), "mismatch") {
		t.Errorf("a wrong hash must fail: %v", err)
	}
}

func TestDownloadsRefuse(t *testing.T) {
	srv := fileServer(t, "jar bytes")
	reg := trustingOnly(srv)
	// errors.Is below makes sure the policy stopped each one, not TLS or the network.
	other := strings.Replace(srv.URL, "127.0.0.1", "localhost", 1)
	plain := strings.Replace(srv.URL, "https://", "http://", 1)
	tests := []struct {
		name string
		get  func(dest string) error
	}{
		{"plain HTTP", func(dest string) error {
			return reg.Download(context.Background(), plain+"/file.jar", Checksum{}, dest, nil)
		}},
		{"a host that is not trusted", func(dest string) error {
			return reg.Download(context.Background(), other+"/file.jar", Checksum{}, dest, nil)
		}},
		{"a redirect to a host that is not trusted", func(dest string) error {
			return reg.Download(context.Background(), srv.URL+"/to?url="+other+"/file.jar", Checksum{}, dest, nil)
		}},
		{"a redirect to plain HTTP", func(dest string) error {
			return reg.Download(context.Background(), srv.URL+"/to?url="+plain+"/file.jar", Checksum{}, dest, nil)
		}},
		{"an external link over plain HTTP", func(dest string) error {
			return reg.DownloadExternal(context.Background(), plain+"/file.jar", dest, nil)
		}},
		{"an external link to the local network", func(dest string) error {
			return reg.DownloadExternal(context.Background(), srv.URL+"/file.jar", dest, nil)
		}},
		{"an icon from a host that is not trusted", func(string) error {
			_, _, err := reg.FetchImage(context.Background(), other+"/icon.png", 1024)
			return err
		}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			dest := filepath.Join(t.TempDir(), "p.jar")
			err := tt.get(dest)
			if !errors.Is(err, ErrDownloadRefused) {
				t.Fatalf("err = %v, want ErrDownloadRefused", err)
			}
			if _, statErr := os.Stat(dest); statErr == nil {
				t.Error("nothing may be written")
			}
		})
	}
}

func TestTrustedHostsAreBareNames(t *testing.T) {
	for h := range trustedHosts {
		if h != strings.ToLower(h) || strings.ContainsAny(h, "/:") {
			t.Errorf("%q: hosts are bare lower-case names", h)
		}
	}
}
