/** Where each user's Overview dashboard layout is kept (ADR-026): Beacon's own table, one row per user. */
import type Database from "better-sqlite3";
import { type DashboardLayout, MAX_LAYOUT_BYTES, normalizeLayout } from "@/lib/dashboard-layout";
import { stmt } from "@/lib/db";

/** The user's layout, normalised; null when none is stored or the stored one is unreadable. */
export function getLayout(db: Database.Database, userId: string): DashboardLayout | null {
  const row = stmt(db, "SELECT layout FROM dashboardLayout WHERE userId = ?").get(userId) as
    | { layout: string }
    | undefined;
  if (!row) return null;
  try {
    return normalizeLayout(JSON.parse(row.layout));
  } catch {
    return null;
  }
}

export function saveLayout(db: Database.Database, userId: string, layout: DashboardLayout): void {
  stmt(
    db,
    `INSERT INTO dashboardLayout (userId, layout, updatedAt) VALUES (?, ?, ?)
     ON CONFLICT(userId) DO UPDATE SET layout = excluded.layout, updatedAt = excluded.updatedAt`,
  ).run(userId, JSON.stringify(layout), new Date().toISOString());
}

export function deleteLayout(db: Database.Database, userId: string): void {
  stmt(db, "DELETE FROM dashboardLayout WHERE userId = ?").run(userId);
}

/** A PUT body as a layout to store, or why not: 413 beyond 32 KB, 400 when it is not a layout. */
export function parseLayoutBody(text: string): { layout: DashboardLayout } | { status: 400 | 413; message: string } {
  if (Buffer.byteLength(text, "utf8") > MAX_LAYOUT_BYTES) {
    return { status: 413, message: `A layout is at most ${MAX_LAYOUT_BYTES / 1024} KB` };
  }
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { status: 400, message: "The body is not JSON" };
  }
  const layout = normalizeLayout(raw);
  return layout ? { layout } : { status: 400, message: "Not a dashboard layout" };
}
