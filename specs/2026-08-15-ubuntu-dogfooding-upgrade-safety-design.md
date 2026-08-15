# Ubuntu Dogfooding and Upgrade Safety

**Date:** 2026-08-15
**Status:** Approved design

## Goal

Make an early Notchy build safe to use with real personal-finance data on Ubuntu while development continues. A user installs a `.deb`, records daily transactions, reconciles accounts, reviews budgets, and later installs a newer `.deb` without losing or silently corrupting the existing database.

The core guarantee is:

> A package upgrade may migrate the database forward, but it must not leave the user's only recoverable copy in an uncertain state.

## Scope

This design adds:

- A protected database startup and migration sequence.
- Verified pre-upgrade backups with retention rules.
- A recovery screen for startup, backup, integrity, and migration failures.
- Version and database-health information in Settings.
- A repeatable Ubuntu `.deb` dogfood-release command and artifact convention.
- Automated migration and failure-path coverage plus a packaged-build acceptance test.

This design does not add:

- Automatic application updates.
- Reverse or down migrations.
- Cloud backup or synchronization.
- Scheduled transactions or other finance features.
- A custom Linux installer.

## Supported Usage Model

Notchy is installed and upgraded as a conventional Debian package. Every release keeps the stable Tauri identifier `com.notchy.app`, so package replacement does not change the application-data location. The SQLite database remains outside the source tree and outside the installed package.

The user installs an artifact with:

```sh
sudo apt install ./notchy_<version>_amd64.deb
```

Installing a newer package replaces application binaries while retaining application data. Forward database migration is supported. Running an older binary against a newer database is rejected. Returning to an older release requires restoring its pre-upgrade backup and reinstalling the matching package; Notchy does not attempt reverse migrations.

## Protected Startup Sequence

Database initialization is coordinated by one startup service used by the main Tauri window. The quick-add window does not independently initiate migrations.

The sequence is:

1. Open `sqlite:notchy.db` and apply required SQLite pragmas.
2. Run `PRAGMA integrity_check` before changing schema or data.
3. Detect whether the database is fresh and read its current schema version.
4. Compare the current version with the latest schema version compiled into the application.
5. Handle the result:
   - **Fresh database:** run initial migrations without creating a pre-upgrade backup.
   - **Current schema:** continue startup without a migration backup.
   - **Supported older schema:** create and verify a pre-upgrade backup, then migrate.
   - **Newer schema:** stop and show recovery guidance without modifying the database.
   - **Invalid or unreadable schema metadata:** stop and show recovery guidance without guessing.
6. Run pending migrations in ascending version order. Each migration and its schema-version update remain atomic in one database transaction.
7. Run integrity and domain consistency checks after migration.
8. Record the successful application version, schema version, migration time, and backup path in application metadata.
9. Continue normal application startup.

The startup coordinator exposes explicit states—`checking`, `backing_up`, `migrating`, `ready`, and `recovery_required`—so the layout never mistakes a database failure for a first run.

## Pre-Upgrade Backups

Pre-upgrade backups reuse SQLite `VACUUM INTO`; the live database is not copied as a raw file while open. The backup is stored below the Tauri application-data directory in `backups/upgrades/` with a name containing:

- The creation timestamp.
- The source schema version.
- The target schema version.
- The source application version when available.

Example:

```text
notchy-pre-upgrade-v5-to-v6-2026-08-15T10-30-00Z.sqlite
```

Before migrations start, Notchy opens the backup read-only and verifies:

- `PRAGMA integrity_check` returns `ok`.
- Required Notchy tables exist.
- The backup schema version equals the live database's source version.

Failure to create or verify this backup blocks migration. A normal launch backup remains best-effort, but a pre-migration backup is mandatory.

Upgrade backups and routine automatic backups have independent retention policies. Routine backups retain the existing rolling count. Upgrade backups retain at least the newest verified backup for every source schema version encountered on the device. A backup required to return to the immediately previous installed schema is never removed automatically.

## Migration Failure Semantics

Migration errors must not be swallowed. If a migration fails:

- Its transaction rolls back, including its schema-version update.
- The database connection is closed cleanly.
- The application enters `recovery_required` and does not load finance screens.
- The verified pre-upgrade backup remains untouched.
- Retrying first re-runs integrity and schema detection; it does not assume the previous state.

No automatic restore occurs after a failed migration. Automatic replacement could hide the original failure or overwrite useful diagnostic state. The user chooses restore explicitly from the recovery screen.

## Recovery Experience

During a normal schema upgrade, the application shows a short “Preparing your data” startup view. It does not expose migration internals unless startup fails.

The recovery screen displays:

- Installed application version.
- Detected and supported schema versions.
- A localized, plain-language failure summary.
- The live database path.
- The newest verified pre-upgrade backup path, when one exists.
- A copyable technical report that excludes accounts, transaction details, payees, descriptions, and monetary values.

Available actions are:

