// Package sqlview reads a plugin's SQLite database for the file manager (ADR-020): its tables and a
// page of rows at a time, opened read-only so a running plugin's writes are never disturbed.
// CoreProtect, LuckPerms (with SQLite storage) and many small plugins keep one in their folder.
package sqlview

import (
	"bytes"
	"context"
	"database/sql"
	"errors"
	"fmt"
	"net/url"
	"os"
	"strings"
	"unicode/utf8"

	_ "modernc.org/sqlite"
)

// ErrNotSQLite is a file without SQLite's header (an H2 database is also a `.db`).
var ErrNotSQLite = errors.New("not a SQLite database")

// ErrNoSuchTable is a table the database does not have.
var ErrNoSuchTable = errors.New("no such table")

var header = []byte("SQLite format 3\x00")

// MaxRows is the largest page of rows a read returns.
const MaxRows = 500

// maxText caps a cell's text: the page is for looking, not for exporting.
const maxText = 2000

type Column struct {
	Name string `json:"name"`
	Type string `json:"type"`
	PK   bool   `json:"pk,omitempty"`
}

type Table struct {
	Name    string   `json:"name"`
	Kind    string   `json:"kind"` // table or view
	Columns []Column `json:"columns"`
}

// Page is some rows of a table: More says there are rows past them. Rows are not counted (a
// CoreProtect table holds millions, and COUNT(*) reads them all).
type Page struct {
	Columns []string `json:"columns"`
	Rows    [][]any  `json:"rows"`
	More    bool     `json:"more"`
}

// IsSQLite reads the file's first bytes.
func IsSQLite(name string) bool {
	f, err := os.Open(name)
	if err != nil {
		return false
	}
	defer f.Close()
	buf := make([]byte, len(header))
	n, _ := f.Read(buf)
	return n == len(header) && bytes.Equal(buf, header)
}

func open(name string) (*sql.DB, error) {
	if !IsSQLite(name) {
		return nil, ErrNotSQLite
	}
	// mode=ro: no writes and no journal of ours; query_only refuses a write even through a PRAGMA.
	dsn := (&url.URL{Scheme: "file", Path: name, RawQuery: "mode=ro&_pragma=busy_timeout(2000)&_pragma=query_only(1)"}).String()
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	return db, nil
}

// Tables lists the database's tables and views with their columns, by name.
func Tables(ctx context.Context, name string) ([]Table, error) {
	db, err := open(name)
	if err != nil {
		return nil, err
	}
	defer db.Close()
	rows, err := db.QueryContext(ctx, `SELECT name, type FROM sqlite_schema WHERE type IN ('table','view') AND name NOT LIKE 'sqlite_%' ORDER BY name`)
	if err != nil {
		return nil, err
	}
	var out []Table
	for rows.Next() {
		var t Table
		if err := rows.Scan(&t.Name, &t.Kind); err != nil {
			rows.Close()
			return nil, err
		}
		out = append(out, t)
	}
	rows.Close()
	for i := range out {
		cols, err := db.QueryContext(ctx, `SELECT name, type, pk FROM pragma_table_info(?)`, out[i].Name)
		if err != nil {
			return nil, err
		}
		for cols.Next() {
			var c Column
			var pk int
			if err := cols.Scan(&c.Name, &c.Type, &pk); err != nil {
				cols.Close()
				return nil, err
			}
			c.PK = pk > 0
			out[i].Columns = append(out[i].Columns, c)
		}
		cols.Close()
	}
	return out, nil
}

// Rows reads up to `limit` rows of a table from `offset`, in the table's own order.
func Rows(ctx context.Context, name, table string, limit, offset int) (Page, error) {
	tables, err := Tables(ctx, name)
	if err != nil {
		return Page{}, err
	}
	found := false
	for _, t := range tables {
		found = found || t.Name == table
	}
	if !found {
		return Page{}, fmt.Errorf("%w: %s", ErrNoSuchTable, table)
	}
	limit = min(max(limit, 1), MaxRows)
	offset = max(offset, 0)
	db, err := open(name)
	if err != nil {
		return Page{}, err
	}
	defer db.Close()
	// The name is one the database listed; quoted all the same, as an identifier.
	q := fmt.Sprintf(`SELECT * FROM "%s" LIMIT ? OFFSET ?`, strings.ReplaceAll(table, `"`, `""`))
	rows, err := db.QueryContext(ctx, q, limit+1, offset)
	if err != nil {
		return Page{}, err
	}
	defer rows.Close()
	cols, err := rows.Columns()
	if err != nil {
		return Page{}, err
	}
	page := Page{Columns: cols, Rows: [][]any{}}
	for rows.Next() {
		if len(page.Rows) == limit {
			page.More = true
			break
		}
		vals := make([]any, len(cols))
		ptrs := make([]any, len(cols))
		for i := range vals {
			ptrs[i] = &vals[i]
		}
		if err := rows.Scan(ptrs...); err != nil {
			return Page{}, err
		}
		for i, v := range vals {
			vals[i] = cell(v)
		}
		page.Rows = append(page.Rows, vals)
	}
	return page, rows.Err()
}

// cell is a value as the panel shows it: text cut at maxText, a blob as its size (or its text,
// when it is short valid UTF-8, which is how some plugins store JSON).
func cell(v any) any {
	switch t := v.(type) {
	case []byte:
		if len(t) <= maxText && utf8.Valid(t) {
			return string(t)
		}
		return map[string]int{"blob": len(t)}
	case string:
		if len(t) > maxText {
			return t[:maxText] + "…"
		}
	}
	return v
}
