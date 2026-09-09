/**
 * ESM resolve hook for the TS test suite.
 *
 * src/ modules may use bundler-style extensionless relative imports (e.g.
 * `import { X } from "./app-data/types"`) — Vite resolves those at build
 * time, but `node --experimental-strip-types` follows strict ESM resolution
 * and fails with ERR_MODULE_NOT_FOUND. This hook retries failed relative
 * specifiers with a `.ts` extension so src/ modules stay testable without
 * changing their import style.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

export async function resolve(specifier, context, nextResolve) {
  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
    if (err?.code !== "ERR_MODULE_NOT_FOUND" || !isRelative || !context.parentURL) {
      throw err;
    }
    const base = new URL(specifier, context.parentURL);
    // TS convention: the explicit .ts extension. (.tsx is out of scope — the
    // strip-types runner is only pointed at .test.ts in src/lib.)
    const candidate = `${base.href}.ts`;
    if (existsSync(fileURLToPath(candidate))) {
      return nextResolve(candidate, context);
    }
    throw err;
  }
}
