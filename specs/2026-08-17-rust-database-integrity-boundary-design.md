# Rust Database Integrity Boundary

**Date:** 2026-08-17  
**Status:** Revised architecture — awaiting user review

## Goal

Make Notchy safe to use as the only copy of daily financial data by giving one native Rust service exclusive authority over SQLite connections, transactions, migrations, backups, restores, and database health.

The non-negotiable guarantees are:

> A financial operation commits every intended database change or commits none of them, regardless of window concurrency, IPC timing, process concurrency, or failure.

> Retrying an operation after an ambiguous IPC result never duplicates a financial effect.

## Why the current boundary is unsafe

The current JavaScript `DatabaseService.transaction()` sends `SAVEPOINT`, write statements, rollback, and release as separate Tauri SQL-plugin IPC calls. The plugin uses a connection pool, so those calls are not guaranteed to use the same SQLite connection. A failure can therefore leave partial data or schema changes committed while the wrapper reports rollback. Database startup also shares this path with quick-add-window connection attempts.

## Exact native execution model

### Dedicated database executor

Rust owns one dedicated database executor thread for the entire process. That thread owns the sole live `rusqlite::Connection`; the connection is never placed behind a `Sync` mutex and never crosses threads. Tauri commands send typed jobs over a bounded channel and await typed one-shot responses. A job represents one complete read or business operation, so all SQL belonging to an operation executes on the same connection.

Synchronous SQLite work runs only on the executor thread and never blocks Tauri's async runtime. The queue has a bounded capacity and returns a stable `database_busy` error rather than growing without limit. `database_status` reads a separately synchronized lifecycle snapshot and does not wait for SQLite.

Candidate inspection may open a temporary `mode=ro` connection, but only inside the executor while the lifecycle state excludes normal operations. No other component opens the live database.

### Cross-process exclusion

Before opening any SQLite connection, `DatabaseManager` acquires an exclusive OS advisory lock on a stable lockfile in the application-config directory and holds it until process exit. Failure to acquire the lock fails closed before SQLite is opened. Tauri single-instance behavior focuses the existing main window for normal launches, but the lockfile remains the authoritative safety mechanism.

A two-process integration test must prove that the losing process never opens or modifies the database.

## Native lifecycle and authorization

The Rust manager enforces this state machine:

```text
Uninitialized
  → Initializing(checking | backing_up | migrating | verifying)
  → Ready
  → RecoveryRequired
  → Restoring
  → Initializing | RecoveryRequired
```

Every data command checks `Ready` inside Rust. Initialization, retry, restore, backup retention, and other destructive recovery commands verify the caller's window label and are exposed only through main-window Tauri capabilities. Quick-add receives only status, required reads, and its minimum transaction-create command. Frontend routing is presentation, not authorization.

During `Initializing`, `RecoveryRequired`, and `Restoring`, ordinary reads and writes fail with stable lifecycle errors. The executor drains any in-flight job before entering restore and admits no new data jobs until the replacement database is reopened and validated.

## Command and transaction boundaries

### Commands represent complete user intent

Rust commands are organized by domain, but mutating commands represent atomic business use cases rather than generic CRUD or frontend-chained steps. Examples include:

- Create account with opening balance.
- Create income or expense transaction.
- Create both sides of a transfer.
- Reconcile an account with an optional adjustment.
- Import a deduplicated transaction batch.
- Merge a category tag and update every reference.
- Allocate or roll over a budget.
- Create, update, close, or delete a goal with its invariants.

Each mutation validates and writes inside one `BEGIN IMMEDIATE` native transaction. Validation reads happen inside that transaction to prevent check-then-write races. Repository-shaped frontend modules remain the only callers of `invoke`, so stores and routes keep their existing domain interfaces.

### Idempotent mutation receipts

Every mutating request carries a client-generated operation ULID. A native `operation_receipts` table stores the operation ID, command kind, canonical request hash, result identifier, and completion time in the same transaction as the financial effect.

