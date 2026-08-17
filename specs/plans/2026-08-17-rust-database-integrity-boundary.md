# Rust Database Integrity Boundary Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace every production SQLite path with one Rust-owned, crash-safe, atomic, and idempotent database boundary so Notchy can safely hold the user's sole daily financial dataset.

**Architecture:** A dedicated Rust executor thread owns one `rusqlite::Connection`, guarded across processes by an OS lockfile and inside the process by a native lifecycle state machine. Native domain commands represent complete user intent and use `BEGIN IMMEDIATE` plus operation receipts; the existing SQL plugin stays active only during non-release development, then all frontend repositories switch together in one cutover task.

**Tech Stack:** Rust 1.77.2, Tauri v2, rusqlite with bundled SQLite and backup support, fs2, tokio one-shot channels, ulid, blake3, ts-rs, SvelteKit 5, TypeScript 5.8, Vitest 3, Playwright, Node 22.22.3, pnpm 10.11.0.

## Global Constraints

- Follow [the approved design](../2026-08-17-rust-database-integrity-boundary-design.md).
- Work on branch `rust-database-integrity-boundary`, based on `main` commit `1270bf4`; preserve untracked `.codegraph/` and `artifacts/`.
- Rust owns one executor thread and one live `rusqlite::Connection`; no live connection or transaction crosses threads.
- Acquire the authoritative OS lock before opening SQLite and hold it until process exit.
- Use `foreign_keys=ON`, `busy_timeout=5000`, `journal_mode=DELETE`, and `synchronous=FULL` after read-only schema acceptance.
- Use schema version `6`; migration 006 creates idempotency receipts.
- Keep money as signed integer smallest-currency units and reject values outside JavaScript's safe integer range at IPC boundaries.
- Every mutating business command accepts an operation ULID, runs validation and writes in one `BEGIN IMMEDIATE` transaction, and stores its receipt in that transaction.
- No intermediate mixed-owner build may be dogfooded, released, or merged to the release branch. Native work remains inactive until Task 14.
- Use real temporary SQLite files for native tests. Observe a failing test before production code for every task.
- Add user-facing strings to both `messages/en.json` and `messages/vi.json`; never edit generated `src/lib/paraglide/`.
- Do not log raw SQLite errors, SQL parameters, rows, payees, descriptions, or monetary values.
- Release target is application `0.2.0`, upgrading schema `5` to `6` from installed `0.1.4`.

---

## File Map

### Native database core

- `src-tauri/src/database/mod.rs` — module exports and `DatabaseManager` construction.
- `src-tauri/src/database/error.rs` — stable allowlisted native error envelope.
- `src-tauri/src/database/types.rs` — lifecycle, startup, recovery, and common DTOs.
- `src-tauri/src/database/executor.rs` — bounded executor queue and sole connection ownership.
- `src-tauri/src/database/lock.rs` — authoritative OS lockfile.
- `src-tauri/src/database/connection.rs` — paths, read-only open, live pragmas, permissions, and legacy-WAL transition.
- `src-tauri/src/database/manifest.rs` — version-specific schema manifests and validation.
- `src-tauri/src/database/migrations.rs` — fresh bootstrap and migrations 1 through 6.
- `src-tauri/src/database/receipt.rs` — request hashing and idempotent transaction helper.
- `src-tauri/src/database/backup.rs` — durable backup publication, discovery, validation, and retention.
- `src-tauri/src/database/restore.rs` — staged atomic replacement and rollback recovery.
- `src-tauri/src/database/startup.rs` — protected lifecycle state machine.
- `src-tauri/src/database/commands.rs` — caller authorization and Tauri command registration.
- `src-tauri/src/database/domains/*.rs` — accounts, transactions, categories, budgets, reconciliations, debts, goals, rules, meta, reports, and export services.

### Frontend boundary

- `src/lib/native/contracts.generated.ts` — generated Rust DTO bindings.
- `src/lib/db/client.ts` — domain-level `AppDatabase` port, never generic SQL.
- `src/lib/db/native/*.ts` — typed Tauri invoke adapters.
- `src/lib/db/browser/*.ts` — browser-only sql.js adapter used by unit/E2E tests.
- Existing `src/lib/db/repos/*.ts` — become domain delegates at atomic cutover.

### Native tests

- `src-tauri/tests/database_executor.rs`
- `src-tauri/tests/process_lock.rs`
- `src-tauri/tests/migrations.rs`
- `src-tauri/tests/startup.rs`
- `src-tauri/tests/idempotency.rs`
- `src-tauri/tests/domain_*.rs`
- `src-tauri/tests/backup_restore.rs`
- `src-tauri/tests/crash_recovery.rs`
- `src-tauri/tests/command_guards.rs`

---

### Task 1: Native contracts, safe errors, and generated TypeScript

**Files:**
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Create: `src-tauri/src/database/mod.rs`
- Create: `src-tauri/src/database/error.rs`
- Create: `src-tauri/src/database/types.rs`
- Create: `src-tauri/src/bin/export_bindings.rs`
- Create: `src/lib/native/contracts.generated.ts`
- Create: `src-tauri/tests/contracts.rs`
- Modify: `package.json`

**Interfaces:**
- Produces: `DbError { code: ErrorCode, meta: BTreeMap<String, String> }`.
- Produces: `LifecycleState`, `StartupStage`, `RecoveryContext`, `OperationId`, and common page/result DTOs.
- Produces: `pnpm generate:db-contracts` and `pnpm check:db-contracts`.

- [x] **Step 1: Add a failing serialization and privacy test**

```rust
#[test]
fn error_envelope_serializes_only_code_and_safe_meta() {
    let error = DbError::new(ErrorCode::DatabaseBusy)
        .with_meta("stage", "migrating");
    let json = serde_json::to_value(error).unwrap();
    assert_eq!(json, serde_json::json!({
        "code": "database_busy",
        "meta": { "stage": "migrating" }
    }));
    assert!(!json.to_string().contains("sqlite"));
}

#[test]
fn unsafe_amounts_are_rejected() {
    assert_eq!(validate_money(9_007_199_254_740_992), Err(ErrorCode::AmountOutOfRange));
    assert_eq!(validate_money(i64::MIN), Err(ErrorCode::AmountOutOfRange));
}
```

