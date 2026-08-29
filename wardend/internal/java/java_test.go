package java

import "testing"

func TestRequiredMajor(t *testing.T) {
	cases := map[string]int{"26.2": 25, "26.1": 25, "1.21.11": 21, "1.21.8": 21, "1.20.6": 21, "1.20.5": 21, "1.20.4": 17, "1.18.2": 17, "1.17": 17, "1.16.5": 8, "1.12.2": 8, "26.1-rc1": 25}
	for mc, want := range cases {
		if got := RequiredMajor(mc); got != want {
			t.Errorf("RequiredMajor(%s) = %d, want %d", mc, got, want)
		}
	}
	if majorOf("1.8.0_392") != 8 || majorOf("21.0.8") != 21 || majorOf("25") != 25 {
		t.Error("majorOf")
	}
}
