# Rust Database Integrity Boundary

**Date:** 2026-08-17  
**Status:** Approved direction — implementation plan pending review

## Goal

Make Notchy safe to use as the only copy of daily financial data by giving one native Rust service exclusive authority over SQLite connections, transactions, migrations, backups, restores, and database health.

The non-negotiable guarantee is:

> A financial write either commits every intended database change or commits none of them, regardless of window concurrency, IPC timing, or a failed migration.

## Why the current boundary is unsafe

The current JavaScript `DatabaseService.transaction()` sends `SAVEPOINT`, write statements, rollback, and release as separate Tauri SQL-plugin IPC calls. The plugin uses a connection pool, so those calls are not guaranteed to use the same SQLite connection. A failure can therefore leave partial data or schema changes committed while the transaction wrapper reports rollback. Database startup also shares this path with quick-add-window connection attempts.

## Chosen architecture

### Rust is the single database owner

Add a Rust `DatabaseManager`, managed by Tauri state, that owns:

- Resolution of the one live database path.
- A process-wide startup lock and a write mutex.
- The SQLite connection/pool lifecycle.
- Real SQLite transactions for all multi-step operations.
- Protected startup, schema inspection, migrations, backup creation/verification, retention, restore, and integrity checks.

No production frontend module opens SQLite directly or imports `@tauri-apps/plugin-sql`. The plugin is removed from production dependencies after the command migration; browser/E2E test adapters remain separate and do not represent the production safety boundary.

### Typed command families

The Rust API is grouped by responsibility, not by UI screen:

- `database_initialize`, `database_status`, and `database_retry` for protected startup.
- `accounts_*`, `transactions_*`, `budgets_*`, `goals_*`, `categories_*`, `reconciliations_*`, and settings/meta commands for normal data access.
- `backup_create`, `backup_list`, `backup_restore`, and `backup_health` for recovery.

Every mutating command performs validation and all related SQL statements in a single Rust transaction. Read commands use the same manager but do not acquire the write mutex. Frontend repositories become typed `invoke` wrappers and retain their domain-shaped interfaces so routes and stores do not become command-aware.

### Window and startup ownership

Only the main window invokes `database_initialize`. It holds the startup lock through integrity check, read-only schema inspection, verified backup, transactional migration, post-migration validation, and startup metadata write.

Other windows call `database_status` before data access. Until status is `ready`, they receive stable `database_update_required` state and do not open another connection. This removes the quick-add race completely.

## Safety rules

- Use an actual read-only SQLite connection for candidate validation and initial inspection of an existing database. Do not apply persistent pragmas before rejecting newer, invalid, or too-old schemas.
- Recognize `fresh`, `too_old`, `older`, `current`, `newer`, and `invalid` schemas. Only supported older schemas migrate forward.
- Validate backups against a version-specific schema manifest: integrity, foreign keys, required tables, required columns, and exact/range schema policy.
- A verified backup record is trusted only after live validation; filename parsing is discovery metadata, never proof. Retention cannot remove the newest verified recovery point for a source schema.
- Recovery discovers the newest compatible retained verified backup independently of the current migration attempt. Restoring validates the candidate before replacing the live database, then reruns protected startup.
- Error reports are allowlisted operational metadata only—never financial rows, SQL parameters, payees, descriptions, or amounts.

## Migration approach

Keep existing numbered migrations and schema semantics. Port their execution to Rust gradually behind a migration registry, starting with the release-supported schemas 3 and 4. Each migration and schema-version update execute in one native transaction on one connection. There are no down migrations and no automatic restore after a migration failure.

Normal finance writes move in vertical domain slices so each repository has exactly one implementation path at a time. A temporary dual-write or JS fallback is forbidden: it would reintroduce split authority and make reconciliation of failures impossible.

## Testing and proof

- Native integration tests use temporary real SQLite files and inject failures after each statement of every multi-step write and migration; reopening the file must show all-or-nothing state.
- Concurrency tests prove a quick-add/status request cannot obtain a writable connection during migration.
- Migration fixtures cover schema 3 and 4 preservation plus unsupported/newer rejection without mutation.
- Backup tests prove read-only inspection, verified manifest checks, safe retention, and restoration from retained records.
- Frontend tests cover only command mapping and recovery presentation; they do not mock away native transaction behavior.
- A packaged Ubuntu upgrade test remains required, including tray, quick-add, reconciliation, budget, manual backup, and restore evidence. A release is marked partial until every required manual case is recorded.

## Scope and sequencing

This correction phase replaces the database boundary before adding features. It includes the release-tool clean-tree gate so untracked source files cannot silently enter a release. It does not add cloud sync, automatic updates, down migrations, or a database redesign.

Implementation is split into independently reviewable phases: native manager and startup; schema/backup/recovery hardening; domain repository migration; frontend adapter removal; release and packaged-upgrade proof.

## Acceptance criteria

- No production write or migration uses JavaScript-level SQL-plugin transactions.
- All financial multi-step writes and migrations are demonstrated atomic under injected failure and concurrency tests.
- Unsafe schema states are inspected read-only and enter recovery without live-database mutation.
- Recovery can find and restore a verified retained backup for every supported failure state.
- A release command refuses tracked or untracked source changes, produces a checksum-verified `.deb`, and the full Ubuntu upgrade checklist is honestly completed.
