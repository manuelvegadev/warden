"use client";

import { Button } from "@warden/ui/components/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@warden/ui/components/table";
import { cn } from "@warden/ui/lib/utils";
import { ChevronLeft, ChevronRight, Eye, Table2 } from "lucide-react";
import { useEffect, useState } from "react";
import { formatBytes, fs, type SqliteCell, type SqlitePage, type SqliteTable } from "@/lib/api";
import { mono } from "@/lib/utils";

const PAGE = 100;

/**
 * A plugin's SQLite database (ADR-020), read-only: its tables and views beside a page of rows,
 * a hundred at a time. Rows are not counted — a CoreProtect table holds millions.
 */
export function SqliteView({ id, path }: { id: string; path: string }) {
  const [tables, setTables] = useState<SqliteTable[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [offset, setOffset] = useState(0);
  const [page, setPage] = useState<SqlitePage | null>(null);

  useEffect(() => {
    let stale = false;
    fs.sqliteTables(id, path)
      .then(({ tables }) => {
        if (stale) return;
        setTables(tables ?? []);
        setTable(tables?.[0]?.name ?? null);
      })
      .catch((e: Error) => !stale && setError(e.message));
    return () => {
      stale = true;
    };
  }, [id, path]);

  useEffect(() => {
    if (!table) return;
    let stale = false;
    setPage(null);
    fs.sqliteRows(id, path, table, PAGE, offset)
      .then((p) => !stale && setPage(p))
      .catch((e: Error) => !stale && setError(e.message));
    return () => {
      stale = true;
    };
  }, [id, path, table, offset]);

  if (error)
    return <p className="px-4 py-3 text-sm text-muted-foreground">Not a database this panel can read: {error}</p>;
  if (!tables) return <p className="px-4 py-3 text-sm text-muted-foreground">Reading…</p>;
  if (tables.length === 0)
    return <p className="px-4 py-3 text-sm text-muted-foreground">The database has no tables.</p>;
  return (
    <div className="flex min-h-0 flex-1">
      <nav className="w-56 shrink-0 overflow-y-auto border-r py-1">
        {tables.map((t) => (
          <button
            key={t.name}
            type="button"
            onClick={() => {
              setTable(t.name);
              setOffset(0);
            }}
            title={t.columns.map((c) => `${c.name} ${c.type}`).join("\n")}
            className={cn(
              "flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-accent/50",
              table === t.name && "bg-accent",
            )}
          >
            {t.kind === "view" ? (
              <Eye className="size-3.5 shrink-0 text-muted-foreground" />
            ) : (
              <Table2 className="size-3.5 shrink-0 text-muted-foreground" />
            )}
            <span className={cn(mono, "min-w-0 flex-1 truncate text-xs")}>{t.name}</span>
          </button>
        ))}
      </nav>
      <div className="flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-auto">
          {!page ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">Reading…</p>
          ) : page.rows.length === 0 ? (
            <p className="px-3 py-2 text-sm text-muted-foreground">No rows{offset > 0 && " past here"}.</p>
          ) : (
            <Table className={cn(mono, "text-xs")}>
              <TableHeader>
                <TableRow>
                  {page.columns.map((c) => (
                    <TableHead key={c}>{c}</TableHead>
                  ))}
                </TableRow>
              </TableHeader>
              <TableBody>
                {page.rows.map((row, i) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: rows of a page, in the table's order
                  <TableRow key={offset + i}>
                    {row.map((cell, j) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: columns by position
                      <TableCell key={j} className="max-w-80 truncate" title={title(cell)}>
                        <Cell value={cell} />
                      </TableCell>
                    ))}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 border-t px-3 py-2 text-xs text-muted-foreground">
          <span>
            Rows {offset + 1}–{offset + (page?.rows.length ?? 0)}
          </span>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Previous rows"
            disabled={offset === 0}
            onClick={() => setOffset((o) => Math.max(0, o - PAGE))}
          >
            <ChevronLeft />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label="Next rows"
            disabled={!page?.more}
            onClick={() => setOffset((o) => o + PAGE)}
          >
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

const title = (v: SqliteCell) =>
  v === null ? "NULL" : typeof v === "object" ? `blob, ${formatBytes(v.blob)}` : String(v);

function Cell({ value }: { value: SqliteCell }) {
  if (value === null) return <span className="text-muted-foreground italic">NULL</span>;
  if (typeof value === "object") return <span className="text-muted-foreground">blob · {formatBytes(value.blob)}</span>;
  if (typeof value === "number") return <span className="text-amber-300">{value}</span>;
  return <>{value}</>;
}
