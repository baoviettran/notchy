# Desktop release smoke checklist

This is a manual desktop release verification record for a packaged Notchy build. It is not automated Tauri coverage. Run the application with `pnpm tauri dev` while developing, then repeat this checklist against a manually installed packaged build before release.

Record one completed row for each case. Every completed row must include the OS, package version, and a `pass` or `fail` result. For every failed case, record paths to both a screenshot and the app log in **Evidence path**. Screenshot evidence is also required for destructive-data cases: delete, restore, and import.

Store evidence outside version control, using paths that identify the release build and operating system. Do not put sensitive financial data in screenshots, logs, backups, or CSV files.

## First launch

| Case | Expected persisted data | OS | Package version | Result (pass/fail) | Evidence path | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| First launch opens a usable application with a fresh local data store | Fresh database is created; no pre-existing accounts or transactions appear |  |  |  |  |  |

## Onboarding

| Case | Expected persisted data | OS | Package version | Result (pass/fail) | Evidence path | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Complete onboarding and create the initial account | Onboarding completion and initial account remain after navigation |  |  |  |  |  |

## Quick-add shortcut

| Case | Expected persisted data | OS | Package version | Result (pass/fail) | Evidence path | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Invoke the quick-add keyboard shortcut and save a transaction | New transaction is saved to the selected account with the entered integer currency amount |  |  |  |  |  |

## Tray actions

| Case | Expected persisted data | OS | Package version | Result (pass/fail) | Evidence path | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Use every available tray action, including showing and hiding the app and quitting it | No unintended data change; explicit quit closes the application cleanly |  |  |  |  |  |

## Transaction create

| Case | Expected persisted data | OS | Package version | Result (pass/fail) | Evidence path | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Create an income or expense transaction | Transaction fields and affected account balance are saved accurately |  |  |  |  |  |

## Transaction edit

| Case | Expected persisted data | OS | Package version | Result (pass/fail) | Evidence path | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Edit an existing transaction | Edited values and recalculated account balance replace the prior values |  |  |  |  |  |

## Transaction delete (destructive)

| Case | Expected persisted data | OS | Package version | Result (pass/fail) | Evidence path | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Delete a transaction and capture a screenshot | Deleted transaction is absent and the account balance is recalculated; screenshot required |  |  |  |  |  |

## Transfer

| Case | Expected persisted data | OS | Package version | Result (pass/fail) | Evidence path | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Create a transfer between two accounts | Linked transfer entries persist; source decreases and destination increases by the same integer amount |  |  |  |  |  |

## Restart persistence

| Case | Expected persisted data | OS | Package version | Result (pass/fail) | Evidence path | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Quit and relaunch the installed build | Accounts, transactions, transfers, balances, and settings created above remain intact |  |  |  |  |  |

## Backup and restore (destructive)

| Case | Expected persisted data | OS | Package version | Result (pass/fail) | Evidence path | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Back up data, alter it, restore the backup, and capture a screenshot | Restored database matches the backup state; post-backup changes are replaced; screenshot required | Ubuntu 24.04.5 LTS (x86_64) | 0.2.1 | **pass** | `artifacts/0.2.1/evidence/step3-package-backup-page.png` | Run on the packaged binary from `artifacts/0.2.1/notchy_0.2.1_amd64.deb` (extracted with `dpkg-deb -x`, not `apt install`ed), driven by WebKitWebDriver against an isolated XDG tree. Backup created by a real click on the page's own *Create backup now* button; probe expense added (`tx 1 → 2`), then `database_restore` replaced it (`2 → 1`, probe gone). The pre-restore rollback snapshot `notchy-backup-v6-0.2.1-01M3W07SH47JW97ARFWRDMGM9J.sqlite` read back `integrity_check → ok` with 2 transactions, i.e. it captured the state the restore discarded. Detail: `specs/notes/2026-08-17-v0.2.0.md`, *Blocker 1 port — re-verified on a package, 0.2.1*. |

## CSV round-trip (import is destructive)

| Case | Expected persisted data | OS | Package version | Result (pass/fail) | Evidence path | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Export transactions to CSV, import the CSV into a clean test data set, and capture a screenshot | Imported transaction data matches the export without duplicate or missing rows; screenshot required for import |  |  |  |  |  |

## Locale switch

| Case | Expected persisted data | OS | Package version | Result (pass/fail) | Evidence path | Notes |
| --- | --- | --- | --- | --- | --- | --- |
| Switch between available locales | Selected locale remains active after navigation and restart |  |  |  |  |  |

## Upgrade (0.1.3 → 0.1.4)

The released `v0.1.3` caps at schema 4, so this upgrade runs the protected migration path (verified pre-upgrade backup → migration 4 → 5 → post-migration verification), not the earlier no-migration assumption. Sample data (checking + savings accounts, expense, income, transfer, budget, locale `vi`, quick-add default) was entered at 0.1.3; the 0.1.4 package was installed over it.

