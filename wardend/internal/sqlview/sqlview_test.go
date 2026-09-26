package sqlview

import (
	"context"
	"database/sql"
	"errors"
	"os"
	"path/filepath"
	"testing"
)

func sample(t *testing.T) string {
	t.Helper()
	name := filepath.Join(t.TempDir(), "database with spaces.db")
	db, err := sql.Open("sqlite", name)
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()
	for _, q := range []string{
		`CREATE TABLE co_user (id INTEGER PRIMARY KEY, user TEXT, time INTEGER)`,
		`CREATE TABLE "odd ""name""" (x BLOB)`,
		`CREATE VIEW recent AS SELECT user FROM co_user`,
		`INSERT INTO co_user (user, time) VALUES ('Steve', 1), ('Alex', 2), ('Notch', 3)`,
		`INSERT INTO "odd ""name""" VALUES (x'00ff00'), ('{"a":1}')`,
	} {
		if _, err := db.Exec(q); err != nil {
			t.Fatal(q, err)
		}
	}
	return name
}

func TestTablesListsTablesAndViewsWithTheirColumns(t *testing.T) {
	tables, err := Tables(context.Background(), sample(t))
	if err != nil {
		t.Fatal(err)
	}
	if len(tables) != 3 || tables[0].Name != "co_user" || tables[2].Kind != "view" {
		t.Fatalf("tables = %+v", tables)
	}
	if c := tables[0].Columns; len(c) != 3 || !c[0].PK || c[1].Name != "user" || c[1].Type != "TEXT" {
		t.Errorf("columns = %+v", c)
	}
}

func TestRowsReadsAPageAndSaysWhetherMoreFollow(t *testing.T) {
	db := sample(t)
	page, err := Rows(context.Background(), db, "co_user", 2, 0)
	if err != nil {
		t.Fatal(err)
	}
	if len(page.Rows) != 2 || !page.More || page.Rows[1][1] != "Alex" {
		t.Errorf("first page = %+v", page)
	}
	page, _ = Rows(context.Background(), db, "co_user", 2, 2)
	if len(page.Rows) != 1 || page.More {
		t.Errorf("last page = %+v", page)
	}
}

func TestRowsShowsBlobsByTheirSizeAndQuotesOddNames(t *testing.T) {
	page, err := Rows(context.Background(), sample(t), `odd "name"`, 10, 0)
	if err != nil {
		t.Fatal(err)
	}
	if b, ok := page.Rows[0][0].(map[string]int); !ok || b["blob"] != 3 {
		t.Errorf("a binary blob is its size: %#v", page.Rows[0][0])
	}
	if page.Rows[1][0] != `{"a":1}` {
		t.Errorf("text stored as a blob is text: %#v", page.Rows[1][0])
	}
}

func TestReadsNothingButSQLite(t *testing.T) {
	db := sample(t)
	if _, err := Rows(context.Background(), db, "missing", 10, 0); !errors.Is(err, ErrNoSuchTable) {
		t.Errorf("a table not in the database: %v", err)
	}
	h2 := filepath.Join(t.TempDir(), "luckperms-h2-v2.mv.db")
	os.WriteFile(h2, []byte("H:2,block:5,blockSize:1000"), 0o644)
	if _, err := Tables(context.Background(), h2); !errors.Is(err, ErrNotSQLite) {
		t.Errorf("an H2 database: %v", err)
	}
}

func TestOpensReadOnly(t *testing.T) {
	db := sample(t)
	before, _ := os.Stat(db)
	if _, err := Tables(context.Background(), db); err != nil {
		t.Fatal(err)
	}
	after, _ := os.Stat(db)
	if !after.ModTime().Equal(before.ModTime()) {
		t.Error("reading the database changed it")
	}
}
