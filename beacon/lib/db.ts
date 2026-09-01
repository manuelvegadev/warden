import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";

// The single SQLite handle shared by Better Auth and by our own tables (ADR-017).
//
// Opened on first use, never at import: `next build` evaluates these modules while prerendering and
// the build must not need the database or the runtime secrets.

/** Tables that are ours, not Better Auth's — `auth migrate` knows nothing about them. */
const SCHEMA = `
CREATE TABLE IF NOT EXISTS instanceAccess (
  id             TEXT PRIMARY KEY,
  organizationId TEXT NOT NULL,
  userId         TEXT NOT NULL,
  nodeId         TEXT NOT NULL DEFAULT 'default',
  instanceId     TEXT NOT NULL,
  role           TEXT NOT NULL,
  createdAt      TEXT NOT NULL,
  createdBy      TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS instanceAccess_unique ON instanceAccess (userId, nodeId, instanceId);
CREATE INDEX IF NOT EXISTS instanceAccess_instance ON instanceAccess (nodeId, instanceId);
`;

/** Creates the tables `auth migrate` knows nothing about. Idempotent; also used by the tests. */
export const createOwnTables = (db: Database.Database) => db.exec(SCHEMA);

let handle: Database.Database | undefined;

export function getDb(): Database.Database {
  if (handle) return handle;
  const path = process.env.DATABASE_PATH ?? "./data/beacon.db";
  mkdirSync(dirname(path), { recursive: true });
  handle = new Database(path);
  handle.pragma("journal_mode = WAL");
  createOwnTables(handle);
  return handle;
}

// better-sqlite3 keeps no statement cache, so `db.prepare(sql)` re-runs sqlite3_prepare_v2 every
// time. claimsFor() is on the hot path — it runs for every JWT Beacon signs, i.e. every proxied
// request — so the statements it needs are compiled once and reused.
const statements = new WeakMap<Database.Database, Map<string, Database.Statement>>();

/** The prepared statement for `sql`, compiled once per database handle. */
export function stmt(db: Database.Database, sql: string): Database.Statement {
  let perDb = statements.get(db);
  if (!perDb) {
    perDb = new Map();
    statements.set(db, perDb);
  }
  let prepared = perDb.get(sql);
  if (!prepared) {
    prepared = db.prepare(sql);
    perDb.set(sql, prepared);
  }
  return prepared;
}

// Tables only ever appear (instrumentation.ts migrates before the server takes traffic), so a table
// once seen is remembered rather than re-queried from sqlite_master on every claim resolution.
const known = new WeakMap<Database.Database, Set<string>>();

/** True when Better Auth's migrations have already created `name`; false on a database that predates them. */
export function tableExists(db: Database.Database, name: string): boolean {
  let seen = known.get(db);
  if (!seen) {
    seen = new Set();
    known.set(db, seen);
  }
  if (seen.has(name)) return true;
  const found = stmt(db, "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(name) !== undefined;
  if (found) seen.add(name);
  return found;
}
