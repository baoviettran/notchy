# Coverage Bug Inventory

- **Date:** 2026-08-28
- **Plan:** `specs/plans/2026-08-28-test-coverage-cure.md` (Task 1)
- **Purpose:** the bug → test backlog. Each gap row must gain a regression test via the named target capability. Primary files seed `specs/coverage-floors.json`.
- **Layers:** unit / component / E2E / native-boundary / (none)

## How to read

- **Existing test** — the test (if any) that would RED on the pre-fix build. "partial" = some related coverage exists but the exact failure mode is not asserted.
- **Target test** — which capability task must lock this bug down. `TC-2` = unit/component prove-it, `TC-7` = E2E flow, `TC-8` = native-boundary, `TC-4` = extraction test.
- Rows marked `dead-code-candidate` are **not** coverage targets — they throw by construction and are imported by nothing.

## Regression-test rows (the backlog)

| # | Bug | Fix commit | Layer | Primary file(s) | Existing test? | Target test |
|---|---|---|---|---|---|---|
| 1 | Quick-add DB contention → "no such savepoint" (single pooled connection, savepoint collision across windows) | `feeb31a` | DB / store | `src/lib/stores/db.svelte.ts`, `src/lib/db/browser/service.ts` | covered — `db-service.test.ts` nested-in-flight savepoint test + `uniqueSavepointName` | TC-2 (Task 8) |
| 2 | Migration idempotency race → "duplicate column name" on concurrent boot | `feeb31a` | DB / boot | migrations, `db.svelte.ts` boot | covered — `migrations.test.ts` sequence re-run + version-lag race | TC-2 (Task 8) |
| 3 | Autocomplete silently drops typed free-text payee on save (needed `allowFreeText`) | `8a48997` | component | `src/lib/components/primitives/Autocomplete.svelte` | covered — `Autocomplete.test.ts` + `AutocompleteBindProbe.svelte` | verify (Task 9) |
| 4 | Schema-version call-site drift → silent E2E break when versions disagree | `c1b7d0a` / `341c702` | migration versioning | `importDatabase`/`validateImport` literals (UI, unit, E2E fixtures) | covered — `schema-version-drift.test.ts` scans the E2E mock literals vs the registry | TC-2 (Task 8) |
| 5 | Playwright `selectOption({label})` flaky on `bind:value` selects | `c1b7d0a` | E2E helper | `src/tests/e2e/helpers/` | covered — E2E 138/138 green | none (pattern already in memory) |
| 6 | Vite dev Svelte CSS purge race → postcss "Unknown word onMount" | `ac4865a` | dev tooling | `vite.config.ts` patch | covered — build-only patch, no test (`pnpm build` is the check) | none |
| 7 | `parseAmount` k/m/tr locale handling; **tokenizer must NOT expand** (parseAmount already does, locale-aware) | baseline | pure | `src/lib/utils/quick_parse.ts`, `number_parse.ts` | covered — `quick_parse-tokenizer.test.ts` spies the parseAmount arg: the raw suffix token ("50k") must reach parseAmount, so a pre-expanding tokenizer goes RED | TC-2 (Task 9) |
| 8 | Batch UI fixes — tour, DatePicker, onboarding, budgets, i18n | `dbcb436` | UI / E2E | `tour/*`, `DatePicker.svelte`, onboarding, budgets, i18n strings | covered — E2E specs per area (onboarding.spec, budgets.spec, tour→light-contrast, DatePicker→goals/accounts, i18n→settings/transactions); DatePicker numeric gap (30%) flagged for Task 11; flow-level red-reproduction is Task 13 — now `onboarding-regression.spec.ts` (single-click advance after locale switch) + `datepicker-regression.spec.ts` (Today/Clear overlay actions), each verified RED on `dbcb436^` and GREEN on HEAD | TC-5 (Task 11) + TC-7 (Task 13) |
| 9 | **Native seam**: `NativeDatabaseClient` op → Rust command name + arg shape is untested (only invoke-error propagation covered) | n/a (live path) | native-boundary | `src/lib/db/native/client.ts` (→ `src-tauri/src/database/commands.rs`) | gap — `native-client.test.ts` mocks invoke to *throw* | **TC-8 (Task 2)** |
| 10 | Native mutation idempotency (operation ULID reused across retry) | `9bc6587` / `5acefa4` | native | `src/lib/db/native/client.ts`, Rust commands | covered on Rust side (`cargo test` in CI); JS retry-ULID reuse not asserted | TC-8 (Task 2) — assert retry reuses ULID |
| 11 | VACUUM / boot-ready gating for quick-add (no-account hint, init gating) | `662f325` | store | `src/lib/stores/db.svelte.ts` | partial | TC-4 extraction test (Task 6) |
| 12 | Broad design/E2E surface polish (nav dedup, focus ring, loading states, a11y, reports) | `c1b7d0a` + design commits | UI / E2E | routes + `src/lib/components` | covered — dedicated E2E specs (accounts/budgets/goals/debts/reports-extended, contrast, motion) | none (existing specs) |

## Native seam detail (row 9)

`initDb()` (`src/lib/db/index.ts:368`) sets `_db = new NativeDatabaseClient()` under `isTauri()`. Every op is `invoke('<command>', args)` to a Rust `#[tauri::command]` — 70 commands registered in `src-tauri/src/lib.rs` `generate_handler!`. **No test asserts a correct operation** — only error propagation (`native-client.test.ts`). Suspected live seam: JS passes camelCase arg keys (`{ accountId }`) but Rust params are snake_case (`account_id`), and `tauri.conf.json` has no camelCase config — unverified whether Tauri converts. TC-8 (Task 2) must resolve it.

## Dead-code rows (NOT coverage targets)

These standalone adapters all `throw new Error('native <x> adapter not wired')` and are imported by **nothing** (`grep -rn "db/native/<name>"` across `src/` + `scripts/` returns no importers — `client.ts` defines its own ops). Candidate for a separate removal task; excluded from `coverage-floors.json` and Stryker mutate lists.

| File | Status |
|---|---|
| `src/lib/db/native/accounts.ts` | dead-code-candidate |
| `src/lib/db/native/transactions.ts` | dead-code-candidate |
| `src/lib/db/native/budgets.ts` | dead-code-candidate |
| `src/lib/db/native/categories.ts` | dead-code-candidate |
| `src/lib/db/native/goals.ts` | dead-code-candidate |
| `src/lib/db/native/rules.ts` | dead-code-candidate |
| `src/lib/db/native/meta.ts` | dead-code-candidate |
| `src/lib/db/native/debts.ts` | dead-code-candidate |
| `src/lib/db/native/reconciliations.ts` | dead-code-candidate |
| `src/lib/db/native/reports.ts` | dead-code-candidate |
| `src/lib/db/native/export.ts` | dead-code-candidate |

## Cross-checks performed (Task 1 Step 2)

- `git log --all -i --grep="fix|bug|regress"` — enumerated bug-bearing commits (`feeb31a`, `8a48997`, `ac4865a`, `341c702`, `9bc6587`, `5acefa4`, `c1b7d0a`, `dbcb436`, plus the design/E2E surface).
- Memory docs (`MEMORY.md`) — confirmed the seed classes: quick-add contention, migration idempotency, autocomplete free-text, schema-version drift, playwright selectOption, vite CSS race, parseAmount tokenizer.
- `grep` of `src/tests/unit/**` — verified which seeds already have tests (rows above). Remaining gaps: row 9 (native seam, the priority), row 7's tokenizer-constraint, row 4's cross-literal drift test, rows 1/2 failure modes.