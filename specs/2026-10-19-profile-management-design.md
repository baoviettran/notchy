# Independent financial profiles

**Serves:** STORY-037
**Date:** 2026-10-19
**Status:** Written spec approved by the owner on 2026-10-19. Implementation plan pending review; not implemented.

**Plan:** [Profile management implementation plan](plans/2026-10-19-profile-management.md)

## 1. Intent and evidence

As a Notchy user, I want separate financial contexts such as personal, household and trial books, so I can maintain, reset and recover one without changing another.

Evidence is the owner's Vietnamese brainstorming conversation on 2026-10-19 in the Notchy workspace. The initial request was: “là user tôi muốn có thể quản lý profile của mình: thêm, xóa, reset, backup, phục hồi”. The owner then explicitly selected independent financial datasets rather than separate authenticated users or a single resettable dataset.

Decisions confirmed in that conversation:

- Profiles have independent financial data and can be switched within the app.
- Reset returns a profile to its newly created state, keeping its name.
- Restore always creates a new profile. The owner explained: “do có thể lựa chọn xóa profile cũ mà, không nhất thiết phải ghi đè”.
- Deleting the last profile is allowed; the app returns to Create profile / Restore backup.
- Each profile has its own directory, database and internal backups (“1+3 ok đấy”).
- Reset requires a successful automatic backup and retains internal backups. Deletion removes the profile and its internal backups, with an option to export first.
- The owner approved the switcher, management screen, renaming, profile currency, shared language/theme, legacy migration, failure behavior and verification scope, then requested “ổn, ghi spec”.

Success means every operation clearly identifies its profile; data never leaks between contexts; recovery creates an independently usable copy; existing users retain their data when upgrading.

This document makes technical choices needed to deliver those agreed behaviors. These details are subject to written-spec review, not evidence of additional owner requests.

## 2. Scope and boundaries

Included: create, list, open/switch, rename, reset, delete, per-profile backup/export, restore as new, first-run/empty state, migration of existing data, and coordination with Quick Add.

Excluded: authentication, access-control isolation between OS users, passwords/encryption, cloud sync, automatic backup scheduling beyond existing behavior, profile merging, restore-overwrite UI, attachments and simultaneous editing of different profiles in different windows.

| Profile-owned | Application-owned |
| --- | --- |
| Accounts, transactions/transfers, categories/tags, budgets/rollovers, goals, debts, reconciliation | Profile registry and last successfully opened profile |
| Schedules, classification rules and learned rules, payee history and any other financial-domain tables | Language and theme |
| Currency, onboarding/tour progress, profile-specific metadata | Application process lock and lifecycle coordination |
| Internal routine, upgrade and pre-reset backups | Legacy-adoption marker and pending lifecycle operations |

CSV import mapping presets, where persisted with financial data, remain profile-owned; they are distinct from the financial profiles in this design. Existing integer-money and ULID conventions continue to apply.

## 3. User experience

### Entry and management

The sidebar displays the active profile name and opens a switcher with the profile list, Create profile, Restore backup and Manage profiles. Narrow layouts expose an equivalent accessible control. The management page is `/settings/profiles`; a database-independent picker at `/profiles` handles the no-active-profile state.

Management lists profiles, marks the active one, and provides rename, backup/export, reset and delete. These operations may target an inactive profile without silently making it active. The existing backup page displays the active profile name and only that profile's health and internal backups.

Names are trimmed, required, and limited to 80 Unicode characters. Names are labels, never directory names. Duplicate names are allowed; the list also shows creation time and a short ID to distinguish them. New names suggested by restore receive a numeric suffix if needed, but the user can edit them.

On normal launch, open the last successfully used profile. With no profiles, show only Create profile and Restore backup. If profiles exist but the saved selection no longer exists, show the picker. If the selected profile is damaged, show its recovery screen with access to the picker; do not silently create a blank database.

### Create and rename

Create asks for a name, initializes a fresh database with the normal default seed data, and opens onboarding after successful activation. Currency is chosen through existing setup. A failure publishes no usable profile and preserves the previous active session. Rename changes only the label and does not move files or change the ID.

