# Test Confidence Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Make release confidence depend on tested financial-data invariants and a real desktop smoke run, rather than on passing AI-generated tests alone.

**Architecture:** Keep fast Vitest tests focused on real SQLite repository behaviour. Add fixture-based migration tests for historical databases, run mutation testing against narrow domain modules, and supplement browser E2E with a repeatable packaged-Tauri release checklist.

**Tech Stack:** SvelteKit 5, Vitest 3, better-sqlite3, Playwright, Tauri v2, SQLite.

## Global Constraints

- Use Node 22.22.3 and pnpm 10.11.0.
- Use integer smallest currency units; never use floating point.
- Database tests use `createTestDb()` unless testing a committed historical SQLite fixture.
- Add user-visible strings in both `messages/en.json` and `messages/vi.json` only when application behaviour changes.
- Run `pnpm test` before every commit; run `pnpm check` for TypeScript/Svelte changes.

---

### Task 1: Add a versioned migration-fixture test harness

**Files:**
- Create: `src/tests/fixtures/migrations/v003.sqlite` (released schema 3 — from `v0.1.0`)
- Create: `src/tests/fixtures/migrations/v004.sqlite` (released schema 4 — from `v0.1.1`)
- Create: `src/tests/fixtures/migrations/README.md` (fixture provenance and regeneration commands)
- Modify: `src/tests/unit/helpers/test-db.ts` (add file-path constructor)
- Modify: `src/tests/unit/migrations.test.ts`

**Provenance — fixture → release → schema version:**

| Fixture | Snapshotted from git tag | Migrations applied | `schema_version` |
| --- | --- | --- | --- |
| `v003.sqlite` | `v0.1.0` | 001, 002, 003 | `3` |
| `v004.sqlite` | `v0.1.1` (= `v0.1.2` = `v0.1.3`) | 001–004 | `4` |

Only schemas 3 and 4 were ever released. Schema versions 1 and 2 were never shipped (v0.1.0 already bundled migration 003), and schema 5 is the current unreleased build. The upgrade paths this task exercises are therefore **3 → 5** and **4 → 5** — the real upgrade paths real users will run. Do not create `v001`/`v002` fixtures unless a future release ships at an intermediate schema; pre-release synthetic fixtures do not catch release upgrade bugs.

**Regeneration (auditable binaries):** Each fixture is a committed `.sqlite` binary. Never run `git checkout` in the active worktree to recreate one. Use a disposable worktree at an explicit temporary path, for example `git worktree add --detach /tmp/notchy-fixture-v003 v0.1.0`. `README.md` must record the tag, exact seed IDs, commands, and SHA-256 checksum for each binary.

**Interfaces:**
- Consumes: `runMigrations(db, migrations)` from `src/lib/db/migrations/runner.ts`, plus a new `createTestDbFromPath(path)` from the test harness (Step 1).
- Produces: one test per released fixture asserting it upgrades to schema version `5` and preserves an account, transaction, and category-tag row.

- [x] **Step 1: Extend the test harness to open a file path.** `TestDatabase` is currently hardcoded to `:memory:` and `createTestDb()` takes no arguments (`src/tests/unit/helpers/test-db.ts`). Add `constructor(path?: string)` defaulting to `:memory:` and export `createTestDbFromPath(path: string): DatabaseService` so a committed fixture can be opened against real `better-sqlite3` — the production-compatible SQLite service the Global Constraints require. This must precede Step 2; without it no fixture test can load.
- [x] **Step 2: Snapshot each fixture in an isolated historical worktree.** Create `/tmp/notchy-fixture-v003` with `git worktree add --detach /tmp/notchy-fixture-v003 v0.1.0`; do not alter the active worktree HEAD. In that disposable worktree, create and run a temporary Vitest builder that uses a file-backed `better-sqlite3` database at `/tmp/v003.sqlite`, applies migrations 001–003, and inserts the documented account, tag, and transaction rows. Close the DB, copy it to `src/tests/fixtures/migrations/v003.sqlite`, then remove the disposable worktree. Repeat from `v0.1.1` for `v004.sqlite`; migration 004 adds `category_types.rollover_enabled`, which must remain at its seeded default. Record the tags, row IDs, and SHA-256 checksums in `src/tests/fixtures/migrations/README.md`.
- [x] **Step 3: Write a failing test that copies one fixture to a temporary path, opens it with `createTestDbFromPath`, runs `runMigrations`, and expects `schema_version` of `5`.** Confirm it fails before the upgrade runs (e.g. assert against `4`/`3` first) so the test is genuinely red, then flip to `5`.
- [x] **Step 4: Extend that test to query the distinguishable rows and assert their IDs, integer amount, and `tag_id` relationship are unchanged across the upgrade.** Assert one rejection/rollback path is unaffected (e.g. a constraint-violating insert still throws after upgrade) to satisfy the spec's data-integrity rule.
- [x] **Step 5: Run `pnpm vitest run src/tests/unit/migrations.test.ts`; expect all fixture-upgrade cases to pass.**
- [x] **Step 6: Commit with `test: cover upgrades from released database fixtures`.**

### Task 2: Establish mutation testing for high-risk domain modules

