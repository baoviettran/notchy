# Independent Financial Profiles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Serves:** STORY-037
**Goal:** Let users maintain independent financial profiles, reset or delete one safely, and recover a backup into a new profile without disturbing existing data.
**Architecture:** A native profile coordinator owns the application lock, durable registry and optional active database manager. Per-profile directories contain SQLite and backups; session-bound domain calls and a cross-window draft barrier protect switches. Browser adapters model the same behavior for tests; existing native backup/migration primitives retain responsibility for durable data.
**Tech Stack:** Rust, rusqlite, Tauri v2, TypeScript, SvelteKit/Svelte 5 runes, Vitest, Playwright.
**Spec:** [Approved design](../2026-10-19-profile-management-design.md)
**Status:** Ready for owner review; execution method not selected. All tasks below are unstarted.

## Global Constraints

- Use Node 22.22.3 and pnpm 10.11.0 from AGENTS.md. The planning environment currently has Node 24.22.0/pnpm 11.25.0; resolve the required toolchain at execution setup, do not silently change dependencies/lockfiles to suit it.
- Write failing tests, observe the intended failure, implement, and verify before committing. Run `pnpm test` before every commit and `pnpm check` for TypeScript/Svelte changes. Native changes also require their relevant Cargo tests.
- Run implementation in an isolated worktree following the worktree skill; preserve the seven pre-existing untracked root CSV files. No product implementation belongs in the planning commit.
- Each profile has one directory, database and internal backup tree. Restore always creates a new profile; no overwrite UI remains at completion. A zero-profile installation is valid.
- Use ULIDs; money stays integer smallest units. Trim names, reject empty names and names longer than 80 Unicode characters, allow duplicate names. In TS count code points with `Array.from(name).length`, matching Rust `chars().count()`.
- Locale/theme are application preferences. Currency/onboarding/tour are profile-specific. Existing stored locale is adopted once. Do not change preferences when restoring a financial backup.
- Do not edit generated Paraglide sources. Add flat underscore keys to both locale JSON files, compile messages, and preserve the locale key/draft boundary.
- Keep domain SQL behind ports. Browser/native predicates and ordering agree. Native filesystem behavior requires native evidence, not just browser mocks.
- Keep `specs/STATUS.md` generated. Every completed task has all its checkboxes checked and its exact commit subject in history. Use the final-step `Commit with` directive below for roadmap parsing.
- After each task's focused checks, run the global pre-commit checks, stage only that task's files, and commit. Finish whole-branch review before integration; never force-push main.

## Review Focus

1. A profile name made of astral Unicode characters must have the same 80-character limit in Rust and JS; duplicate labels must remain distinguishable. Tests: Tasks 1, 8, 11.
2. Quick Add misses an event or wakes after a reset of the same profile: stale requests must fail, and a hidden unsaved draft must block switching. Tests: Tasks 2, 9, 12.
3. A source backup changes after inspection, or an export destination resolves through a symlink into managed storage: no wrong snapshot import or disappearing export. Tests: Tasks 4, 5.
4. The app crashes after a directory rename but before a registry write, or a committed deletion cannot remove all bytes: recovery must not duplicate/resurrect profiles or claim complete cleanup. Tests: Tasks 3, 5, 14.
5. Legacy WAL data and backups survive interrupted adoption; deletion of the last adopted profile must not recreate it on next launch. Tests: Tasks 6, 14.

## File and interface map

New Rust module `src-tauri/src/profiles/`:

- `types.rs`: generated serializable records, requests, sessions, outcomes and tagged errors.
- `registry.rs`: private atomic JSON storage and preferences; `paths.rs`: ID-derived paths/containment.
- `journal.rs`: durable operation phases/replay; `coordinator.rs`: admission, lock ownership and activation.
- `create.rs`, `backup.rs`, `reset.rs`, `delete.rs`, `legacy.rs`: one lifecycle responsibility each.
- `commands.rs`: guarded Tauri adapters; `mod.rs`: module exports only.

New frontend `src/lib/profiles/`: `types.ts` reexports generated DTOs; `port.ts` defines the service; `native.ts` and `browser.ts` implement it; `session.ts` binds immutable sessions; `drafts.svelte.ts` tracks dirty surfaces; `windows.ts` coordinates registered webviews. `src/lib/stores/profiles.svelte.ts` owns picker/operation state. Keep the existing `session.svelte.ts` (other UI session behavior) separate.

New UI: `ProfileSwitcher.svelte`, `ProfileManager.svelte`, `ProfileDialogs.svelte` under `src/lib/components/profiles/`; `/profiles` and `/settings/profiles` routes. Existing backup/recovery and Quick Add consume this service.

### Shared contract (defined in Task 1, consumed throughout)