- Retry the protected startup sequence.
- Open the backup directory using the platform file-manager integration.
- Restore a selected verified backup after destructive-action confirmation.
- Quit the application.

Restoring a supported older backup is allowed: Notchy validates it, replaces the live database using the existing safe restore flow, and then migrates it forward through the protected startup sequence. A backup with a schema newer than the installed application is rejected without modifying the live database.

## Settings Visibility

Settings → Backup shows:

- Installed application version.
- Current database schema version.
- Database file location.
- Last successful routine backup time.
- Latest verified pre-upgrade backup and its source schema.
- Any outstanding backup warning.
- A “Create backup now” action.
- The existing export and restore actions.

Paths are selectable or copyable. The UI does not present the application-data directory as a directory the user should edit manually.

## Ubuntu Release Workflow

A single dogfood-release command performs these gates in order:

1. Confirm the three version declarations match:
   - `package.json`
   - `src-tauri/tauri.conf.json`
   - `src-tauri/Cargo.toml`
2. Run `pnpm test`.
3. Run `pnpm check`.
4. Run the relevant migration-fixture and release-safety tests.
5. Build the production frontend and Tauri `.deb` package.
6. Emit the exact artifact path and SHA-256 checksum.

The artifact naming convention is:

```text
notchy_<version>_<architecture>.deb
notchy_<version>_<architecture>.deb.sha256
```

Each dogfood release has a short changelog that identifies user-visible changes, database schema changes, upgrade notes, and the verification commands run. Package signing and a hosted update feed are deferred until automatic updates are introduced; the checksum protects the current local artifact handoff from accidental corruption.

## Architecture Boundaries

The implementation keeps these responsibilities separate:

- **Schema inspection:** determines whether a database is fresh, supported, current, or newer than the app.
- **Upgrade backup:** creates, verifies, names, and retains mandatory pre-migration backups.
- **Migration runner:** applies ordered transactional migrations and updates schema metadata.
- **Startup coordinator:** sequences integrity, inspection, backup, migration, verification, and UI state.
- **Recovery service:** validates and restores selected backups without containing UI code.
- **Release tooling:** validates version consistency and builds artifacts; it never accesses user data.

The startup coordinator depends on the smaller services through explicit results. Finance routes depend only on the coordinator reaching `ready`.

## Error Handling and Privacy

- A backup failure blocks only an upgrade that requires migration; it does not block a launch already on the current schema.
- Integrity, schema, and migration errors have stable application error codes and localized messages.
- Logs may contain versions, paths, error codes, migration names, and stack traces.
- Logs and technical reports must not contain financial rows or SQL parameter values derived from user data.
- Recovery actions that replace the live database require confirmation and identify which file will be replaced.

## Automated Verification

Tests must cover these externally meaningful outcomes:

- Fresh database startup creates no pre-upgrade backup.
- Current-schema startup performs no migration backup.
- Every released historical schema fixture upgrades to the latest schema while preserving representative accounts, transactions, balances, budgets, and settings.
- An upgrade creates and verifies a backup before the first migration runs.
- Backup creation or verification failure prevents migration.
- A migration failure rolls back its changes and leaves the source schema readable.
- Post-migration integrity failure enters recovery instead of loading the app.
- A newer-schema database is rejected without modification.
- A supported older backup restores and migrates forward.
- A newer-schema backup is rejected without replacing the live database.
- Upgrade-backup retention preserves the required rollback points.
- Version synchronization validation fails when any declaration differs.
- Technical reports omit representative sensitive values.

Database tests use real SQLite databases and committed fixtures. Failure-path tests inject failures at service boundaries while asserting the resulting database artifact, not only the thrown error.

## Packaged Ubuntu Acceptance Test

Before treating a dogfood release as installable:

1. Install the prior `.deb` on Ubuntu.
2. Complete onboarding and enter realistic non-sensitive sample data covering an account, expense, income, transfer, budget, and settings.
3. Quit and relaunch to prove persistence.
4. Install the new `.deb` over the existing package.
5. Confirm the application reaches `ready` and displays the original data and balances.
6. Confirm a verified pre-upgrade backup exists when the schema changed.
7. Exercise transaction creation through the main form and quick-add shortcut.
8. Reconcile an account and review the current budget.
9. Complete a manual backup and restore round trip.
10. Record Ubuntu version, package version, source and target schema versions, result, and evidence paths in the desktop release checklist.

## Acceptance Criteria

The design is complete when:

- A user can install an early Notchy `.deb`, enter real data, and upgrade to a later `.deb` without manually moving the database.
- Every schema-changing upgrade creates a verified recovery point before migration.
- The application refuses unsafe upgrade, downgrade, and corruption states without modifying the live database further.
- Recovery information is understandable without developer tools.
- A single command produces a tested, version-consistent `.deb` and checksum.
- A packaged Ubuntu upgrade has been exercised and recorded before the build is recommended for daily use.
