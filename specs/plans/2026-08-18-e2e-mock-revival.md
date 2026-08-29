# E2E Tauri Mock Revival Implementation Plan
**Serves:** STORY-013

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Revive the dead Tauri IPC mock, make it opt-in, and bring the 14 failing E2E specs green while keeping the 99 passing specs green on the browser fallback.

**Architecture:** Since `ab5a875` (native DB cutover) the mock's init script is a JS template literal whose 104 `\'` escapes are silently mangled by template-literal processing, so the whole injected script is a parse error and every E2E spec silently boots the browser fallback. We (1) fix the escaping and make mock injection opt-in (browser fallback stays the default for UI-flow specs), (2) make the mock's native `database_initialize` faithful (lifecycle field, `LATEST=5` to match the JS registry, canonical live-path keys, verified pre-upgrade backups, auto-backup simulation, `database_restore` handler), (3) give mock specs raw-DB access (`__notchyMock.rawQuery/rawExecute/createBackup`), and (4) fix stale assertions and delete the diagnostic specs.

**Tech Stack:** TypeScript, Vitest, Playwright (1.52.0), Tauri v2 IPC mock (`window.__TAURI_INTERNALS__`), sql.js in-memory, IndexedDB persist.

**Spec:** Behavioral spec is `src/tests/CLAUDE.md` (E2E runs against the web build with a sql.js in-memory fallback behind `isTauri()`). The native boundary being mocked is defined by `ab5a875 feat(db): cut over to native database ownership` and `src/lib/db/native/client.ts` (the `invoke` commands). The recovery journeys under test were specced by `972f492 test(e2e): cover protected startup recovery`.

## Global Constraints