- [x] **Step 2: Confirm the red state**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test contracts`

Expected: FAIL because `database::error`, DTOs, and validation do not exist.

- [x] **Step 3: Add dependencies and the common contract**

Add `rusqlite` with `bundled,backup`, `fs2`, `tokio` with `sync`, `ulid` with `serde`, `blake3`, `thiserror`, `ts-rs` with `serde-compat`, and `tauri-plugin-single-instance` to Cargo. Define:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, TS, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ErrorCode {
    DatabaseBusy,
    DatabaseLocked,
    DatabaseNotReady,
    DatabaseUpdateRequired,
    UnauthorizedCaller,
    SchemaTooOld,
    SchemaTooNew,
    DatabaseInvalid,
    DatabaseCorrupt,
    BackupUnavailable,
    RestoreFailed,
    OperationIdConflict,
    AmountOutOfRange,
    InvalidUlid,
    InvalidDate,
    InvalidInput,
    RecoveryRequired,
}

#[derive(Debug, Clone, Serialize, Deserialize, TS)]
pub struct DbError {
    pub code: ErrorCode,
    pub meta: BTreeMap<String, String>,
}

pub fn validate_money(value: i64) -> Result<i64, ErrorCode> {
    const JS_MAX_SAFE: u64 = 9_007_199_254_740_991;
    (value.unsigned_abs() <= JS_MAX_SAFE).then_some(value).ok_or(ErrorCode::AmountOutOfRange)
}
```

Define strict ISO-date newtypes, bounded text/list validators, and generated tagged patch enums that distinguish omitted, explicit null, and replacement. Restrict error metadata to an enum-backed allowlist such as lifecycle stage, schema version, and retryability; reject arbitrary keys and never accept raw strings from SQLite as metadata.

Export TypeScript through `export_bindings`; `--check` compares generated bytes without rewriting.

- [x] **Step 4: Verify contracts and generation**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test contracts`

Run: `pnpm generate:db-contracts && pnpm check:db-contracts`

Expected: PASS; the second command reports the committed bindings are current.

- [x] **Step 5: Commit Task 1**

```sh
git add src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/src/database src-tauri/src/bin/export_bindings.rs src-tauri/tests/contracts.rs src/lib/native/contracts.generated.ts package.json
git commit -m "feat(db-native): define safe database contracts"
```

---

### Task 2: Executor thread, lifecycle state, connection policy, and OS lock

**Files:**
- Create: `src-tauri/src/database/executor.rs`
- Create: `src-tauri/src/database/lock.rs`
- Create: `src-tauri/src/database/connection.rs`
- Create: `src-tauri/tests/database_executor.rs`
- Create: `src-tauri/tests/process_lock.rs`
- Create: `src-tauri/src/bin/lock_probe.rs`
- Modify: `src-tauri/src/database/mod.rs`

**Interfaces:**
- Produces: `DatabaseManager::spawn(paths, queue_capacity)`, `call`, `snapshot`, and `shutdown`.
- Produces: `ProcessLock::acquire(path)` held for manager lifetime.
- Produces: `open_read_only`, `open_live`, and `DatabasePaths`.

- [x] **Step 1: Write failing ownership, queue, and process-lock tests**

```rust
#[tokio::test]
async fn executor_runs_every_job_on_one_thread() {
    let manager = DatabaseManager::spawn(test_paths(), 2).unwrap();
    let first = manager.call(|state| Ok(state.thread_id())).await.unwrap();
    let second = manager.call(|state| Ok(state.thread_id())).await.unwrap();
    assert_eq!(first, second);
}

#[tokio::test]
async fn bounded_queue_fails_closed() {
    let manager = blocked_manager(1);
    fill_running_and_pending_jobs(&manager).await;
    assert_eq!(manager.try_call(|_| Ok(())).unwrap_err().code, ErrorCode::DatabaseBusy);
}

#[test]
fn second_process_never_opens_sqlite() {
    let first = spawn_lock_probe("hold");
    let second = run_lock_probe("try-open");
    assert_eq!(second.stdout, "database_locked\nsqlite_opened=false\n");
    stop(first);
}
```

- [x] **Step 2: Confirm the red state**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test database_executor --test process_lock`

Expected: FAIL because the manager, lock, and probe binary do not exist.

- [x] **Step 3: Implement the executor and exact connection policy**

```rust
type Job = Box<dyn FnOnce(&mut ExecutorState) + Send + 'static>;

pub struct DatabaseManager {
    sender: SyncSender<Job>,
    lifecycle: Arc<RwLock<LifecycleState>>,
    lock: Arc<ProcessLock>,
}

impl DatabaseManager {
    pub async fn call<T, F>(&self, operation: F) -> DbResult<T>
    where
        T: Send + 'static,
        F: FnOnce(&mut ExecutorState) -> DbResult<T> + Send + 'static;
}
```

`open_live` applies, in order, `foreign_keys=ON`, `busy_timeout=5000`, legacy WAL checkpoint when detected, `journal_mode=DELETE`, and `synchronous=FULL`. Set app directories to `0700` and created files to `0600` on Unix. `open_read_only` uses SQLite URI `mode=ro` and never runs writable pragmas.

- [x] **Step 4: Verify executor, file permissions, exact path, and two-process exclusion**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test database_executor --test process_lock`

Expected: PASS; the losing process reports `sqlite_opened=false`.

- [x] **Step 5: Commit Task 2**

```sh
git add src-tauri/src/database src-tauri/src/bin/lock_probe.rs src-tauri/tests/database_executor.rs src-tauri/tests/process_lock.rs
git commit -m "feat(db-native): own sqlite on one locked executor"
```

---

### Task 3: Native schema manifests, fresh bootstrap, migrations 1–6

**Files:**
- Create: `src-tauri/src/database/manifest.rs`
- Create: `src-tauri/src/database/migrations.rs`
- Create: `src-tauri/tests/migrations.rs`
- Create: `src-tauri/tests/fixtures/invalid-zero-byte.sqlite`
- Modify: `src-tauri/src/database/mod.rs`

**Interfaces:**
- Produces: `LATEST_SCHEMA_VERSION: i64 = 6`, `MIN_SUPPORTED_SCHEMA_VERSION: i64 = 3`.
- Produces: `inspect_schema(path) -> SchemaInspection` and `validate_manifest(connection, version)`.
- Produces: `bootstrap_current` and `migrate_supported`.

- [x] **Step 1: Write failing fixture and non-mutation tests**

```rust
#[test]
fn supported_v4_migrates_to_v6_atomically() {
    let path = copy_fixture("v004.sqlite");
    migrate_supported(&path, 4, FailurePoint::None).unwrap();
    let db = open_ro(&path);
    assert_eq!(schema_version(&db), 6);
    assert!(table_exists(&db, "categorize_rules"));
    assert!(table_exists(&db, "operation_receipts"));
    assert_seed_rows_preserved(&db);
}

#[test]
fn newer_too_old_and_invalid_are_byte_for_byte_unchanged() {
    for fixture in ["v002.sqlite", "v007.sqlite", "invalid-zero-byte.sqlite"] {
        let path = copy_fixture(fixture);
        let before = snapshot_file_and_sidecars(&path);
        assert!(inspect_schema(&path).is_rejected());
        assert_eq!(snapshot_file_and_sidecars(&path), before);
    }
}
```

- [x] **Step 2: Confirm the red state**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test migrations`

