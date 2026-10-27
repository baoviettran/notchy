# Automatic Backups Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Serves:** STORY-038

**Review revision:** 2026-10-26; see [review resolutions](../notes/2026-10-26-plan-review-resolution.md).

**Goal:** Keep verified recovery copies current without requiring a manual backup.

**Architecture:** Rust owns content revisions, daily eligibility, verified publication and retention under the profile coordinator. A session-bound UI controller requests checks on activation/resume and while open; multiple windows cannot publish the same daily job. Browser tests model policy and contracts without claiming filesystem durability.

**Tech Stack:** Rust/rusqlite/Tauri v2; TypeScript/Svelte 5; Vitest/Playwright.

**Spec:** `specs/2026-10-26-personal-finance-confidence-design.md`, sections 1–4, 10–11.

## Global Constraints

- Node 22.22.3 and pnpm 10.11.0; use the repository toolchain, not a global pnpm upgrade.
- Application data directory, isolated per profile; one automatic snapshot per local day when profile content changed.
- Keep seven daily representatives plus four weekly representatives, with overlap and a newest-per-schema recovery floor.
- Twelve-week forecasting and drafts are later plans; this slice must ship independently.
- Never prune manual, legacy, migration, reset, external or unregistered copies. Never revive the legacy JS auto-backup path.
- Existing Rust schema is 7; browser schema is 6. Add native migration 8 and browser migration 007; preserve released migrations. Recheck these numbers at execution if another change has landed.
- Native SQLite is authoritative; use existing coordinator paths and locks. No frontend SQL/filesystem backup calls, raw database hashing, or copying a live SQLite file.
- Write failing tests first using real SQLite. Before each commit run `pnpm test`; also `pnpm check` for TS/Svelte changes and affected Rust tests. Commit only task files, preserve the seven personal CSVs, never stage `docs/` or generated Paraglide files.
- Feature implementation starts in a suitable isolated worktree using the worktree skill. Carry these approved docs into that checkout explicitly; do not lose the currently uncommitted design/backlog changes.

- Verification must report a nonzero executed-test count and include the newly named behavior. A compile error is a valid initial red state; a successful command selecting zero tests is never green. Run each named integration test target without an unverified substring filter; inspect test discovery/counts before accepting results.

## Review Focus

1. A durable snapshot succeeds but metadata persistence fails: preserve it and reconcile the same job after restart, without pruning or publishing duplicates — Task 3.
2. Profile writes occur while publication is running: mark only the captured revision as backed up — Tasks 1 and 3.
3. DST/timezone changes or clock rollback: use local dates with stored offset, keep the newest actual recovery point, no deletion caused solely by clock changes — Task 2.
4. A copied/restored profile contains old backup paths: never prune the source profile's files — Task 3.
5. A long-running Quick Add window remains open when the main window closes: checks continue without duplicate timers or stale-session writes — Task 4.

## Files and contracts

New focused files:

- `src-tauri/src/database/automatic_backup.rs`: policy DTOs, registry/revision access and pure retention selection.
- `src-tauri/src/profiles/automatic_backup.rs`: session-safe orchestration and publication recovery.
- `src/lib/backup/automatic.ts`: activation/focus/visibility timer lifecycle.
- `src/lib/db/browser/automatic-backup.ts`: in-memory policy adapter.
- `src/lib/db/browser/migrations/007_automatic_backup.ts`: browser metadata tables/triggers.
- `src/tests/unit/automatic-backup.test.ts`, `src/tests/unit/automatic-backup-controller.test.ts`, `src-tauri/tests/automatic_backup.rs`: behavior tests.

Shared DTOs are declared in Rust and exported through `database/commands.rs` to `src/lib/native/contracts.generated.ts`; do not hand-edit generated bindings.

`BackupClock = { nowIso: string; localDate: string; isoWeek: string; offsetMinutes: number }` describes the native-observed clock. Frontend does not choose a publication path or supply success timestamps. Native test fixtures inject the clock.

`AutomaticBackupStatus = { enabled: boolean; contentRevision: number; backedUpRevision: number; lastSuccessAt: string | null; lastSuccessDate: string | null; nextEligibleDate: string | null; warning: string | null; pruneWarning: string | null }` uses checked safe integers for revisions.