- **TDD discipline (no exceptions):** write the failing test first, watch it fail, implement minimum code, refactor with tests green. All tests pass before committing (`pnpm test` and `pnpm test:e2e`).
- **Plan/spec paths:** plans live in `specs/plans/`, specs in `specs/` (project redirect; `docs/` is a git submodule and invisible to main-repo commits).
- **Checkbox discipline:** when a task's commit lands, flip that task's step checkboxes `- [x]` → `- [x]` in this plan file. Run `pnpm test:roadmap` to refresh `specs/STATUS.md` before relying on it.
- **Schema-version triplication gotcha:** the JS registry (`src/lib/db/migrations/index.ts`) is at `LATEST_SCHEMA_VERSION = 5`; Rust is at 6 (migration 006 operation_receipts). The mock must align to the **JS** value (5) because `restoreCompatibleDatabase` (`src/lib/recovery.ts:25-26`) validates `max: LATEST_SCHEMA_VERSION`. When the JS registry grows migration 006, move the mock's `LATEST`, the `toBe('5')` assertions, and `{schemaVersion: 5}` together.
- **The mock body is a template literal:** any backslash escape the in-page code needs must be written `\\` in the source (a single `\` is silently dropped for unrecognized escapes like `\'`). The syntax guard test (Task 1) exists to catch regressions.
- **Amounts are integers.** No floats.
- **`pnpm test`** = `vitest run` (unit). **`pnpm test:e2e`** = `playwright test` (E2E). OS-level desktop features (tray, shortcuts) are not exercisable from Playwright.

## File Structure

- `src/tests/e2e/fixtures/tauri-mock.ts` — the mock. All of the mock-side work (escaping, opt-in fixture, canonical keys, faithful `database_initialize`, `database_restore`, `__notchyMock` raw access) lives here. One file, one responsibility: simulate the native DB boundary.
- `src/tests/unit/tauri-mock-syntax.test.ts` — **new** guard test that re-resolves the injected template and asserts it parses.
- `src/tests/e2e/mock-boots.spec.ts` — **new** tripwire spec proving the mock injects when requested.
- `src/tests/e2e/backup-restore.spec.ts` — switch `liveQuery`/`createBackup`/`db.execute` off the stale `__notchyTestHooks` facade calls onto the mock's raw access.
- `src/tests/e2e/startup-recovery.spec.ts` — same `liveQuery` switch; two stale assertions (`/schema 7/i`, `toBe('6')`).
- `src/tests/e2e/reload-survival.spec.ts` — unchanged; it is the canary for the canonical live-path key.
- `src/tests/e2e/csv-import.spec.ts` — switch the two count queries from `db.query` to the browser client's `.raw.query`.
- `src/tests/e2e/debug-reload.spec.ts` — **delete** (untracked diagnostic, superseded by `mock-boots.spec` + `reload-survival.spec`).
- `src/tests/e2e/zz-probe.spec.ts` — **delete** (diagnostic probe created during diagnosis).
- `src/lib/stores/db.svelte.ts` — remove the now-unusable `createBackup` hook from `__notchyTestHooks` (2 sites).

---

### Task 1: Revive the dead mock + make injection opt-in

The mock dies in the browser with `PAGEERROR missing ) after argument list`. Cause: the init script is injected as a JS template literal, and template literals drop the backslash on unrecognized escapes — `\'` resolves to `'`. Inside the mock's single-quoted SQL strings (`'...kind=\'income\'...'`) that terminates the string early, and the resulting text fails to parse, so `window.__TAURI_INTERNALS__` and `window.__notchyMock` never exist and every spec boots the browser fallback.

This task also makes injection **opt-in**: only specs that explicitly set `tauriMockOptions` get the mock. The 21 UI-flow specs (accounts, reports, budgets, goals, …) keep the browser fallback, which runs the real repos and is the documented E2E path (`src/tests/CLAUDE.md`). Only the DB-lifecycle specs (backup-restore, startup-recovery, reload-survival, mock-boots) opt in.

**Files:**
- Modify: `src/tests/e2e/fixtures/tauri-mock.ts:93-984` (template), `:1065-1071` (fixture)
- Create: `src/tests/unit/tauri-mock-syntax.test.ts`
- Create: `src/tests/e2e/mock-boots.spec.ts`

**Interfaces:**
- Consumes: none (starts from the current broken state).
- Produces: `tauriMockPage` injects the mock only when `tauriMockOptions` is explicitly set; `window.__notchyMock` and `window.__TAURI_INTERNALS__` exist under injection.

- [x] **Step 1: Write the failing syntax-guard test**

Create `src/tests/unit/tauri-mock-syntax.test.ts`:

```typescript
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The Tauri IPC mock is injected as a JS template literal (injectTauriMock in
 * src/tests/e2e/fixtures/tauri-mock.ts). Template literals silently DROP the
 * backslash on unrecognized escapes: `\'` resolves to `'`, not `\'`. Inside the
 * mock's single-quoted SQL strings that terminates the string early and turns
 * the WHOLE init script into a parse error in the browser — so __TAURI_INTERNALS__
 * is never installed and every E2E spec silently falls back to the browser
 * database. This test re-resolves the template exactly as the module load does
 * and asserts the result parses as valid JavaScript.
 */
describe('tauri-mock init script', () => {
	it('resolved template parses as valid JavaScript', () => {
		const src = readFileSync('src/tests/e2e/fixtures/tauri-mock.ts', 'utf8');
		const open = src.indexOf('await page.addInitScript(`');
		expect(open).toBeGreaterThanOrEqual(0);
		const start = src.indexOf('`', open) + 1;
		const end = src.indexOf('\n\t`);', start);
		expect(end).toBeGreaterThan(start);

		// Neutralize the ${...} interpolations (base64 payloads — contain no escapes).
		let raw = src.slice(start, end).replace(/\$\{[^}]*\}/g, 'X');
		// Resolve the template with Node's own template-literal semantics.
		const resolved = (0, eval)('`' + raw + '`');
		// Playwright evals the resolved text in-page; it must be valid JS.
		expect(() => new Function(resolved)).not.toThrow();
	});
});
```

- [x] **Step 2: Run the guard test and confirm it fails**

Run: `pnpm test src/tests/unit/tauri-mock-syntax.test.ts`
Expected: FAIL — `new Function(resolved)` throws `SyntaxError: missing ) after argument list`.

- [x] **Step 3: Fix the template escaping**

In `src/tests/e2e/fixtures/tauri-mock.ts`, every `\'` inside the `page.addInitScript(\`…\`)` template (lines 93–984, 104 occurrences) must become `\\'` so the resolved text keeps the escaped quote. Verified: there are zero `\'` occurrences outside the template, so a whole-file substitution is safe. Run:

```bash
perl -i -pe "s/\\\\'/\\\\\\\\'/g" src/tests/e2e/fixtures/tauri-mock.ts
```

Then verify no single-backslash-quote remains inside the template:

```bash
grep -c "\\\\'" src/tests/e2e/fixtures/tauri-mock.ts   # expect 0
```

- [x] **Step 4: Run the guard test and confirm it passes**

Run: `pnpm test src/tests/unit/tauri-mock-syntax.test.ts`
Expected: PASS.

