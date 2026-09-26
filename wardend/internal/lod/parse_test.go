package lod

import (
	"testing"
)

func TestParsePregenStatus(t *testing.T) {
	tests := []struct {
		name  string
		lines []string
		want  PregenStatus
	}{
		{"running", []string{
			"Generation progress: 52.30%",
			"Processed LODs: 1204 / 2304 (38.40 CPS)",
			"Time elapsed: 2m 10s",
			"Time remaining: 9m 3s",
		}, PregenStatus{State: "running", Progress: 52.3, Done: 1204, Target: 2304, CPS: 38.4, Elapsed: "2m 10s", Remaining: "9m 3s"}},
		{"a server locale with decimal commas", []string{
			"Generation progress: 12,34%",
			"Processed LODs: 10 / 81 (3,50 CPS)",
			"Time elapsed: 5s",
			"Time remaining: 20s",
		}, PregenStatus{State: "running", Progress: 12.34, Done: 10, Target: 81, CPS: 3.5, Elapsed: "5s", Remaining: "20s"}},
		{"finished", []string{
			"Generation progress: 100.00%",
			"Processed LODs: 81 / 81 (NaN CPS)",
			"Time elapsed: 30s",
			"Generation is complete.",
		}, PregenStatus{State: "done", Progress: 100, Done: 81, Target: 81, Elapsed: "30s"}},
		{"colour codes left in", []string{"§aGeneration progress: §e1.00%"}, PregenStatus{State: "running", Progress: 1}},
		{"nothing running", []string{"No pre-generator running in world world."}, PregenStatus{State: "none"}},
		{"not recognised", []string{"Unknown command. Type \"/help\" for help."},
			PregenStatus{State: "unknown", Raw: []string{"Unknown command. Type \"/help\" for help."}}},
		{"no reply", nil, PregenStatus{State: "unknown", Raw: nil}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := ParsePregenStatus(tt.lines)
			if got.State != tt.want.State || got.Progress != tt.want.Progress || got.Done != tt.want.Done ||
				got.Target != tt.want.Target || got.CPS != tt.want.CPS || got.Elapsed != tt.want.Elapsed ||
				got.Remaining != tt.want.Remaining || len(got.Raw) != len(tt.want.Raw) {
				t.Fatalf("got %+v, want %+v", got, tt.want)
			}
		})
	}
}

func TestPregenStarted(t *testing.T) {
	ok := []string{"Generating LODs for view distance of 256 chunks in world world starting at center 0 0..."}
	if err := PregenStarted(ok); err != nil {
		t.Fatal(err)
	}
	if err := PregenStarted([]string{"Unknown world."}); err == nil || err.Error() != "Unknown world." {
		t.Fatalf("got %v", err)
	}
	if err := PregenStarted(nil); err == nil {
		t.Fatal("an empty reply is not a start")
	}
}

func TestStoreStatus(t *testing.T) {
	lines := []string{"x", "LOD store: sqlite state=ready db=120MB wal=4MB sweep_drops=0 evicted=0"}
	if got := StoreStatus(lines); got != lines[1] {
		t.Fatalf("got %q", got)
	}
	if got := StoreStatus([]string{"Unknown command."}); got != "" {
		t.Fatalf("got %q", got)
	}
}

func TestWorldArg(t *testing.T) {
	if got := WorldArg("My World"); got != "My_World" {
		t.Fatalf("got %q", got)
	}
}
