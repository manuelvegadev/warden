package lod

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDetectFindsEachFamilyUnderEitherBrand(t *testing.T) {
	jars := []Jar{
		{FileName: "EssentialsX.jar", Name: "Essentials", Version: "2.22.0", Enabled: true},
		{FileName: "lss.jar", Name: "LodServerSupport", Version: "0.15.1", Enabled: false},
		{FileName: "DistantHorizonsSupport-0.14.0.jar", Name: "DHSupport", Version: "0.14.0", Enabled: true},
	}
	got := Detect(jars)
	if len(got) != 2 {
		t.Fatalf("got %+v", got)
	}
	if got[0].Provider.Kind != DHS || got[0].Version != "0.14.0" || !got[0].Enabled {
		t.Fatalf("dhs %+v", got[0])
	}
	if got[1].Provider.Kind != LSS || got[1].Brand.Command != "lsslod" || got[1].Enabled {
		t.Fatalf("lss %+v", got[1])
	}
}

func TestCompatibility(t *testing.T) {
	dhs, _ := ByKind(DHS)
	lss, _ := ByKind(LSS)
	tests := []struct {
		p        *Provider
		version  string
		verified bool
		warning  bool
	}{
		{dhs, "0.14.0", true, true},
		{dhs, "0.13.1", true, false},
		{dhs, "0.15.0", false, false},
		{lss, "0.14.0", true, false},
		{lss, "0.3.0", false, false},
		{lss, "garbage", false, false},
	}
	for _, tt := range tests {
		c := tt.p.Compat(tt.version)
		if c.Verified != tt.verified || (c.Warning != "") != tt.warning || c.Link == "" {
			t.Errorf("%s %s: %+v", tt.p.Kind, tt.version, c)
		}
		if c.Verified && c.Clients == "" {
			t.Errorf("%s %s: verified without clients", tt.p.Kind, tt.version)
		}
	}
}

func TestStoresAreWhereEachPluginKeepsItsData(t *testing.T) {
	dhs, _ := ByKind(DHS)
	lss, _ := ByKind(LSS)
	d := dhs.Stores(dhs.Brands[0], []string{"world"})
	if len(d) != 1 || d[0].DB != "plugins/DHSupport/data.sqlite" || len(d[0].Paths) != 4 {
		t.Fatalf("dhs %+v", d)
	}
	v := lss.Stores(lss.Brands[0], []string{"world", "world_nether"})
	if len(v) != 2 || v[1].DB != "world_nether/vss-lod/store.db" || v[1].Paths[0] != "world_nether/vss-lod" {
		t.Fatalf("vss %+v", v)
	}
}

func TestDiskUseAndDelete(t *testing.T) {
	dir := t.TempDir()
	os.MkdirAll(filepath.Join(dir, "world", "vss-lod"), 0o755)
	os.WriteFile(filepath.Join(dir, "world", "vss-lod", "store.db"), make([]byte, 1000), 0o644)
	os.WriteFile(filepath.Join(dir, "world", "vss-lod", "store.db-wal"), make([]byte, 24), 0o644)
	stores := []Store{{DB: "world/vss-lod/store.db", Paths: []string{"world/vss-lod"}}, {DB: "x/store.db", Paths: []string{"x"}}}
	use := DiskUse(dir, stores)
	if len(use) != 1 || use[0].Path != "world/vss-lod" || use[0].Bytes != 1024 {
		t.Fatalf("use %+v", use)
	}
	if err := DeleteData(dir, stores); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(dir, "world", "vss-lod")); !os.IsNotExist(err) {
		t.Fatal("the store is still there")
	}
	if _, err := os.Stat(filepath.Join(dir, "world")); err != nil {
		t.Fatal("the world went with it")
	}
}
