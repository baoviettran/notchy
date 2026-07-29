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