Rust DTOs use serde camelCase; generated TS field names below are authoritative. Sessions use a generation ULID string, not a JS numeric counter, and a new generation is issued on every activation/reset/rollback reopen.

```ts
type ProfileSession = { profileId: string; generation: string };
type ProfileRecord = { id: string; name: string; createdAt: string };
type AppPreferences = { locale: 'en' | 'vi'; theme: 'auto' | 'light' | 'dark' };
type ProfileRegistry = { version: 1; profiles: ProfileRecord[];
  lastActiveId: string | null; legacyAdopted: boolean };
type ProfileSnapshot = { profiles: ProfileRecord[]; active: ProfileSession | null;
  phase: 'idle' | 'transitioning' | 'recovery'; preferences: AppPreferences;
  recovery: { profileId: string | null; code: string; retryable: boolean } | null };
type RestorePreview = { token: string; suggestedName: string; schemaVersion: number };
type DeleteResult = { cleanupPending: boolean };
type OperationContext = { operationId: string; transitionToken: string | null };
```

`ProfilePort` promises: `load(): ProfileSnapshot`, `paths(id): ProfileStoragePaths`, `backups(id): BackupSummary[]`, `create(name, context): ProfileRecord`, `rename(id, name): ProfileRecord`, `activate(id, transitionToken): ProfileSession`, `backup(id): string`, `exportBackup(id, targetPath): void`, `inspectRestore(sourcePath): RestorePreview`, `restore(token, name, context): ProfileRecord`, `reset(id, context): void`, `delete(id, context, exportPath: string | null): DeleteResult`, `setPreferences(preferences): void`. `ProfileStoragePaths` has string fields `dataDir`, `databasePath`, `routineBackupDir`, `upgradeBackupDir`, `resetBackupDir`. `BackupSummary` retains the existing native backup DTO shape. All return `Promise<...>` in TS. `load` reports state and does not open a financial database; bootstrap owns legacy adoption/last-profile activation.

Native equivalents are async `DbResult<T>` methods on `ProfileCoordinator`; Rust names use snake_case. `OperationContext` carries a stable ULID per user intent for durable retry receipts. Active reset/delete and activation require a consumed-once transition token, obtained from the draft barrier; create, inactive operations and restore accept null. Public JS cannot bypass a barrier with an arbitrary token. Create publishes a profile; the UI activates it as a second step. If activation fails, keep the valid newly created profile available in the picker and retain the previous active profile. This separates creation failure (no published profile) from activation failure.

The registry persists profiles/selection, journals persist lifecycle operations and replay results, and preferences persist independently. Session generation and transition tokens are process-scoped and invalid after restart. No new financial schema version is required: display-name backup metadata uses the existing `app_meta` key-value table in the staged snapshot.

## Execution order

Tasks 1–6 build tested native units without changing production startup. Tasks 7–12 build the command/adaptor/UI integration behind the existing entry point. Task 13 makes the complete flow authoritative in one cutover and removes compatibility routing; Task 14 verifies the desktop and crash boundaries. Keep unreleased wiring out of user navigation until Task 13. This is one dependent subsystem, not independent parallel product projects.

### Task 1: Durable registry, paths and preferences

**Files:** Create `src-tauri/src/profiles/{mod,types,paths,registry}.rs`, `src-tauri/tests/profile_registry.rs`; modify `src-tauri/src/lib.rs` to export the module only.
**Interfaces:** Produces shared DTOs, `ProfilePaths::new(config: PathBuf, data: PathBuf)`, `profile_dir(id: &str) -> DbResult<PathBuf>`, `validate_name(&str) -> DbResult<String>`, `RegistryStore::load() -> DbResult<ProfileRegistry>`, `save(&ProfileRegistry) -> DbResult<()>`, preference load/save. Missing registry is empty; malformed registry is an error. Missing preferences use detected locale/current theme defaults supplied by bootstrap.

- [x] **Step 1: Add failing native tests** for missing versus corrupt registry, atomic replacement, duplicate IDs, invalid/traversal IDs, preferences independent of profiles, and private Unix permissions. Pin names with `assert_eq!(validate_name("  Cá nhân  ")?, "Cá nhân"); assert!(validate_name(&"😀".repeat(81)).is_err()); assert!(validate_name(&"😀".repeat(80)).is_ok());`. Duplicate names with different IDs are accepted. Inject a failed publish and assert old registry bytes remain readable.
- [x] **Step 2: Run red:** `cargo test --manifest-path src-tauri/Cargo.toml --test profile_registry`; expect missing profile API or intended assertion failures, not unrelated build failures.
- [x] **Step 3: Implement registry/path primitives.** Version 1 JSON, ULID-only path segments, 0700 directories/0600 files on Unix, temp write → file sync → rename → parent sync. Expose injected filesystem failure points for deterministic tests; never use real user directories in tests.
- [x] **Step 4: Run green:** repeat Task 1 command; all assertions pass, including failed-publication preservation.
- [x] **Step 5: Commit** — Commit with `feat(profiles): add durable registry and profile paths`.