- [x] **Step 5: Make mock injection opt-in**

In `src/tests/e2e/fixtures/tauri-mock.ts`, change the fixture so the mock is only injected when a test explicitly sets `tauriMockOptions` (default `undefined` instead of `{}`). Lines 1065-1071:

```typescript
export const test = base.extend<{ tauriMockPage: Page; tauriMockOptions: TauriMockOptions }>({
	// Undefined by default: the mock is only injected when a test explicitly
	// opts in via test.use({ tauriMockOptions }). UI-flow specs run the browser
	// fallback (real repos, documented E2E path); DB-lifecycle specs opt in.
	tauriMockOptions: [undefined, { option: true }],
	tauriMockPage: async ({ page, tauriMockOptions }, use) => {
		if (tauriMockOptions !== undefined) await injectTauriMock(page, tauriMockOptions);
		await use(page);
	},
});
```

- [x] **Step 6: Write the mock-alive tripwire spec**

Create `src/tests/e2e/mock-boots.spec.ts`:

```typescript
import { test, expect } from './fixtures/tauri-mock';

// Opt in explicitly: with no tauriMockOptions the app would boot the browser
// fallback, which proves nothing about the mock.
test.use({ tauriMockOptions: {} });

test('mock injects Tauri internals when requested', async ({ tauriMockPage: page }) => {
	await page.goto('/');
	await expect
		.poll(() => page.evaluate(() => typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__))
		.toBe('object');
	await expect
		.poll(() => page.evaluate(() => typeof (window as unknown as Record<string, unknown>).__notchyMock))
		.toBe('object');
});
```

- [x] **Step 7: Run the tripwire spec**

Run: `npx playwright test src/tests/e2e/mock-boots.spec.ts`
Expected: PASS (the mock now parses and installs). Note the app may sit on the startup-progress screen afterwards — that is fixed by Task 2 adding `lifecycle: 'ready'`; this spec asserts only the injected globals.

- [x] **Step 8: Confirm a browser-fallback spec is unaffected**

Run: `npx playwright test src/tests/e2e/accounts.spec.ts`
Expected: PASS (opt-in means the browser fallback still boots).

- [x] **Step 9: Commit**

