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
| Back up data, alter it, restore the backup, and capture a screenshot | Restored database matches the backup state; post-backup changes are replaced; screenshot required |  |  |  |  |  |

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
| Install 0.2.0 over 0.1.4; verify protected migration, data preservation, and a backup/restore round-trip |  | 0.1.4 / 5 | 0.2.0 / 6 | pending | pending | pending |