### Task 2: Session admission and application lock ownership

**Files:** Create `src-tauri/src/profiles/coordinator.rs`, `src-tauri/tests/profile_sessions.rs`; modify `src-tauri/src/database/{executor,connection}.rs`, `src-tauri/tests/{database_executor,process_lock}.rs`.
**Interfaces:** Consumes registry/paths. Produces `ProfileCoordinator::open(paths: ProfilePaths) -> DbResult<Arc<Self>>`, `load`, and `with_session<T,F>(&self, session: &ProfileSession, job: F) -> DbResult<T>` where `F` consumes the admitted manager for exactly the awaited operation. Add `DatabaseManager::spawn_with_lock(paths, queue_capacity, Arc<ProcessLock>)`; existing `spawn` delegates for current callers. Coordinator holds the app lock across zero-profile and switching states.

- [x] **Step 1: Add failing tests** that hold an admitted A write while requesting B, then assert `write_destination == A`, `active == B` only after A drains, and an A-generation request returns `ProfileSessionExpired`. Assert reset/reopen gets a different generation, concurrent lifecycle requests serialize, and another process cannot acquire the lock when no database is open.
- [x] **Step 2: Run red:** `cargo test --manifest-path src-tauri/Cargo.toml --test profile_sessions --test process_lock --test database_executor`.
- [x] **Step 3: Implement admission and manager lifetime.** A read permit covers the full awaited job; lifecycle changes take the exclusive permit, drain work, then close/open. Never export a manager handle beyond admission. Add coordinator activation internals with explicit rollback; last-active is persisted only after success. Error states are typed, not panics.
- [x] **Step 4: Run green:** repeat tests and assert both target-open failure with successful rollback and double-open failure (recovery with no writable session). Existing single-manager tests still pass.
- [x] **Step 5: Commit** — Commit with `refactor(profiles): bind database work to profile sessions`.

### Task 3: Journaled creation, rename and replay

**Files:** Create `src-tauri/src/profiles/{journal,create}.rs`, `src-tauri/tests/profile_lifecycle.rs`; modify coordinator and profile types.
**Interfaces:** Produces `create(name, context)`, `rename(id, name)` and `reconcile_operations() -> DbResult<()>`. `JournalRecord` contains operation ID/kind, target ID, phase (`prepared`, `published`, `committed`, `cleanup_pending`), staged paths and serialized result. Repeated operation IDs return the original result; a conflicting payload fails. Tests use isolated real SQLite seeded via the current startup/migration functions.

- [x] **Step 1: Add failing tests**: create two distinct empty seeded profiles; rename preserves ID/path; repeated create returns one ID; crash after directory publication before registry commit is reconciled once. Assert `profiles.len() == 1` after retry and `original_database_hash == hash_after_rename`.
- [x] **Step 2: Run red:** `cargo test --manifest-path src-tauri/Cargo.toml --test profile_lifecycle`.
- [x] **Step 3: Implement staged initialization and commit journal.** Validate new DB, sync and publish directory, commit registry/result receipt, then clear transient staging. Replay is deterministic from phase plus actual files. Do not treat arbitrary orphan directories as profiles; clean only validated operation-owned staging.
- [x] **Step 4: Run green:** repeat Task 3 command; failed create never produces a selectable partial database and retry never duplicates a committed profile.
- [x] **Step 5: Commit** — Commit with `feat(profiles): create and rename profiles with crash recovery`.

### Task 4: Per-profile backup and restore as new

**Files:** Create `src-tauri/src/profiles/backup.rs`, `src-tauri/tests/profile_backup.rs`; modify `src-tauri/src/database/{backup,manifest}.rs` only where shared primitives need extraction.
**Interfaces:** Produces coordinator `backup`, `export_backup`, `inspect_restore`, `restore` using Task 3 journal. Preview token references an app-owned verified snapshot, schema and digest; it is opaque to JS, expires with the operation/session lifecycle and is consumed or explicitly canceled. Add `cancel_restore(token) -> DbResult<()>` and matching port method for abandoned dialogs. Restore produces a new ULID and never activates automatically.