```bash
git add src/tests/e2e/fixtures/tauri-mock.ts src/tests/unit/tauri-mock-syntax.test.ts src/tests/e2e/mock-boots.spec.ts
git commit -m "fix(e2e): revive dead Tauri IPC mock, opt-in injection
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 2: Faithful native `database_initialize` + canonical live-path keys

With the mock alive and opt-in, the four DB-lifecycle specs now boot natively and fail for concrete reasons:

- `mapStatus` (`src/lib/stores/db.svelte.ts:129`) requires `status.lifecycle === 'ready'` to reach the app — the mock returns `{ state: 'ready', current: { ready: {} }, recovery: null }` with no `lifecycle`, so the app hangs on the startup-progress screen.
- The mock's `LATEST = 6` diverges from the JS registry's `5`; `restoreCompatibleDatabase` validates `max: 5`, so a schema-6 backup is rejected and the round-trip restore breaks.
- The recovery paths never create the pre-upgrade backup the specs expect (`listVirtualFs('/notchy/appdata/backups/upgrades')`, `backups[0].path`).
- Seeding/flush/copy key on the legacy connection string `sqlite:notchy.db` (`LIVE_PATH`), but native boot loads `/notchy/appdata/notchy.db` (`LIVE_DB_PATH`) — so `initialSchemaVersion`, `seedMeta`, and `flushLiveDb` are inert on the native path.
- `restoreLatestBackup` (native) calls `invoke('database_restore', { summary })` — the mock has no such handler.
- `runAutoBackup` is no longer called in native mode, so the auto-backup spec needs the mock to simulate it.

**Files:**
- Modify: `src/tests/e2e/fixtures/tauri-mock.ts` — hoist `LIVE_DB_PATH`, add `isLivePath`, key fixes at `:195` (flushLiveDb), `:252/:260/:268` (seeding guards), `:408` (copy_file IDB), rewrite the native block `:442-513`, add `database_restore` + `transaction_frequent` handlers
- Modify: `src/tests/e2e/startup-recovery.spec.ts:35` and `:112` (stale assertions)

**Interfaces:**
- Consumes: Task 1's opt-in fixture and revived mock.
- Produces: `database_initialize`/`database_retry`/`database_status` return `DatabaseStatus`-shaped objects (`lifecycle`, `stage`, `recovery`, `backups`); `database_restore({ summary })` replaces the live DB; live-path seeding/flush/persist all key on `LIVE_DB_PATH`.

- [x] **Step 1: Define the faithful contract by fixing the stale assertions**

In `src/tests/e2e/startup-recovery.spec.ts`:

- Line 35, `await expect(page.getByText(/schema 7/i)).toBeVisible();` → the recovery UI renders `m.recovery_unknown()` for the detected schema (statusToRecovery flattens it to null) and the code message `recovery_code_database_schema_newer` = "Your database was created by a newer version of Notchy." Assert the code message instead:

```typescript
await expect(page.getByText(/newer version of Notchy/i)).toBeVisible();
```

- Line 112, `expect(schema[0].value).toBe('6');` → the mock's `LATEST` aligns to the JS registry (5). Change to:

```typescript
expect(schema[0].value).toBe('5');
```

- [x] **Step 2: Run the specs and confirm they fail**

Run: `npx playwright test src/tests/e2e/startup-recovery.spec.ts src/tests/e2e/reload-survival.spec.ts`
Expected: FAIL — startup-recovery times out on "Notchy needs attention" (no `lifecycle` → app never reaches a stage), reload-survival times out on Dashboard after reload.

- [x] **Step 3: Hoist the live-path constants and add the canonical key helper**

At the top of the injected template (near line 95-96, where `LIVE_PATH` is defined):

```javascript
const LIVE_PATH = 'sqlite:notchy.db';
const LIVE_DB_PATH = '/notchy/appdata/notchy.db';
// Native boot loads LIVE_DB_PATH; the legacy plugin:sql connection string
// resolves to the same file via fsKeyFor. "Live" means either key.
function isLivePath(p) {
	return p === LIVE_PATH || p === LIVE_DB_PATH;
}
```

Then remove the local `const LIVE_DB_PATH = APP_DATA_DIR + '/notchy.db';` currently at line 441 (it shadows the hoisted constant).

- [x] **Step 4: Re-key flush, seeding, and copy_file to the native live path**

In the same file:

- `flushLiveDb()` (line 195): `const db = dbs.get(LIVE_PATH);` → `const db = dbs.get(LIVE_DB_PATH) || dbs.get(LIVE_PATH);`
- Seeding guards (lines 252, 260, 268): `if (path === LIVE_PATH && …)` → `if (isLivePath(path) && …)` in all three.
- `plugin:fs|copy_file` (line 408): `if (data && args.toPath === APP_DATA_DIR + '/notchy.db')` stays, but the IDB mirror must write under the native key so the reload rehydrates it:

```javascript
if (data && args.toPath === LIVE_DB_PATH) {
	await idbSet(idbKey(LIVE_DB_PATH), data);
}
```

- [x] **Step 5: Rewrite the native `database_initialize` block**

Replace lines 442-513 (the `database_initialize`/`database_retry`/`database_status` block) with:

```javascript
		if (cmd === 'database_initialize' || cmd === 'database_retry' || cmd === 'database_status') {
			// LATEST aligns to the JS registry (LATEST_SCHEMA_VERSION = 5 in
			// src/lib/db/migrations/index.ts): restoreCompatibleDatabase validates
			// max 5, and the E2E fixtures/assertions are schema-5-based. Rust runs
			// its own migration 006; the mock simulates the JS-visible contract.
			const LATEST = 5;
			const UPGRADE_DIR = APP_DATA_DIR + '/backups/upgrades';
			const BACKUP_DIR = APP_DATA_DIR + '/backups';
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const schemaRow = select(db, "SELECT value FROM app_meta WHERE key = 'schema_version'", []);
			const currentVersion = schemaRow.length > 0 ? parseInt(schemaRow[0].value) : 0;
			const stamp = new Date().toISOString().replace(/[:.]/g, '-');
			const upgradePath =
				UPGRADE_DIR +
				'/notchy-pre-upgrade-v' + currentVersion + '-to-v' + LATEST + '-0.2.0-' + stamp + '.sqlite';
			const toSummary = (p) => ({
				id: p,
				path: p,
				schema_version: currentVersion,
				source_app_version: '0.2.0',
				created_at: new Date().toISOString(),
				verified: true
			});
			// Verified backups available for restore, newest first.
			const upgrades = [...fs.keys()].filter((p) => p.startsWith(UPGRADE_DIR)).reverse().map(toSummary);

			if (currentVersion > LATEST) {
				return {
					lifecycle: 'recovery_required',
					stage: null,
					recovery: { code: 'database_schema_newer', retryable: false },
					backups: upgrades
				};
			}

			if (currentVersion < 5) {
				// Mirrors Rust: a verified pre-upgrade backup is written BEFORE any
				// migration, so a failed migration still leaves a restorable snapshot.
				if (!faults.failUpgradeBackup) {
					fs.set(upgradePath, db.export());
				}
				if (faults.failUpgradeBackup) {
					return {
						lifecycle: 'recovery_required',
						stage: null,
						recovery: { code: 'upgrade_backup_failed', retryable: false },
						backups: []
					};
				}
				if (faults.failMigrationVersion === 5) {
					return {
						lifecycle: 'recovery_required',
						stage: null,
						recovery: { code: 'migration_failed', retryable: true },
						backups: [toSummary(upgradePath)]
					};
				}
				// Migration 005 (mirrors src/lib/db/migrations/005-*.ts: goals table).
				db.run('CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, name TEXT NOT NULL, goal_type TEXT NOT NULL, target_amount INTEGER NOT NULL, target_date TEXT NOT NULL, linked_account_id TEXT, starting_amount INTEGER DEFAULT 0, current_amount INTEGER DEFAULT 0, show_on_dashboard INTEGER DEFAULT 1, status TEXT DEFAULT active, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)');
				db.run("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '5')");
			}

			// Auto-backup simulation. runAutoBackup (src/lib/backup/index.ts) is no
			// longer called from dbStore.init() in native mode — Rust owns backups.
			// Mirror its contract: if last_backup_at is older than 1 hour, write a
			// notchy-backup-*.sqlite snapshot and refresh the marker.
			const lastBak = select(db, "SELECT value FROM app_meta WHERE key = 'last_backup_at'", []);
			if (lastBak.length > 0 && Date.now() - new Date(lastBak[0].value).getTime() > 3600_000) {
				fs.set(BACKUP_DIR + '/notchy-backup-' + stamp + '.sqlite', db.export());
				db.run("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_backup_at', ?)", [new Date().toISOString()]);
			}

			return { lifecycle: 'ready', stage: null, recovery: null, backups: upgrades };
		}
