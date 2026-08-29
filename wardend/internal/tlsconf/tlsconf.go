// Package tlsconf turns the WARDEND_TLS_* settings into a tls.Config: certificate files, ACME
// (Let's Encrypt) with TLS-ALPN-01, or a self-signed certificate generated into the data dir.
package tlsconf

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/tls"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/pem"
	"errors"
	"fmt"
	"log/slog"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"time"

	"golang.org/x/crypto/acme/autocert"
)

// Modes of WARDEND_TLS. See docs/deploy.md for when to use which.
const (
	ModeOff        = "off"
	ModeFiles      = "files"
	ModeACME       = "acme"
	ModeSelfSigned = "self-signed"
)

// Options mirror the WARDEND_TLS_* environment.
type Options struct {
	Mode     string
	CertFile string   // files mode
	KeyFile  string   // files mode
	Hosts    []string // ACME allowlist / extra SANs of the self-signed cert
	Email    string   // ACME account contact
	HTTPAddr string   // ACME: challenge + redirect listener; "" disables
	DataDir  string
}

// Validate checks the mode and its required inputs without touching the filesystem.
func (o Options) Validate() error {
	switch o.Mode {
	case ModeOff, ModeSelfSigned:
		return nil
	case ModeFiles:
		if o.CertFile == "" || o.KeyFile == "" {
			return errors.New("WARDEND_TLS=files needs WARDEND_TLS_CERT and WARDEND_TLS_KEY")
		}
		return nil
	case ModeACME:
		if len(o.Hosts) == 0 {
			return errors.New("WARDEND_TLS=acme needs WARDEND_TLS_HOSTS (public DNS names)")
		}
		return nil
	}
	return fmt.Errorf("unknown WARDEND_TLS mode %q (off|files|acme|self-signed)", o.Mode)
}

// Build returns the server TLS config (nil for ModeOff) and, for ACME, the handler to run on
// HTTPAddr that answers challenges and redirects everything else to HTTPS.
func Build(o Options) (cfg *tls.Config, acmeHTTP http.Handler, err error) {
	if err := o.Validate(); err != nil {
		return nil, nil, err
	}
	switch o.Mode {
	case ModeOff:
		return nil, nil, nil
	case ModeACME:
		m := &autocert.Manager{
			Prompt:     autocert.AcceptTOS,
			HostPolicy: autocert.HostWhitelist(o.Hosts...),
			Cache:      autocert.DirCache(filepath.Join(o.DataDir, "tls", "acme")),
			Email:      o.Email,
		}
		cfg = m.TLSConfig()
		acmeHTTP = m.HTTPHandler(nil)
	default: // files, self-signed
		certFile, keyFile := o.CertFile, o.KeyFile
		if o.Mode == ModeSelfSigned {
			if certFile, keyFile, err = ensureSelfSigned(filepath.Join(o.DataDir, "tls"), o.Hosts); err != nil {
				return nil, nil, err
			}
			slog.Info("tls: self-signed certificate; the panel and browsers must trust it", "file", certFile)
		}
		cert, err := tls.LoadX509KeyPair(certFile, keyFile)
		if err != nil {
			return nil, nil, fmt.Errorf("load certificate: %w", err)
		}
		cfg = &tls.Config{Certificates: []tls.Certificate{cert}}
	}
	cfg.MinVersion = tls.VersionTLS12
	return cfg, acmeHTTP, nil
}

// ensureSelfSigned creates <dir>/wardend.crt + wardend.key once (ECDSA P-256, 10 years) with the
// given hosts as SANs (plus localhost and the loopback addresses), and reuses them afterwards.
func ensureSelfSigned(dir string, hosts []string) (certFile, keyFile string, err error) {
	certFile, keyFile = filepath.Join(dir, "wardend.crt"), filepath.Join(dir, "wardend.key")
	if _, err := tls.LoadX509KeyPair(certFile, keyFile); err == nil {
		return certFile, keyFile, nil
	}
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", "", err
	}
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		return "", "", err
	}
	serial, _ := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 128))
	tmpl := &x509.Certificate{
		SerialNumber:          serial,
		Subject:               pkix.Name{CommonName: "wardend", Organization: []string{"Warden"}},
		NotBefore:             time.Now().Add(-time.Hour),
		NotAfter:              time.Now().AddDate(10, 0, 0),
		KeyUsage:              x509.KeyUsageDigitalSignature,
		ExtKeyUsage:           []x509.ExtKeyUsage{x509.ExtKeyUsageServerAuth},
		BasicConstraintsValid: true,
		DNSNames:              []string{"localhost"},
		IPAddresses:           []net.IP{net.IPv4(127, 0, 0, 1), net.IPv6loopback},
	}
	for _, h := range hosts {
		if ip := net.ParseIP(h); ip != nil {
			tmpl.IPAddresses = append(tmpl.IPAddresses, ip)
		} else {
			tmpl.DNSNames = append(tmpl.DNSNames, h)
		}
	}
	der, err := x509.CreateCertificate(rand.Reader, tmpl, tmpl, &key.PublicKey, key)
	if err != nil {
		return "", "", err
	}
	keyDER, err := x509.MarshalECPrivateKey(key)
	if err != nil {
		return "", "", err
	}
	if err := os.WriteFile(certFile, pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: der}), 0o644); err != nil {
		return "", "", err
	}
	if err := os.WriteFile(keyFile, pem.EncodeToMemory(&pem.Block{Type: "EC PRIVATE KEY", Bytes: keyDER}), 0o600); err != nil {
		return "", "", err
	}
	return certFile, keyFile, nil
}
