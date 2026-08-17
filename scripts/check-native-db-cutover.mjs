#!/usr/bin/env node

/**
 * Cutover scanner: fails if `@tauri-apps/plugin-sql` appears in any production source file.
 * Ensures the Tauri SQL plugin is fully removed after the native database cutover.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = join(import.meta.dirname, "..");
const SRC_DIR = join(ROOT, "src");
const TARGET = "@tauri-apps/plugin-sql";

/** Directories to skip entirely (relative to src/) */
const SKIP_DIRS = new Set([
  "node_modules",
  ".svelte-kit",
  "build",
  "lib/paraglide",
  "lib/db/browser",
]);

/** Exact file paths to skip (relative to src/) */
const SKIP_FILES = new Set(["tests/e2e/fixtures/tauri-mock.ts"]);

/** File extensions to scan */
const SCAN_EXTENSIONS = new Set([".ts", ".js", ".svelte"]);

/** File extensions to skip (test files) */
const TEST_EXTENSIONS = new Set([".test.ts", ".test.js", ".spec.ts", ".spec.js"]);

/**
 * Recursively collect files to scan.
 * @param {string} dir
 * @returns {string[]}
 */
function collectFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const fullPath = join(dir, entry);
    const relToSrc = relative(SRC_DIR, fullPath);
    const stat = statSync(fullPath);

    if (stat.isDirectory()) {
      // Check if this directory is in the skip set (match against relative path)
      const relParts = relToSrc.split("/");
      // Skip if any ancestor or the directory itself is in SKIP_DIRS
      let skip = false;
      for (let i = 1; i <= relParts.length; i++) {
        if (SKIP_DIRS.has(relParts.slice(0, i).join("/"))) {
          skip = true;
          break;
        }
      }
      if (!skip) {
        results.push(...collectFiles(fullPath));
      }
    } else if (stat.isFile()) {
      // Skip test files
      const isTest = [...TEST_EXTENSIONS].some((ext) => entry.endsWith(ext));
      if (isTest) continue;

      // Skip exact files in SKIP_FILES
      if (SKIP_FILES.has(relToSrc)) continue;

      // Only scan target extensions
      const hasScanExt = [...SCAN_EXTENSIONS].some((ext) => entry.endsWith(ext));
      if (!hasScanExt) continue;

      results.push(fullPath);
    }
  }
  return results;
}

// --- Main ---

const files = collectFiles(SRC_DIR);
let matches = 0;

for (const file of files) {
  const content = readFileSync(file, "utf-8");
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].includes(TARGET)) {
      const relPath = relative(ROOT, file);
      console.log(`${relPath}:${i + 1}: ${lines[i].trim()}`);
      matches++;
    }
  }
}

if (matches === 0) {
  console.log(`OK: "${TARGET}" not found in any production source file.`);
  process.exit(0);
} else {
  console.error(
    `\nFAILED: found ${matches} reference(s) to "${TARGET}" in production source files.`
  );
  process.exit(1);
}