```

- [x] **Step 6: Add the `database_restore` handler**

Immediately after the block above (before the `throw new Error('tauri-mock: unhandled invoke ' + cmd);` at the end of the invoke handler):

```javascript
		if (cmd === 'database_restore') {
			const src = args.summary && args.summary.path;
			const bytes = src && fs.get(src);
			if (!bytes) throw new Error('tauri-mock: database_restore source missing: ' + src);
			// Replace the live file bytes and persist to IndexedDB so the
			// post-restore reload rehydrates the restored database (mirrors a real
			// disk write that survives process restart).
			fs.set(LIVE_DB_PATH, bytes);
			await idbSet(idbKey(LIVE_DB_PATH), bytes);
			return {};
		}
```

- [x] **Step 7: Add the `transaction_frequent` handler**

It is the only native command missing from the mock. Mirror `BrowserTransactionOps.getFrequent` (`src/lib/db/browser/client.ts:117-127`):

```javascript
		if (cmd === 'transaction_frequent') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			return select(db, "SELECT payee, tag_id, account_id, amount, kind, COUNT(*) as count FROM transactions WHERE deleted_at IS NULL AND date >= ? AND payee IS NOT NULL AND kind IN ('expense', 'income') GROUP BY payee, tag_id, account_id ORDER BY count DESC, date DESC LIMIT 5", [args.sinceDate]);
		}
```

- [x] **Step 8: Run the specs**

Run: `npx playwright test src/tests/e2e/startup-recovery.spec.ts src/tests/e2e/reload-survival.spec.ts`
Expected: reload-survival PASSES; the 5 non-restore startup-recovery tests (schema newer, migration failure ×3, upgrade-backup failure) PASS; the restore journey (`restore clears the injected fault…`) still FAILS on `liveQuery` with `db.query is not a function` — that is fixed by Task 3.

- [x] **Step 9: Run the auto-backup spec**

Run: `npx playwright test src/tests/e2e/backup-restore.spec.ts -g "auto-backup"`
Expected: PASS (seedMeta seeds `last_backup_at` via the now-correct `isLivePath` guard; `database_initialize` simulates the stale-backup snapshot).

- [x] **Step 10: Commit**

```bash
git add src/tests/e2e/fixtures/tauri-mock.ts src/tests/e2e/startup-recovery.spec.ts
git commit -m "fix(e2e): faithful native database_initialize + canonical live-path keys
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 3: Raw DB access for specs

