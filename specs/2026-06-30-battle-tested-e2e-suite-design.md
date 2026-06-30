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

## Precondition: Fix the `VACUUM INTO ?` production bug FIRST

Before building any mock, the source must be fixed. This is a latent bug, not a mock artifact.

`src/lib/backup/index.ts:18` (`createBackup`) and `src/routes/settings/backup/+page.svelte:23` (`exportSqlite`) both run:

```ts
db.execute('VACUUM INTO ?', [path])
```

SQLite **does not allow bound parameters in `VACUUM` statements** — the filename must be a string literal. This throws `near "?": syntax error` on **every** backend: sql.js, the Tauri rusqlite plugin, better-sqlite3. It has never been caught because `src/tests/unit/backup.test.ts` only covers `exportCsv`, `validateImport`, and `getBackupsToDelete` — it deliberately skips `createBackup`. So `createBackup` and the SQLite export button are both broken in production today.

**Fix:** rewrite both call sites to inline an escaped string literal, e.g. `db.execute(\`VACUUM INTO '\${path.replace(/'/g, "''")}'\`)`. With this fix, the mock passes the statement straight through to sql.js — **no VACUUM override needed at all.** (The earlier "special-case VACUUM INTO via `db.export()`" idea is dropped: it would have masked this bug instead of surfacing it.)

This is the first task in the implementation plan, with its own unit test added to `backup.test.ts` so `createBackup` is never untested again.

## The Tauri-FS Mock (`fixtures/tauri-mock.ts`)

Injected via `page.addInitScript` *before* the app loads, so by the time `getDb()` runs, the seams resolve to the mock. This is what makes backup/restore and reload-survival provable.

### What it fakes

1. **`window.__TAURI_INTERNALS__`** — set to an object exposing `.invoke(cmd, args)`, `.transformCallback`, and `.convertFileSrc`. Presence-only flag gates `getDb()` (`src/lib/db/index.ts:16`) and `runAutoBackup()` (`src/lib/backup/index.ts:30`) onto the Tauri path. `transformCallback`/`convertFileSrc` are stubbed (no-op / identity) because `@tauri-apps/api/core` touches them; `plugin-dialog` handling is scoped out (see below).
2. **`@tauri-apps/plugin-sql`** — intercepted at the **Tauri IPC boundary**. The plugin calls `__TAURI_INTERNALS__.invoke(cmd, args)` (`node_modules/@tauri-apps/api/core.js`). The mock's `invoke` routes SQL commands to a **real sql.js instance** looked up in a `path → sql.js` registry. `notchy.db` is one instance; a backup file is another. The real plugin code runs; only the IPC transport is faked — maximal fidelity.
3. **`@tauri-apps/plugin-fs` + `@tauri-apps/api/path`** — also routed through `invoke` to an in-memory virtual filesystem: `Map<path, Uint8Array>`. `appDataDir()` returns a fixed `/notchy/appdata`.
4. **The persist layer** — a `persistMode` flag set via `persistDb(page)` (separate mechanism, see "Two persistence mechanisms" below).

### IPC command → return-shape contract

The mock's `invoke` must return the exact shape each plugin expects, or it breaks silently. Verified against `node_modules/@tauri-apps/plugin-sql/dist-js/index.js` and the FS/path plugins:

| IPC command | Arg keys | Must return |
|---|---|---|
| `plugin:sql|load` | `{ db }` | **the path string** (plugin stores it as `this.path`, reused by every later call) |
| `plugin:sql|select` | `{ db, query, values }` | array of row objects |
| `plugin:sql|execute` | `{ db, query, values }` | `[rowsAffected, lastInsertId]` tuple |
| `plugin:sql|close` | `{ db }` | void |
| `plugin:fs|copy_file` | `{ fromPath, toPath, options }` | void (copies bytes in the virtual FS) |
| `plugin:fs|mkdir` | `{ path, options }` | void |
| `plugin:fs|read_dir` | `{ path, options }` | array of `{ name, ... }` entries |
| `plugin:fs|remove` | `{ path, options }` | void |
| `plugin:fs|stat` | `{ path, options }` | `{ size, ... }` |
| `plugin:fs|write_text_file` | `{ path, contents, options }` | void (CSV export path) |
| `plugin:path|resolve_directory` / `plugin:path|join` | varies | string |