- [x] **Step 1: Add failing tests** using fixtures `v004.sqlite`, `v008.sqlite` and a newly initialized DB: source bytes unchanged, all financial tables/settings survive, destination ID differs, legacy missing label gets a fallback, current preferences unchanged. Assert `source_before == source_after`, `restored.id != original.id`, and corrupt/newer/unrelated files leave registry length unchanged. Replace the source after inspection and assert restoration uses the verified staged snapshot, never new unverified bytes.
- [x] **Step 2: Run red:** `cargo test --manifest-path src-tauri/Cargo.toml --test profile_backup --test backup_restore`.
- [x] **Step 3: Implement snapshot-based restore and exports.** Reuse native online backup, validation and migrations. Record `profile_display_name` in the staged export's `app_meta` before final validation, without changing live data or financial schema. Backup health is per target; inactive profiles use isolated maintenance connections under the lifecycle lock. Canceled previews are removed, startup removes abandoned previews, completed retries return the same new record.
- [x] **Step 4: Run green:** repeat Task 4 command; add export failure preserving an existing target and restore failure preserving all other directories. Supported schema policy comes from `inspect_schema`, never scattered version literals.
- [x] **Step 5: Commit** — Commit with `feat(profiles): back up and restore independent profiles`.

### Task 5: Reset, delete and cleanup recovery

**Files:** Create `src-tauri/src/profiles/{reset,delete}.rs`, `src-tauri/tests/profile_reset_delete.rs`; modify journal, coordinator and backup retention.
**Interfaces:** Produces `reset(id, context)` and `delete(id, context, export_path: Option<PathBuf>) -> DbResult<DeleteResult>`. Active operations consume a Task 9 transition token through the coordinator's barrier validator; native tests use its test-only authorization fixture, never a production bypass. Produces `validate_external_export(path: &Path) -> DbResult<()>` using canonical existing ancestors and managed-root containment.

- [x] **Step 1: Add failing tests** asserting reset retains ID/name/backups, clears financial data/onboarding, and backup failure preserves the original DB. Assert delete-last yields `profiles.is_empty()` and no active session; inactive deletion leaves active unchanged. Inject cleanup failure and assert `cleanup_pending == true`, profile absent, and restart cleanup does not resurrect it. Assert canceled/failed export-first leaves profile present, including symlink aliases into managed storage.
- [x] **Step 2: Run red:** `cargo test --manifest-path src-tauri/Cargo.toml --test profile_reset_delete`.
- [x] **Step 3: Implement journaled reset/delete.** Reset publishes a verified protected snapshot under `backups/resets`, stages a fresh DB and swaps with rollback. Retain the latest pre-reset point until the next successful reset. Delete renames to operation-owned trash, commits registry removal, then cleans; before commit roll back, after commit report pending cleanup. Reject exports into any managed profile/staging/trash tree.
- [x] **Step 4: Run green:** repeat Task 5 tests; assert other profiles and external exports retain exact bytes after failure/replay. New reset generation invalidates old Quick Add sessions even with the same profile ID.
- [x] **Step 5: Commit** — Commit with `feat(profiles): reset and delete profiles safely`.

### Task 6: Adopt existing desktop data exactly once

**Files:** Create `src-tauri/src/profiles/legacy.rs`, `src-tauri/tests/profile_legacy.rs`; modify registry/journal/coordinator as needed.
**Interfaces:** Produces `adopt_legacy() -> DbResult<()>` and `bootstrap() -> DbResult<ProfileSnapshot>`. Bootstrap acquires the already-owned app lock, reconciles operations, adopts once, loads shared preferences, and attempts last-active activation. Missing selection returns picker state; corrupt selected data returns recovery state with the record preserved.

- [x] **Step 1: Add failing tests** for legacy data plus routine/upgrade backups and WAL transactions; interruption before/after registry commit; corrupt legacy DB with usable backup; stored locale/currency/tour preservation. Assert `profile.name == "Cá nhân"`, exactly one adopted profile, backup bytes preserved, and after deleting it `bootstrap().profiles.is_empty()` despite leftover old files.
- [x] **Step 2: Run red:** `cargo test --manifest-path src-tauri/Cargo.toml --test profile_legacy`.
- [x] **Step 3: Implement copy/verify/commit/retire adoption.** Use existing WAL checkpoint and integrity handling; do not assume config/data roots share a filesystem. Commit the adoption marker with registration before retiring legacy owned files. Corrupt DB is quarantined as the registered legacy profile's recoverable data, with backups copied unchanged; never replace corruption with a seeded blank DB. Existing application preferences win over legacy metadata.
- [x] **Step 4: Run green:** repeat Task 6 tests; also assert fresh install with no legacy DB starts empty and registry corruption never triggers automatic legacy adoption.
- [x] **Step 5: Commit** — Commit with `feat(profiles): adopt existing data into the first profile`.

### Task 7: Native profile commands and generated contracts

