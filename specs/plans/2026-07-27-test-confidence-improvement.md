# Test Confidence Improvement Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

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
- Modify: `src/tests/unit/helpers/test-db.ts` (add file-path constructor)
- Modify: `src/tests/unit/migrations.test.ts`

**Provenance — fixture → release → schema version:**

| Fixture | Snapshotted from git tag | Migrations applied | `schema_version` |
| --- | --- | --- | --- |
| `v003.sqlite` | `v0.1.0` | 001, 002, 003 | `3` |
| `v004.sqlite` | `v0.1.1` (= `v0.1.2` = `v0.1.3`) | 001–004 | `4` |

Only schemas 3 and 4 were ever released. Schema versions 1 and 2 were never shipped (v0.1.0 already bundled migration 003), and schema 5 is the current unreleased build. The upgrade paths this task exercises are therefore **3 → 5** and **4 → 5** — the real upgrade paths real users will run. Do not create `v001`/`v002` fixtures unless a future release ships at an intermediate schema; pre-release synthetic fixtures do not catch release upgrade bugs.

**Regeneration (auditable binaries):** each fixture is a committed `.sqlite` binary. To regenerate or audit one, check out the release tag, run a fresh `createTestDb()` through that tag's `migrations` array, inject the distinguishable rows (Step 1), and `VACUUM` the file into place under `src/tests/fixtures/migrations/`. Record the regenerating tag in the fixture filename so the binary is reproducible from source.

**Interfaces:**
- Consumes: `runMigrations(db, migrations)` from `src/lib/db/migrations/runner.ts`, plus a new `createTestDbFromPath(path)` from the test harness (Step 1).
- Produces: one test per released fixture asserting it upgrades to schema version `5` and preserves an account, transaction, and category-tag row.

- [ ] **Step 1: Extend the test harness to open a file path.** `TestDatabase` is currently hardcoded to `:memory:` and `createTestDb()` takes no arguments (`src/tests/unit/helpers/test-db.ts`). Add `constructor(path?: string)` defaulting to `:memory:` and export `createTestDbFromPath(path: string): DatabaseService` so a committed fixture can be opened against real `better-sqlite3` — the production-compatible SQLite service the Global Constraints require. This must precede Step 2; without it no fixture test can load.
- [ ] **Step 2: Snapshot each fixture from its release tag.** For `v003.sqlite`, `git checkout v0.1.0`, run a fresh in-memory DB through that tag's `migrations` (001–003), then inject distinguishable rows using only tables/columns present at schema 3: one `accounts` row, one `category_tags` row, and one `transactions` row whose `tag_id` references that tag (all three tables and the `tag_id` FK exist from migration 001, so this shape is valid at every released schema). Repeat for `v004.sqlite` from `v0.1.1` (adds `category_types.rollover_enabled` from 004 — leave it at its seeded default; do not assert on it). `VACUUM` each into `src/tests/fixtures/migrations/`.
- [ ] **Step 3: Write a failing test that copies one fixture to a temporary path, opens it with `createTestDbFromPath`, runs `runMigrations`, and expects `schema_version` of `5`.** Confirm it fails before the upgrade runs (e.g. assert against `4`/`3` first) so the test is genuinely red, then flip to `5`.
- [ ] **Step 4: Extend that test to query the distinguishable rows and assert their IDs, integer amount, and `tag_id` relationship are unchanged across the upgrade.** Assert one rejection/rollback path is unaffected (e.g. a constraint-violating insert still throws after upgrade) to satisfy the spec's data-integrity rule.
- [ ] **Step 5: Run `pnpm vitest run src/tests/unit/migrations.test.ts`; expect all fixture-upgrade cases to pass.**
- [ ] **Step 6: Commit with `test: cover upgrades from released database fixtures`.**

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

