#!/usr/bin/env node

/**
 * Cutover scanner: fails if `@tauri-apps/plugin-sql` appears in any production source file,
 * or if legacy platform/startup/service files still exist.
 * Ensures the Tauri SQL plugin is fully removed after the native database cutover.
 */

import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(import.meta.dirname, "..");
const SRC_DIR = join(ROOT, "src");
const TARGET = "@tauri-apps/plugin-sql";

/**
 * Blank out comments, preserving every newline so line numbers stay aligned.
 *
 * A mention inside a comment is documentation, not a reference — `db/index.ts`
 * explains that the plugin was *removed*, and that sentence used to fail this
 * gate. String literals are deliberately kept: a dynamic `import("...")` is a
 * real reference.
 *
 * @param {string} source
 * @returns {string} same length and line structure, comments replaced by spaces
 */
export function stripComments(source) {
  let out = "";
  let state = "code";
  let quote = null;
  let i = 0;

  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];

    if (state === "code") {
      if (quote) {
        if (ch === "\\") {
          out += ch + (next ?? "");
          i += 2;
          continue;
        }
        if (ch === quote) quote = null;
        out += ch;
        i++;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        quote = ch;
      } else if (ch === "/" && next === "/") {
        state = "line";
        out += "  ";
        i += 2;
        continue;
      } else if (ch === "/" && next === "*") {
        state = "block";
        out += "  ";
        i += 2;
        continue;
      } else if (source.startsWith("<!--", i)) {
        state = "html";
        out += "    ";
        i += 4;
        continue;
      }
      out += ch;
      i++;
      continue;
    }

    if (state === "line") {
      if (ch === "\n") {
        state = "code";
        out += ch;
      } else {
        out += " ";
      }
      i++;
      continue;
    }

    if (state === "block") {
      if (ch === "*" && next === "/") {
        state = "code";
        out += "  ";
        i += 2;
        continue;
      }
      out += ch === "\n" ? "\n" : " ";
      i++;
      continue;
    }

    // html comment (svelte)
    if (source.startsWith("-->", i)) {
      state = "code";
      out += "   ";
      i += 3;
      continue;
    }
    out += ch === "\n" ? "\n" : " ";
    i++;
  }

  return out;
}

/**
 * Real references to TARGET, with the *original* line text for the report.
 * @param {string} source
 * @returns {{line: number, text: string}[]}
 */
export function findReferences(source) {
  const original = source.split("\n");
  const stripped = stripComments(source).split("\n");
  const hits = [];
  for (let i = 0; i < stripped.length; i++) {
    if (stripped[i].includes(TARGET)) {
      hits.push({ line: i + 1, text: (original[i] ?? "").trim() });
    }
  }
  return hits;
}

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

// --- Check for deleted legacy files ---

const LEGACY_FILES = [
  "lib/db/platform.ts",
  "lib/db/startup.ts",
  "lib/db/service.ts",
];

let legacyErrors = 0;
for (const relPath of LEGACY_FILES) {
  const fullPath = join(SRC_DIR, relPath);
  if (existsSync(fullPath)) {
    console.error(`FAILED: legacy file still exists: src/${relPath}`);
    legacyErrors++;
  }
}
if (legacyErrors > 0) {
  console.error(
    `\nFAILED: ${legacyErrors} legacy file(s) must be deleted after cutover.`
  );
  process.exit(1);
}

// --- Main ---

function main() {
  const files = collectFiles(SRC_DIR);
  let matches = 0;

  for (const file of files) {
    const references = findReferences(readFileSync(file, "utf-8"));
    for (const { line, text } of references) {
      console.log(`${relative(ROOT, file)}:${line}: ${text}`);
      matches++;
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
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main();
}