**Files:** Create `src-tauri/src/profiles/commands.rs`, `src-tauri/tests/profile_commands.rs`; modify `src-tauri/src/database/{commands,error}.rs`, `src-tauri/src/profiles/types.rs`, `src/lib/native/contracts.generated.ts`, `src/lib/utils/errors.ts`, `messages/{en,vi}.json`. Register new commands in `src-tauri/src/lib.rs` without yet replacing current startup ownership.
**Interfaces:** Profile command names are `profiles_load`, `profile_paths`, `profile_discover_backups`, `profile_create`, `profile_rename`, `profile_activate`, `profile_backup`, `profile_export_backup`, `profile_inspect_restore`, `profile_cancel_restore`, `profile_restore`, `profile_reset`, `profile_delete`, `app_preferences_set`. Parameters map to port names plus `context`; no caller-provided internal paths. `profiles_load` and profile path/backup discovery are readable by both webviews; mutations are main-window-only. Profile commands use managed `Arc<ProfileCoordinator>` once Task 13 installs it. Tests inject it now.

- [ ] **Step 1: Add failing command tests** for main versus Quick Add authorization, malformed IDs, null/missing transition tokens on active mutation, source validation and typed result DTOs. Add errors `ProfileNotFound`, `ProfileNameInvalid`, `ProfileSessionExpired`, `ProfileRegistryInvalid`, `ProfileTransitionBlocked`, `ProfileOperationConflict`, `ProfileExportUnsafe`; reuse existing DB/IO error codes when their meanings fit.
- [ ] **Step 2: Run red:** `cargo test --manifest-path src-tauri/Cargo.toml --test profile_commands --test contracts`.
- [ ] **Step 3: Implement adapters and export DTOs** through existing `generate_bindings`, extend exhaustive localized error mapping in both languages, and add profile command fixtures to `src/tests/unit/native-boundary.test.ts` when command registration requires them. No raw SQL/file-copy bridge in JS.
- [ ] **Step 4: Run green:** Task 7 Cargo command, `pnpm generate:db-contracts`, `pnpm check:db-contracts`, compile Paraglide with the repo command, and `pnpm check`; contract generation is deterministic.
- [ ] **Step 5: Commit** — Commit with `feat(profiles): expose typed native profile operations`.

### Task 8: Browser/native profile ports and immutable session adapters

**Files:** Create `src/lib/profiles/{types,port,native,browser,session}.ts`, `src/tests/unit/profiles-port.test.ts`, `src/tests/unit/profile-session.test.ts`; modify `src/lib/db/native/{client,backup,schedules}.ts` and `src/lib/db/browser/client.ts` to support explicit bound invocation without activating it in bootstrap yet; extend `src/tests/unit/native-boundary.test.ts`.
**Interfaces:** Implements shared `ProfilePort` including `cancelRestore`. `createSessionInvoker(session: ProfileSession): <T>(command: string, args?: Record<string, unknown>) => Promise<T>` always captures the immutable session. `assertCurrentSession(expected, actual): void` throws on profile or generation mismatch. Browser port accepts injected `createDatabase: () => Promise<DatabaseService>` and snapshot import/export functions; tests supply `createTestDb()`.

- [ ] **Step 1: Add failing tests** with two real SQLite databases asserting isolated accounts/rules/currency, identical name validation and duplicate restore naming. Pin `expect(() => assertCurrentSession(oldSession, newSession)).toThrow()` for same-ID/new-generation; assert invoking a delayed A command still sends A, never reads a mutable global B token.
- [ ] **Step 2: Run red:** `pnpm exec vitest run src/tests/unit/profiles-port.test.ts src/tests/unit/profile-session.test.ts src/tests/unit/native-boundary.test.ts`.
- [ ] **Step 3: Implement both ports and bound clients.** Browser operations retain existing development persistence guarantees; adapters enforce generation checks at admission and response consumption. Keep profile services callable without `getDb()`. Add injectable invoker constructors to native domain ops, so all operations including backup/schedules share one bound session.
- [ ] **Step 4: Run green:** repeat focused tests and `pnpm check`. Assert metadata preferences never bleed from a restored DB; no SQL-mocking shortcuts.
- [ ] **Step 5: Commit** — Commit with `feat(profiles): add profile ports and session-bound adapters`.

### Task 9: Cross-window draft barrier