Expected: FAIL because the native registry and manifests do not exist.

- [x] **Step 3: Port the schema into one native registry**

Define:

```rust
pub struct Migration {
    pub version: i64,
    pub name: &'static str,
    pub up: fn(&Transaction<'_>) -> DbResult<()>,
}

pub const MIGRATIONS: &[Migration] = &[
    Migration { version: 1, name: "initial", up: migration_001 },
    Migration { version: 2, name: "change_log_triggers", up: migration_002 },
    Migration { version: 3, name: "seed", up: migration_003 },
    Migration { version: 4, name: "rollover_toggle", up: migration_004 },
    Migration { version: 5, name: "categorize_rules", up: migration_005 },
    Migration { version: 6, name: "operation_receipts", up: migration_006 },
];
```

Migration 006 creates `operation_receipts(operation_id TEXT PRIMARY KEY, command_kind TEXT NOT NULL, request_hash TEXT NOT NULL, result_json TEXT NOT NULL, completed_at TEXT NOT NULL)`. Each migration and `schema_version` update use one `TransactionBehavior::Immediate` transaction. Manifests include tables, columns, nullability/defaults, foreign keys, indexes, and triggers for schemas 3–6.

Fresh means the path is absent. Bootstrap a same-directory temp DB through migrations 1–6, validate, sync, rename, sync the directory. Existing zero-byte/partial files are invalid.

- [x] **Step 4: Verify fixtures, failure rollback, and manifests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test migrations`

Expected: PASS for fresh, v3, v4, current, newer, too-old, malformed, and injected failure after every migration statement.

- [x] **Step 5: Commit Task 3**

```sh
git add src-tauri/src/database/manifest.rs src-tauri/src/database/migrations.rs src-tauri/tests/migrations.rs src-tauri/tests/fixtures
git commit -m "feat(db-native): port schema and migrations to rust"
```

---

### Task 4: Durable backup publication, verified discovery, and retention

**Files:**
- Create: `src-tauri/src/database/backup.rs`
- Create: `src-tauri/tests/backup_restore.rs`
- Modify: `src-tauri/src/database/types.rs`

**Interfaces:**
- Produces: `publish_backup`, `discover_verified_backups`, and `retention_deletions`.
- Produces: opaque `BackupToken` and safe `BackupSummary` DTOs.

- [x] **Step 1: Write failing durable-publication and retention tests**

```rust
#[test]
fn backup_is_not_visible_until_validated_synced_and_renamed() {
    let harness = BackupHarness::from_fixture("v004.sqlite");
    assert_err_at_each_failpoint(&harness, [
        "after_copy", "after_validate", "after_file_sync", "after_rename", "after_dir_sync"
    ]);
    assert_no_final_file_before_publish(&harness);
}

#[test]
fn corrupt_matching_filename_never_displaces_verified_backup() {
    let records = discover_verified_backups(dir_with_verified_and_corrupt_match()).unwrap();
    assert_eq!(records.len(), 1);
    assert!(retention_deletions(&records, 2).is_empty());
}
```

- [x] **Step 2: Confirm the red state**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test backup_restore backup_`

Expected: FAIL because native durable backup services do not exist.

- [x] **Step 3: Implement online backup publication**

Use `rusqlite::backup::Backup` to copy the live connection into a unique `.tmp` file. Validate the source-version manifest plus integrity/foreign keys, sync the file, rename in the destination directory, and sync that directory. Name the final backup with the last successfully recorded source application version, never the currently running target binary version. Issue an opaque in-memory token mapped to canonical path, schema, and validation fingerprint. Revalidate every discovered candidate; filename parsing only supplies candidate metadata. Protect the newly published backup and newest two verified records per source schema.

- [x] **Step 4: Verify backup tests and process-kill publication recovery**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test backup_restore backup_`

Expected: PASS; restart cleanup removes unpublished temp files without deleting verified backups.

- [x] **Step 5: Commit Task 4**

```sh
git add src-tauri/src/database/backup.rs src-tauri/src/database/types.rs src-tauri/tests/backup_restore.rs
git commit -m "feat(db-native): publish verified durable backups"
```

---

### Task 5: Protected startup lifecycle and native command guards

**Files:**
- Create: `src-tauri/src/database/startup.rs`
- Create: `src-tauri/src/database/commands.rs`
- Create: `src-tauri/tests/startup.rs`
- Create: `src-tauri/tests/command_guards.rs`
- Modify: `src-tauri/src/database/mod.rs`

**Interfaces:**
- Produces: `DatabaseManager::initialize`, `retry`, and `status`.
- Produces: main-only `database_initialize`, `database_retry`, and `database_status` command functions.

- [x] **Step 1: Write failing lifecycle and authorization tests**

```rust
#[tokio::test]
async fn initialization_orders_backup_before_migration() {
    let events = initialize_fixture("v004.sqlite").await.unwrap().events;
    assert_eq!(events, ["checking", "backing_up", "migrating", "verifying", "ready"]);
}

#[tokio::test]
async fn quick_add_cannot_initialize_or_write_during_migration() {
    let manager = paused_migration_manager().await;
    assert_eq!(initialize_as("quick-add", &manager).await.unwrap_err().code, ErrorCode::InvalidInput);
    assert_eq!(write_as("quick-add", &manager).await.unwrap_err().code, ErrorCode::DatabaseUpdateRequired);
}
```

- [x] **Step 2: Confirm the red state**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test startup --test command_guards`

Expected: FAIL because lifecycle orchestration and guards do not exist.

- [x] **Step 3: Implement the native state machine**

`initialize` acquires the process lock before inspection, performs read-only classification, publishes an upgrade backup for supported older schemas, opens the live connection, migrates, validates exact schema 6, writes safe startup metadata, then enters `Ready`. Any failure enters `RecoveryRequired` with retained verified backup summaries. All data-job entry points check `Ready`. Check `WebviewWindow::label()` for main-only operations.

- [x] **Step 4: Verify fresh/current/older/newer/invalid and concurrent initialization**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test startup --test command_guards`

Expected: PASS; concurrent initialize calls coalesce and no secondary caller opens SQLite.

- [x] **Step 5: Commit Task 5**

```sh
git add src-tauri/src/database/startup.rs src-tauri/src/database/commands.rs src-tauri/src/database/mod.rs src-tauri/tests/startup.rs src-tauri/tests/command_guards.rs
git commit -m "feat(db-native): enforce protected startup lifecycle"
```

---

### Task 6: Idempotent native mutation harness

**Files:**
- Create: `src-tauri/src/database/receipt.rs`
- Create: `src-tauri/tests/idempotency.rs`
- Modify: `src-tauri/src/database/executor.rs`

**Interfaces:**
- Produces: `run_idempotent(operation_id, command_kind, request, closure)`.
- Consumes: migration-006 `operation_receipts`.

- [x] **Step 1: Write failing response-loss, conflict, and rollback tests**

```rust
#[test]
fn retry_after_commit_returns_original_result_once() {
    let first = run_then_drop_response("01OPERATION", request("create_transaction"));
    let retry = invoke_again("01OPERATION", request("create_transaction")).unwrap();
    assert_eq!(retry.id, committed_id(first));
    assert_eq!(count_financial_rows(), 1);
}

