// @ts-check
/**
 * Migration bookkeeping shared by the two appliers — `scripts/migrate.mjs`
 * (deploy, recursive readdir) and `src/lib/db.ts` (PGLite preview, a recursive
 * Vite glob over migrations and its subdirectories).
 *
 * BOTH appliers recurse into subdirectories (e.g. migrations/auth/), and BOTH
 * go through `pendingMigrations`, which keys applied files by BASENAME. That
 * guarantees the two appliers use the SAME `_migrations` naming — a database
 * that already has `0001_auth.sql` will not re-run it, no matter which
 * directory the file was applied from (including the "copy auth/0001_auth.sql
 * up into migrations/" flow, which is why the key is the basename and not the
 * relative path).
 */

/**
 * The `_migrations` key for a migration path (or bare filename).
 * @param {string} path
 * @returns {string}
 */
export function migrationName(path) {
  return path.split("/").pop() ?? path;
}

/**
 * @param {string} path
 * @returns {boolean}
 */
export function isMigrationFile(path) {
  return path.endsWith(".sql");
}

/**
 * Migrations in `paths` that are not yet in `applied`, in apply order.
 * Non-`.sql` entries (a `readdir` also yields `migrations/auth/`) are dropped.
 * @param {Iterable<string>} paths
 * @param {Iterable<string>} applied
 * @returns {Array<{ name: string, path: string }>}
 */
export function pendingMigrations(paths, applied) {
  const done = new Set(applied);
  return [...paths]
    .filter(isMigrationFile)
    .map((path) => ({ name: migrationName(path), path }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .filter(({ name }) => !done.has(name));
}