**Files:** Create `src/lib/profiles/{drafts.svelte,windows}.ts`, `src-tauri/src/profiles/windows.rs`, `src/tests/unit/profile-drafts.test.ts`, `src-tauri/tests/profile_windows.rs`; modify coordinator/types/profile commands.
**Interfaces:** `registerDraft(id: string, isDirty: () => boolean, discard: () => void): () => void`; `resolveDrafts(choice: 'stay' | 'discard' | 'cancel'): Promise<boolean>`. Native `profile_prepare_transition(expected: ProfileSession | null) -> TransitionRequest`, `profile_ack_transition(request_id, dirty: bool, resolved: bool)`, `profile_cancel_transition(request_id)`; request contains ULID, expected session and required existing webview labels. Sender label is read from Tauri window, never JS input. A resolved request emits `profile:transition-ready` with `{requestId, transitionToken}` to main. Other events are `profile:prepare-transition` with `{requestId, expectedSession}`, `profile:transition-canceled` with `{requestId}`, and `profile:session-changed` with `{session: ProfileSession | null}` to all windows. The JS `windows.ts` module subscribes before making requests and tears listeners down after completion/cancellation.

- [ ] **Step 1: Add failing tests** that dirty main/hidden Quick Add blocks until resolved, cancellation preserves drafts, discard applies only to acknowledged session, a new keystroke during preparation cannot be lost, and nonresponsive live windows block. Assert `token.is_none()` until every registered participant acknowledges the current request/session and editor inputs are frozen for transition.
- [ ] **Step 2: Run red:** `pnpm exec vitest run src/tests/unit/profile-drafts.test.ts` and `cargo test --manifest-path src-tauri/Cargo.toml --test profile_windows`.
- [ ] **Step 3: Implement request/ack/release protocol.** Snapshot native existing windows; register windows with coordinator on readiness and deregister on actual destruction. Freeze edits while acknowledged; cancel unfreezes. Missed events are reconciled on focus/command, not assumed clean. Tokens are one-use, session-bound and required by Task 5 active mutations and activation. No timeout implies consent; surface blocked participants.
- [ ] **Step 4: Run green:** repeat both tests and update generated DTOs/contracts. Test close/reopen of Quick Add between request and commit, duplicate acknowledgments and token replay.
- [ ] **Step 5: Commit** — Commit with `feat(profiles): coordinate drafts across application windows`.

### Task 10: Frontend lifecycle store and shared preferences

**Files:** Create `src/lib/stores/profiles.svelte.ts`, `src/lib/profiles/reset-state.ts`, `src/tests/unit/profiles-store.test.ts`; modify `src/lib/stores/{settings,db,tour}.svelte.ts`, `src/lib/stores/quick-refresh.ts`, `src/lib/logic/post-due-schedules.ts`, `src/routes/+layout.ts` and profile-bound stores (`accounts`, `transactions`, `categories`, `budgets`, `goals`, `debts`, `schedules`, `rules`, `reports`, `import`, `rule-ui`, `ui-hint`).
**Interfaces:** Store produces `snapshot`, `busy`, `error`, `load()`, `switchTo(id)`, `createAndOpen(name)`, `reset(id)`, `remove(id, exportPath)`, `restore(token, name)`. `resetProfileState(session: ProfileSession | null): void` clears the explicitly registered stores, entity selections and listener leases. `settings.loadAppPreferences()` and `settings.loadProfileSettings()` split ownership; `settings.load()` composes for current callers until cutover.

- [ ] **Step 1: Add failing tests** for open success, rollback, rollback failure, create success followed by activation failure (new valid profile remains listed), reset generation change, and empty picker. With controlled promises assert a late A read cannot refill B stores. Assert restore leaves current draft/session alone and preferences persist through restore/reset.
- [ ] **Step 2: Run red:** `pnpm exec vitest run src/tests/unit/profiles-store.test.ts src/tests/unit/settings-store.test.ts src/tests/unit/stores/settings.theme.test.ts`.
- [ ] **Step 3: Implement store orchestration and reset hooks.** Coordinate draft barrier before destructive active transitions; always release barriers on failure. After activation, bind adapter, reset state, load profile settings, and run main-only idempotent schedule catch-up once for that activation. Route to dashboard/onboarding only after readiness. Persist locale/theme through application port and broadcast preference updates to windows; boot locale sniff remains synchronous.
- [ ] **Step 4: Run green:** repeat tests and add assertions that repeated ready effects do not duplicate schedule posting or listeners, and preference errors do not select a wrong profile. Run `pnpm check`.
- [ ] **Step 5: Commit** — Commit with `feat(profiles): orchestrate profile state and shared preferences`.

### Task 11: Profile picker, manager and dialogs

**Files:** Create `src/lib/components/profiles/{ProfileSwitcher,ProfileManager,ProfileDialogs}.svelte`, `src/routes/profiles/+page.svelte`, `src/routes/settings/profiles/+page.svelte`, `src/tests/unit/components/{ProfileManager,ProfileDialogs}.test.ts`; modify locale JSON. Navigation is connected in Task 13.
**Interfaces:** Components consume Task 10 store and Task 8 port only; dialogs expose target ID plus localized name, never a filesystem path as identity. Use existing modal/focus primitives and tracked labels outside the locale key.

