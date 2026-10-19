# Desktop and rule management verification — 2026-10-19

Serves: STORY-026, STORY-029

Scope: current 0.2.1 source on Fedora 44 / GNOME Wayland. Test data lives in
`artifacts/0.2.1/fedora-smoke/{config,data}` through isolated XDG paths.
No personal database was used. Screenshots and binaries under `artifacts/` are
local evidence and intentionally ignored by Git.

## Implementation and review

- Settings → Classification rules now lists manual and learned rules, including
  disabled rules, with create/edit, enable/disable, confirmed delete, and confirmed
  learned-only clearing. Editing preserves provenance. Historical transactions
  remain unchanged; learned rules can appear again as more transactions are entered.
- Editor drafts survive locale changes. Modal close/cancel/delete labels track the
  locale outside the keyed shell.
- Native account/transaction patches now encode nullable fields using Rust's tagged
  patch contract. Real desktop transaction editing succeeds.
- Quick Add initializes its own webview adapter, retries initialization on focus,
  focuses the enabled input after retry, and has permission to hide after saving.
- Native rule DTOs include `deleted_at`, keeping the active-rule filter consistent
  with the browser adapter.
- Independent code review found one focus-retry issue, fixed with a failing-then-
  passing component regression. Follow-up review found no remaining issue.
- Independent design review: **ship**, no material fixes. Desktop, 390px width,
  and Vietnamese editor captures preserve the existing Settings design. Mechanical
  scan of the new page/form/dialog returned `[]`. Existing design documentation
  already covers the extension; the `docs/` submodule was not modified.

## Automated gates

| Gate | Result |
| --- | --- |
| Svelte / TypeScript `pnpm check` | Pass: 0 errors; 3 existing Quick Add CSS `@apply` warnings |
| Vitest, including coverage | Pass: 1,150 tests / 127 files |
| Coverage | Statements 83.43%, branches 75.51%, functions 77.02%, lines 85.10% |
| Changed-file coverage floor | Pass; native client statements 98.98%, branches 93.24% |
| Playwright full suite | Pass: 159 tests |
| Final-build affected E2E rerun | Pass: 6 rules / Quick Add tests |
| Rust | Pass: 326 tests |
| Clippy, all targets, warnings denied | Pass |
| Generated IPC contracts | Pass: bindings current |
| Native database cutover check | Pass |
| Release tooling test | Pass |
| Roadmap generation | Pass; existing historical stale-plan classifications retained |
| Frontend production build | Pass |
| Desktop release bundles | Pass: DEB and RPM built |

Vitest used two workers to avoid resource pressure. Playwright 1.52 ran under
Node 22.23.3 because its loader hangs under the default Node 24.22.0 here. pnpm
11.25.0 uses the added workspace configuration for patches and approved dependency
builds; matching the repository's exact tool versions was waived by the user.

## Native evidence

The development native host was driven through WebKitWebDriver with real Rust /
SQLite commands, not the browser test adapter:

| Case | Result / evidence |
| --- | --- |
| Onboarding and account creation | Pass; `evidence/01-onboarded.png` |
| Expense create/edit/delete | Pass; 50,000 → 60,000 edit, then absent after delete; `02-edited-transaction.png`, `03-delete-confirmation.png`, `04-transaction-deleted.png` |
| Income and transfer | Pass; 1,000,000 income and 100,000 transfer; Checking 900,000 / Savings 100,000 before Quick Add |
| Manual backup and restore | Pass; backup verified, probe transaction added, restore removed probe and preserved original IDs; `06-backup-created.png`, `07-backup-restored.png`, `backup-results.json` |
| SQLite / CSV export commands | Pass; SQLite and all seven archival CSV files written under `export/` |
| Quick Add save | Pass; 15,000 expense persisted and window hidden after save; `08-quick-add.png` |
| Tray actions | Pass; real DBus menu Quick Add, Show Notchy, Quit activated |
| Global shortcut | User manually confirmed Ctrl+Shift+N opens Quick Add; synthetic XWayland injection was inconclusive |
| Locale and restart | Pass; Vietnamese locale and Checking 885,000 / Savings 100,000 persisted; `09-vietnamese-settings.png`, `persisted-state.json` |