**Registry key contract:** the mock registers/looks up sql.js instances keyed by the **path string that `plugin:sql|load` returns** (i.e. what becomes `this.path`). All subsequent `execute`/`select`/`close` calls carry that same `db` arg, so the registry key stays consistent. The live DB is keyed by `'sqlite:notchy.db'`; a backup file is keyed by its full path. This must be consistent or `select` calls won't find their instance.

### Two persistence mechanisms (do not conflate)

The spec previously blurred these. They are distinct:

1. **Virtual FS as source of truth (for backup/restore round-trip).** `exportSqlite` does `VACUUM INTO '<path>'`, writing real sqlite bytes into the virtual FS at `path`. `importDatabase` (`src/lib/backup/index.ts:170`) opens the candidate via `createTauriDb('sqlite:<path>?readonly')` (the mock must honor `?readonly` or fall back to the non-readonly open, `backup/index.ts:182-186`), validates it, then `closeDb()` + `copyFile(sourcePath, livePath)`. `closeDb()` nulls the cached `_db` (`db/index.ts:30-35`); the UI then `setTimeout(reload, 800)` (`backup/+page.svelte:65`). On reload, `getDb()` re-runs and `Database.load('sqlite:notchy.db')` must serve the **copied bytes** from the virtual FS. So the restore test asserts against the virtual-FS file contents, not IndexedDB.
2. **IndexedDB persist (for reload-survival only).** `persistDb(page)` flips a flag; the mock flushes the live sql.js bytes to IndexedDB keyed by path on every write, and `plugin:sql|load('sqlite:notchy.db')` checks IndexedDB first. This is a *separate* mechanism from the virtual FS. Only the reload-survival test uses it. (Note: a full JS-context `page.reload()` resets the module-scoped `_db` cache in `db/index.ts:9`, so `getDb()` genuinely re-runs and rehydrates — viable only because the mock's `load` reads IndexedDB.)

### Pre-init seed hook (for the auto-backup test)

`runAutoBackup` is fire-and-forget during `dbStore.init()` (`src/lib/stores/db.svelte.ts`), which runs at app startup — before any test body can touch the page. It also skips if `app_meta.last_backup_at` is <1 hour old (`backup/index.ts:35-41`). To make the auto-backup test deterministic, the mock must accept an **init-time seed**: a spec declares `{ seedMeta: { 'last_backup_at': '<old timestamp>' } }` passed via `addInitScript`, and the mock writes those rows into the live sql.js instance immediately after `plugin:sql|load` creates it (before `runAutoBackup` reads them). Without this hook the auto-backup test is unwritable.

### Scope: `plugin-dialog` is OUT for the button path

The real export/import buttons call `save()` / `open()` from `@tauri-apps/plugin-dialog` (`backup/+page.svelte:4`), which also touch `__TAURI_INTERNALS__`. Rather than stub the OS file picker, the backup/restore **round-trip and validation tests drive the logic directly** — call `createBackup(db, dir)` / `importDatabase(path, 3)` from the test (via `page.evaluate`) against the mock-backed DB and virtual FS. This proves the full SQL+FS chain (write bytes → validate → copy → reopen) through the real plugin SQL/FS code, while skipping the native dialog. A *separate*, lightweight UI smoke test confirms the Export/Import buttons render and are clickable; if a future story needs the literal dialog path, a `plugin:dialog` mock (returning canned paths) is a known follow-up.

### Honest caveat

IPC-boundary interception is the one place the mock re-interprets rather than replays — and even there, the real plugin code runs unchanged; only the `invoke` transport is faked. The `VACUUM INTO` override is gone (replaced by the source fix). The trade-off (vs. a pure logic-level test of `validateImport`/`importDatabase`) is accepted because the goal is to prove the whole SQL+FS chain through the real plugin boundary.

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
- **Backup → restore round-trip** (drives `createBackup`/`importDatabase` directly via `page.evaluate`, not the OS dialog — see scope note): seed data → `createBackup(db, dir)` writes real sqlite bytes to the virtual FS → diverge (add txns) → `importDatabase('<backup-path>', 3)` validates + copies over live DB → reload → original data returns, divergent txns gone.
- **Corrupt import rejected:** mint a non-Notchy/corrupt file in the virtual FS (e.g. a sql.js DB missing `app_meta`) → `importDatabase` returns `{valid:false, error}`, live DB untouched (assert the live DB's data is unchanged).
- **Schema-version mismatch rejected:** mint a valid-shape sql.js DB with `app_meta.schema_version != 3` (current version per `migrations/index.ts`) → rejected, untouched.
- **Auto-backup runs on launch** (uses the pre-init seed hook: `{ seedMeta: { last_backup_at: '<old>' } }`) → assert a `notchy-backup-*.sqlite` file appears in the virtual FS under `/notchy/appdata/backups`; poll the FS map (mock resolves FS writes synchronously), do not assume timing.
- **UI smoke** (lightweight): the Export/Import buttons render and are clickable; does not exercise the OS dialog path.
- **Reload-survival** (calls `persistDb`): add tx → `page.reload()` → tx still present. *The local-first promise.* Uses the IndexedDB-persist mechanism, separate from the virtual-FS round-trip.

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
- *Mock return-shape / command-name traps* — the mock must dispatch on snake_case IPC strings (`plugin:fs|copy_file`, not `copyFile`) and return the exact shape per command (table above). A wrong shape fails silently. Mitigation: assert the mock's debug log in an early sanity test.
- *Registry key drift* — `plugin:sql|load` must return the same path it registers under, or subsequent `select` calls miss their instance. Mitigation: key the registry on the returned path string.
- *`VACUUM INTO` source bug* — fixed in the precondition step (inlined literal), so backup runs real SQL on sql.js with no override. The added `backup.test.ts` unit test guards against regression.
- *Auto-backup racing app startup* — `runAutoBackup` is fire-and-forget during `dbStore.init()` and skips if <1h since `last_backup_at`. Mitigation: the pre-init seed hook sets `last_backup_at` old; specs poll the FS map (mock resolves FS writes synchronously), do not assume timing.
- *`closeDb` + reload ordering on restore* — `importDatabase` nulls the cached `_db` and the UI reloads 800ms later; the mock's `Database.load('sqlite:notchy.db')` must serve the copied bytes. Mitigation: reload-survival and restore tests wait for the app `ready` signal, not a fixed 800ms.
- *CSS `@import` warnings* — out of scope (cosmetic, separate fix).

## Success Criteria — "battle-tested" means

1. Every route has at least one passing E2E (breadth gate).
2. Transactions: add/edit/delete for all three kinds proven.
3. Account reconciliation: happy + large-discrepancy warning proven.
4. Budgets: per-month allocation isolation proven.
5. Backup/restore: round-trip + corrupt/mismatch rejection proven through the real plugin SQL+FS code (OS dialog scoped out).
6. Reload-survival: data persists across `page.reload()` (the local-first promise), proven via `persistDb` (IndexedDB path).
7. The `VACUUM INTO ?` production bug is fixed and covered by a new `createBackup` unit test.
8. Full suite green on `pnpm test:e2e`; CI-ready (`reuseExistingServer: !CI` already set).

## Out of Scope

- Real Tauri desktop build (`pnpm tauri build`) E2E — out of scope; this suite targets the web/preview build.
- CSS `@import` ordering warnings — cosmetic, separate fix.
- Performance/load testing.
- Visual regression / screenshot diffing.