- [ ] **Step 1: Add failing component tests** for empty create/restore state, 80/81-character names, trimmed/duplicate names with creation time/short ID, active marker, rename, restore preview/editable name and explicit Open action. Assert reset explains backup-first and delete explains loss of internal backups with export-first choice. Cancel export/preview leaves the dialog/profile intact as appropriate.
- [ ] **Step 2: Run red:** `pnpm exec vitest run src/tests/unit/components/ProfileManager.test.ts src/tests/unit/components/ProfileDialogs.test.ts`.
- [ ] **Step 3: Implement UI with localized copy.** Provide keyboard selection/focus return, disabled repeat-submit during operations, per-target progress, preserved name on errors, and equivalent narrow-layout access. Restore cancellation calls `cancelRestore`; closing by Escape uses the same cleanup. Show cleanup-pending outcomes distinctly from fully removed bytes.
- [ ] **Step 4: Compile messages and run green:** repeat component tests and `pnpm check`; assert locale switch updates labels without erasing typed profile names.
- [ ] **Step 5: Commit** — Commit with `feat(profiles): add profile management and picker screens`.

### Task 12: Enroll existing editors and Quick Add in profile sessions

**Files:** Modify `src/routes/quick-add/+page.svelte`, `src/lib/components/forms/{TransactionForm,AccountForm,GoalForm,ScheduleForm,RuleForm}.svelte`, `src/lib/components/modals/{RuleDialogs,ImportTransactionsModal}.svelte`, `src/routes/{budgets,debts,settings/categories,accounts/[id],transactions/[id],onboarding}/+page.svelte`; create `src/tests/unit/components/ProfileDraftIntegration.test.ts` and `src/tests/unit/components/QuickAddProfile.test.ts`; modify `src/lib/stores/quick-refresh.ts` and Quick Add tests.
**Interfaces:** Every persisted-input surface registers a Task 9 dirty callback and discard action; destruction unregisters. Audit remaining direct form/save handlers with `rg` and enroll any additional dirty editor before closing this task. Quick Add captures session at form load/submission and sends `{session}` with transaction events. Reconcile fresh snapshot on focus before enabling save.

- [ ] **Step 1: Add failing integration tests**: dirty transaction modal remains on canceled switch; import mapping/preview and inline budget edits block switching; hidden Quick Add cannot save A input into B; same-profile reset invalidates old quick-account selection. Assert save errors retain draft and successful saves clear dirty state only for their own session.
- [ ] **Step 2: Run red:** `pnpm exec vitest run src/tests/unit/components/ProfileDraftIntegration.test.ts src/tests/unit/components/QuickAddProfile.test.ts`.
- [ ] **Step 3: Add registrations and session labels.** Dirty compares current inputs to initial/saved state, not just nonempty fields. Freeze acknowledged editors during transition; user choosing stay returns focus to the dirty surface. With no active profile/incomplete setup Quick Add offers opening main and never calls domain APIs. Include session in `transaction:saved` and ignore old events.
- [ ] **Step 4: Run green:** the integration tests, existing Quick Add/locale tests and `pnpm check`; enumerate enrolled editors in commit description so omitted draft surfaces are reviewable.
- [ ] **Step 5: Commit** — Commit with `feat(profiles): protect existing drafts during profile changes`.

### Task 13: Atomic production cutover and restore UI replacement

**Files:** Modify `src-tauri/src/lib.rs`, `src-tauri/src/database/commands.rs`, `src-tauri/tests/common/mod.rs`, `src-tauri/tests/command_guards.rs`, `src/lib/db/index.ts`, `src/lib/db/native/{client,recovery}.ts`, `src/routes/+layout.svelte`, `src/lib/components/layout/{Sidebar,TopBar}.svelte`, `src/routes/settings/{+page.svelte,backup/+page.svelte}`, `src/lib/components/system/RecoveryScreen.svelte`, `src/lib/recovery.ts`, `src/tests/unit/{native-boundary,native-client,native-import,recovery,platform-paths}.test.ts`, `src/tests/e2e/fixtures/tauri-mock.ts`; create `src/tests/unit/profile-bootstrap.test.ts`.
**Interfaces:** Production setup manages only the coordinator, then `profiles_bootstrap` (main-only) drives Task 6; `profiles_load` remains read-only. Every financial command accepts `session: ProfileSession`, uses `with_session`, and preserves existing domain arguments/results. Unscoped lifecycle/status requests use the coordinator and cannot mutate the live DB through obsolete restore/import commands. `getDatabasePaths()` now gets authoritative selected-profile paths and reports no-selection explicitly.

