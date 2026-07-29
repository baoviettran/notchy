# Test Confidence Audit — 2026-07-27

## Verdict

The automated suite is a useful regression safety net, but it is not sufficient evidence that a release works in the installed desktop application. Its strongest coverage is the SQLite-backed business/data layer. Its weakest boundary is the real Tauri runtime, where browser E2E substitutes sql.js and a detailed IPC mock for the SQL, filesystem, dialog, tray, and global-shortcut plugins.

Passing tests should therefore be interpreted as: “the covered behaviours still work in their test environments,” not “the application is release-ready.”

## Evidence collected

| Check | Result | What it establishes |
| --- | --- | --- |
| `pnpm test:coverage` | 52 files, 426 tests passed | Repository, migration, parser, rules, backup, and component tests are executable and green. |
| `pnpm test:e2e` | 87 Chromium tests passed | Major web user journeys work through the browser/sql.js path. |
| `pnpm check` | 0 errors, 1 `autofocus` accessibility warning | The Svelte/TypeScript project type-checks. |
| Unit coverage | 55.91% statements, 54.94% branches, 40.96% functions | Passing status is not caused by a near-complete execution suite. |

## What deserves confidence

- Repository tests use `createTestDb()` with real in-memory SQLite, rather than mocking SQL.
- Transaction tests cover transfer creation/update/delete, incoming-transfer visibility, batch atomicity, and nested savepoint rollback.
- Migration tests cover seed data, idempotence, and recovery from a known half-applied migration state.
- Backup tests reopen a real `VACUUM INTO` SQLite artifact; E2E backup tests cover restore rejection and a reload round trip.
- The E2E suite covers the main account, transaction, budget, category, goal, debt, report, settings, import, rules, onboarding, and reload flows.

## Material confidence gaps

### P0 — validate the installed desktop application

`src/tests/e2e/fixtures/tauri-mock.ts` emulates Tauri IPC using sql.js and an in-memory virtual filesystem. It is sophisticated and valuable, but it cannot prove actual plugin permissions, app-data paths, SQLite pool behaviour, dialogs, tray callbacks, global shortcuts, or independent webview contexts. `src-tauri/src/lib.rs` has no Rust tests.

Before each release candidate, run a short manual smoke checklist in `pnpm tauri dev` (or a packaged build): first launch/onboarding, quick-add shortcut and tray menu, create/edit/delete/transfer, restart persistence, backup creation, restore of a copied backup, CSV import/export, and both locales. Record OS, package version, and result.

### P0 — protect data upgrades with historical database fixtures

The migration suite validates migrations and one half-applied state, but it creates its database with the current migration set before simulating that state. Add committed SQLite fixtures representing each released schema version, then open each fixture through the same desktop startup/migration path and assert both schema version and representative user data are preserved. This catches upgrade bugs that a fresh DB cannot reveal.

### P1 — make risk coverage measurable

Coverage has no thresholds, and the global 56% statement figure includes UI that is intentionally excluded from component execution. Do not set a blanket 100% target. Instead, require high branch coverage for data-integrity modules (`transactions`, `accounts`, `backup`, `integrity`, migrations) and track the number of release-critical journeys executed in a real Tauri build.

### P1 — independently test test quality

No mutation-testing tool is configured. Run mutation testing only against pure and repository-domain modules first (transaction validation, parsers, rules matcher, import deduplication, backup validation). A mutant that survives is a specific demonstration that the test suite missed a plausible defect; it is more informative than line coverage for AI-authored tests.

### P2 — improve untested UI and error paths

The coverage report shows zero execution for several form, modal, chart, tour, layout, and notification components. Add tests only where those components contain business decisions or accessibility interactions; do not create shallow “renders” tests merely to increase a percentage. Prioritize form submission errors, disabled states, focus/escape behaviour, and destructive-action confirmation paths.

## Test-review rules for future AI-assisted changes

1. Start from a business invariant or a previously observed failure, not a function name.
2. Make the test fail against a deliberately broken implementation before accepting it.
3. Assert an externally visible result: persisted data, rendered user state, or a real integration boundary—not a private helper call.
4. Include at least one rejection/rollback case for every operation that can alter financial data.
5. Keep the implementation and its tests in separate review passes; ask “what one-line bug would this test fail to catch?”
