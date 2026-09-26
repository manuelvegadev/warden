package catalog

import (
	"context"
	"testing"
)

// fakeSource is a plugin source answering from memory.
type fakeSource struct {
	hits     []PluginHit
	versions []PluginVersion
}

func (f fakeSource) ID() string { return "fake" }
func (f fakeSource) Search(context.Context, string, int, int) (SearchResult, error) {
	return SearchResult{Hits: append([]PluginHit(nil), f.hits...), Total: len(f.hits)}, nil
}
func (f fakeSource) Get(context.Context, string) (PluginHit, error) { return f.hits[0], nil }
func (f fakeSource) Versions(context.Context, string) ([]PluginVersion, error) {
	return f.versions, nil
}

func withFake(src fakeSource) *Registry {
	r := NewRegistry("tests")
	r.plugins = map[string]PluginSource{"fake": src}
	return r
}

func TestSearchKeepsPluginsThatDoNotListTheVersionInTheirPlace(t *testing.T) {
	reg := withFake(fakeSource{hits: []PluginHit{
		{ID: "dh-support", MCVersions: []string{"1.21.11", "26.1", "26.2"}},
		{ID: "chunky", MCVersions: []string{"26.2", "26.3"}},
		{ID: "no-versions"},
	}})
	res, err := reg.SearchPlugins(context.Background(), "fake", "", "26.3", 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	var order []string
	for _, h := range res.Hits {
		order = append(order, h.ID)
	}
	if len(order) != 3 || order[0] != "dh-support" || order[1] != "chunky" {
		t.Fatalf("order = %v", order)
	}
	dh := res.Hits[0]
	if dh.Listed == nil || *dh.Listed || dh.NewestMC != "26.2" {
		t.Errorf("dh-support: listed %v, newest %q", dh.Listed, dh.NewestMC)
	}
	if !*res.Hits[1].Listed || !*res.Hits[2].Listed {
		t.Error("a project that lists no versions is not held against it")
	}
}

func TestSearchWithoutAVersionMarksNothing(t *testing.T) {
	reg := withFake(fakeSource{hits: []PluginHit{{ID: "a", MCVersions: []string{"1.21"}}}})
	res, _ := reg.SearchPlugins(context.Background(), "fake", "", "", 10, 0)
	if res.Hits[0].Listed != nil {
		t.Error("no version asked for, no verdict")
	}
}

var releases = []PluginVersion{
	{ID: "0.15", Channel: "beta", MCVersions: []string{"26.2"}},
	{ID: "0.14", Channel: "release", MCVersions: []string{"26.1", "26.2"}},
	{ID: "0.13", Channel: "release", MCVersions: []string{"1.21.11"}},
}

func TestLatestIsTheNewestListedRelease(t *testing.T) {
	vs := MarkListed(releases, "1.21.11")
	v, ok := FindVersion(vs, "latest")
	if !ok || v.ID != "0.13" {
		t.Errorf("latest for 1.21.11 = %s", v.ID)
	}
	if v, _ := FindVersion(MarkListed(releases, "26.2"), ""); v.ID != "0.14" {
		t.Errorf("a listed release wins over a newer listed beta: %s", v.ID)
	}
}

func TestNothingListedMeansNoLatestButAnyReleaseCanStillBeChosen(t *testing.T) {
	vs := MarkListed(releases, "26.3")
	if _, ok := FindVersion(vs, "latest"); ok {
		t.Error("latest must not quietly install a release that does not list 26.3")
	}
	v, ok := FindVersion(vs, "0.14")
	if !ok || v.Listed {
		t.Errorf("chosen by id, it installs, marked unlisted: %+v", v)
	}
	if n, _ := NewestRelease(vs); n.ID != "0.14" {
		t.Errorf("the newest release there is: %s", n.ID)
	}
}

func TestMarkListedDoesNotTouchTheCachedReleases(t *testing.T) {
	_ = MarkListed(releases, "26.2")
	if releases[0].Listed {
		t.Error("the source's slice is shared through its cache and must stay unmarked")
	}
}