### Switch and drafts

Only one profile is active application-wide. Before changing it, resolve unsaved input in the main window and Quick Add. Offer to stay and finish/save, discard and continue, or cancel; do not attempt to auto-save invalid or incomplete forms. A window that cannot acknowledge draft state blocks the switch until it can be resolved.

Once resolved, disable writes while switching, load the destination and rebuild profile-bound frontend state. Open the dashboard for a configured profile or onboarding for an unfinished profile. Do not retain a route containing the previous profile's entity ID. Persist the last-active selection only after activation succeeds.

### Backup and restore

Backup creates a verified snapshot of the selected profile. Export writes a portable SQLite snapshot to the user's chosen location using the existing durable export mechanism. It includes all profile-owned database content, not the global registry or application preferences. CSV export remains a report/export feature, not a complete profile backup.

Restore accepts a selected compatible SQLite backup or a verified internal backup, validates it, asks for a name, and creates a fresh profile ID. Suggest the source profile label when available, otherwise a name based on the file. New backups carry the source display name as non-authoritative metadata; older backups without it remain supported. Never reuse a backup's profile ID as the destination identity.

Stage, validate and migrate the imported snapshot before publishing it. Preserve restored currency, onboarding state, schedules and rules. Ignore legacy locale/theme metadata when applying application settings. Opening the restored profile runs the normal idempotent due-schedule catch-up and reports its result.

After success, show the new profile with an Open action. Restore does not force a switch or discard the current draft. Source files are never modified. No restore action in Settings or startup recovery overwrites an existing profile; a damaged profile can remain listed while its backup becomes a new one. The existing internal rollback machinery remains available for crash recovery, not as an overwrite product option.

### Reset

Confirm the named profile and explain that financial data and profile settings will return to defaults. Create and verify an automatic pre-reset backup before modifying anything. If backup fails, stop and keep the profile unchanged.

Replace the live database with a freshly initialized database. Preserve the profile ID, name, creation time and internal backup history. Clear onboarding and tour progress along with financial settings; currency is chosen again during setup. If active, reopen onboarding; if inactive, leave the current session alone. Preserve the newest pre-reset backup until a later successful reset supersedes it, or the profile is deleted; routine retention must not immediately prune the recovery point.

### Delete

Confirm the profile name and explicitly state that its database and internal backups will be deleted. Provide Export backup before deleting; if selected, a canceled or failed export cancels deletion. Exporting to a directory that will be deleted is rejected. Previously exported files outside app-owned profile storage are retained.

Deleting an inactive profile preserves the active session. Deleting the active profile resolves drafts first and returns to the picker, without automatically choosing another profile. Deleting the last one returns to Create profile / Restore backup. An unopenable profile can still be deleted after confirmation; export failure does not authorize deletion under the export-first choice.

## 4. Storage and native ownership

Use an application-owned registry independent of any financial database:

```text
appConfigDir/
  profiles.json                  # version, profiles, last-active ID, adoption marker
  preferences.json               # locale and theme
  notchy.lock                    # retained application-wide lock
appDataDir/
  profiles/
    <ULID>/
      notchy.db
      backups/                   # routine snapshots
        upgrades/
        resets/
  profile-operations/            # durable operation journals and staging
```

The registry stores stable ID, name and creation timestamp per profile. Paths are derived from validated IDs and known roots in Rust. The frontend cannot choose internal storage paths. A native operation journal records the operation ID, target profile, phase and staging/rollback paths for crash reconciliation.

Registry and preference writes use private permissions and durable temp-file publication. A malformed registry is a recovery condition, not an empty profile list. Reconcile journals before accepting commands; unregistered directories are never silently adopted as active profiles. Registry corruption offers retry and recoverable diagnostics without deleting directories.

Introduce a native profile coordinator which owns the application-wide lock, registry, operation serialization and optional active `DatabaseManager`. Refactor manager lifecycle ownership so replacing a manager never releases the application lock or requires two owners of the same lock. Financial queries continue through the existing domain ports and dedicated executor; keep raw SQL out of frontend code.