#[test]
fn reused_operation_id_with_different_input_fails() {
    commit("01OPERATION", request_with_amount(100));
    let error = invoke("01OPERATION", request_with_amount(200)).unwrap_err();
    assert_eq!(error.code, ErrorCode::OperationIdConflict);
}
```

- [x] **Step 2: Confirm the red state**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test idempotency`

Expected: FAIL because receipt hashing and replay do not exist.

- [x] **Step 3: Implement canonical server-side receipt handling**

Canonicalize the deserialized Rust DTO, hash `command_kind || canonical_json` with BLAKE3, and start `TransactionBehavior::Immediate`. Look up the receipt inside the transaction. Same hash returns deserialized `result_json`; a different hash fails. Otherwise run the business closure and insert its safe result in the same transaction before commit.

```rust
pub fn run_idempotent<Req, Res, F>(
    connection: &mut Connection,
    operation_id: OperationId,
    command_kind: &'static str,
    request: &Req,
    operation: F,
) -> DbResult<Res>
where
    Req: Serialize,
    Res: Serialize + DeserializeOwned,
    F: FnOnce(&Transaction<'_>) -> DbResult<Res>;
```

- [x] **Step 4: Verify every commit/rollback failpoint**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test idempotency`

Expected: PASS; no state exists without a matching receipt and no receipt exists without its state.

- [x] **Step 5: Commit Task 6**

```sh
git add src-tauri/src/database/receipt.rs src-tauri/src/database/executor.rs src-tauri/tests/idempotency.rs
git commit -m "feat(db-native): make mutations idempotent"
```

---

### Task 7: Accounts, transactions, transfers, refunds, and imports

**Files:**
- Create: `src-tauri/src/database/domains/mod.rs`
- Create: `src-tauri/src/database/domains/accounts.rs`
- Create: `src-tauri/src/database/domains/transactions.rs`
- Create: `src-tauri/tests/domain_accounts_transactions.rs`
- Create: `src/lib/db/native/accounts.ts`
- Create: `src/lib/db/native/transactions.ts`
- Modify: `src-tauri/src/database/types.rs`
- Modify: `src/lib/native/contracts.generated.ts`

**Interfaces:**
- Produces: account list/get/create/update/delete and transaction list/get/create/update/delete/restore/duplicate/import operations.
- Keeps existing frontend `Account`, `AccountWithBalance`, `Transaction`, filter, and result shapes.

- [x] **Step 1: Write failing native parity and atomicity tests**

```rust
#[test]
fn account_and_opening_balance_are_one_operation() {
    for point in failpoints("account_create") {
        let db = fixture_at_schema_6();
        let result = accounts::create(&mut db, op_id(), request(), point);
        assert!(result.is_err());
        assert_eq!(count(&db, "accounts"), 0);
        assert_eq!(count(&db, "transactions"), 0);
    }
}

#[test]
fn imported_batch_is_all_or_nothing_and_idempotent() {
    assert_batch_failure_leaves_zero_rows();
    assert_retry_creates_each_row_once();
}
```

Cover transfer direction/self-transfer, refund target, single currency, account delete linked-goal guard, update validation, safe text bounds, pagination bounds, and JavaScript-safe amounts.

- [x] **Step 2: Confirm the red state**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_accounts_transactions`

Expected: FAIL because native domain services do not exist.

- [x] **Step 3: Port complete business operations**

Use `run_idempotent` for every mutation. Generate IDs and timestamps in Rust. Keep the single-row transfer model and balance semantics exactly. Ensure account creation validates currency and inserts its opening-balance transaction inside the same transaction. Batch import validates every row before commit and stores one receipt containing all resulting IDs.

Create inactive typed invoke adapters matching current repository results; do not wire them into production yet.

Regenerate the TypeScript bindings after adding the account and transaction DTOs; do not hand-edit the generated file.

- [x] **Step 4: Verify native parity plus existing browser tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_accounts_transactions`

Run: `pnpm generate:db-contracts && pnpm check:db-contracts`

Run: `pnpm vitest run src/tests/unit/accounts.test.ts src/tests/unit/transactions.test.ts src/tests/unit/transactions-tx.test.ts src/tests/unit/import.test.ts`

Expected: PASS with unchanged financial results.

- [x] **Step 5: Commit Task 7**

```sh
git add src-tauri/src/database/domains/mod.rs src-tauri/src/database/domains/accounts.rs src-tauri/src/database/domains/transactions.rs src-tauri/src/database/types.rs src-tauri/tests/domain_accounts_transactions.rs src/lib/db/native/accounts.ts src/lib/db/native/transactions.ts src/lib/native/contracts.generated.ts
git commit -m "feat(db-native): port accounts and transactions"
```

---

### Task 8: Categories, tag merge, and budgets

**Files:**
- Create: `src-tauri/src/database/domains/categories.rs`
- Create: `src-tauri/src/database/domains/budgets.rs`
- Create: `src-tauri/tests/domain_categories_budgets.rs`
- Create: `src/lib/db/native/categories.ts`
- Create: `src/lib/db/native/budgets.ts`
- Modify: `src-tauri/src/database/types.rs`
- Modify: `src/lib/native/contracts.generated.ts`

**Interfaces:**
- Produces: bucket/tag CRUD, move/delete/merge, allocation, copy-previous, rollover, and budget summaries.

- [x] **Step 1: Write failing merge and rollover transaction tests**

```rust
#[test]
fn tag_merge_repoints_every_reference_or_none() {
    assert_each_failpoint_rolls_back("tag_merge", &["after_repoint", "after_soft_delete"]);
}

#[test]
fn copy_previous_month_is_idempotent() {
    let operation = op_id();
    let first = budgets::copy_previous(&mut db(), operation.clone(), "2026-08").unwrap();
    let retry = budgets::copy_previous(&mut db(), operation, "2026-08").unwrap();
    assert_eq!(first, retry);
    assert_no_duplicate_allocations();
}
```

- [x] **Step 2: Confirm the red state**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_categories_budgets`

Expected: FAIL because the native services do not exist.

- [x] **Step 3: Port complete category and budget intents**

Keep system-tag protections, affected totals, sort-order calculations, tag merge, rollover flag, budget allocation uniqueness, previous-month copy, spent/remaining calculations, and integer money behavior. Put validation reads and writes inside `BEGIN IMMEDIATE` for create/delete/merge/copy operations.

