package mc

import "testing"

func TestParse(t *testing.T) {
	cases := []struct {
		line   string
		kind   EventKind
		player string
	}{
		{`[12:00:05 INFO]: Done (4.123s)! For help, type "help"`, EvServerReady, ""},
		{`[12:00:05] [Server thread/INFO]: Done (4.123s)! For help, type "help"`, EvServerReady, ""},
		{`[12:01:01 INFO]: Steve joined the game`, EvPlayerJoin, "Steve"},
		{`[12:05:00 INFO]: Steve left the game`, EvPlayerLeave, "Steve"},
		{`[12:02:00 INFO]: <Steve> hello`, EvPlayerChat, "Steve"},
		{`[12:02:10 INFO]: Steve has made the advancement [Stone Age]`, EvPlayerAdvance, "Steve"},
		{`[12:09:01 WARN]: Can't keep up! Is the server overloaded?`, EvServerOverloaded, ""},
	}
	for _, c := range cases {
		ev := Parse(c.line)
		if ev == nil || ev.Kind != c.kind || ev.Player != c.player {
			t.Errorf("%q → %+v, want %s/%s", c.line, ev, c.kind, c.player)
		}
	}
	if Parse(`[12:00:00 INFO]: Preparing spawn area: 50%`) != nil {
		t.Error("expected nil for unrelated line")
	}
}