The four mock specs run `liveQuery`/`db.execute`/`createBackup` against `__notchyTestHooks.getDb()`, which now returns the `AppDatabase` domain facade — it has no `.query`/`.execute`, and `createBackup` needs a `DatabaseService`. Give the mock its own raw access so specs can run assertions and set up divergence against the live sql.js connection.

**Files:**
- Modify: `src/tests/e2e/fixtures/tauri-mock.ts` — `window.__notchyMock` (lines 966-983) gains `rawQuery`/`rawExecute`/`createBackup`; export Node-side helpers near `flushDb` (line 1037)
- Modify: `src/tests/e2e/backup-restore.spec.ts`
- Modify: `src/tests/e2e/startup-recovery.spec.ts` (`liveQuery` helper)
- Modify: `src/tests/e2e/csv-import.spec.ts` (browser-fallback `.raw.query`)

**Interfaces:**
- Consumes: Task 2's canonical `LIVE_DB_PATH` and revived `__notchyMock`.
- Produces: `rawQuery(page, sql, values?)`, `rawExecute(page, sql, values?)`, `createMockBackup(page, dir)` exported helpers; `__notchyMock.rawQuery/rawExecute/createBackup`.

- [x] **Step 1: Confirm the failure mode**

Run: `npx playwright test src/tests/e2e/backup-restore.spec.ts`
Expected: FAIL — `(intermediate value).query is not a function` (facade has no `.query`) and `createBackup` throwing (facade is not a `DatabaseService`).

- [x] **Step 2: Add raw access to `window.__notchyMock`**

In `src/tests/e2e/fixtures/tauri-mock.ts`, inside the `window.__notchyMock = { … }` object (lines 966-983), add:

```javascript
	rawQuery: (query, values) => {
		const db = dbs.get(LIVE_DB_PATH);
		if (!db) throw new Error('tauri-mock: live DB not open');
		return select(db, query, values || []);
	},
	rawExecute: (query, values) => {
		const db = dbs.get(LIVE_DB_PATH);
		if (!db) throw new Error('tauri-mock: live DB not open');
		db.run(query, values || []);
		return db.getRowsModified();
	},
	createBackup: (backupDir) => {
		const db = dbs.get(LIVE_DB_PATH);
		if (!db) throw new Error('tauri-mock: live DB not open');
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const path = backupDir + '/notchy-backup-' + stamp + '.sqlite';
		fs.set(path, db.export());
		return path;
	},
```

(`dbs.get(LIVE_DB_PATH)` is the live connection `database_initialize` opened; it exists whenever the app has booted.)

- [x] **Step 3: Export Node-side page helpers**

In the fixture module, next to `flushDb` (around line 1037):

```typescript
export async function rawQuery<T>(page: Page, sql: string, values?: unknown[]): Promise<T[]> {
	return page.evaluate(
		({ sql, values }) =>
			(window as unknown as { __notchyMock?: { rawQuery: (q: string, v: unknown[]) => unknown[] } }).__notchyMock?.rawQuery(sql, values ?? []),
		{ sql, values }
	) as Promise<T[]>;
}

export async function rawExecute(page: Page, sql: string, values?: unknown[]): Promise<number> {
	return page.evaluate(
		({ sql, values }) =>
			(window as unknown as { __notchyMock?: { rawExecute: (q: string, v: unknown[]) => number } }).__notchyMock?.rawExecute(sql, values ?? []),
		{ sql, values }
	) as Promise<number>;
}

export async function createMockBackup(page: Page, dir: string): Promise<string> {
	return page.evaluate(
		(dir) => (window as unknown as { __notchyMock?: { createBackup: (d: string) => string } }).__notchyMock?.createBackup(dir),
		dir
	) as Promise<string>;
}
```

- [x] **Step 4: Update `backup-restore.spec.ts`**

- `liveQuery` (lines 25-27): replace the body with a call to the new helper:

```typescript
async function liveQuery<T>(page: Page, sql: string): Promise<T[]> {
	return rawQuery<T>(page, sql);
}
```

- Backup creation (lines 65-67 and 124-126): replace `h.createBackup(db, BACKUP_DIR)` with:

```typescript
const backupPath = await createMockBackup(page, BACKUP_DIR);
```

- Divergence inserts (lines 71-73 and 121-123): replace the `db.execute(...)` hook calls with:

```typescript
await rawExecute(page, DIVERGE_INSERT);
```

and

```typescript
await rawExecute(page, "UPDATE app_meta SET value='4' WHERE key='schema_version'");
```

- Update the imports (line 3) to include `rawQuery, rawExecute, createMockBackup` from the fixture. Keep `hookExpr` and `h.restoreCompatibleDatabase` for the restore/rejection calls (that is the real JS validation path).

- [x] **Step 5: Update `startup-recovery.spec.ts` `liveQuery`**

Replace lines 18-26 with:

```typescript
async function liveQuery<T>(page: Page, sql: string): Promise<T[]> {
	return rawQuery<T>(page, sql);
}
```

and add `rawQuery` to the fixture import on line 1.

- [x] **Step 6: Update `csv-import.spec.ts` count queries**

`csv-import` runs on the browser fallback (no `tauriMockOptions`), so `getDb()` returns the `BrowserDatabaseClient`, which exposes the raw `DatabaseService` via its `.raw` getter. Replace both `db.query(...)` blocks (lines 72-78 and 95-101):

```typescript
const countBefore = await page.evaluate(async () => {
	const hooks = (window as any).__notchyTestHooks;
	if (!hooks) throw new Error('Test hooks not available');
	const db = (await hooks.getDb()) as { raw: { query: (q: string) => Promise<{ cnt: number }[]> } };
	const result = await db.raw.query('SELECT COUNT(*) as cnt FROM transactions');
	return result[0].cnt;
});
```

(same replacement for `countAfter`).

- [x] **Step 7: Run the specs**

Run: `npx playwright test src/tests/e2e/backup-restore.spec.ts src/tests/e2e/startup-recovery.spec.ts src/tests/e2e/csv-import.spec.ts src/tests/e2e/reload-survival.spec.ts`
Expected: all PASS (5 + 6 + 1 + 1).

- [x] **Step 8: Commit**