**Files:**
- Modify: `package.json`
- Create: `stryker.conf.mjs`
- Modify: `src/tests/unit/transactions.test.ts`
- Modify: `src/tests/unit/backup.test.ts`
- Modify: `src/tests/unit/rules_matcher.test.ts`
- Modify: `src/tests/unit/dedup.test.ts`

**Module sequencing — pure first, DB-backed second:**
- **Pure modules** (`src/lib/utils/rules_matcher.ts`, `src/lib/utils/dedup.ts`): no SQLite, fast, isolate Stryker-config correctness. Run these first to validate the runner before paying for slow real-DB mutation runs.
- **DB-backed modules** (`src/lib/db/repos/transactions.ts`, `src/lib/backup/index.ts`): real `better-sqlite3` per test, slow under mutation. Run only after the pure pass validates the config.

**SQL-mutation boundary:** Stryker can mutate TypeScript expressions and may replace an entire SQL string, which can reveal that a query is never exercised. It cannot reliably make semantic changes to one comparison or one WHERE predicate inside a string literal. Do not use a mutation score to claim SQL correctness. Protect every release-critical query with real-SQL integration tests that assert the exact rows included or excluded, ordering, limit, soft-delete state, and rollback outcome. Treat a whole-string mutant as a coverage signal only, and record it separately from semantic SQL-query confidence.

**Interfaces:**
- Consumes: the existing Vitest command and tests.
- Produces: `pnpm test:mutation` that mutates only the four high-risk modules above, sequenced pure-then-DB.

- [x] **Step 1: Pin both `@stryker-mutator/core` (CLI) and `@stryker-mutator/vitest-runner` after checking their compatible release pair against official Stryker documentation; add `test:mutation` as `stryker run`. Write `stryker.conf.mjs` with an initial `mutate` list containing only `src/lib/utils/rules_matcher.ts` and `src/lib/utils/dedup.ts`, and use the existing Vitest configuration. Do not add the DB-backed modules until Step 4.**
- [x] **Step 2: Run `pnpm test:mutation` against the two pure modules (`rules_matcher.ts`, `dedup.ts`) and list every surviving mutant by module. This validates the Stryker config before the slow DB-backed runs.**
- [x] **Step 3: For each pure-module survivor that represents a plausible user-visible defect, write an assertion that fails when that mutation is applied. Do not add tests for equivalent mutants.**
- [x] **Step 4: Extend `mutate` (or create a second `stryker.db.conf.mjs`) to include `src/lib/db/repos/transactions.ts` and `src/lib/backup/index.ts`. Before accepting its score, add or retain direct real-SQL integration tests for each release-critical WHERE, ordering, limit, soft-delete, and rollback invariant; whole-string SQL mutants are diagnostic only and do not substitute for those tests.**
- [x] **Step 5: For each DB-backed survivor representing a plausible user-visible defect, write an assertion that fails when that mutation is applied. Do not add tests for equivalent mutants.**
- [x] **Step 6: Re-run `pnpm test:mutation`; record the mutation score and accepted equivalent mutants in the pull request.**
- [x] **Step 7: Commit with `test: add mutation checks for financial data logic`.**

### Task 3: Make desktop release verification repeatable

**Files:**
- Create: `specs/2026-07-27-desktop-release-smoke-checklist.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: `pnpm tauri dev` and a manually installed packaged build.
- Produces: a release checklist and a `test:release-smoke` script that prints the checklist path and current package version.

- [x] **Step 1: Write checklist cases for first launch, onboarding, quick-add shortcut, tray actions, transaction create/edit/delete/transfer, restart persistence, backup/restore, CSV round-trip, and locale switch. Use one Markdown table per case with these columns: `Case`, `Expected persisted data`, `OS`, `Package version`, `Result (pass/fail)`, `Evidence path`, and `Notes`.**
- [x] **Step 2: Require a screenshot and app-log path for every failed case, and a screenshot for every destructive-data case (delete, restore, import). A completed row must contain OS, package version, and pass/fail result, so the document is a release audit record rather than a one-off note.**
- [x] **Step 3: Add `test:release-smoke` as a non-destructive Node script that prints exactly `Desktop release checklist: specs/2026-07-27-desktop-release-smoke-checklist.md` and the package version from `package.json`. Do not present it as automated Tauri coverage.**
- [x] **Step 4: Run `pnpm test:release-smoke` and `pnpm check`; expect the script to print the checklist and type checks to remain green.**
- [x] **Step 5: Commit with `docs: add desktop release smoke checklist`.**

## Self-Review

- Spec coverage: fixture upgrades cover real release upgrade paths (3→5, 4→5), mutation testing detects weak assertions (pure-then-DB, with the SQL-literal blind spot made explicit), and the checklist covers the unmockable desktop boundary with the spec's required OS/version/result audit fields.
- Placeholder scan: no application implementation is left unspecified; the fixture rows and surviving mutants must be concretely selected from observed command output during execution.
- Type consistency: all production APIs the plan names (`runMigrations`, the four mutation targets, the migration registry) exist in the current repository. The one new interface is `createTestDbFromPath` in the **test** harness (`src/tests/unit/helpers/test-db.ts`) — a test-only addition, not a production API change. No `src/lib/` interface changes.
- Release provenance: fixture filenames map to git tags (v0.1.0 → schema 3; v0.1.1+ → schema 4); regeneration steps are recorded so the committed `.sqlite` binaries stay reproducible from source.
