package mc

import (
	"os"
	"path/filepath"
	"testing"
)

func TestReadStatsAndAdvancements(t *testing.T) {
	dir := t.TempDir()
	stats := filepath.Join(dir, "s.json")
	os.WriteFile(stats, []byte(`{"stats":{"minecraft:custom":{"minecraft:play_time":72000,"minecraft:deaths":3},"minecraft:mined":{"minecraft:stone":50,"minecraft:dirt":80}},"DataVersion":4325}`), 0o640)
	s, err := ReadStats(stats)
	if err != nil {
		t.Fatal(err)
	}
	if s.Custom("play_time") != 72000 || s.Total("mined") != 130 || s.Top("mined", 1)[0].ID != "minecraft:dirt" {
		t.Fatalf("stats parsed wrong: %+v", s)
	}
	if e, err := ReadStats(filepath.Join(dir, "missing.json")); err != nil || len(e.Categories) != 0 {
		t.Fatalf("missing stats should be empty: %+v %v", e, err)
	}

	adv := filepath.Join(dir, "a.json")
	os.WriteFile(adv, []byte(`{"minecraft:story/mine_stone":{"criteria":{"get_stone":"2026-08-29 01:00:00 -0500"},"done":true},"minecraft:recipes/misc/stick":{"criteria":{"has_planks":"2026-08-29 00:59:00 -0500"},"done":true},"minecraft:story/upgrade_tools":{"criteria":{"stone_pickaxe":"2026-08-29 01:05:00 -0500"},"done":false},"DataVersion":4325}`), 0o640)
	list, err := ReadAdvancements(adv)
	if err != nil {
		t.Fatal(err)
	}
	if len(list) != 2 || list[0].ID != "minecraft:story/mine_stone" || !list[0].Done || list[0].At.IsZero() || list[1].Done {
		t.Fatalf("advancements parsed wrong: %+v", list)
	}
}