| Case | OS | Source app / schema | Target app / schema | Result (pass/fail) | Pre-upgrade backup path | Evidence path |
| --- | --- | --- | --- | --- | --- | --- |
| Install 0.1.4 over 0.1.3; verify protected migration, data preservation, and a backup/restore round-trip | Ubuntu 24.04.4 LTS (x86_64) | 0.1.3 / 4 | 0.1.4 / 5 | pass | `~/.local/share/com.notchy.app/backups/upgrades/notchy-pre-upgrade-v4-to-v5-0.1.4-2026-08-16T15-53-39-156Z.sqlite` | Live DB `~/.config/com.notchy.app/notchy.db`; app log `~/.local/share/com.notchy.app/logs/Notchy.log` |

Notes: `app_meta` records `last_successful_app_version = 0.1.4`, `last_successful_schema_version = 5`, `last_migrated_from_schema = 4`, and the pre-upgrade backup path. All 4 accounts, 5 transactions (expense, income, transfer with `transfer_pair_id`), the budget, and balances survived (salary 12,955,000; savings 2,000,000; July accounts 1,000,000 each). A manual backup → added transaction → restore round-trip confirmed the added row disappears while originals remain. GUI-only exercises (tray actions, `Ctrl+Shift+N` quick-add, reconcile, budget review) were not automatable in this session (no X automation tool); tray/global-shortcut registration is part of the Rust build and the app reached the dashboard after each launch.

## Upgrade (0.1.4 → 0.2.0)

The released `v0.1.4` caps at schema 5, so this upgrade runs the protected migration path (verified pre-upgrade backup → migration 5 → 6 → post-migration verification). Schema 6 adds operation-id deduplication for retry-safe writes. The npm package `@tauri-apps/plugin-sql` was removed; all database operations now route through Rust (`rusqlite`).

| Case | OS | Source app / schema | Target app / schema | Result (pass/fail) | Pre-upgrade backup path | Evidence path |
| --- | --- | --- | --- | --- | --- | --- |
| Install 0.2.0 over 0.1.4; verify protected migration, data preservation, and a backup/restore round-trip | Ubuntu 24.04.5 LTS (x86_64), GNOME on Wayland | 0.1.4 / 5 | 0.2.0 / 6 | **partial** | `~/.local/share/com.notchy.app/backups/notchy-backup-v5-0.1.4-01M3CGSB1ASS5VDMKWMHXE4HVJ.sqlite` — note the missing `upgrades/` | `artifacts/0.2.0/evidence/` (screenshots); full case table in `specs/notes/2026-08-17-v0.2.0.md` |

Notes: the installed binary is byte-identical to `artifacts/0.2.0/notchy_0.2.0_amd64.deb` (`sha256 a7e08a87…`), so this row describes the shipped artifact. Migration, data preservation, transfer direction, reconcile-with-adjustment, and budget rollover all passed. The result is `partial`, blocking the daily-use recommendation, on two defects found against the shipped package:

- **Settings → Backup & Data is non-functional under Tauri.** The page reads the database through `db.raw`, a raw escape hatch that exists only on the browser client, so the health card errors, "Create backup now" writes nothing, and Export SQLite/CSV throw. The E2E suite drives the browser client, where `raw` exists, so it stayed green. There is also no native create-backup command, and routine backup has not run since 2026-08-19. (The page has since been ported off `db.raw` — see the note below.)
- **The pre-upgrade backup lands in `backups/`, not `backups/upgrades/`.** The 0.1.3 → 0.1.4 row above shows the JS path writing the `upgrades/` subdirectory; the native path regressed, so Settings "Open backup folder" points at a directory that does not exist after the upgrade.

Both defects are fixed on `fix/native-backup-upgrades-dir` (`1ecb590`, after the `0.2.0` build) and will ship in the next release; the `0.2.0` artifact was not re-cut. The `settings/backup` page has since been ported off `db.raw` and onto the domain port (`specs/settings-backup-native-port`, `8917db1`…`4e783b2`).

**Re-verified on the `0.2.1` package (2026-10-01).** `artifacts/0.2.1/notchy_0.2.1_amd64.deb` (`sha256 03303e6a…`) was driven by WebKitWebDriver against an isolated XDG tree, and both previously-blocked GUI cases pass there: **Manual backup** (a real click on *Create backup now* published a verified backup) and **Backup/restore round-trip** (probe change replaced on restore) — see the *Backup and restore (destructive)* row above. **Export SQLite / CSV**, recorded `fail` for `0.2.0`, also works on the `0.2.1` command side.

This row nonetheless stays `partial`, because what it describes is the package-manager upgrade and Step 7's full checkpoint, and neither was replayed: the `0.2.1` run used a **fresh** tree from an extracted `.deb` (no `apt install`, no `0.1.4 → 0.2.1` upgrade), the native file pickers are not WebDriver-drivable, **Restart after injected failure** still stands `fail` (the sweep in `1ecb590` is unverified), and the `Ctrl+Shift+N` chord and tray activation remain undrivable (no reliable OS-level key injection on Wayland; no StatusNotifierHost exposed). Detail: `specs/notes/2026-08-17-v0.2.0.md`.