Regenerate the TypeScript bindings after adding category and budget DTOs.

- [x] **Step 4: Verify native parity and current tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_categories_budgets`

Run: `pnpm generate:db-contracts && pnpm check:db-contracts`

Run: `pnpm vitest run src/tests/unit/categories.test.ts src/tests/unit/budgets.test.ts`

Expected: PASS.

- [x] **Step 5: Commit Task 8**

```sh
git add src-tauri/src/database/domains/categories.rs src-tauri/src/database/domains/budgets.rs src-tauri/src/database/types.rs src-tauri/tests/domain_categories_budgets.rs src/lib/db/native/categories.ts src/lib/db/native/budgets.ts src/lib/native/contracts.generated.ts
git commit -m "feat(db-native): port categories and budgets"
```

---

### Task 9: Reconciliation and debt operations

**Files:**
- Create: `src-tauri/src/database/domains/reconciliations.rs`
- Create: `src-tauri/src/database/domains/debts.rs`
- Create: `src-tauri/tests/domain_reconciliation_debts.rs`
- Create: `src/lib/db/native/reconciliations.ts`
- Create: `src/lib/db/native/debts.ts`
- Modify: `src-tauri/src/database/types.rs`
- Modify: `src/lib/native/contracts.generated.ts`

**Interfaces:**
- Produces: reconciliation history, atomic reconcile-with-adjustment, debt lists, and debt write-off.

- [x] **Step 1: Write failing balance-snapshot and adjustment tests**

```rust
#[test]
fn reconciliation_balance_read_and_adjustment_share_one_immediate_transaction() {
    let result = reconcile_fixture_with_concurrent_writer();
    assert_eq!(result.expected_balance, balance_before_competing_write());
    assert_audit_and_adjustment_commit_together();
}
```

Also inject failure after adjustment and after audit row; neither may remain alone.

- [x] **Step 2: Confirm the red state**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_reconciliation_debts`

Expected: FAIL because native reconciliation/debt services do not exist.

- [x] **Step 3: Port reconciliation and debt intents**

Calculate expected balance after `BEGIN IMMEDIATE`, write optional adjustment and reconciliation row in the same idempotent operation, preserve `1_000_000` large-discrepancy behavior in frontend presentation, and implement debt write-off with its transaction plus audit semantics.

Regenerate the TypeScript bindings after adding reconciliation and debt DTOs.

- [x] **Step 4: Verify native and browser parity**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_reconciliation_debts`

Run: `pnpm generate:db-contracts && pnpm check:db-contracts`

Run: `pnpm vitest run src/tests/unit/reconciliation.test.ts src/tests/unit/reconciliations.test.ts src/tests/unit/debts.test.ts`

Expected: PASS.

- [x] **Step 5: Commit Task 9**

```sh
git add src-tauri/src/database/domains/reconciliations.rs src-tauri/src/database/domains/debts.rs src-tauri/src/database/types.rs src-tauri/tests/domain_reconciliation_debts.rs src/lib/db/native/reconciliations.ts src/lib/db/native/debts.ts src/lib/native/contracts.generated.ts
git commit -m "feat(db-native): port reconciliation and debts"
```

---

### Task 10: Goals, categorization rules, settings, and quick-account state

**Files:**
- Create: `src-tauri/src/database/domains/goals.rs`
- Create: `src-tauri/src/database/domains/rules.rs`
- Create: `src-tauri/src/database/domains/meta.rs`
- Create: `src-tauri/tests/domain_goals_rules_meta.rs`
- Create: `src/lib/db/native/goals.ts`
- Create: `src/lib/db/native/rules.ts`
- Create: `src/lib/db/native/meta.ts`
- Modify: `src-tauri/src/database/types.rs`
- Modify: `src/lib/native/contracts.generated.ts`

**Interfaces:**
- Produces: goal lifecycle, categorize-rule CRUD/learning, locale/currency/tour/quick-account settings, and onboarding metadata.

- [x] **Step 1: Write failing invariant and receipt tests**

```rust
#[test]
fn learned_rule_upsert_is_idempotent_and_preserves_priority() {
    let operation = op_id();
    let first = rules::upsert_learned(&mut db(), operation.clone(), learned_request()).unwrap();
    let retry = rules::upsert_learned(&mut db(), operation, learned_request()).unwrap();
    assert_eq!(first, retry);
    assert_eq!(matching_rule_count(), 1);
}
```

Cover linked-account deletion constraints, goal close/reopen semantics, settings allowlists, quick account must reference an active account, and input bounds.

- [x] **Step 2: Confirm the red state**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_goals_rules_meta`

Expected: FAIL because native services do not exist.

- [x] **Step 3: Port goals, rules, and metadata**

Keep existing domain output shapes and stable error codes. Treat every setting update as an idempotent mutation. Keep reads side-effect free and gated by `Ready`.

Regenerate the TypeScript bindings after adding goal, rule, settings, and quick-account DTOs.

- [x] **Step 4: Verify native parity and current suites**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_goals_rules_meta`

Run: `pnpm generate:db-contracts && pnpm check:db-contracts`

Run: `pnpm vitest run src/tests/unit/goals.test.ts src/tests/unit/rules.test.ts src/tests/unit/rules_matcher.test.ts src/tests/unit/meta.test.ts src/tests/unit/quick_account.test.ts`

Expected: PASS.

- [x] **Step 5: Commit Task 10**

```sh
git add src-tauri/src/database/domains/goals.rs src-tauri/src/database/domains/rules.rs src-tauri/src/database/domains/meta.rs src-tauri/src/database/types.rs src-tauri/tests/domain_goals_rules_meta.rs src/lib/db/native/goals.ts src/lib/db/native/rules.ts src/lib/db/native/meta.ts src/lib/native/contracts.generated.ts
git commit -m "feat(db-native): port goals rules and settings"
```

---

### Task 11: Reports, read models, CSV export, and backup health

**Files:**
- Create: `src-tauri/src/database/domains/reports.rs`
- Create: `src-tauri/src/database/domains/export.rs`
- Create: `src-tauri/tests/domain_reports_export.rs`
- Create: `src/lib/db/native/reports.ts`
- Create: `src/lib/db/native/export.ts`
- Modify: `src-tauri/src/database/backup.rs`
- Modify: `src-tauri/src/database/types.rs`
- Modify: `src/lib/native/contracts.generated.ts`

**Interfaces:**
- Produces: overview, trend, comparison, category trend, composition, year-over-year, net-worth, CSV export, and backup-health DTOs.

- [x] **Step 1: Write failing golden read-model tests**

```rust
#[test]
fn native_reports_match_committed_schema5_golden_results() {
    let db = financial_fixture_at_schema_6();
    assert_eq!(reports::overview(&db, "2026-08", false).unwrap(), golden("overview.json"));
    assert_eq!(reports::net_worth(&db, 12, false).unwrap(), golden("net-worth.json"));
}

