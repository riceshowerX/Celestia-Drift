#!/usr/bin/env node
/**
 * Deploy-time database migrator (node-postgres, `pg`).
 *
 * Runs during `npm run build` — on every Vercel deploy — applying pending files
 * under ../migrations (INCLUDING subdirectories, e.g. migrations/auth/) to
 * DATABASE_URL. Each file is applied in one transaction and recorded in a
 * `_migrations` table by basename, so it runs once and is safe to re-run (and
 * matches how the PGLite applier in src/lib/db.ts records files).
 *
 * No DATABASE_URL (local / preview builds) -> skip; the PGLite fallback applies
 * the same files at startup instead (see src/lib/db.ts).
 */
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join, sep } from "node:path";
import pg from "pg";
import { pendingMigrations } from "./migration-plan.mjs";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.log(
    "[migrate] DATABASE_URL not set — skipping (the PGLite fallback migrates itself).",
  );
  process.exit(0);
}

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

async function main() {
  let entries;
  try {
    // Recursive: entries are paths relative to migrationsDir, using the OS
    // separator (e.g. "auth\0001_auth.sql" on Windows). Normalize to posix so
    // both appliers see identical relative paths.
    entries = (await readdir(migrationsDir, { recursive: true })).map(
      (entry) => entry.split(sep).join("/"),
    );
  } catch {
    console.log("[migrate] no migrations/ directory — nothing to do.");
    return;
  }
  // An app with no schema of its own must not pay for a database connection.
  if (pendingMigrations(entries, []).length === 0) {
    console.log("[migrate] no migrations — nothing to do.");
    return;
  }

  const pool = new pg.Pool({ connectionString: databaseUrl, max: 1 });
  // Required by node-postgres: an idle-client error without a listener is an
  // uncaught exception that kills the build process.
  pool.on("error", (err) => console.error("[migrate] idle pg client error:", err));
  const client = await pool.connect();
  try {
    // Read the applied set before the loop. The bookkeeping table may not
    // exist yet on a fresh database (its CREATE TABLE now lives inside the
    // first migration transaction, #56), so an undefined-table error simply
    // means nothing has been applied.
    let applied = [];
    try {
      const seen = await client.query("SELECT name FROM _migrations");
      applied = seen.rows.map((row) => row.name);
    } catch (err) {
      if (err?.code !== "42P01") throw err; // 42P01: undefined_table
    }
    let count = 0;
    for (const { name, path } of pendingMigrations(entries, applied)) {
      const text = await readFile(join(migrationsDir, path), "utf8");
      try {
        await client.query("BEGIN");
        // Bookkeeping table created INSIDE the transaction (#56) so the DDL,
        // the schema statements and the tracking row commit or roll back
        // together.
        await client.query(
          "CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())",
        );
        // pg's simple-query protocol runs a whole multi-statement file at once.
        await client.query(text);
        await client.query("INSERT INTO _migrations (name) VALUES ($1)", [name]);
        await client.query("COMMIT");
      } catch (err) {
        console.error(`[migrate] error applying ${name}`);
        try {
          await client.query("ROLLBACK");
        } catch {
          // ROLLBACK fails when the connection died — keep the original error.
        }
        throw err;
      }
      console.log(`[migrate] applied ${name}`);
      count += 1;
    }
    console.log(count ? `[migrate] done — ${count} migration(s) applied.` : "[migrate] up to date.");
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((err) => {
  console.error("[migrate] failed:", err?.message || err);
  // pg errors carry the context needed to debug a bad SQL file.
  for (const key of ["code", "detail", "hint", "position", "where"]) {
    if (err?.[key] != null) console.error(`[migrate]   ${key}: ${err[key]}`);
  }
  process.exit(1);
});