- Retrying the same operation ID with the same command and request returns the recorded result.
- Reusing an operation ID with different input returns `operation_id_conflict`.
- A receipt is never committed without its financial effect and vice versa.

This is migration 006, making schema 6 the target schema for the integrity-boundary release; it is architecture support rather than an optional finance feature.

## Typed IPC contract

Rust `serde` DTOs and enums are the source of truth. Generated TypeScript bindings, or an equivalent checked generation step, are committed and verified in CI so the frontend cannot drift from the native API.

Contracts use:

- Signed 64-bit integers for smallest-currency-unit amounts, with JavaScript safe-range validation at the boundary.
- ULID strings validated natively.
- Strict ISO date types and bounded text/list sizes.
- Explicit patch enums so omitted, null, and unchanged values are distinct.
- Tagged, allowlisted error envelopes containing stable codes and safe metadata only—never raw SQLite, `anyhow`, SQL parameters, financial rows, payees, descriptions, or amounts.

Backup and restore commands do not accept unrestricted frontend-supplied filesystem paths. Rust file selection and backup discovery return opaque tokens bound to canonicalized approved files; commands resolve and revalidate those tokens natively.

## Protected startup and schema policy

Only the main window can request initialization. Startup holds the OS lock and native lifecycle ownership through:

1. Resolve the existing application-config database path exactly; never create a second database in the application-data directory.
2. If the file is absent, create the current schema in a temporary file in the same directory, validate and `fsync` it, atomically publish it, and open it as the live database.
3. If any file already exists, inspect it through an actual read-only connection before applying persistent pragmas. A zero-byte or partially initialized file is `invalid`, not `fresh`.
4. Classify it as `too_old`, `older`, `current`, `newer`, or `invalid`. Only released supported schemas migrate.
5. For an older supported schema, publish a verified pre-upgrade backup before opening the live database read-write.
6. Open the sole live connection, apply connection policy, and run each pending migration plus schema-version update in one native transaction.
7. Validate the exact target manifest, physical integrity, and foreign keys before entering `Ready`.
8. Record successful application/schema versions, source application version, migration time, and verified backup identity.

Fresh bootstrap and every released migration live in one Rust migration registry. The TypeScript migration registry is removed at production cutover; there is never a second production source of schema truth. Non-transactional migration statements are rejected during review and testing.

## Connection and filesystem policy

The live connection uses `foreign_keys=ON`, `busy_timeout=5000`, `journal_mode=DELETE`, and `synchronous=FULL`. A single executor does not need WAL read concurrency, and the rollback-journal policy reduces sidecar and restore complexity. When opening a legacy WAL database after read-only acceptance, startup checkpoints it before switching to `DELETE`; tests cover interruption during this transition.

The application-config and application-data directories are private to the user, and database, lock, backup, staged, and receipt files are created with user-only permissions. Tests assert the exact live path and prove startup never creates a second empty database.

Schema manifests are version-specific and cover tables, columns, types, nullability, defaults, primary/foreign keys, indexes, triggers, and constraints that carry business invariants. Validation runs SQLite integrity and foreign-key checks. Read-only rejection tests compare database bytes and sidecar state before and after inspecting too-old, newer, corrupt, and invalid files.

## Crash-safe backup, retention, and restore

### Backup publication

While normal jobs are excluded, Rust uses SQLite's online backup API to write a uniquely named temporary file in the destination directory. It validates the complete source-version manifest, runs integrity and foreign-key checks, `fsync`s the file, atomically renames it to its final name, and `fsync`s the directory. Only then is the backup recorded as verified and eligible for retention.

Filename parsing is discovery metadata, never proof. Every retained candidate is revalidated before it can displace another recovery point. Retention protects the newly created backup and at least the newest verified rollback point for every encountered source schema. Backup filenames use the last successful source application version, not the target binary version.

### Restore replacement

Restore follows this fail-closed protocol:

1. Enter `Restoring`, reject new jobs, and drain the executor queue.
2. Create and publish a verified rollback backup of the current live database.
3. Resolve the opaque candidate token and validate the candidate through a true read-only connection.
4. Copy it to a unique temporary file beside the live database, validate it again, and `fsync` it.
5. Finish or roll back the active transaction, close the live connection, and safely retire any rollback journal plus legacy WAL/SHM state.
6. Atomically rename the staged file over the live database and `fsync` the parent directory.
7. Reopen, run protected migration if needed, and validate the exact target manifest before returning to `Ready`.
8. On failure, enter `RecoveryRequired` and expose the verified rollback point; never claim success from a partially reopened database.

Recovery discovers and validates retained compatible backups independently of the current startup attempt and allows the user to select among compatible verified recovery points.

## Atomic production cutover

The Rust manager, migrations, domain services, typed bindings, and tests are developed behind an inactive native adapter against temporary databases. Production continues to use the existing backend only on non-release development commits.

One explicit cutover task switches every production repository adapter together, removes `@tauri-apps/plugin-sql`, removes its Rust plugin and capabilities, deletes direct SQL imports and generic production SQL access, and enables the native manager. No build with mixed Rust/plugin ownership is dogfoodable, releasable, or eligible to merge to the release branch.

A static release gate fails if the SQL plugin dependency, capability, initialization, import, or direct production database path remains.

## Testing and proof

- Native integration tests exercise the real `DatabaseManager` and Tauri command guards with temporary real SQLite files.
- Failure injection after every statement of each multi-step business operation and migration must reopen to all-or-nothing state.
- Subprocess kill tests terminate the process at migration, backup-publication, and restore-replacement failpoints, then verify recovery on restart.
- Concurrency tests cover simultaneous initialization, write rejection during startup/restore, executor queue bounds, and quick-add access.
- Two-process tests prove OS-lock exclusion before SQLite open.
- IPC-response-loss tests prove operation-ULID retries are idempotent.
- Migration fixtures cover fresh bootstrap, released schemas 3 and 4, and byte-for-byte non-mutation of unsupported/newer/invalid databases.
- Backup tests prove read-only validation, full manifests, durable publication, safe retention, rollback creation, and crash-safe restore.
- Contract tests prove Rust/TypeScript DTO and error-code parity.
- Frontend tests cover adapter mapping and recovery presentation; browser mocks are not evidence of native atomicity.
- A packaged Ubuntu upgrade test remains required, including tray, quick-add, reconciliation, budget, manual backup, restore, and restart-after-failure evidence. A release is partial until every case is recorded.

## Release gate

The dogfood release command verifies version and generated-contract consistency, runs native, frontend, browser, mutation, crash/failure, and package tests, then builds the `.deb` and checksum. Before building, it checks tracked and untracked files and rejects unexpected paths. Environment-owned `.codegraph/` data and generated build/artifact directories are handled through an explicit narrow allowlist; untracked source files always fail the gate.

## Out of scope

- Cloud synchronization.
- Automatic updates.
- Down migrations or automatic restore after migration failure.
- New finance features unrelated to integrity.

## Acceptance criteria

- One executor thread and one live Rust-owned SQLite connection are the only production database path.
- The OS lock prevents a second process from opening SQLite.
- Every business mutation is atomic and idempotent under injected failure, IPC response loss, concurrency, and process termination.
- Unsafe schema states are inspected read-only and rejected without byte or sidecar mutation.
- Backup publication and restore replacement remain recoverable across process kill or power-loss boundaries.
- Recovery can discover and restore verified retained backups for every supported failure state.
- Main-only lifecycle and recovery authorization is enforced in Rust and Tauri capabilities.
- No production SQL-plugin dependency, capability, initialization, import, or generic SQL access remains after the atomic cutover.
- The release command rejects unexpected tracked or untracked source changes, produces a checksum-verified `.deb`, and the complete Ubuntu checklist is honestly exercised and recorded.