Separate registry operations from the active database port so list/create/restore/delete remain available when no database can open. Native commands accept profile IDs and operation inputs; backup export and restore also accept user-selected external paths. Generate and verify their DTO contracts using the existing workflow.

Reuse connection, manifest, migration, online-backup, file-sync and validation primitives in `src-tauri/src/database/`. Parameterize paths rather than duplicating the current backup/restore protocols. Keep the existing `AppDatabase` domain behavior, with a profile-session scope added at the adapter/native boundary.

## 5. Switching and cross-window correctness

Every opened profile session has an ID and generation. Domain calls and responses carry or bind to this pair, including Quick Add, scheduled posting, imports and events. Reset also advances the generation even though the profile ID is unchanged. A stale request fails rather than running against whichever database is now active.

The coordinator serializes lifecycle changes. It stops admission of new operations for the outgoing session, waits for accepted work to finish, and closes the old connection before opening the destination through the existing integrity/migration pipeline. Already accepted commands retain their original destination; none are rerouted.

If opening the destination fails, reopen the outgoing profile and restore its view. If reopening also fails, show a recovery/picker state with writes disabled; never label one profile while exposing another's data. Persisted last-active state changes only after successful activation.

Publish a session-change event to all webviews. Each clears profile-specific stores, cached results, entity selections, forms after draft resolution, tour state and listeners, then reloads for the new generation. Late results and transaction events from old generations are ignored. A missed event is detected by session validation on commands/focus, not trusted as proof that the window is current.

Quick Add shows the profile name and cannot submit with a stale session. With no active profile or incomplete onboarding, it directs the user to the main window for setup. Due schedules run once per activation with the existing database idempotency protections; windows must not each independently trigger the pass.

The locale remount boundary remains separate: stateful surfaces stay outside `{#key settings.locale}`, with tracked labels. Shared locale changes preserve drafts. An intentional profile-session reset occurs only after draft resolution and must not be implemented by moving stateful components into the locale key.

## 6. Atomic lifecycle operations and recovery

Create/restore builds in staging, verifies schema/integrity/foreign keys, migrates supported old schemas and syncs the files before publication. Publication and the registry update are journaled so a crash between them can finish or roll back deterministically. A profile becomes visible only when committed. A retry with the same operation ID must not create duplicate profiles.

Restore rejects unsupported-newer, unsupported-old, corrupt and unrelated SQLite files with actionable messages. Revalidate the staged copy rather than trusting a previous file-picker inspection or filename. Do not mutate the source to migrate it.

Reset journals the verified pre-reset backup and the staged fresh database before replacing the live one. Keep a rollback copy until the fresh database has passed initialization. On failure or restart, resolve to the complete original or complete new database; never expose partial deletion. The backup survives either outcome.

Delete closes/drains target work, journals intent, renames the owned directory into pending deletion, removes its registry record and then cleans the files. Before registry commit, failures roll back the rename. After commit, deletion is logically complete; failed cleanup is reported as pending and retried on startup. Do not claim disk cleanup succeeded while files remain. Deleted profiles never reappear because an orphan directory was discovered.

All cleanup validates containment within managed roots and does not follow symlinks outside them. Export destinations inside the selected profile directory, staging or pending-deletion storage are rejected. Other profiles and external exports are never cleanup targets.

## 7. Existing-user migration

Current desktop storage is `appConfigDir/notchy.db` plus `appDataDir/backups`; the frontend mirrors these paths in `src/lib/db/index.ts`. Adopt this data once into a profile named “Cá nhân”.

Under the application lock, detect legacy storage before treating the app as empty. Preserve the established startup integrity/legacy-WAL handling. Snapshot valid data into staged profile storage, copy the full existing internal backup tree, validate and sync the copies, then durably register the profile and the adoption-complete marker. Retire old owned files only after commit. The operation is resumable and does not depend on a cross-filesystem rename.

If the legacy database is corrupt, preserve it and its backups and expose a recoverable legacy profile rather than booting a blank one. Its internal backups can be restored into a new profile. No files are discarded to make migration appear successful.