`BackupOps` gains `automaticStatus(): Promise<AutomaticBackupStatus>`, `setAutomaticEnabled(enabled: boolean, options?: MutationOptions): Promise<void>` and `checkAutomatic(): Promise<AutomaticBackupStatus>`. Native commands: `backup_automatic_status`, `backup_automatic_set_enabled`, `backup_automatic_check`; all require the bound `ProfileSession`, and set-enabled uses caller operation IDs. Status means persisted/verified success, never just timer completion.

## Task 1: Track meaningful content revisions through a new migration

**Files:** Modify `src-tauri/src/database/{migrations,manifest,mod}.rs`, `src/lib/db/browser/migrations/index.ts`; create the two automatic-backup policy/migration files above; extend `src-tauri/tests/{automatic_backup,migrations}.rs` and `src/tests/unit/automatic-backup.test.ts`.

**Interfaces:** Produce native `read_automatic_status(conn: &Connection) -> DbResult<AutomaticBackupStatus>` and `install_content_revision_triggers(tx: &Transaction, tables: &[&str]) -> DbResult<()>`. Later migrations call the latter for their content tables. Browser migration exposes the same trigger semantics, not the same schema version number.

- [ ] **Step 1: Write failing migration/revision tests.** Build fresh and schema-7 native databases, schema-6 browser databases, and a minimal scratch-profile fixture. Assert `revision_after_expense > revision_before`, a rolled-back expense leaves the revision unchanged, and backup status/registry writes do not increment it. Test first-use settings/profile financial metadata via the explicit `app_meta` content-key allowlist `currency`, `first_run_complete`, `onboarding_step`; locale/theme/last-open/backup and receipt metadata do not count. Named behavior: `tracks_only_committed_content_changes`; decisive assertion: `assert_eq!(revision_after_rollback, revision_before)` (using that task’s fixture).
- [ ] **Step 2: Run to observe failure.** `cargo test --manifest-path src-tauri/Cargo.toml --test automatic_backup`; `pnpm exec vitest run src/tests/unit/automatic-backup.test.ts`. Expected missing schema/API failures before implementation.
- [ ] **Step 3: Implement migration and revision access.** Add singleton `automatic_backup_state` (enabled, content revision, backed-up revision, successful dates, publication/prune warnings) and `automatic_backup_copies` (copy ID, relative owned filename, schema, captured revision, local date/week, timestamp, publication job ID). Add triggers for current financial tables and allowlisted financial metadata; receipts/logs/scheduler bookkeeping never bump content. New enabled profile with meaningful content starts eligible. Update version-aware manifests and backup validation, and replace tests that assume native v008 is unsupported with an actually future-version fixture. Preserve prior version manifests.
- [ ] **Step 4: Verify.** Both commands from Step 2 pass; `cargo test --manifest-path src-tauri/Cargo.toml --test migrations` passes with verified pre-upgrade snapshot and atomic rollback assertions. Browser/native adapter tests keep their distinct version numbers.
- [ ] **Step 5: Commit.** Run required pre-commit checks; Commit with `feat(backup): track profile content revisions`.

## Task 2: Implement daily eligibility and verified retention policy

**Files:** Modify `src-tauri/src/database/automatic_backup.rs`, `src-tauri/src/database/mod.rs`, `src-tauri/Cargo.toml` and its lockfile; create `src-tauri/src/database/clock.rs`; extend `src-tauri/tests/automatic_backup.rs` and `src/tests/unit/automatic-backup.test.ts`; create shared fixture `src/tests/fixtures/automatic-backup-policy.json`.

**Interfaces:** Consume Task 1 metadata. Produce `automatic_backup_due(status: &AutomaticBackupStatus, clock: &BackupClock) -> bool` and `automatic_retention_ids(copies: &[AutomaticCopy], protected_id: &str) -> Vec<String>`. Define `AutomaticCopy` as the registry fields in Task 1 plus verification/ownership eligibility; returned IDs are deletion candidates, never arbitrary paths.

