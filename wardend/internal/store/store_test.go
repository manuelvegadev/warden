package store

import (
	"context"
	"path/filepath"
	"testing"
	"time"

	"github.com/manuelvega/warden/wardend/internal/mc"
)

func TestPlayersAndSessions(t *testing.T) {
	s, err := Open(filepath.Join(t.TempDir(), "t.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer s.Close()
	ctx := context.Background()
	t0 := time.Unix(1_700_000_000, 0).UTC()
	s.OnEvent("srv", &mc.Event{Kind: mc.EvPlayerJoin, Player: "Steve"}, t0)
	s.OnEvent("srv", &mc.Event{Kind: mc.EvPlayerChat, Player: "Steve", Text: "hi"}, t0.Add(10*time.Second))
	s.OnEvent("srv", &mc.Event{Kind: mc.EvPlayerLeave, Player: "Steve"}, t0.Add(90*time.Second))
	s.OnEvent("srv", &mc.Event{Kind: mc.EvPlayerJoin, Player: "Alex"}, t0.Add(100*time.Second))
	s.OnStopped("srv", t0.Add(160*time.Second)) // Alex's session closed by the server stopping

	players, err := s.Players(ctx, "srv")
	if err != nil {
		t.Fatal(err)
	}
	if len(players) != 2 {
		t.Fatalf("players = %+v", players)
	}
	byName := map[string]Player{}
	for _, p := range players {
		byName[p.Name] = p
	}
	if byName["Steve"].PlayTimeS != 90 || byName["Alex"].PlayTimeS != 60 {
		t.Errorf("play time: %+v", byName)
	}
	sessions, _ := s.Sessions(ctx, "srv", "Alex", 10)
	if len(sessions) != 1 || sessions[0].LeftAt == nil {
		t.Errorf("sessions = %+v", sessions)
	}
	events, _ := s.Events(ctx, "srv", []string{"player.chat"}, 10)
	if len(events) != 1 || events[0].Text != "hi" {
		t.Errorf("events = %+v", events)
	}
	// Metrics with the new columns round-trip.
	tps := 19.5
	if err := s.InsertMetric(ctx, "srv", MetricRow{TS: t0, CPU: 1, NetRx: 10, NetTx: 20, TPS1: &tps}); err != nil {
		t.Fatal(err)
	}
	rows, _ := s.Metrics(ctx, "srv", t0.Add(-time.Second))
	if len(rows) != 1 || rows[0].NetTx != 20 || rows[0].TPS1 == nil || *rows[0].TPS1 != 19.5 {
		t.Errorf("metrics = %+v", rows)
	}
}
