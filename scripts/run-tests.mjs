#!/usr/bin/env node
// @ts-check
/**
 * Cross-platform test runner.
 *
 * Replaces the previous shell-driven `npm test`, whose single-quoted globs
 * (e.g. 'scripts' glob for .test.mjs) are NOT expanded on Windows cmd.exe —
 * the script suite matched 0 files and still exited 0, so `npm test` reported
 * a FAKE GREEN (55/250 cases actually ran).
 *
 * Contract:
 *   1. Both suites (scripts and src test files) ALWAYS run — a failure in one
 *      does not skip the other.
 *   2. An empty suite is a FAILURE (non-zero exit), not a pass: a moved or
 *      renamed test directory must never look green again.
 *   3. No shell globbing: test files are collected with fs and passed to
 *      `node --test` as explicit paths, so behavior is identical on
 *      Windows/macOS/Linux CI.
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Recursively collect files under `dir` matching `suffix`, posix-style paths. */
function collectFiles(dir, suffix) {
  const found = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    return found; // missing directory -> empty suite (fails below)
  }
  for (const entry of entries) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...collectFiles(full, suffix));
    } else if (entry.name.endsWith(suffix)) {
      found.push(full);
    }
  }
  return found;
}

/** Run one suite; returns true when it passed. Empty file lists fail. */
function runSuite(label, nodeArgs, files) {
  if (files.length === 0) {
    console.error(`[test] ${label}: matched 0 test files — refusing to report a fake green.`);
    return false;
  }
  console.error(`[test] ${label}: ${files.length} file(s)`);
  const res = spawnSync(process.execPath, [...nodeArgs, "--test", ...files], {
    stdio: "inherit",
    cwd: root,
  });
  if (res.error) {
    console.error(`[test] ${label}: failed to spawn node: ${res.error.message}`);
    return false;
  }
  if (res.status !== 0) {
    console.error(`[test] ${label}: FAILED (exit ${res.status ?? "signal"})`);
    return false;
  }
  return true;
}

const scriptTests = collectFiles(join(root, "scripts"), ".test.mjs");
// TS tests run through --experimental-strip-types (Node 22 native TS support).
// The resolve hook adds `.ts` to extensionless relative imports, which src/
// modules use for bundler-style imports Vite resolves at build time.
const tsTests = collectFiles(join(root, "src"), ".test.ts");

const scriptOk = runSuite("scripts suite (.test.mjs)", [], scriptTests);
// Both suites always run; failures aggregate into one non-zero exit.
const tsOk = runSuite(
  "src suite (.test.ts)",
  ["--experimental-strip-types", "--import", "./scripts/ts-resolve-register.mjs"],
  tsTests,
);

if (!scriptOk || !tsOk) process.exit(1);
console.error("[test] all suites passed.");