- [ ] **Step 1: Write failing pure-policy cases.** Assert no copy on unchanged content or a second changed write after today's successful copy; a changed profile becomes eligible next day. Assert `deletions ∩ {manual, reset, upgrade, legacy, corrupt, unknown, newest_per_schema, protected_id} = empty`. With eleven dates spanning four weeks assert union selection, not eleven mandatory retained files. Include ISO year boundary, DST, timezone crossing and backwards clock cases in the shared fixture. Named behavior: `retains_union_of_daily_weekly_and_schema_copies`; decisive assertion: `assert!(deletions.iter().all(|id| !protected.contains(id)))` (using that task’s fixture).
- [ ] **Step 2: Run red tests.** `cargo test --manifest-path src-tauri/Cargo.toml --test automatic_backup`; `pnpm exec vitest run src/tests/unit/automatic-backup.test.ts`. Expect missing policy/incorrect fixture assertions.
- [ ] **Step 3: Implement policy.** Add `pub fn local_backup_clock() -> BackupClock` in `database/clock.rs`, using `chrono::Local` from the already locked chrono 0.4.44 (declare it directly as `=0.4.44` with clock/std features; preserve other lockfile versions). Do not reuse the existing UTC-only `today_iso` helper for local dates. Expose an injected clock for native tests. Select latest verified representative by actual creation ordering for seven most recent snapshot-bearing dates and four ISO weeks, union the sets, then protect latest per schema and the new copy. Changed local-clock labels alone never authorize a destructive prune; defer pruning until time is trustworthy again. A restored profile has no trusted owned-copy registry until rebinding.
- [ ] **Step 4: Verify.** Commands from Step 2 pass against identical policy fixture cases; no floating-point timestamp/money shortcuts and no date parsing from ambiguous locale strings.
- [ ] **Step 5: Commit.** Run pre-commit checks; Commit with `feat(backup): select daily and weekly recovery copies`.

## Task 3: Publish automatic snapshots once and recover interrupted jobs

**Files:** Create `src-tauri/src/profiles/automatic_backup.rs`; modify `src-tauri/src/profiles/{mod,coordinator,backup}.rs`, `src-tauri/src/database/{automatic_backup,backup}.rs`; extend `src-tauri/tests/{automatic_backup,profile_backup}.rs`.

**Interfaces:** Consume Tasks 1–2 and existing verified publisher. Produce coordinator methods `automatic_backup_status(&self, session: &ProfileSession) -> DbResult<AutomaticBackupStatus>`, `check_automatic_backup(&self, session: &ProfileSession) -> DbResult<AutomaticBackupStatus>` (both async), and receipt-backed enable-setting under the session. Factor locked internal helpers rather than acquiring `transition.write()` recursively through `backup_for_session`.

- [ ] **Step 1: Write failing native fault tests.** Concurrent checks produce one owned copy. Inject failure before publication, after publication/before registry success, and during pruning. Assert prior copies remain, captured revision is recorded exactly, retry reconciles the same job ID, and a post-snapshot mutation remains dirty. Restore a snapshot into another profile; assert source files and registry are untouched. Inject unwritable/full filesystem behavior through controlled I/O failpoints, not by filling the user's disk. Named behavior: `reconciles_published_job_after_reopen`; decisive assertion: `assert_eq!(verified_automatic_copy_count, 1)` (using that task’s fixture).
- [ ] **Step 2: Run red tests.** `cargo test --manifest-path src-tauri/Cargo.toml --test automatic_backup`; expect missing coordinator behavior.
- [ ] **Step 3: Implement orchestration.** Persist pending publication job ID/captured revision before publication; use it as the stable owned target identity, reconcile a verified matching target after crash, and update success state only after durable verification. Use existing coordinator paths, publisher and transition ordering; never call a session-wrapped method while holding its lock. Expose a constrained `pub(crate) fn publish_backup_with_id(source: &Path, directory: &Path, job_id: &str, failpoint: BackupFailurePoint) -> DbResult<BackupToken>` wrapper around the existing private named publisher. It generates the standard schema/app-version/ULID filename from a validated job ULID; callers never supply arbitrary filenames. Register automatic ownership without labeling manual copies automatic. Revalidate before retention; preserve all files on publication/registry failure, distinguish pruning errors, and clear only errors resolved by the successful operation. On restore/reset rebind scheduler ownership and trigger fresh eligibility without trusting imported absolute paths.
- [ ] **Step 4: Verify.** Task 3 command and `cargo test --manifest-path src-tauri/Cargo.toml --test profile_backup` pass. Reopen the scratch coordinator between failpoint and retry; checking in one process alone is insufficient.
- [ ] **Step 5: Commit.** Run pre-commit checks; Commit with `feat(backup): run verified automatic profile snapshots`.

## Task 4: Wire typed commands, open-app checks and backup status

**Files:** Modify `src-tauri/src/database/commands.rs`, `src-tauri/src/lib.rs`, `src/lib/db/{client,native/client,native/backup,browser/client}.ts`, `src/lib/native/invoke.ts`, `src/lib/profiles/reset-state.ts`, `src/routes/{+layout,quick-add/+page,settings/backup/+page}.svelte`, both locale JSONs; create `src/lib/backup/automatic.ts`, browser adapter and controller test above; extend `src/tests/unit/components/{BackupPage,QuickAddPage}.test.ts` and native-boundary tests.

