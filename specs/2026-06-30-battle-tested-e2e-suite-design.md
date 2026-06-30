# Battle-Tested E2E Suite — Design

**Date:** 2026-06-30
**Goal:** Replace the single onboarding E2E spec with a comprehensive, isolated Playwright suite that proves Notchy's core flows — breadth across every route, depth on the data-integrity surfaces (transactions, accounts/reconciliation, budgets), and full-IPC-mock depth on backup/restore plus a reload-survival guarantee. This is the gate that lets us call the app "battle-tested" before shipping.

## Context & Decisions

The existing suite (`src/tests/e2e/onboarding.spec.ts`) is a single happy path: onboarding → dashboard → add one transaction. It runs against the **in-memory sql.js DB fallback** (active because Playwright's chromium has no `window.__TAURI_INTERNALS__`), so every test starts from a fresh DB. Playwright config (`playwright.config.ts`) builds the static site (`pnpm build && pnpm preview`) on port 4173, chromium-only, 10s expect timeout, `trace: 'on-first-retry'`, `reuseExistingServer: !CI`.

Confirmed decisions from brainstorming:

1. **Goal = breadth + depth (choice C).** One smoke/CRUD test per route, plus deep multi-step suites on the data-integrity surfaces and backup/restore.
2. **Tauri handling = mock `__TAURI_INTERNALS__` globally but opt-in per spec (choices B then C).** A full IPC-boundary mock is scoped to the backup/restore specs via a fixture; other specs stay on the plain in-browser sql.js path.
3. **Persistence = toggleable (choice C).** Default: fresh DB per navigation (fast). A `persistDb(page)` helper opts specific specs (reload-survival, backup round-trip) into IndexedDB-backed cross-reload persistence.
4. **Structure = hybrid (choice C).** Every non-onboarding test starts from an onboarded state via an `onboardedPage` fixture that *re-runs the real onboarding* (not a hand-written SQL seed), so the foundational setup path stays under test and cannot silently drift from what real onboarding produces.

## Architecture & Layout

```
src/tests/e2e/
├── fixtures/
│   ├── onboarded.ts     # test.extend({ onboardedPage }) — runs the 3-step onboarding setup
│   ├── tauri-mock.ts    # scoped __TAURI_INTERNALS__ + fake Database.load + fake FS, IndexedDB-backed
│   └── persist.ts       # persistDb(page) helper: toggle mock DB to survive reload (opt-in)
├── helpers/
│   └── ui.ts            # addTransaction(), onboard(), ... shared UI actions (no assertions)
├── onboarding.spec.ts   # refactored to use fixtures
├── transactions.spec.ts
├── accounts.spec.ts
├── budgets.spec.ts
├── debts.spec.ts
├── goals.spec.ts
├── reports.spec.ts
├── categories.spec.ts
└── backup-restore.spec.ts   # full IPC mock: round-trip, corrupt/mismatch rejection, auto-backup, reload-survival
```

Three layers:

1. **Fixtures** (`test.extend`) — own the environment. `onboardedPage` gives every non-onboarding test an already-set-up app. `tauriMockPage` swaps in the IPC mock only where opted. `persistDb(page)` flips the mock to IndexedDB-backed.
2. **Helpers** (`ui.ts`) — pure UI actions, no assertions. Centralize selector and shortcut knowledge so a rename = one-file edit.
3. **Specs** — focused `test()` blocks combining helpers + assertions. One failure does not block siblings.

Every non-onboarding spec uses `onboardedPage` (re-runs the 3 steps, so onboarding stays under test). Backup/restore opts into `tauriMockPage`. The reload-survival test calls `persistDb(page)`.

## The Tauri-FS Mock (`fixtures/tauri-mock.ts`)

Injected via `page.addInitScript` *before* the app loads, so by the time `getDb()` runs, the seams resolve to the mock. This is what makes backup/restore and reload-survival provable.

### What it fakes

1. **`window.__TAURI_INTERNALS__`** — presence-only flag. `getDb()` (`src/lib/db/index.ts`) and `runAutoBackup()` (`src/lib/backup/index.ts`) both gate on `!!window.__TAURI_INTERNALS__`. Setting it flips both onto the Tauri path.
2. **`@tauri-apps/plugin-sql` `Database.load('sqlite:<path>')`** — intercepted at the **Tauri IPC boundary**. The plugin ultimately calls `__TAURI_INTERNALS__.invoke(cmd, args)`. The mock supplies an `invoke` that handles `plugin:sql|*` commands by routing them to a **real sql.js instance** from a `path → sql.js` registry. `notchy.db` is one instance; a backup file is another. The real plugin code runs; only the IPC transport is faked — maximal fidelity.
3. **`@tauri-apps/plugin-fs`** (`copyFile`, `mkdir`, `readDir`, `remove`, `stat`) + **`@tauri-apps/api/path`** (`appDataDir`, `join`) — also routed through `invoke` to an in-memory virtual filesystem: `Map<path, Uint8Array>`. `copyFile` copies bytes between paths. `appDataDir()` returns a fixed `/notchy/appdata`.
4. **The persist layer** — a `persistMode` flag set via `persistDb(page)`. Off (default): `notchy.db` is a plain in-memory sql.js DB, fresh per test, fast. On: the mock serializes the DB to **IndexedDB** on every write and rehydrates on `Database.load('sqlite:notchy.db')`, so a `page.reload()` reopens the same data.

### Targeted override: `VACUUM INTO`

`createBackup` runs `db.execute('VACUUM INTO ?', [path])`. sql.js (in-memory) cannot VACUUM INTO an arbitrary filesystem path. The mock's SQL executor **special-cases this single statement**: instead of passing it to sql.js, it serializes the current DB to bytes via `db.export()` and writes them to the virtual FS at `path`. This is the *only* place the mock re-interprets SQL rather than passing it through — documented in the mock. Everything else is real SQL on real sqlite.

### Persistence toggle (`fixtures/persist.ts`)

`persistDb(page)` calls `page.evaluate` to flip a flag the mock reads. Subsequent writes also flush to IndexedDB; `Database.load('sqlite:notchy.db')` checks IndexedDB first. Powers the reload-survival test.

### Honest caveat

The `VACUUM INTO` override and the IPC-boundary interception are the two places this mock re-interprets rather than replays. Both are documented in `tauri-mock.ts`. The trade-off (vs. a pure logic-level test of `validateImport`/`importDatabase`) is accepted because the goal is to prove the whole button → file → restored-DB chain through the real plugin boundary.

## Test Inventory

~35–45 test cases across 10 spec files. `breadth` = smoke/CRUD, `depth` = multi-step or edge.

### `onboarding.spec.ts` (refactor existing to fixtures)
- Keep existing happy path: language → currency → first account → dashboard → add tx.
- *depth:* Finish button disabled until name entered (already asserted); invalid amount rejected on first tx.

### `transactions.spec.ts` (depth)
- Add expense, income, transfer via FAB/modal (transfer requires to-account).
- `50k` / `1.2k` shortcut parsing proven in a real flow.
- **Edit** an existing tx → amount changes in list.
- **Delete** a tx → removed from list.
- Transfer edit is blocked (kind disabled in edit mode — assert the disabled state).
- Pagination prev/next when >page-size transactions exist.

### `accounts.spec.ts` (depth)
- Create account from accounts page; appears in list.
- Open detail (`accounts/[id]`); balance reflects transactions.
- **Reconcile happy path:** enter actual = expected → reconciles cleanly.
- **Reconcile large discrepancy:** `isLargeDiscrepancy` triggers the warning before confirming.

### `budgets.spec.ts` (breadth + one depth)
- Allocate to a budgetable category → persisted.
- **Prev/next month navigation** → month label changes, allocations independent per month.
- Update an existing allocation.

### `debts.spec.ts` (breadth)
- Load + create/edit a debt; renders.

### `goals.spec.ts` (breadth)
- Load + create/edit a goal; renders.

### `reports.spec.ts` (breadth)
- Smoke `reports/`, `reports/trend`, `reports/compare` load with seeded data, no console errors.

### `categories.spec.ts` (breadth)
- Create a category; merge if the UI exposes it.

### `backup-restore.spec.ts` (depth — opts into `tauriMockPage`)
- **Backup → restore round-trip:** seed data → backup → diverge (add txns) → restore from the backup file → original data returns.
- **Corrupt import rejected:** restore from a non-Notchy/corrupt file → error shown, live DB untouched.
- **Schema-version mismatch rejected:** wrong-version file → error, untouched.
- **Auto-backup runs on launch** and prunes to 10 (set `last_backup_at` old; assert a backup file appears).
- **Reload-survival** (calls `persistDb`): add tx → `page.reload()` → tx still present. *The local-first promise.*

## Conventions

### Shared helpers (`helpers/ui.ts`) — actions only, no assertions
- `addTransaction(page, { kind: 'expense'|'income'|'transfer', amount, account?, toAccount? })` — opens FAB, scopes to modal, clicks kind, fills amount, saves.
- `onboard(page, { lang, currency, accountName })` — the 3-step setup, used by `onboardedPage`.
- Selectors centralized here so a UI rename = one-file edit.

### Fixture contract
- `onboardedPage` — `test.extend` giving `{ page }` already through onboarding. Re-runs setup each test.
- `tauriMockPage` — wraps `page` with `addInitScript` injecting the mock *before* first `goto`. Backup specs use this.
- `persistDb(page)` — function a test calls to flip persistence on.

### Robustness
- Scope modal interactions to `page.getByRole('dialog')` (dashboard has an inline quick form that collides).
- Scope list assertions to `page.getByRole('main')` to avoid toast/echo collisions.
- No fixed waits. Use `expect().toBeVisible()` with the configured 10s timeout.
- Each `test()` is independent — own onboarded state, own (mock) DB.

## Known Failure Modes the Suite Must Handle (not paper over)

- *sql.js WASM init latency on first load* — covered by the 10s expect timeout.
- *`VACUUM INTO` override* — if sql.js can't produce valid bytes, backup fails loudly, not silently. Mock logs every FS write to a debug array the spec can inspect.
- *Auto-backup racing app startup* — `runAutoBackup` is fire-and-forget; backup specs asserting "backup exists" must poll the FS map (the mock resolves FS writes synchronously), not assume.
- *CSS `@import` warnings* — out of scope (cosmetic, separate fix).

## Success Criteria — "battle-tested" means

1. Every route has at least one passing E2E (breadth gate).
2. Transactions: add/edit/delete for all three kinds proven.
3. Account reconciliation: happy + large-discrepancy warning proven.
4. Budgets: per-month allocation isolation proven.
5. Backup/restore: round-trip + corrupt/mismatch rejection proven through the real IPC boundary (not a logic-only stub).
6. Reload-survival: data persists across `page.reload()` (the local-first promise), proven via `persistDb`.
7. Full suite green on `pnpm test:e2e`; CI-ready (`reuseExistingServer: !CI` already set).

## Out of Scope

- Real Tauri desktop build (`pnpm tauri build`) E2E — out of scope; this suite targets the web/preview build.
- CSS `@import` ordering warnings — cosmetic, separate fix.
- Performance/load testing.
- Visual regression / screenshot diffing.
