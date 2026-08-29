/**
 * Per-file coverage gate.
 *
 * Fails CI if a touched `src/lib/**` file falls below its floor in
 * `specs/coverage-floors.json`. Targeted floors, not a global percentage:
 * a file with no floor entry always passes. Floors are monotonic — the
 * ratchet rule (Task 14) is `floor = max(current, observed - 5)`.
 *
 * Usage:
 *   pnpm test:coverage            # writes coverage/coverage-summary.json
 *   BASE_SHA=<base> node scripts/coverage-gate.mjs
 *
 * BASE_SHA defaults to HEAD~1 locally; CI sets it to the PR base SHA.
 */
import { readFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { relative } from 'node:path';

const ROOT = process.cwd();
const BASE_SHA = process.env.BASE_SHA || 'HEAD~1';

// Diff against the merge-base of HEAD and base, not base-branch-HEAD: that is
// exactly the set of files THIS PR changed. Base-HEAD sweeps in commits that
// landed on main after the PR branched, mis-flagging them as touched here.
let diffBase = BASE_SHA;
try {
  diffBase = execSync(`git merge-base HEAD ${BASE_SHA}`, { encoding: 'utf8' }).trim();
} catch {
  // Base object unavailable (e.g. shallow local checkout) — fall back to BASE_SHA.
}

const floors = JSON.parse(readFileSync('specs/coverage-floors.json', 'utf8'));
const summary = JSON.parse(readFileSync('coverage/coverage-summary.json', 'utf8'));

// Repo-relative paths of files changed since the base.
const touched = execSync(`git diff --name-only ${diffBase}`, { encoding: 'utf8' })
	.split('\n')
	.map((s) => s.trim())
	.filter(Boolean)
	.filter((p) => p.startsWith('src/lib/'));

// coverage-summary.json keys are absolute paths; map them to repo-relative.
const observed = {};
for (const [abs, d] of Object.entries(summary)) {
	if (abs === 'total') continue;
	observed[relative(ROOT, abs)] = d;
}

const report = [];
let failed = false;

for (const rel of touched) {
	const floor = floors[rel];
	if (!floor) continue; // no floor entry for this file -> pass

	const dat = observed[rel];
	if (!dat) {
		report.push(`FAIL ${rel}: has a floor in coverage-floors.json but no coverage data in this run`);
		failed = true;
		continue;
	}

	const stmtsOk = dat.statements.pct >= floor.stmts;
	const branchOk = dat.branches.pct >= floor.branch;
	report.push(
		`${stmtsOk && branchOk ? 'PASS' : 'FAIL'} ${rel}` +
			`  stmts floor=${floor.stmts} got=${dat.statements.pct}` +
			`  branch floor=${floor.branch} got=${dat.branches.pct}`
	);
	if (!(stmtsOk && branchOk)) failed = true;
}

console.log(report.length ? report.join('\n') : '(no touched src/lib files with floor entries — gate passes)');

if (failed) {
	console.error('\nCoverage gate FAILED — a touched bug-prone module is below its floor.');
	process.exit(1);
}
console.log('\nCoverage gate PASSED');