**Interfaces:** Produce the three `BackupOps` methods above. Produce `startAutomaticBackupChecks(db: AppDatabase, current: () => ProfileSession | null): () => void`, which performs an immediate check, checks every 60 seconds while open, checks on focus/visibility restoration, and returns complete cleanup. Capture the bound session; late results never update another profile's status.

- [ ] **Step 1: Write failing controller/component tests.** Assert activation/focus/timer checks use the bound profile; teardown clears timer/listeners; resume after date rollover checks once; main/Quick Add can both request checks with one native copy. Status toggles persist; publication failure displays a localized retryable warning and keeps last good success visible. Plain browser uses in-memory adapter without Tauri filesystem calls. Named behavior: `it('does ignore late backup results when the profile changes')`; decisive assertion: `expect(profileBStatus).toEqual(before)` (using that task’s fixture).
- [ ] **Step 2: Run red tests.** `pnpm exec vitest run src/tests/unit/automatic-backup-controller.test.ts src/tests/unit/components/BackupPage.test.ts src/tests/unit/components/QuickAddPage.test.ts src/tests/unit/native-boundary.test.ts`.
- [ ] **Step 3: Implement port, generated DTO exports, registration and controller.** Add set-enabled to the mutation command allowlist; status/check use native clock and idempotent job identity, not a financial receipt per timer tick. Register Tauri commands using `ProfileCoordinator` and session guards. Settings shows automatic enabled state, successful date, eligibility, real location, retry state and same-disk explanation. Use flat keys in both locales and tracked labels outside locale key. Add content-table registration seam for following migrations.
- [ ] **Step 4: Verify.** Step 2 command passes; `pnpm generate:db-contracts`, `pnpm check:db-contracts`, `pnpm check`, and affected native command tests pass.
- [ ] **Step 5: Commit.** Run pre-commit checks; Commit with `feat(backup): expose automatic backup controls and status`.

## Task 5: Prove installed-app recovery and document the new policy

**Files:** Extend `src/tests/e2e/backup-restore.spec.ts`; create `specs/notes/2026-10-26-automatic-backup-verification.md`; update `README.md`, `README.vi.md`, `ROADMAP.md` and STORY-038 only after acceptance.

**Interfaces:** Consume the complete slice. Produce recorded native backup/restore evidence and updated user policy, without claiming new platform support.

- [ ] **Step 1: Add failing user-journey assertions.** Settings enables automatic backup by default, changed profile produces a verified copy, the same-day second write waits, failed backup remains visible, and a manual copy is preserved by automatic retention. Browser E2E proves the UI contract; native fixture tests prove file contents and retention. Named behavior: `it('does preserve manual copies when automatic retention runs')`; decisive assertion: `expect(manualCopyStillExists).toBe(true)` (using that task’s fixture).
- [ ] **Step 2: Run red/targeted journey.** `pnpm exec playwright test src/tests/e2e/backup-restore.spec.ts`; first run must expose missing journey/UI assertions, not merely pass old tests.
- [ ] **Step 3: Complete integration and record native acceptance.** In an isolated test data root, run a real installed Linux binary, create synthetic financial data, trigger a due backup using a testable clock in the harness, reopen and restore-as-new, then compare IDs/balances. Verify real paths, successful copy hash and schema. Test backend failure via harness failpoints; do not ship a UI fault injector. Update documentation from observed behavior.
- [ ] **Step 4: Verify release-relevant checks.** Run `pnpm test`, `pnpm check`, `pnpm build`, `pnpm test:roadmap`, `pnpm check:db-contracts`, Rust tests and all-target Clippy. Run the affected production E2E serially with builds; retain command results and native evidence paths. Mark STORY-038 shipped only when acceptance passed.
- [ ] **Step 5: Commit.** Commit with `test(backup): verify automatic recovery and retention`.

## Handoff

After this slice passes, execute `specs/plans/2026-10-26-durable-transaction-drafts.md`. Extend revision tracking there for draft content; do not delay safe backup delivery for forecasting.

## Self-Review

Spec sections 3–4 map to Tasks 1–4; recovery and acceptance in sections 10–11 map to Tasks 3 and 5. The five review-focus cases have explicit owning tests. All five tasks have red/green commands, typed interfaces and distinct commit subjects. No implementation checkbox is complete.