- [ ] **Step 1: Add failing bootstrap/contract tests** for fresh empty app, legacy adoption, configured last profile, corrupt selection/picker escape and no DB access before activation. Extend the real Rust-signature sweep to assert every domain command has a session and every native adapter supplies it; test direct obsolete import/restore calls cannot overwrite data.
- [ ] **Step 2: Run red:** `pnpm exec vitest run src/tests/unit/profile-bootstrap.test.ts src/tests/unit/native-boundary.test.ts src/tests/unit/native-import.test.ts src/tests/unit/recovery.test.ts`; `cargo test --manifest-path src-tauri/Cargo.toml --test command_guards --test profile_commands`.
- [ ] **Step 3: Wire the prepared system atomically.** Install coordinator, route all command admission through sessions, bind JS clients before domain access, and remove legacy implicit-live and overwrite command registration. Retain low-level restore rollback routines for internal use/tests. Connect switcher/settings navigation, backup target labels and recovery-to-new flow. Route no active session to `/profiles`; preserve locale key semantics. Update all command fixtures and DTO generation together. Update browser/E2E mocks to model independent profiles, not a universal default profile hiding empty-state bugs.
- [ ] **Step 4: Run green:** focused commands, full `pnpm test`, `pnpm check`, `pnpm check:db-contracts`, `pnpm check:native-db-cutover`, and `cargo test --manifest-path src-tauri/Cargo.toml`. Verify no production frontend path still calls overwrite restore or constructs the old global DB path.
- [ ] **Step 5: Commit** — Commit with `feat(profiles): activate profile lifecycle throughout the app`.

### Task 14: Crash matrix, user journeys and desktop evidence

**Files:** Create `src/tests/e2e/profiles.spec.ts`, `src-tauri/tests/profile_crash_recovery.rs`, `specs/notes/2026-10-19-profile-management-verification.md`; create `src-tauri/src/bin/profile_probe.rs` following the existing `backup_probe.rs` subprocess harness, `src/tests/e2e/{backup-restore,startup-recovery}.spec.ts`, story inventory and this plan's completed checkboxes.
**Interfaces:** Use native subprocess kill/failpoints at journal phases and real scratch files. Browser journeys drive visible controls. Evidence records actual commands, versions, results, screenshots and limitations; never equate browser tests to desktop verification.

- [ ] **Step 1: Add failing end-to-end journeys** for A/B isolation across finances/settings, rename, backup→restore-new, reset→recovery-new, inactive/active/last deletion, invalid backup, dirty switch, shared locale and restart selection. Add crash assertions at prepare/publish/registry-commit/cleanup for create/restore/reset/delete/adoption, plus read-only disk/full-write failure and lock contention. Assert after reboot either complete old or complete new state, never two records for one operation or a resurrected deletion.
- [ ] **Step 2: Run red:** `pnpm exec playwright test src/tests/e2e/profiles.spec.ts`; `cargo test --manifest-path src-tauri/Cargo.toml --test profile_crash_recovery`. Fix test harness problems before claiming intended red.
- [ ] **Step 3: Complete missing behaviors exposed by these tests,** retaining minimal focused changes in their owning modules. Record any design deviation for owner review before implementing a conflicting product behavior.
- [ ] **Step 4: Run all gates and real desktop checks:** `pnpm test`, `pnpm check`, `pnpm build`, `pnpm test:e2e`, `pnpm check:db-contracts`, `pnpm check:native-db-cutover`, `cargo test --manifest-path src-tauri/Cargo.toml`. With `pnpm tauri dev`, exercise file dialogs, legacy upgrade with backup copy, close/reopen persistence, hidden Quick Add drafts, failed export-first deletion and restoring a backup from an unusable profile. Capture UI screenshots and exact native outcomes. If native verification is blocked, document it and keep shipping status pending.
- [ ] **Step 5: Commit** — Commit with `test(profiles): verify recovery and desktop profile journeys`. After commit, mark completed task boxes, run `pnpm test:roadmap` to regenerate status, and mark STORY-037 shipped only after complete review/verification. Commit that bookkeeping with `docs: record profile management verification` after required pre-commit tests.

## Self-review and owner handoff

Coverage: spec §§1–2 map to contracts/constraints and Tasks 1/8/10; §3 to Tasks 3–5/9–13; §4 to Tasks 1–2/7/13; §5 to Tasks 2/9/10/12/13; §6 to Tasks 3–5/14; §7 to Task 6; §8 to Tasks 7–13; §9 to focused tests and Task 14. Review Focus items each have explicit assertions in their owning task.

Execution has not started. Review this plan and select subagent-driven implementation (fresh implementer/reviewer per task) or native implementation in this chat (one final independent review). Subagent-driven is recommended for this plan because the lifecycle/session interfaces cross Rust, Svelte and multiple windows, and a missed boundary could write financial data into the wrong profile.
