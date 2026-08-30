package selfupdate

import "testing"

func TestNewer(t *testing.T) {
	cases := []struct {
		cur, tag string
		want     bool
	}{
		{"v0.4.0", "v0.5.0", true}, {"v0.4.0", "v0.4.1", true}, {"v0.4.0", "v1.0.0", true},
		{"v0.4.0", "v0.4.0", false}, {"v0.5.0", "v0.4.9", false},
		{"v0.4.0-3-gabc123-dirty", "v0.4.0", false}, {"v0.4.0-3-gabc123", "v0.4.1", true},
		{"dev", "v9.9.9", false}, {"v0.4.0", "nightly", false},
	}
	for _, c := range cases {
		if got := Newer(c.cur, c.tag); got != c.want {
			t.Errorf("Newer(%q,%q) = %v", c.cur, c.tag, got)
		}
	}
	if !validTag("v1.2.3") || validTag("1.2.3") || validTag("v1.2") {
		t.Error("validTag")
	}
}
