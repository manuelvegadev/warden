/**
 * Next.js server startup hook. Applies Better Auth's schema migrations to the SQLite database so
 * a fresh volume (Docker, Dokploy) works without running the CLI by hand; `pnpm auth:migrate`
 * remains the explicit way in development.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const [{ getMigrations }, { auth }] = await Promise.all([import("better-auth/db/migration"), import("@/lib/auth")]);
  const m = await getMigrations(auth.options);
  const pending = m.toBeCreated.length + m.toBeAdded.length + m.toBeAddedIndexes.length;
  if (pending === 0) return;
  await m.runMigrations();
  // biome-ignore lint/suspicious/noConsole: server startup log, no logger exists at this point
  console.log(`[beacon] auth schema migrated (${m.toBeCreated.length} tables, ${m.toBeAdded.length} column sets)`);
}
