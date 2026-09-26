package catalog

import (
	"strconv"
	"strings"
)

// CompareMC orders Minecraft versions the way their numbers mean: 1.21.10 after 1.21.2, 26.1 after
// 1.21.11, and a pre-release or release candidate ("26.3-pre-1", "26.3-rc-1") before the release it
// leads to. Something that is not a version sorts below every version. It returns -1, 0 or 1.
func CompareMC(a, b string) int {
	an, ap := splitMC(a)
	bn, bp := splitMC(b)
	for i := 0; i < max(len(an), len(bn)); i++ {
		x, y := at(an, i), at(bn, i)
		if x != y {
			return sign(x - y)
		}
	}
	switch {
	case ap == bp:
		return 0
	case ap == "": // a release is newer than its pre-releases
		return 1
	case bp == "":
		return -1
	}
	return strings.Compare(ap, bp)
}

// NewestMC is the newest of a list of Minecraft versions, or "" for an empty list.
func NewestMC(versions []string) string {
	var newest string
	for _, v := range versions {
		if newest == "" || CompareMC(v, newest) > 0 {
			newest = v
		}
	}
	return newest
}

// splitMC is a version's numbers and its pre-release suffix ("pre-1", "rc-2"); nil numbers for
// something else.
func splitMC(v string) ([]int, string) {
	num, pre, _ := strings.Cut(v, "-")
	parts := strings.Split(num, ".")
	out := make([]int, 0, len(parts))
	for _, p := range parts {
		n, err := strconv.Atoi(p)
		if err != nil {
			return nil, ""
		}
		out = append(out, n)
	}
	return out, pre
}

func at(xs []int, i int) int {
	if i < len(xs) {
		return xs[i]
	}
	return 0
}

func sign(n int) int {
	switch {
	case n < 0:
		return -1
	case n > 0:
		return 1
	}
	return 0
}
