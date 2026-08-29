package instance

import "testing"

func TestSanitize(t *testing.T) {
	cases := map[string]string{
		"> \r  \r[20:58:56 INFO]: Done (9.5s)! For help, type \"help\"":         "[20:58:56 INFO]: Done (9.5s)! For help, type \"help\"",
		"> > \r  \r[21:03:07 INFO]: There are 0 of a max of 5 players online: ": "[21:03:07 INFO]: There are 0 of a max of 5 players online:",
		"\x1b[32m[12:00:00 INFO]\x1b[0m: hi":                                    "[12:00:00 INFO]: hi",
		">   [20:58:56 INFO]: x":                                                "[20:58:56 INFO]: x",
	}
	for in, want := range cases {
		if got := sanitize(in); got != want {
			t.Errorf("sanitize(%q) = %q, want %q", in, got, want)
		}
	}
	if levelOf("[12:00:00 WARN]: Can't keep up!") != "WARN" {
		t.Error("level")
	}
}

func TestRingBuffer(t *testing.T) {
	r := NewRingBuffer(3)
	for _, s := range []string{"a", "b", "c", "d"} {
		r.Push(Line{Text: s})
	}
	got := r.Last(10)
	if len(got) != 3 || got[0].Text != "b" || got[2].Text != "d" {
		t.Errorf("unexpected %+v", got)
	}
}