Move the existing stored locale into application preferences once; preserve the effective theme when available, otherwise use the current default. Keep currency and setup progress in the adopted profile. Once application preferences exist, switching or restoring a profile never overrides them. Boot-time locale detection remains synchronous, followed by authoritative preference loading.

The durable adoption marker prevents leftover legacy files from recreating “Cá nhân” after the user deletes their last profile. Older exports remain importable through the supported schema policy. Unknown versions remain errors, not candidates for destructive conversion.

## 8. Frontend and adapter integration

Introduce a profile service/port with native and browser implementations, a Svelte rune-based profile store, the picker/management route, and switcher controls. Keep application preferences separate from profile settings in `settings.svelte.ts`. Expand boot state to include no selection, transition and profile recovery before rendering database-dependent pages.

Relevant existing integration points include `src/routes/+layout.svelte`, `src/lib/stores/db.svelte.ts`, `src/lib/stores/settings.svelte.ts`, `src/lib/db/index.ts`, native command registration, the backup page, RecoveryScreen, Quick Add and the scheduled-posting boot effect.

Browser/test adapters model separate databases per profile and the same public lifecycle semantics. Browser storage retains its existing development/test persistence guarantees; this feature does not turn it into a separately supported persistent web product. Real filesystem crash durability requires native tests and desktop verification.

All user-facing copy is supplied in `messages/en.json` and `messages/vi.json`. Dialogs identify the target profile, support keyboard navigation and restore focus. Progress/error messages distinguish the target profile and preserve valid entered names on retry.

## 9. Acceptance criteria and verification

Write failing tests before implementation. Database tests use real SQLite, with `createTestDb()` for frontend database tests and temporary filesystem roots for native lifecycle tests.

| Scenario | Required result |
| --- | --- |
| Create A and B, add data and configure different currencies | Each retains only its own financial data/settings across switches and restart |
| Rename a profile, including to a duplicate label | ID/files/data stay stable; list remains distinguishable |
| Switch with a main-window or Quick Add draft | User can stay or discard; cancel preserves both draft and active profile |
| Switch during accepted writes or delayed reads/events | Writes finish only in their original session; stale work never affects/displays in the destination |
| Open destination fails | Original reopens, or explicit recovery appears if rollback also fails |
| Reset succeeds | Verified pre-reset backup exists; same profile identity, fresh seed state and onboarding; other profiles unchanged |
| Pre-reset backup fails | No reset, no lost financial data |
| Restore valid current/compatible old/legacy backup | New ID and correct data; source and all existing profiles unchanged |
| Restore malformed/newer/unrelated file or cancel | No published profile, actionable error or clean cancellation |
| Restore a profile with schedules | Due entries catch up idempotently when opened, with visible feedback |
| Delete active, inactive or last profile | Correct picker/active state; target internal backups removed, external exports retained |
| Export-first fails or user cancels | Deletion does not proceed |
| Crash at each create/restore/reset/delete publication boundary | Restart resolves journal deterministically without partial visible profiles or cross-profile loss |
| Upgrade legacy database with backups, then restart mid-adoption | Data/backups/settings preserved exactly once; no duplicate profile |
| Delete last profile after legacy adoption | Restart stays empty; old files do not recreate the profile |
| Corrupt registry or selected database | Recoverable UI with files preserved; no silent blank initialization |
| Switch locale with a draft, including in profile dialogs | Labels update while draft survives |

Verification layers: native unit/integration and crash-injection tests; port-contract parity; frontend unit/component tests for state/drafts; Playwright profile journeys; real Tauri smoke checks for file dialogs, restart persistence, permissions, Quick Add and backup/reset/restore/deletion. Web E2E alone is not desktop evidence.

Implementation validation runs `pnpm test`, `pnpm check`, relevant native tests, generated-contract checks, `pnpm build` and relevant `pnpm test:e2e` journeys, using the repository's required toolchain. Record exact results and desktop screenshots in the implementation work. No implementation or test-pass claim is made by this design document.
