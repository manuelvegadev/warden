package catalog

import (
	"context"
	"os"
	"testing"
)

// TestProvidersLive hits the real Purpur, Fabric and Mojang APIs; set WARDEN_LIVE_TESTS=1 to run.
func TestProvidersLive(t *testing.T) {
	if os.Getenv("WARDEN_LIVE_TESTS") == "" {
		t.Skip("WARDEN_LIVE_TESTS not set")
	}
	reg := NewRegistry("wardend-test")
	for _, id := range []string{"purpur", "fabric", "vanilla"} {
		p, _ := reg.Provider(id)
		vs, err := p.Versions(context.Background(), false)
		if err != nil || vs.Latest == "" || len(vs.Versions) == 0 {
			t.Fatalf("%s versions: %v %+v", id, err, vs)
		}
		builds, err := p.Builds(context.Background(), vs.Latest)
		if err != nil || len(builds) == 0 {
			t.Fatalf("%s builds for %s: %v", id, vs.Latest, err)
		}
		b, _ := LatestBuild(builds)
		t.Logf("%s: latest=%s versions=%d builds=%d newest=#%d %s %s hash=%s:%s", id, vs.Latest, len(vs.Versions), len(builds), b.ID, b.Channel, b.Name, b.Hash.Algo, b.Hash.Value[:min(8, len(b.Hash.Value))])
	}
}