```bash
git add src/tests/e2e/fixtures/tauri-mock.ts src/tests/e2e/backup-restore.spec.ts src/tests/e2e/startup-recovery.spec.ts src/tests/e2e/csv-import.spec.ts
git commit -m "fix(e2e): raw DB access for mock specs; csv-import via .raw
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 4: Cleanup — diagnostic specs and stale hook

`debug-reload.spec.ts` is an untracked diagnostic with no assertions, superseded by `mock-boots.spec.ts` + `reload-survival.spec.ts`. `zz-probe.spec.ts` is the throwaway probe from diagnosis. The `createBackup` test hook is unusable in native mode (it needs a `DatabaseService`, but native `getDb()` returns the facade).

**Files:**
- Delete: `src/tests/e2e/debug-reload.spec.ts`
- Delete: `src/tests/e2e/zz-probe.spec.ts`
- Modify: `src/lib/stores/db.svelte.ts` (2 hook sites: lines 103-107 and 164-168)

**Interfaces:**
- Consumes: Task 3's hook usage is gone from specs.
- Produces: `__notchyTestHooks = { getDb, restoreCompatibleDatabase }` (no `createBackup`).

- [x] **Step 1: Delete the diagnostic specs**

```bash
git rm src/tests/e2e/debug-reload.spec.ts
rm src/tests/e2e/zz-probe.spec.ts
```

(`debug-reload.spec.ts` was never committed, so `git rm` fails if the file isn't tracked — use `rm` and skip the `git rm` in that case.)

- [x] **Step 2: Remove the unusable `createBackup` hook**

In `src/lib/stores/db.svelte.ts`, in both `init()` (lines 100-108) and `onReady()` (lines 160-168), drop `createBackup: backup.createBackup` from the hooks object and drop the now-unused `const backup = await import('$lib/backup');`. The two sites become:

```typescript
if (hasMockMarker || !hasTauri) {
	const { restoreCompatibleDatabase } = await import('$lib/recovery');
	const { getDb: getDbFn } = await import('$lib/db');
	(window as unknown as { __notchyTestHooks?: Record<string, unknown> }).__notchyTestHooks = {
		getDb: getDbFn,
		restoreCompatibleDatabase
	};
}
```

- [x] **Step 3: Sweep for stale references**

```bash
grep -rn "createBackup" src/tests/e2e/*.spec.ts src/lib/stores/db.svelte.ts
grep -rn "db.query\|\.execute(" src/tests/e2e/*.spec.ts
grep -rn "schema 7\|toBe('6')" src/tests/e2e
```

Expected: only the mock's own `createBackup` (in `window.__notchyMock`), the fixture's `createMockBackup`, and `src/lib/backup/index.ts` remain. No `db.query`/`db.execute` on the facade, no `/schema 7/`, no `toBe('6')`.

- [x] **Step 4: Run the full E2E suite**

Run: `pnpm test:e2e`
Expected: all specs pass except any reconciliation gaps found in Task 5.

- [x] **Step 5: Commit**

```bash
git add src/lib/stores/db.svelte.ts
git rm src/tests/e2e/debug-reload.spec.ts 2>/dev/null || true
git commit -m "chore(e2e): delete diagnostic specs, drop unusable createBackup hook
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

### Task 5: Full-suite reconciliation

Now that the mock is alive and opt-in, the full E2E suite runs two paths: 21 specs on the browser fallback (unchanged, previously green) and 4 mock specs on the revived native mock (Tasks 2-3). The mock's native handlers — written during the cutover — are exercised for the first time. Any divergence between a handler and the browser repo that implements the same operation surfaces here.

**Files:**
- Modify: `src/tests/e2e/fixtures/tauri-mock.ts` (any handler that diverges)

**Interfaces:**
- Consumes: Tasks 1-4.
- Produces: `pnpm test:e2e` and `pnpm test` fully green.

- [x] **Step 1: Run the full suite and catalog failures**

Run: `pnpm test:e2e`
Expected: `n` failures where `n` is small (the 4 mock specs were green in Task 3; the 21 browser specs were green throughout). Record each failure with its spec + assertion.

- [x] **Step 2: Fix each divergence against the browser repos as source of truth**

For every failing mock-native spec, compare the mock handler's SQL/return shape with the equivalent browser repo in `src/lib/db/browser/repos/` (accounts → `accounts.ts`, transactions → `transactions.ts`, meta → `meta.ts`, …). Align the handler to the repo. The likely candidates are the balance/SUM logic in `account_list`/`account_get`/`account_get_balance` (lines 517-527) and any row-shape field the UI asserts. Run the failing spec after each fix.

- [x] **Step 3: Run the full suite until green**

Run: `pnpm test:e2e`
Expected: PASS (0 failures).

- [x] **Step 4: Run the unit suite**

Run: `pnpm test`
Expected: PASS — including the new `tauri-mock-syntax.test.ts` guard and no regressions from the `db.svelte.ts` hook change.

- [x] **Step 5: Update this plan's checkboxes and refresh the roadmap**

Flip every completed `- [x]` in this file to `- [x]`, then run `pnpm test:roadmap` and commit:

```bash
git add specs/plans/2026-08-18-e2e-mock-revival.md src/tests/e2e/fixtures/tauri-mock.ts
git commit -m "fix(e2e): reconcile native mock handlers to browser repos
Co-Authored-By: Claude <noreply@anthropic.com>"
```

---

## Self-Review

**1. Spec coverage.** The behavioral spec is `src/tests/CLAUDE.md` plus the native boundary in `src/lib/db/native/client.ts`. Coverage: every native command is now handled by the mock (`transaction_frequent` added in Task 2 Step 7); the recovery journeys specced by `972f492` (schema-newer, migration-failure, upgrade-backup-failure, restore-forward) are driven by the faithful `database_initialize`; backup/restore round trips use the JS validation path against mock FS + IDB; persistence across reload is re-keyed to the native path. The one deliberate scope cut: the 21 UI-flow specs stay on the browser fallback rather than exercising mock native handlers, so reports/budgets/goals handlers may drift — documented, and a known follow-up if full native-fidelity E2E is ever wanted.

**2. Placeholder scan.** Every step carries concrete code or a concrete command. The only open-ended step is Task 5 Step 2 (reconciliation), which is inherently exploratory but bounded to the 4 mock specs and points at the repos as the source of truth.

**3. Type consistency.** `BackupSummary` fields match `src/lib/db/native/client.ts` (`id, path, schema_version, source_app_version, created_at, verified`). `DatabaseStatus` returns carry `lifecycle/stage/recovery/backups`. The mock `LATEST = 5` matches the `toBe('5')`/`{schemaVersion: 5}` assertions in both specs and `restoreCompatibleDatabase`'s `max: 5`. `rawQuery`/`rawExecute`/`createMockBackup` names are used identically in the fixture exports, `__notchyMock`, and both specs.

---

## Execution Handoff

Plan complete and saved to `specs/plans/2026-08-18-e2e-mock-revival.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

**Which approach?**
