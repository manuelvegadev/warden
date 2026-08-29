package tlsconf

import (
	"crypto/tls"
	"crypto/x509"
	"encoding/pem"
	"os"
	"testing"
)

func TestSelfSignedIsReusedAndHasSANs(t *testing.T) {
	dir := t.TempDir()
	c1, k1, err := ensureSelfSigned(dir, []string{"mc.example.lan", "192.168.1.10"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tls.LoadX509KeyPair(c1, k1); err != nil {
		t.Fatal(err)
	}
	b, _ := os.ReadFile(c1)
	block, _ := pem.Decode(b)
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	if err := cert.VerifyHostname("mc.example.lan"); err != nil {
		t.Fatal(err)
	}
	if err := cert.VerifyHostname("192.168.1.10"); err != nil {
		t.Fatal(err)
	}
	if err := cert.VerifyHostname("localhost"); err != nil {
		t.Fatal(err)
	}
	info1, _ := os.Stat(c1)
	c2, _, _ := ensureSelfSigned(dir, nil)
	info2, _ := os.Stat(c2)
	if !info1.ModTime().Equal(info2.ModTime()) {
		t.Fatal("certificate regenerated instead of reused")
	}
}

func TestBuildModes(t *testing.T) {
	if cfg, h, err := Build(Options{Mode: ModeOff}); cfg != nil || h != nil || err != nil {
		t.Fatalf("off: %v %v %v", cfg, h, err)
	}
	if err := (Options{Mode: ModeFiles}).Validate(); err == nil {
		t.Fatal("files without paths should fail")
	}
	if err := (Options{Mode: ModeACME}).Validate(); err == nil {
		t.Fatal("acme without hosts should fail")
	}
	if err := (Options{Mode: "bogus"}).Validate(); err == nil {
		t.Fatal("unknown mode should fail")
	}
	cfg, h, err := Build(Options{Mode: ModeSelfSigned, DataDir: t.TempDir()})
	if err != nil || cfg == nil || h != nil || len(cfg.Certificates) != 1 {
		t.Fatalf("self-signed: %+v %v %v", cfg, h, err)
	}
	cfg, h, err = Build(Options{Mode: ModeACME, Hosts: []string{"mc.example.com"}, DataDir: t.TempDir()})
	if err != nil || cfg == nil || h == nil {
		t.Fatalf("acme: %+v %v %v", cfg, h, err)
	}
}