#[test]
fn csv_export_neutralizes_formula_injection() {
    assert!(export_csv(formula_fixture()).contains("'=HYPERLINK"));
}
```

- [x] **Step 2: Confirm the red state**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_reports_export`

Expected: FAIL because native read models do not exist.

- [x] **Step 3: Port every read query and export rule**

Port the SQL semantics from all existing report, account-balance, budget summary, debt, and backup-health reads. Preserve ordering, pagination, adjustment inclusion, transfer direction, all-zero empty-state semantics, and CSV escaping/formula neutralization. Reads execute as one executor job and never open another connection.

Regenerate the TypeScript bindings after adding report, export, and backup-health DTOs.

- [x] **Step 4: Verify native goldens and browser report tests**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test domain_reports_export`

Run: `pnpm generate:db-contracts && pnpm check:db-contracts`

Run: `pnpm vitest run src/tests/unit/reports.test.ts src/lib/stores/reports.test.ts src/tests/unit/backup-health.test.ts src/tests/unit/backup.test.ts`

Expected: PASS.

- [x] **Step 5: Commit Task 11**

```sh
git add src-tauri/src/database/domains/reports.rs src-tauri/src/database/domains/export.rs src-tauri/src/database/backup.rs src-tauri/src/database/types.rs src-tauri/tests/domain_reports_export.rs src/lib/db/native/reports.ts src/lib/db/native/export.ts src/lib/native/contracts.generated.ts
git commit -m "feat(db-native): port reports export and health"
```

---

### Task 12: Crash-safe restore and recovery discovery

**Files:**
- Create: `src-tauri/src/database/restore.rs`
- Create: `src-tauri/tests/crash_recovery.rs`
- Modify: `src-tauri/tests/backup_restore.rs`
- Modify: `src-tauri/src/database/startup.rs`
- Create: `src/lib/db/native/recovery.ts`

**Interfaces:**
- Produces: `restore_backup(main_window, token)` and compatible-backup selection.
- Proves: backup publication, migration, and restore replacement remain byte-safe across subprocess termination.
- Consumes: Task 4 opaque tokens and Task 5 lifecycle.

- [x] **Step 1: Write failing staged-replacement and kill tests**

```rust
#[test]
fn restore_never_exposes_a_partial_live_database() {
    for point in ["after_stage", "after_stage_sync", "after_live_close", "after_rename", "after_dir_sync"] {
        kill_restore_process_at(point);
        let reopened = reopen_after_crash();
        assert!(reopened.matches_old_or_fully_restored_manifest());
        assert!(reopened.has_verified_rollback_point());
    }
}
```

Test current-live rollback backup, candidate revalidation, path-token substitution rejection, legacy sidecar cleanup, and migration after restoring schema 3/4/5.

Add subprocess kill matrices for an upgrade migration and backup publication as well as restore. After every kill, restart through the real startup state machine and assert that the live file is either the accepted pre-operation database or the fully validated post-operation database, with at least one verified recovery point.

- [x] **Step 2: Confirm the red state**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test crash_recovery --test backup_restore`

Expected: FAIL because native restore does not exist.

- [x] **Step 3: Implement the exact restore protocol**

Enter `Restoring`, reject/drain jobs, publish rollback backup, resolve and revalidate opaque token, copy beside live DB, validate and sync, close the live connection, retire journals/legacy WAL state, atomic rename, sync directory, reopen with exact pragmas, migrate if supported, validate schema 6, then enter `Ready`. Any failure enters `RecoveryRequired` and returns safe backup summaries.