Evidence paths above are relative to `artifacts/0.2.1/fedora-smoke/`.

## Final packaged binary

The final DEB was extracted with `ar` / `tar`; its `usr/bin/notchy` ran on Fedora
against the same isolated profile through WebKitWebDriver. This is execution of
the packaged binary, not a package-manager installation.

- Restart preserved the exact account balances, transaction IDs and Vietnamese
  locale recorded above (`10-packaged-persistence.png`).
- Two injected orphan `.tmp-wal` / `.tmp-shm` backup files disappeared on startup.
- The new UI created, edited, disabled, re-enabled and deleted a manual rule.
  A learned fixture created through native IPC appeared in the list; confirmed
  learned-only clearing soft-deleted it, retained the manual rule and kept all
  historical transaction IDs (`11-packaged-rules.png`, `package-results.json`).
- Real tray activation opened Quick Add. Its input had focus; Enter saved a 15,000
  expense through Rust and hid the window. The probe was subsequently deleted
  (`package-quick-results.json`).
- Final package SHA-256 values are recorded in `package-sha256.txt` beside the
  local evidence. Source implementation commits: `30b8e0c`, `8dc0745`, `b27e650`.

## Limits

The initial run did not certify a package-manager upgrade or native operating-system
file-picker interaction; the follow-up below records those additional checks.
Direct SQLite restore and export command verification is distinguished from
clicking through a file picker. Raw per-table CSV exports
are archival data, not a lossless full-database import format; use SQLite backup
for full restore. Historical release-checklist results retain their original
scope and limitations.

## Follow-up: package installation and native file picker

- Rootless Fedora 44 container: DNF installed the actual 0.2.1 RPM;
  `rpm -V notchy` succeeded. Ubuntu 24.04 container: APT installed the released
  0.2.0 DEB, upgraded to the 0.2.1 DEB, and `dpkg -V notchy` succeeded. A file
  placed in the container's app-data directory survived the package upgrade.
  These checks cover package transactions, not launching the app in a container.
  Logs are local under `artifacts/0.2.1/package-manager-smoke/`.
- The user confirmed the real Save dialog exported a SQLite file. Read-only
  inspection reported integrity `ok`, schema 7, and no restore probe transaction.
- Importing that file through Settings failed before replacement: the UI still
  used the removed JavaScript SQL plugin. A native-dispatch regression test
  reproduced the missing-package error. Direct restore-command smoke testing
  above did not cover this broken entry point.
- The fix routes selected-file imports to the main-window-only `database_import`
  command. Rust classifies the source, publishes a validated snapshot in owned
  backup storage, then uses the existing rollback and atomic-restore protocol.
  Unsupported schema versions retain their specific import messages.
- Native regression tests cover export/diverge/import, rollback publication,
  supported older-schema migration, source preservation, invalid-source
  rejection, and the window guard. Browser E2E hooks explicitly exercise their
  legacy validation adapter; they do not certify the native picker flow.
- The user retried import on the rebuilt DEB binary through the real file
  picker: import succeeded and the `TEST PHUC HOI` transaction disappeared.
  Read-only verification confirmed integrity `ok`, all three original live
  transaction IDs exactly matching the exported backup, and an unchanged hash
  for the selected source file (`import-picker-before.json`,
  `import-picker-after.json` under the local evidence directory).
- The user exported CSV into the project directory through the folder picker.
  All seven table files parsed with consistent columns, including two accounts
  and three transactions (`csv-picker-results.json`).
- The user confirmed cancel/reopen works for SQLite Save, CSV folder selection,
  and SQLite Import (including its confirmation). No busy state or confirmation
  blocked the second attempt. Native picker verification is complete for this
  Fedora 44 session.
- Final fix verification: 1,154 unit/component tests in 128 files; 17 native
  command tests; 11 browser backup/recovery E2E tests; type check (0 errors,
  three existing CSS warnings), Clippy with warnings denied, frontend build,
  and rebuilt DEB/RPM bundles passed. Independent review found no remaining
  blocker. The new commit's CI must complete before merging PR #40.