**SQL-mutation blind spot:** the high-value mutations in `transactions.ts` and `backup/index.ts` live inside **SQL string literals** — `<` vs `<=`, column names, `WHERE` clauses, `ORDER BY`, `LIMIT`. Stryker mutates JS/TS expressions by default and may leave string-literal SQL untouched, producing a healthy-looking mutation score while financial-data bugs survive. Configure string-literal mutation for these two modules (Stryker's `StringLiteral` mutator is on by default, but verify it actually fires inside the tagged template SQL; if a mutation like `accounts` → `'Stryker was here!'` is reported as *equivalent* because the query is never executed by the matched test, that itself signals missing coverage). Surface and reason about each SQL mutant explicitly; do not let an aggregate score hide a surviving `WHERE` mutation.

**Interfaces:**
- Consumes: the existing Vitest command and tests.
- Produces: `pnpm test:mutation` that mutates only the four high-risk modules above, sequenced pure-then-DB.

- [ ] **Step 1: Pin `@stryker-mutator/vitest-runner` (verify Vitest 3 compatibility — the runner has version churn) and write `stryker.conf.mjs` limiting `mutate` to the four modules and the test command to the Vitest runner. Sequence the two pure modules first.**
- [ ] **Step 2: Run `pnpm test:mutation` against the two pure modules (`rules_matcher.ts`, `dedup.ts`) and list every surviving mutant by module. This validates the Stryker config before the slow DB-backed runs.**
- [ ] **Step 3: For each pure-module survivor that represents a plausible user-visible defect, write an assertion that fails when that mutation is applied. Do not add tests for equivalent mutants.**
- [ ] **Step 4: Extend `pnpm test:mutation` (or run a second config) to include the two DB-backed modules (`transactions.ts`, `backup/index.ts`). Verify SQL string-literal mutants actually fire inside tagged-template SQL; if they don't, flag which SQL mutation was missed and add a test that would catch it.**
- [ ] **Step 5: For each DB-backed survivor representing a plausible user-visible defect, write an assertion that fails when that mutation is applied. Do not add tests for equivalent mutants.**
- [ ] **Step 6: Re-run `pnpm test:mutation`; record the mutation score and accepted equivalent mutants in the pull request.**
- [ ] **Step 7: Commit with `test: add mutation checks for financial data logic`.**

### Task 3: Make desktop release verification repeatable

**Files:**
- Create: `specs/2026-07-27-desktop-release-smoke-checklist.md`
- Modify: `package.json`

**Interfaces:**
- Consumes: `pnpm tauri dev` and a manually installed packaged build.
- Produces: a release checklist and a `test:release-smoke` script that prints the checklist path and current package version.

- [ ] **Step 1: Write checklist cases for first launch, onboarding, quick-add shortcut, tray actions, transaction create/edit/delete/transfer, restart persistence, backup/restore, CSV round-trip, and locale switch.**
- [ ] **Step 2: For each case, specify expected persisted data and the failure evidence to capture (screenshot plus app log). Each case must also carry a results row recording the three fields the spec's P0 requires: OS, package version (`pnpm test:release-smoke` prints it), and pass/fail result — so a completed checklist is a release audit record, not a one-off note.**
- [ ] **Step 3: Add `test:release-smoke` as a non-destructive helper script pointing reviewers to the checklist; do not present it as automated Tauri coverage.**
- [ ] **Step 4: Run `pnpm test:release-smoke` and `pnpm check`; expect the script to print the checklist and type checks to remain green.**
- [ ] **Step 5: Commit with `docs: add desktop release smoke checklist`.**

## Self-Review

- Spec coverage: fixture upgrades cover real release upgrade paths (3→5, 4→5), mutation testing detects weak assertions (pure-then-DB, with the SQL-literal blind spot made explicit), and the checklist covers the unmockable desktop boundary with the spec's required OS/version/result audit fields.
- Placeholder scan: no application implementation is left unspecified; the fixture rows and surviving mutants must be concretely selected from observed command output during execution.
- Type consistency: all production APIs the plan names (`runMigrations`, the four mutation targets, the migration registry) exist in the current repository. The one new interface is `createTestDbFromPath` in the **test** harness (`src/tests/unit/helpers/test-db.ts`) — a test-only addition, not a production API change. No `src/lib/` interface changes.
- Release provenance: fixture filenames map to git tags (v0.1.0 → schema 3; v0.1.1+ → schema 4); regeneration steps are recorded so the committed `.sqlite` binaries stay reproducible from source.
