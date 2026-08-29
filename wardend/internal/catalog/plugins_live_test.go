package catalog

import (
	"context"
	"os"
	"testing"
	"time"
)

// Live smoke test against Hangar and Modrinth; skipped unless WARDEN_LIVE_TESTS=1.
func TestPluginSourcesLive(t *testing.T) {
	if os.Getenv("WARDEN_LIVE_TESTS") != "1" {
		t.Skip("set WARDEN_LIVE_TESTS=1 to hit Hangar/Modrinth")
	}
	reg := NewRegistry("warden-tests/dev (cluceudemy@gmail.com)")
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	res, err := reg.SearchPlugins(ctx, "all", "ViaVersion", "1.21.8", 5, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(res.Hits) == 0 {
		t.Fatal("no hits")
	}
	seen := map[string]bool{}
	for _, h := range res.Hits {
		seen[h.Source] = true
	}
	if !seen["hangar"] || !seen["modrinth"] {
		t.Errorf("expected both sources, got %v", seen)
	}
	for _, c := range []struct{ src, id string }{{"hangar", "ViaVersion"}, {"modrinth", "luckperms"}} {
		src, _ := reg.PluginSource(c.src)
		vs, err := src.Versions(ctx, c.id, "1.21.8")
		if err != nil || len(vs) == 0 {
			t.Fatalf("%s versions: %v (%d)", c.src, err, len(vs))
		}
		v, ok := FindVersion(vs, "latest")
		if !ok || v.URL == "" || v.FileName == "" {
			t.Errorf("%s latest: %+v", c.src, v)
		}
		if v.Hash.Value == "" {
			t.Errorf("%s: no hash on %s", c.src, v.Name)
		}
		t.Logf("%s %s → %s %s (%s %s…)", c.src, c.id, v.Name, v.FileName, v.Hash.Algo, v.Hash.Value[:12])
	}
}