- [x] **Step 4: Verify process-kill and recovery discovery**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test crash_recovery --test backup_restore`

Expected: PASS at every backup, migration, and restore kill point; no truncated live database is observable.

- [x] **Step 5: Commit Task 12**

```sh
git add src-tauri/src/database/restore.rs src-tauri/src/database/startup.rs src-tauri/tests/crash_recovery.rs src-tauri/tests/backup_restore.rs src/lib/db/native/recovery.ts
git commit -m "feat(db-native): restore databases crash safely"
```

---

### Task 13: Inactive frontend domain port and browser adapter

**Files:**
- Create: `src/lib/db/client.ts`
- Create: `src/lib/db/native/client.ts`
- Create: `src/lib/db/browser/client.ts`
- Create: `src/lib/db/browser/service.ts`
- Create: `src/lib/db/browser/in-memory.ts`
- Create: `src/lib/db/browser/integrity.ts`
- Create: `src/lib/db/browser/pragmas.ts`
- Create: `src/lib/db/browser/schema.ts`
- Create: `src/lib/db/browser/migrations/001_initial.ts`
- Create: `src/lib/db/browser/migrations/002_triggers.ts`
- Create: `src/lib/db/browser/migrations/003_seed.ts`
- Create: `src/lib/db/browser/migrations/004_rollover_toggle.ts`
- Create: `src/lib/db/browser/migrations/005_categorize_rules.ts`
- Create: `src/lib/db/browser/migrations/index.ts`
- Create: `src/lib/db/browser/migrations/runner.ts`
- Create: `src/lib/db/browser/repos/accounts.ts`
- Create: `src/lib/db/browser/repos/budgets.ts`
- Create: `src/lib/db/browser/repos/categories.ts`
- Create: `src/lib/db/browser/repos/debts.ts`
- Create: `src/lib/db/browser/repos/goals.ts`
- Create: `src/lib/db/browser/repos/meta.ts`
- Create: `src/lib/db/browser/repos/quick_account.ts`
- Create: `src/lib/db/browser/repos/reconciliations.ts`
- Create: `src/lib/db/browser/repos/reports.ts`
- Create: `src/lib/db/browser/repos/rules.ts`
- Create: `src/lib/db/browser/repos/transactions.ts`
- Modify: `src/lib/db/in-memory.ts`
- Modify: `src/lib/db/integrity.ts`
- Modify: `src/lib/db/pragmas.ts`
- Modify: `src/lib/db/schema.ts`
- Modify: `src/lib/db/service.ts`
- Modify: `src/lib/db/migrations/001_initial.ts`
- Modify: `src/lib/db/migrations/002_triggers.ts`
- Modify: `src/lib/db/migrations/003_seed.ts`
- Modify: `src/lib/db/migrations/004_rollover_toggle.ts`
- Modify: `src/lib/db/migrations/005_categorize_rules.ts`
- Modify: `src/lib/db/migrations/index.ts`
- Modify: `src/lib/db/migrations/runner.ts`
- Modify: `src/lib/db/repos/accounts.ts`
- Modify: `src/lib/db/repos/budgets.ts`
- Modify: `src/lib/db/repos/categories.ts`
- Modify: `src/lib/db/repos/debts.ts`
- Modify: `src/lib/db/repos/goals.ts`
- Modify: `src/lib/db/repos/meta.ts`
- Modify: `src/lib/db/repos/quick_account.ts`
- Modify: `src/lib/db/repos/reconciliations.ts`
- Modify: `src/lib/db/repos/reports.ts`
- Modify: `src/lib/db/repos/rules.ts`
- Modify: `src/lib/db/repos/transactions.ts`
- Create: `src/tests/unit/native-client.test.ts`
- Modify: `src/lib/db/native/*.ts`

**Interfaces:**
- Produces: `AppDatabase` domain port and inactive `NativeDatabaseClient`.
- Preserves: browser sql.js behavior for Vitest and Playwright.

- [ ] **Step 1: Write failing invoke-mapping and browser-parity tests**

```typescript
it('maps one transfer intent to one native command with one operation ULID', async () => {
	await native.transactions.create(operationId, transferInput);
	expect(invoke).toHaveBeenCalledOnce();
	expect(invoke).toHaveBeenCalledWith('transaction_create', {
		request: { operation_id: operationId, input: transferInput }
	});
});

it('never exposes execute query or transaction on AppDatabase', () => {
	expectTypeOf<AppDatabase>().not.toHaveProperty('execute');
	expectTypeOf<AppDatabase>().not.toHaveProperty('transaction');
});
```

- [ ] **Step 2: Confirm the red state**

Run: `pnpm vitest run src/tests/unit/native-client.test.ts`

Expected: FAIL because the domain port and clients do not exist.

- [ ] **Step 3: Build both inactive adapters**

`AppDatabase` exposes domain services only. `NativeDatabaseClient` invokes generated commands and generates a new operation ULID once per user intent; retry paths reuse it. `BrowserDatabaseClient` owns the generic `DatabaseService`, sql.js connection, migrations, integrity helpers, schema, pragmas, and moved repository implementations under `src/lib/db/browser/`.

Move—not copy—the generic modules. Until Task 14, the old module paths are compatibility forwarders and the legacy Tauri `service.ts` remains the exclusive production owner; it imports the generic interface from `browser/service.ts`. Native commands remain unregistered and unreachable. This preserves exactly one production owner before and after cutover, never a mixed-owner interval.

- [ ] **Step 4: Verify adapter contracts and full browser suite**

Run: `pnpm check:db-contracts && pnpm vitest run src/tests/unit/native-client.test.ts`

Run: `pnpm test`

Expected: PASS; production remains on the old backend and native code remains inactive.

- [ ] **Step 5: Commit Task 13**

```sh
git add src/lib/db/client.ts src/lib/db/native src/lib/db/browser src/lib/db/in-memory.ts src/lib/db/integrity.ts src/lib/db/pragmas.ts src/lib/db/schema.ts src/lib/db/service.ts src/lib/db/migrations src/lib/db/repos src/tests/unit/native-client.test.ts
git commit -m "refactor(db): prepare native and browser adapters"
```

---

### Task 14: Atomic production cutover and SQL-plugin removal

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/src/database/mod.rs`
- Modify: `src-tauri/src/database/commands.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Delete: `src-tauri/capabilities/default.json`
- Create: `src-tauri/capabilities/main.json`
- Create: `src-tauri/capabilities/quick-add.json`
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/lib/db/index.ts`
- Delete: `src/lib/db/platform.ts`
- Delete: `src/lib/db/startup.ts`
- Delete: `src/lib/db/service.ts`
- Modify: `src/lib/stores/db.svelte.ts`
- Modify: `src/lib/db/repos/accounts.ts`
- Modify: `src/lib/db/repos/budgets.ts`
- Modify: `src/lib/db/repos/categories.ts`
- Modify: `src/lib/db/repos/debts.ts`
- Modify: `src/lib/db/repos/goals.ts`
- Modify: `src/lib/db/repos/meta.ts`
- Modify: `src/lib/db/repos/quick_account.ts`
- Modify: `src/lib/db/repos/reconciliations.ts`
- Modify: `src/lib/db/repos/reports.ts`
- Modify: `src/lib/db/repos/rules.ts`
- Modify: `src/lib/db/repos/transactions.ts`
- Modify: `src/routes/+layout.svelte`
- Modify: `src/routes/quick-add/+page.svelte`
- Modify: `src/routes/settings/backup/+page.svelte`
- Modify: `src/lib/components/system/RecoveryScreen.svelte`
- Modify: `src/lib/components/system/StartupProgress.svelte`
- Modify: `messages/en.json`
- Modify: `messages/vi.json`
- Modify: `src/tests/unit/components/RecoveryScreen.test.ts`
- Create: `src/tests/unit/components/StartupProgress.test.ts`
- Modify: `src/tests/e2e/fixtures/tauri-mock.ts`
- Modify: `src/tests/e2e/startup-recovery.spec.ts`
- Modify: `src/tests/e2e/tray-quick-capture.spec.ts`
- Create: `scripts/check-native-db-cutover.mjs`
- Create: `scripts/check-native-db-cutover.test.mjs`

**Interfaces:**
- Activates: `DatabaseManager`, all native commands, generated DTOs, and native repositories.
- Removes: every production `@tauri-apps/plugin-sql` path and generic SQL capability.

- [ ] **Step 1: Write failing static-cutover and E2E lifecycle tests**

```javascript
test('production contains no SQL plugin or generic database escape hatch', async () => {
	const findings = await scanProductionDatabasePaths(root);
	assert.deepEqual(findings, []);
});
```

Add E2E assertions that quick-add gets update-required during initialization, retries after `Ready`, and one create action produces one command/operation ID.

Add component tests that render localized checking, backup, migration, verification, recovery-required, newer-schema, lock-held, and retry states in both English and Vietnamese without exposing filesystem paths or raw SQLite errors.

- [ ] **Step 2: Confirm the red state**

Run: `node --test scripts/check-native-db-cutover.test.mjs`

Expected: FAIL listing `@tauri-apps/plugin-sql`, `tauri_plugin_sql`, SQL capability, and direct service paths.

- [ ] **Step 3: Perform one atomic production switch**

Register `DatabaseManager` as Tauri state, the single-instance plugin, and all guarded commands. Replace `getDb` with native lifecycle/client initialization under Tauri and browser client under non-Tauri. Make repository files domain delegates. Delete the legacy Tauri service, platform, and startup modules; remove SQL plugin JS/Rust dependencies, initialization, permissions, and capability entries. Replace the shared capability with `main.json` and `quick-add.json`: only main receives initialize, retry, restore, backup publication/retention, and recovery commands; quick-add receives status, its minimum reads, and transaction-create. Rust label checks remain authoritative even if capability files regress. Wire startup progress, recovery selection, backup settings, and quick-add retry to typed lifecycle data and safe localized error codes. Update the E2E Tauri mock to implement the typed command contract, without using it as native safety evidence.

Add:

```json
"check:native-db-cutover": "node scripts/check-native-db-cutover.mjs"
```

The scanner permits generic SQL only under `src/lib/db/browser/` and test helpers; it fails for production imports, dependency declarations, capabilities, or initialization.

- [ ] **Step 4: Run the complete cutover gate**

Run in order:

```sh
pnpm check:native-db-cutover
pnpm check:db-contracts
cargo test --manifest-path src-tauri/Cargo.toml
pnpm check
pnpm test
pnpm test:e2e
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
```

Expected: all commands exit 0; static scan has no findings; existing browser behavior remains green.

- [ ] **Step 5: Commit Task 14**

```sh
git add src-tauri/src/lib.rs src-tauri/src/database/mod.rs src-tauri/src/database/commands.rs src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/capabilities/default.json src-tauri/capabilities/main.json src-tauri/capabilities/quick-add.json package.json pnpm-lock.yaml src/lib/db/index.ts src/lib/db/platform.ts src/lib/db/startup.ts src/lib/db/service.ts src/lib/stores/db.svelte.ts src/lib/db/repos src/routes/+layout.svelte src/routes/quick-add/+page.svelte src/routes/settings/backup/+page.svelte src/lib/components/system/RecoveryScreen.svelte src/lib/components/system/StartupProgress.svelte messages/en.json messages/vi.json src/tests/unit/components/RecoveryScreen.test.ts src/tests/unit/components/StartupProgress.test.ts src/tests/e2e/fixtures/tauri-mock.ts src/tests/e2e/startup-recovery.spec.ts src/tests/e2e/tray-quick-capture.spec.ts scripts/check-native-db-cutover.mjs scripts/check-native-db-cutover.test.mjs
git commit -m "feat(db): cut over to native database ownership"
```

---

### Task 15: Release gate, 0.2.0 package, and real Ubuntu proof

**Files:**
- Modify: `scripts/release-dogfood.mjs`
- Modify: `scripts/release-dogfood.test.mjs`
- Modify: `package.json`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Modify: `src-tauri/tauri.conf.json`
- Modify: `specs/2026-07-27-desktop-release-smoke-checklist.md`
- Create: `specs/notes/2026-08-17-v0.2.0.md`

**Interfaces:**
- Produces: `artifacts/0.2.0/notchy_0.2.0_amd64.deb` and checksum.
- Consumes: every native, crash, frontend, and package gate.

- [ ] **Step 1: Write failing clean-tree and release-order tests**

```javascript
test('rejects an untracked source file but allows explicit environment outputs', () => {
	assert.throws(() => assertClean([{ path: 'src/untracked.ts', status: '??' }]), /untracked source/);
	assert.doesNotThrow(() => assertClean([
		{ path: '.codegraph/daemon.sock', status: '??' },
		{ path: 'artifacts/0.2.0/notchy.deb', status: '??' }
	]));
});
```

Assert exact order: contract/cutover checks, Cargo tests including crash/process tests, frontend check/unit/E2E, database mutation suite, frontend build, Cargo check, then Tauri `.deb` build.

- [ ] **Step 2: Confirm the red state**

Run: `pnpm test:release-tooling`

Expected: FAIL because untracked-source inspection and the expanded gate are absent.

- [ ] **Step 3: Implement release `0.2.0` gate and notes**

Use `git status --porcelain=v1 --untracked-files=all`, parse every entry, and allow only exact `.codegraph/`, `artifacts/0.2.0/`, `build/`, `.svelte-kit/`, and `src-tauri/target/` prefixes. Reject all tracked modifications at release start and every unexpected untracked path. Synchronize all version records to `0.2.0`; document source app `0.1.4`, source schema `5`, target schema `6`, rollback backup, native cutover, and unsupported downgrade.

- [ ] **Step 4: Run automated release verification**

Run:

```sh
pnpm test:release-tooling
pnpm check:native-db-cutover
pnpm check:db-contracts
cargo test --manifest-path src-tauri/Cargo.toml
pnpm check
pnpm test
pnpm test:e2e
pnpm test:mutation:db
pnpm build
cargo check --manifest-path src-tauri/Cargo.toml
git diff --check
```

Expected: every command exits 0. Record exact test counts and accepted warnings in the release notes.

- [ ] **Step 5: Build the clean `.deb` and verify checksum**

Run: `pnpm release:dogfood`

Run: `sha256sum -c artifacts/0.2.0/notchy_0.2.0_amd64.deb.sha256`

Expected: `artifacts/0.2.0/notchy_0.2.0_amd64.deb: OK`.

- [ ] **Step 6: Obtain explicit approval for package installation**

This step changes the workstation's installed package. Stop and request user approval immediately before running `sudo apt install` commands.

- [ ] **Step 7: Exercise the complete Ubuntu daily-use checkpoint**

Install the prior 0.1.4 `.deb`, enter non-sensitive accounts, income, expense, transfer, budget, goal, rule, locale, and quick-account data, quit, and relaunch. Install 0.2.0 over it. Verify schema 5→6 migration, verified rollback backup, balances, transfer direction, reconciliation with adjustment, budget rollover, quick-add shortcut and retained window retry, tray actions, manual backup, restore, restart after injected failure, and operation-ID retry without duplication.

Expected: every case passes. Any skipped or failed GUI case leaves the result `partial` and blocks daily-use recommendation.

- [ ] **Step 8: Record evidence and commit**

Record Ubuntu version, source/target app and schema, backup path, checksum, test counts, each GUI result, and non-sensitive evidence paths in both documents.

```sh
git add scripts/release-dogfood.mjs scripts/release-dogfood.test.mjs package.json pnpm-lock.yaml src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json specs/2026-07-27-desktop-release-smoke-checklist.md specs/notes/2026-08-17-v0.2.0.md
git commit -m "docs: verify native database Ubuntu release"
```

---

## Completion Gate

Do not call this architecture complete because automated tests pass. Completion requires all of the following:

- One Rust executor/connection is the only production database path.
- The OS lock prevents a second process from opening SQLite.
- Every mutating user intent is atomic and idempotent under statement failure, IPC response loss, concurrency, and subprocess kill.
- Fresh, supported, too-old, newer, invalid, and corrupt schemas follow the specified byte-safe paths.
- Backup publication and restore replacement survive kill points with a verified recovery point.
- Rust window/capability guards—not frontend routing—enforce lifecycle authorization.
- The SQL plugin and generic production SQL escape hatches are absent.
- The 0.1.4/schema-5 → 0.2.0/schema-6 Ubuntu package upgrade, tray, quick-add, reconciliation, budget, backup, restore, and restart evidence are all recorded as passing.
