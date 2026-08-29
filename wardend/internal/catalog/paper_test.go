package catalog

import "testing"

func TestVersionLess(t *testing.T) {
	cases := [][2]string{{"1.21.8", "1.21.11"}, {"1.21.11", "26.1"}, {"26.1.2", "26.2"}, {"1.21.9-rc1", "1.21.9"}}
	for _, c := range cases {
		if !versionLess(c[0], c[1]) {
			t.Errorf("%s should be < %s", c[0], c[1])
		}
		if versionLess(c[1], c[0]) {
			t.Errorf("%s should not be < %s", c[1], c[0])
		}
	}
}
