# Battle-Tested E2E Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the single onboarding E2E spec with a comprehensive, isolated Playwright suite — breadth across every route, depth on transactions/accounts/budgets, and full-IPC-mock depth on backup/restore plus a reload-survival guarantee.

**Architecture:** Three layers — Playwright `test.extend` fixtures (own the environment), pure UI helper functions (actions, no assertions), and focused per-route spec files. A scoped `__TAURI_INTERNALS__` IPC mock (backed by real sql.js + a virtual filesystem) is opt-in for backup/restore. A precondition task fixes a latent `VACUUM INTO ?` production bug first.

**Tech Stack:** Playwright 1.52 (chromium), sql.js (in-memory SQLite WASM, already a dependency), SvelteKit 5 static build (`pnpm build && pnpm preview` on port 4173). No new dependencies.

**Spec:** `specs/2026-06-30-battle-tested-e2e-suite-design.md`

## Global Constraints

- Amounts are integers (smallest currency unit). Never floats. — CLAUDE.md
- Run gates before claiming done: `pnpm test`, `pnpm check`, `pnpm test:e2e`. — CLAUDE.md
- Commit prefix: `feat:`, `fix:`, `refactor:`, `test:`. — CLAUDE.md
- No fixed waits in Playwright specs. Use `expect().toBeVisible()` (10s timeout already set in `playwright.config.ts`).
- Scope modal interactions to `page.getByRole('dialog')`; scope list assertions to `page.getByRole('main')` (dashboard has an inline quick form that collides; toasts collide with list rows).
- Each `test()` is independent — own onboarded state, own DB.
- Current schema version is **3** (`src/lib/db/migrations/index.ts`: migrations 001/002/003; `importDatabase(path, 3)` in `src/routes/settings/backup/+page.svelte:57`).
- The DB type contract (`src/lib/db/service.ts`): `DatabaseService.execute(sql, params?) → Promise<{rowsAffected, lastInsertId?}>`; `query<T>(sql, params?) → Promise<T[]>`; `close() → Promise<void>`.

---

## File Structure

**Created:**
- `src/tests/e2e/helpers/ui.ts` — pure UI actions (`onboard`, `addTransaction`), no assertions.
- `src/tests/e2e/fixtures/onboarded.ts` — `onboardedPage` fixture (runs the 3-step setup).
- `src/tests/e2e/fixtures/tauri-mock.ts` — scoped `__TAURI_INTERNALS__` IPC mock (sql.js + virtual FS + IndexedDB persist).
- `src/tests/e2e/fixtures/persist.ts` — `persistDb(page)` toggle.
- `src/tests/e2e/transactions.spec.ts`
- `src/tests/e2e/accounts.spec.ts`
- `src/tests/e2e/budgets.spec.ts`
- `src/tests/e2e/debts.spec.ts`
- `src/tests/e2e/goals.spec.ts`
- `src/tests/e2e/reports.spec.ts`
- `src/tests/e2e/categories.spec.ts`
- `src/tests/e2e/backup-restore.spec.ts`

**Modified:**
- `src/lib/backup/index.ts:18` — fix `VACUUM INTO ?` → inlined escaped literal.
- `src/routes/settings/backup/+page.svelte:23` — same fix for `exportSqlite`.
- `src/tests/unit/backup.test.ts` — add a `createBackup` test (currently skipped/uncovered).
- `src/tests/e2e/onboarding.spec.ts` — refactor to use the `ui.ts` helper + `onboardedPage`.

---

## Task 1: Fix the `VACUUM INTO ?` production bug (precondition)

This is a latent bug that would break both real backups and the mock. Fix the source first so the mock needs no override.

**Files:**
- Modify: `src/lib/backup/index.ts:13-20` (`createBackup`)
- Modify: `src/routes/settings/backup/+page.svelte:14-30` (`exportSqlite`)
- Test: `src/tests/unit/backup.test.ts`

**Interfaces:**
- Produces: `createBackup(db, backupDir)` unchanged signature — still returns the backup path string. Behavior now works on real SQLite.

- [ ] **Step 1: Write the failing test**

Add to `src/tests/unit/backup.test.ts` (append after the existing `describe('getBackupsToDelete', …)` block). The test DB is better-sqlite3, which rejects the bound param the same way rusqlite/sql.js do.

```typescript
describe('createBackup', () => {
	it('writes a valid backup file via VACUUM INTO', async () => {
		const db = createTestDb();
		await runMigrations(db, migrations);
		// Seed a row so the backup isn't empty.
		await db.execute(
			`INSERT INTO accounts (id, name, type, currency, created_at, updated_at)
			 VALUES ('01TEST', 'Checking', 'checking', 'VND', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
		);

		const tmpDir = mkdtempSync(join(tmpdir(), 'notchy-backup-'));
		try {
			const path = await createBackup(db, tmpDir);
			// Path is the full file under backupDir.
			expect(path.startsWith(tmpDir)).toBe(true);
			expect(path.endsWith('.sqlite')).toBe(true);
			expect(existsSync(path)).toBe(true);
			// The backup is a real SQLite file — reopen it and confirm the row survived.
			const backup = new BetterSqlite3(path, { readonly: true });
			const rows = backup.prepare('SELECT name FROM accounts').all();
			expect(rows.length).toBe(1);
			backup.close();
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
```

Add the imports at the top of `backup.test.ts` (after the existing imports):

```typescript
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import BetterSqlite3 from 'better-sqlite3';
import { createBackup } from '$lib/backup';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test src/tests/unit/backup.test.ts -t "writes a valid backup file"`
Expected: FAIL — `near "?": syntax error` thrown by `createBackup`'s `VACUUM INTO ?`.

- [ ] **Step 3: Fix `createBackup` in `src/lib/backup/index.ts`**

Replace the body of `createBackup` (lines 13-20). SQLite requires the `VACUUM INTO` target as a string literal, not a bound parameter. Inline an escaped literal (double single-quotes is the SQL string escape).

```typescript
export async function createBackup(db: DatabaseService, backupDir: string): Promise<string> {
	const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
	const filename = `notchy-backup-${timestamp}.sqlite`;
	const path = `${backupDir}/${filename}`;
	// VACUUM INTO does not accept a bound parameter for the filename — it must be
	// a string literal. Inline an escaped literal (SQL doubles single-quotes).
	await db.execute(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
	return path;
}
```

- [ ] **Step 4: Fix `exportSqlite` in `src/routes/settings/backup/+page.svelte`**

In the `exportSqlite` function, replace line 23:

```typescript
			await db.execute(`VACUUM INTO ?`, [path]);
```

with:

```typescript
			await db.execute(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
```

(Keep the surrounding try/catch and toast handling unchanged.)

- [ ] **Step 5: Run test to verify it passes**

Run: `pnpm test src/tests/unit/backup.test.ts`
Expected: PASS — all backup tests including the new `createBackup` test.

- [ ] **Step 6: Commit**

```bash
git add src/lib/backup/index.ts src/routes/settings/backup/+page.svelte src/tests/unit/backup.test.ts
git commit -m "fix(backup): inline VACUUM INTO literal (bound param is invalid SQL)

VACUUM statements don't accept bound parameters — the filename must be a
string literal. createBackup and exportSqlite both threw near '?': syntax
error on every backend. Inline an escaped literal. Add a createBackup unit
test (previously uncovered).
"
```

---

## Task 2: UI helpers (`helpers/ui.ts`)

Pure UI actions, no assertions. Centralize selectors + the `50k` shortcut knowledge so every spec reuses them and a rename is one-file edit.

**Files:**
- Create: `src/tests/e2e/helpers/ui.ts`

**Interfaces:**
- Produces:
  - `onboard(page, opts: { lang?: RegExp; currency?: RegExp; accountName?: string }): Promise<void>` — runs the 3-step setup. Defaults match the existing onboarding spec: lang `/^English/`, currency `/VND — Vietnamese đồng/`, account `'Test Checking'`.
  - `addTransaction(page, opts: { kind: 'expense'|'income'|'transfer'; amount: string; }): Promise<void>` — opens the dashboard FAB, scopes to the modal, clicks the kind button, fills amount, saves. For `transfer`, the second account Select is left at its default (auto-selects the only other account when present; for a single-account onboarded state the test creates a second account first — see Task 4).
  - `expectOnDashboard(page): Promise<void>` — waits for the Dashboard heading.

- [ ] **Step 1: Write the helper file**

Create `src/tests/e2e/helpers/ui.ts`:

```typescript
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Run the 3-step onboarding flow. Defaults match the original onboarding spec.
 * Leaves the app on the Dashboard. Called by the onboardedPage fixture AND by
 * the onboarding.spec.ts happy path so the setup itself stays under test.
 */
export async function onboard(
	page: Page,
	opts: { lang?: RegExp; currency?: RegExp; accountName?: string } = {}
): Promise<void> {
	const lang = opts.lang ?? /^English/;
	const currency = opts.currency ?? /VND — Vietnamese đồng/;
	const accountName = opts.accountName ?? 'Test Checking';

	await page.goto('/');

	// Step 1: language
	await page.getByRole('button', { name: lang }).click();
	await page.getByRole('button', { name: 'Continue →' }).click();

	// Step 2: currency
	await page.getByRole('button', { name: currency }).click();
	await page.getByRole('button', { name: 'Continue →' }).click();

	// Step 3: first account (Finish disabled until a name is entered)
	await page.getByLabel('Name').fill(accountName);
	await page.getByRole('button', { name: 'Finish setup' }).click();

	await expectOnDashboard(page);
}

export async function expectOnDashboard(page: Page): Promise<void> {
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

/**
 * Add a transaction via the dashboard FAB + modal. `amount` is the raw string
 * typed into the Amount field — pass '50k' to exercise parseAmount's shortcut.
 * The modal is scoped via getByRole('dialog') because the dashboard also has an
 * inline quick form with its own Amount/Save controls.
 */
export async function addTransaction(
	page: Page,
	opts: { kind: 'expense' | 'income' | 'transfer'; amount: string }
): Promise<void> {
	await page.getByRole('button', { name: 'Add transaction' }).click();
	const modal = page.getByRole('dialog');
	await expect(modal.getByRole('heading', { name: 'Add transaction' })).toBeVisible();
	await modal.getByRole('button', { name: opts.kind === 'transfer' ? 'Transfer' : capitalize(opts.kind), exact: true }).click();
	await modal.getByLabel('Amount').fill(opts.amount);
	await modal.getByRole('button', { name: 'Save' }).click();
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
```

- [ ] **Step 2: Verify it type-checks**

Run: `pnpm check`
Expected: 0 errors (the file is new; if `exact: true` name matching fails typecheck, adjust — the kind buttons use `{exact:true}` per the existing spec pattern).

- [ ] **Step 3: Commit**

```bash
git add src/tests/e2e/helpers/ui.ts
git commit -m "test(e2e): add UI helpers (onboard, addTransaction)"
```

---

## Task 3: `onboardedPage` fixture + refactor onboarding spec

**Files:**
- Create: `src/tests/e2e/fixtures/onboarded.ts`
- Modify: `src/tests/e2e/onboarding.spec.ts`

**Interfaces:**
- Produces: `onboardedPage` — a `test.extend({ page })` that, before each test, calls `onboard(page)` so the app is on the Dashboard. Specs use it as `import { test, expect } from './fixtures/onboarded'`.

- [ ] **Step 1: Write the fixture**

Create `src/tests/e2e/fixtures/onboarded.ts`:

```typescript
import { test as base, expect } from '@playwright/test';
import { onboard } from '../helpers/ui';

/**
 * Every non-onboarding spec starts from an onboarded app on the Dashboard.
 * Re-runs the real onboarding (not a SQL seed) each test, so the setup path
 * stays under test and can't drift from what real onboarding produces.
 */
export const test = base.extend<{ onboardedPage: Page }>({
	// eslint-disable-next-line no-empty-pattern
	onboardedPage: async ({ page }, use) => {
		await onboard(page);
		await use(page);
	}
});

export { expect };
```

Add the `Page` import at the top:

```typescript
import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { onboard } from '../helpers/ui';
```

- [ ] **Step 2: Refactor `onboarding.spec.ts` to use the helper**

Rewrite `src/tests/e2e/onboarding.spec.ts` to use `onboard` and add the disabled-button + invalid-amount depth tests:

```typescript
import { test, expect } from '@playwright/test';
import { onboard, expectOnDashboard, addTransaction } from './helpers/ui';

test('onboarding → dashboard → add transaction', async ({ page }) => {
	await onboard(page);
	await addTransaction(page, { kind: 'expense', amount: '50k' });
	await expect(page.getByText(/Saved · expense ·/)).toBeVisible();
	await page.getByRole('link', { name: 'Transactions' }).click();
	await expect(page.getByRole('main').getByText('-₫50,000')).toBeVisible();
});

test('Finish setup is disabled until an account name is entered', async ({ page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: /^English/ }).click();
	await page.getByRole('button', { name: 'Continue →' }).click();
	await page.getByRole('button', { name: /VND — Vietnamese đồng/ }).click();
	await page.getByRole('button', { name: 'Continue →' }).click();
	const finish = page.getByRole('button', { name: 'Finish setup' });
	await expect(finish).toBeDisabled();
	await page.getByLabel('Name').fill('X');
	await expect(finish).toBeEnabled();
});
```

- [ ] **Step 3: Run the E2E suite**

Run: `pnpm test:e2e`
Expected: PASS — both onboarding tests green.

- [ ] **Step 4: Commit**

```bash
git add src/tests/e2e/fixtures/onboarded.ts src/tests/e2e/onboarding.spec.ts
git commit -m "refactor(e2e): onboardedPage fixture, onboarding spec uses helpers"
```

---

## Task 4: `transactions.spec.ts` (depth)

**Files:**
- Create: `src/tests/e2e/transactions.spec.ts`

**Interfaces:**
- Consumes: `test, expect` from `./fixtures/onboarded`; `addTransaction` from `./helpers/ui`.
- Produces: nothing (leaf spec).

- [ ] **Step 1: Write the spec**

Create `src/tests/e2e/transactions.spec.ts`:

```typescript
import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';

test.describe('transactions', () => {
	test('add expense, income, transfer', async ({ onboardedPage: page }) => {
		// Transfer needs a second account. Create one via the Accounts page.
		await page.getByRole('link', { name: 'Accounts' }).click();
		await page.getByRole('button', { name: /Add account|New account|Create account/ }).click();
		const acctModal = page.getByRole('dialog');
		await acctModal.getByLabel('Name').fill('Savings');
		await acctModal.getByRole('button', { name: 'Save' }).click();
		await page.getByRole('link', { name: 'Dashboard' }).click();

		await addTransaction(page, { kind: 'expense', amount: '50k' });
		await addTransaction(page, { kind: 'income', amount: '1.2k' });
		await addTransaction(page, { kind: 'transfer', amount: '20k' });

		await page.getByRole('link', { name: 'Transactions' }).click();
		const main = page.getByRole('main');
		await expect(main.getByText('-₫50,000')).toBeVisible();
		await expect(main.getByText('₫1,200')).toBeVisible();
	});

	test('edit a transaction changes the amount in the list', async ({ onboardedPage: page }) => {
		await addTransaction(page, { kind: 'expense', amount: '50k' });
		await page.getByRole('link', { name: 'Transactions' }).click();
		// Open edit via the row button (the row's flex-1 button opens edit).
		await page.getByRole('main').getByText('-₫50,000').click();
		const editModal = page.getByRole('dialog');
		await expect(editModal.getByRole('heading', { name: 'Edit transaction' })).toBeVisible();
		await editModal.getByLabel('Amount').fill('75k');
		await editModal.getByRole('button', { name: 'Save changes' }).click();
		await expect(page.getByRole('main').getByText('-₫75,000')).toBeVisible();
		await expect(page.getByRole('main').getByText('-₫50,000')).toHaveCount(0);
	});

	test('delete a transaction removes it from the list', async ({ onboardedPage: page }) => {
		await addTransaction(page, { kind: 'expense', amount: '50k' });
		await page.getByRole('link', { name: 'Transactions' }).click();
		await expect(page.getByRole('main').getByText('-₫50,000')).toBeVisible();
		await page.getByRole('button', { name: '✕' }).click();
		// Delete may use a ConfirmDialog — confirm if present.
		const confirm = page.getByRole('dialog').getByRole('button', { name: /Delete|Confirm/ });
		if (await confirm.isVisible().catch(() => false)) await confirm.click();
		await expect(page.getByRole('main').getByText('-₫50,000')).toHaveCount(0);
	});

	test('transfer kind is disabled in edit mode', async ({ onboardedPage: page }) => {
		await addTransaction(page, { kind: 'expense', amount: '50k' });
		await page.getByRole('link', { name: 'Transactions' }).click();
		await page.getByRole('main').getByText('-₫50,000').click();
		const editModal = page.getByRole('dialog');
		// Kind buttons are disabled when editing (TransactionForm.svelte:145 disabled={isEdit}).
		await expect(editModal.getByRole('button', { name: 'Expense', exact: true })).toBeDisabled();
	});
});
```

**Note for the implementer:** the pagination test is deferred — page-size depends on `displayItems` slicing, which needs >N transactions seeded. If `transactions/+page.svelte` uses a fixed page size, add a test that adds (pageSize+1) expenses via a loop and asserts the Next button enables. Check the page-size constant in `transactions/+page.svelte` and add this test only if the constant is small enough to be practical; otherwise note it as a gap.

- [ ] **Step 2: Run the spec**

Run: `pnpm test:e2e src/tests/e2e/transactions.spec.ts`
Expected: PASS. If selector names differ from the actual UI (e.g. the Add-account button label), adjust to match `src/routes/accounts/+page.svelte` — do not weaken assertions, fix the selector.

- [ ] **Step 3: Commit**

```bash
git add src/tests/e2e/transactions.spec.ts
git commit -m "test(e2e): transactions add/edit/delete across kinds"
```

---

## Task 5: `accounts.spec.ts` (depth — reconcile)

**Files:**
- Create: `src/tests/e2e/accounts.spec.ts`

**Interfaces:**
- Consumes: `test, expect` from `./fixtures/onboarded`. Reconcile UI: `showReconcile` modal opened by a Reconcile button; `Input` labeled by `accounts_actual_balance_label()`; confirm button labeled `accounts_reconcile()`. Large discrepancy (>1,000,000) opens `ConfirmDialog` titled `accounts_large_discrepancy_title()`.

- [ ] **Step 1: Write the spec**

Create `src/tests/e2e/accounts.spec.ts`:

```typescript
import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';

test.describe('accounts', () => {
	test('create an account and open its detail', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Accounts' }).click();
		await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
		await page.getByRole('button', { name: /Add account|New account|Create account/ }).click();
		const modal = page.getByRole('dialog');
		await modal.getByLabel('Name').fill('Savings');
		await modal.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByText('Savings')).toBeVisible();
	});

	test('reconcile happy path — actual matches expected', async ({ onboardedPage: page }) => {
		// Seed a known balance: 50,000 expense against the onboarded account.
		await addTransaction(page, { kind: 'expense', amount: '50k' });

		await page.getByRole('link', { name: 'Accounts' }).click();
		await page.getByText('Test Checking').click();
		await expect(page.getByRole('heading', { name: /Test Checking/ })).toBeVisible();

		// Open reconcile. Expected balance after the expense; enter the same.
		await page.getByRole('button', { name: /Reconcile|Reconcile account/ }).click();
		const modal = page.getByRole('dialog');
		// Enter a matching actual balance (0 discrepancy). Use 0.
		await modal.getByLabel(/Actual balance|actual balance/i).fill('0');
		await modal.getByRole('button', { name: /Reconcile$/ }).click();
		// Reconciled-to-zero toast / no adjustment.
		await expect(page.getByText(/Reconciled|reconciled/i)).toBeVisible();
	});

	test('reconcile large discrepancy warns before confirming', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Accounts' }).click();
		await page.getByText('Test Checking').click();
		await page.getByRole('button', { name: /Reconcile|Reconcile account/ }).click();
		const modal = page.getByRole('dialog');
		// A balance off by > 1,000,000 (LARGE_DISCREPANCY_THRESHOLD).
		await modal.getByLabel(/Actual balance|actual balance/i).fill('5000000');
		await modal.getByRole('button', { name: /Reconcile$/ }).click();
		// ConfirmDialog warning appears (title accounts_large_discrepancy_title).
		await expect(page.getByRole('dialog').getByText(/large|discrepancy|sure/i)).toBeVisible();
	});
});
```

- [ ] **Step 2: Run the spec**

Run: `pnpm test:e2e src/tests/e2e/accounts.spec.ts`
Expected: PASS. Reconcile button/label selectors must match `src/routes/accounts/[id]/+page.svelte` — verify the Reconcile button's accessible name and adjust. The Input label comes from the i18n key; if `getByLabel` doesn't match, target by placeholder (`accounts_amount_placeholder`) or `input[type=number]` within the dialog.

- [ ] **Step 3: Commit**

```bash
git add src/tests/e2e/accounts.spec.ts
git commit -m "test(e2e): accounts create + reconcile happy/large-discrepancy"
```

---

## Task 6: `budgets.spec.ts` (breadth + month isolation)

**Files:**
- Create: `src/tests/e2e/budgets.spec.ts`

**Interfaces:**
- Consumes: `test, expect` from `./fixtures/onboarded`. Budgets UI (`src/routes/budgets/+page.svelte`): prev/next month buttons `◀`/`▶`, month label in a `span.figures`; allocation inputs per budgetable bucket; toast `budgets_updated()`.

- [ ] **Step 1: Write the spec**

Create `src/tests/e2e/budgets.spec.ts`:

```typescript
import { test, expect } from './fixtures/onboarded';

test.describe('budgets', () => {
	test('allocate to a category and it persists', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Budgets' }).click();
		await expect(page.getByRole('heading', { name: 'Budgets' })).toBeVisible();
		// First budgetable bucket's allocation input.
		const firstInput = page.locator('input[type=number]').first();
		await firstInput.fill('500000');
		await firstInput.press('Enter');
		await expect(page.getByText(/Updated|updated/i)).toBeVisible();
		// Reload the month to confirm persistence.
		await page.reload();
		await expect(page.locator('input[type=number]').first()).toHaveValue('500000');
	});

	test('prev/next month navigation changes the month and isolates allocations', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Budgets' }).click();
		const monthLabel = page.locator('span.figures.font-medium');
		const initialMonth = await monthLabel.textContent();
		expect(initialMonth).toBeTruthy();

		// Navigate next, allocate, then go back — allocation must NOT leak across months.
		await page.getByRole('button', { name: '▶' }).click();
		await expect(monthLabel).not.toHaveText(initialMonth!);
		const nextInput = page.locator('input[type=number]').first();
		await nextInput.fill('300000');
		await nextInput.press('Enter');
		await expect(page.getByText(/Updated|updated/i)).toBeVisible();

		// Back to the original month — its allocation is unchanged.
		await page.getByRole('button', { name: '◀' }).click();
		await expect(monthLabel).toHaveText(initialMonth!);
		await expect(page.locator('input[type=number]').first()).toHaveValue('');
	});
});
```

- [ ] **Step 2: Run the spec**

Run: `pnpm test:e2e src/tests/e2e/budgets.spec.ts`
Expected: PASS. If budgets use a different input mechanism (e.g. an editable cell, not `input[type=number]`), adjust the selector to match `budgets/+page.svelte:39-48`. Confirm `▶`/`◀` are the actual button labels (`budgets/+page.svelte:61-63`).

- [ ] **Step 3: Commit**

```bash
git add src/tests/e2e/budgets.spec.ts
git commit -m "test(e2e): budgets allocation + per-month isolation"
```

---

## Task 7: Breadth specs — debts, goals, reports, categories

Four independent smoke specs. Grouped as one task because each is small and follows the same pattern, but each gets its own commit.

**Files:**
- Create: `src/tests/e2e/debts.spec.ts`, `src/tests/e2e/goals.spec.ts`, `src/tests/e2e/reports.spec.ts`, `src/tests/e2e/categories.spec.ts`

- [ ] **Step 1: Write `debts.spec.ts`**

Create `src/tests/e2e/debts.spec.ts`:

```typescript
import { test, expect } from './fixtures/onboarded';

test('debts page loads and a debt can be created', async ({ onboardedPage: page }) => {
	await page.getByRole('link', { name: 'Debts' }).click();
	await expect(page.getByRole('heading', { name: 'Debts' })).toBeVisible();
	await page.getByRole('button', { name: /Add debt|New debt|Create debt/ }).click();
	const modal = page.getByRole('dialog');
	await modal.getByLabel(/Name|Description/i).first().fill('Car loan');
	await modal.getByLabel(/Amount/i).fill('5000');
	await modal.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Car loan')).toBeVisible();
});
```

- [ ] **Step 2: Write `goals.spec.ts`**

Create `src/tests/e2e/goals.spec.ts`:

```typescript
import { test, expect } from './fixtures/onboarded';

test('goals page loads and a goal can be created', async ({ onboardedPage: page }) => {
	await page.getByRole('link', { name: 'Goals' }).click();
	await expect(page.getByRole('heading', { name: 'Goals' })).toBeVisible();
	await page.getByRole('button', { name: /Add goal|New goal|Create goal/ }).click();
	const modal = page.getByRole('dialog');
	await modal.getByLabel(/Name|Description/i).first().fill('Emergency fund');
	await modal.getByLabel(/Amount|Target/i).fill('10000');
	await modal.getByRole('button', { name: 'Save' }).click();
	await expect(page.getByText('Emergency fund')).toBeVisible();
});
```

- [ ] **Step 3: Write `reports.spec.ts`**

Create `src/tests/e2e/reports.spec.ts`:

```typescript
import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';

test('reports sub-pages load with no console errors', async ({ onboardedPage: page }) => {
	const errors: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});

	// Seed data so reports have something to render.
	await addTransaction(page, { kind: 'expense', amount: '50k' });

	for (const path of ['/reports', '/reports/trend', '/reports/compare']) {
		await page.goto(path);
		// Each report renders its heading without throwing.
		await expect(page.getByRole('main')).toBeVisible();
	}
	expect(errors).toEqual([]);
});
```

- [ ] **Step 4: Write `categories.spec.ts`**

Create `src/tests/e2e/categories.spec.ts`:

```typescript
import { test, expect } from './fixtures/onboarded';

test('a category can be created and merged on delete', async ({ onboardedPage: page }) => {
	await page.goto('/settings/categories');
	await expect(page.getByRole('heading', { name: /Categories/i })).toBeVisible();

	// Create two tags so one can merge into the other.
	await page.getByRole('button', { name: /Add|New|Create/i }).click();
	let modal = page.getByRole('dialog');
	await modal.getByLabel(/Name/i).fill('Tag A');
	await modal.getByRole('button', { name: /Create|Save/i }).click();

	await page.getByRole('button', { name: /Add|New|Create/i }).click();
	modal = page.getByRole('dialog');
	await modal.getByLabel(/Name/i).fill('Tag B');
	await modal.getByRole('button', { name: /Create|Save/i }).click();

	// Delete Tag A, merging into Tag B (categories/+page.svelte deleteOption merge_into).
	await page.getByRole('button', { name: /Delete|✕/ }).first().click();
	const delModal = page.getByRole('dialog');
	// If referenced, a merge Select appears; pick Tag B.
	const mergeSelect = delModal.locator('select').first();
	if (await mergeSelect.isVisible().catch(() => false)) {
		await mergeSelect.selectOption({ label: 'Tag B' });
	}
	await delModal.getByRole('button', { name: /Delete$/ }).click();
	await expect(page.getByText('Tag A')).toHaveCount(0);
});
```

- [ ] **Step 5: Run all four specs**

Run: `pnpm test:e2e src/tests/e2e/debts.spec.ts src/tests/e2e/goals.spec.ts src/tests/e2e/reports.spec.ts src/tests/e2e/categories.spec.ts`
Expected: PASS. **Implementer must verify every selector against the actual route files** (`debts/+page.svelte`, `goals/+page.svelte`, `reports/*/+page.svelte`, `settings/categories/+page.svelte`). Breadth specs intentionally use loose regex selectors; tighten any that match multiple elements.

- [ ] **Step 6: Commit**

```bash
git add src/tests/e2e/debts.spec.ts src/tests/e2e/goals.spec.ts src/tests/e2e/reports.spec.ts src/tests/e2e/categories.spec.ts
git commit -m "test(e2e): breadth specs for debts, goals, reports, categories"
```

---

## Task 8: The Tauri-FS IPC mock (`fixtures/tauri-mock.ts`)

The hard part. Injected via `page.addInitScript` before first navigation. Intercepts `__TAURI_INTERNALS__.invoke`, routing `plugin:sql|*` to real sql.js instances and `plugin:fs|*`/`plugin:path|*` to a virtual filesystem. Two persistence mechanisms: virtual-FS-as-source-of-truth (restore) and IndexedDB (reload-survival, toggled by `persistDb`).

**Files:**
- Create: `src/tests/e2e/fixtures/tauri-mock.ts`
- Create: `src/tests/e2e/fixtures/persist.ts`

**Interfaces:**
- Produces:
  - `tauriMockPage` — `test.extend({ page })` that injects the mock via `page.addInitScript` before the fixture yields. Accepts options via `test.use({ tauriMockOptions: { seedMeta, persist } })`.
  - `injectTauriMock(page, opts): Promise<void>` — lower-level injector for direct use.
  - `readVirtualFs(page, path): Promise<Uint8Array | undefined>` — inspect a virtual-FS file from the test.
  - `listVirtualFs(page, dir): Promise<string[]>` — list files under a virtual-FS directory.
  - `persistDb(page): Promise<void>` — flips IndexedDB persistence on for reload-survival.

- [ ] **Step 1: Write the mock injector**

Create `src/tests/e2e/fixtures/tauri-mock.ts`. The mock runs in the page context (serialized by `addInitScript`), so it must be self-contained — no imports of app code. It loads sql.js from the same `?url` the app uses.

```typescript
import type { Page } from '@playwright/test';
import { test as base } from '@playwright/test';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';

export interface TauriMockOptions {
	/** Rows written into the live DB's app_meta immediately after load (before runAutoBackup reads them). */
	seedMeta?: Record<string, string>;
	/** If true, the live DB flushes to IndexedDB and rehydrates on load (reload-survival). */
	persist?: boolean;
}

/**
 * Inject a __TAURI_INTERNALS__ mock into the page BEFORE the app loads.
 * Routes plugin:sql|* to real sql.js instances and plugin:fs|*/plugin:path|*
 * to an in-memory virtual filesystem. The real plugin code runs unchanged;
 * only the IPC transport is faked.
 *
 * NOTE: addInitScript serializes the function source and runs it in the page
 * context, so this body cannot close over outer variables. Options are passed
 * via a global the page reads on init.
 */
export async function injectTauriMock(page: Page, opts: TauriMockOptions = {}): Promise<void> {
	// Stash options on a global the in-page script reads.
	await page.addInitScript(`
		window.__NOTCHY_TAURI_MOCK_OPTIONS__ = ${JSON.stringify(opts)};
	`);

	await page.addInitScript(`
		(async () => {
			const opts = window.__NOTCHY_TAURI_MOCK_OPTIONS__ || {};
			const APP_DATA_DIR = '/notchy/appdata';
			const LIVE_PATH = 'sqlite:notchy.db';

			// --- sql.js (loaded the same way the app loads it) ---
			const SQL = await (async () => {
				const mod = await import(${JSON.stringify(wasmUrl.replace(/\?url$/, ''))}).catch(() => null);
				// The ?url asset isn't importable as a module; use the runtime loader
				// via a dynamic import of sql.js itself, matching in-memory.ts.
				return null;
			})();

			// We can't reliably import sql.js inside addInitScript (no bundler here).
			// Instead, load the WASM via the sql.js CDN-free local asset by having
			// the page fetch the app's own sql-wasm.wasm through a module the test
			// exposes. Simpler: load sql.js from the global the app already set up.
			const initSqlJs = window.__initSqlJsForMock__;
			if (!initSqlJs) throw new Error('tauri-mock: window.__initSqlJsForMock__ not set');
			const SQL_JS = await initSqlJs();

			// --- virtual filesystem + DB registry ---
			const fs = new Map(); // path -> Uint8Array
			const dbs = new Map(); // path -> sql.js Database
			const idbKey = (path) => 'notchy-mock-db:' + path;

			async function idbGet(key) {
				return new Promise((resolve) => {
					const req = indexedDB.open('notchy-mock', 1);
					req.onupgradeneeded = () => req.result.createObjectStore('kv');
					req.onsuccess = () => {
						const db = req.result;
						const tx = db.transaction('kv', 'readonly').objectStore('kv').get(key);
						tx.onsuccess = () => resolve(tx.result || null);
						tx.onerror = () => resolve(null);
					};
					req.onerror = () => resolve(null);
				});
			}
			async function idbSet(key, val) {
				return new Promise((resolve) => {
					const req = indexedDB.open('notchy-mock', 1);
					req.onupgradeneeded = () => req.result.createObjectStore('kv');
					req.onsuccess = () => {
						const db = req.result;
						const tx = db.transaction('kv', 'readwrite').objectStore('kv').put(val, key);
						tx.onsuccess = () => resolve();
						tx.onerror = () => resolve();
					};
				});
			}

			async function loadDb(path) {
				if (dbs.has(path)) return dbs.get(path);
				// Rehydrate from IndexedDB if persist is on; else from the virtual FS
				// (restore path copied bytes there); else fresh.
				let bytes = null;
				if (opts.persist) bytes = await idbGet(idbKey(path));
				if (!bytes && fs.has(path)) bytes = fs.get(path);
				const db = bytes ? new SQL_JS.Database(bytes) : new SQL_JS.Database();
				dbs.set(path, db);

				// Pre-init seed hook: write seedMeta into the live DB before runAutoBackup.
				if (path === LIVE_PATH && opts.seedMeta) {
					for (const [k, v] of Object.entries(opts.seedMeta)) {
						try {
							db.run("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)", [k, v]);
						} catch {}
					}
				}
				return db;
			}

			function select(db, query, values) {
				const stmt = db.prepare(query);
				try {
					stmt.bind(values || []);
					const rows = [];
					while (stmt.step()) rows.push(stmt.getAsObject());
					return rows;
				} finally {
					stmt.free();
				}
			}

			// Path helpers
			const join = (...parts) => parts.join('/').replace(/\\/g, '/').replace(/\\/+/g, '/').replace(/\/+/g, '/');

			window.__TAURI_INTERNALS__ = {
				invoke: async (cmd, args) => {
					args = args || {};
					// --- SQL plugin ---
					if (cmd === 'plugin:sql|load') {
						const db = await loadDb(args.db);
						// Echo the path: the plugin stores invoke's return as this.path.
						return args.db;
					}
					if (cmd === 'plugin:sql|select') {
						const db = await loadDb(args.db);
						return select(db, args.query, args.values);
					}
					if (cmd === 'plugin:sql|execute') {
						let db = await loadDb(args.db);
						db.run(args.query, args.values || []);
						const rowsAffected = db.getRowsModified();
						if (opts.persist && args.db === LIVE_PATH) {
							await idbSet(idbKey(args.db), db.export());
						}
						return [rowsAffected, 0];
					}
					if (cmd === 'plugin:sql|close') {
						const db = dbs.get(args.db);
						if (db) { db.close(); dbs.delete(args.db); }
						return {};
					}
					// --- Path plugin ---
					if (cmd === 'plugin:path|resolve_directory') return APP_DATA_DIR;
					if (cmd === 'plugin:path|join') return join(...(args.paths || []));
					// --- FS plugin ---
					if (cmd === 'plugin:fs|copy_file') {
						fs.set(args.toPath, fs.get(args.fromPath));
						return {};
					}
					if (cmd === 'plugin:fs|mkdir') { return {}; }
					if (cmd === 'plugin:fs|read_dir') {
						const out = [];
						for (const p of fs.keys()) {
							if (p.startsWith(args.path + '/')) {
								out.push({ name: p.slice(args.path.length + 1), isDirectory: false });
							}
						}
						return out;
					}
					if (cmd === 'plugin:fs|remove') { fs.delete(args.path); return {}; }
					if (cmd === 'plugin:fs|stat') {
						const f = fs.get(args.path);
						return f ? { size: f.length, isFile: true, isDirectory: false } : { size: 0 };
					}
					if (cmd === 'plugin:fs|write_text_file') {
						fs.set(args.path, new TextEncoder().encode(args.contents));
						return {};
					}
					throw new Error('tauri-mock: unhandled invoke ' + cmd);
				},
				transformCallback: () => 0,
				convertFileSrc: (p) => p,
			};

			// Expose a way for tests to read the virtual FS.
			window.__notchyMock = {
				readFs: (path) => fs.get(path),
				listFs: (dir) => [...fs.keys()].filter((p) => p.startsWith(dir)),
				writeFs: (path, bytes) => fs.set(path, bytes),
			};
		})();
	`);
}

// Expose sql.js init to the page before the mock runs.
// Called by the fixture after addInitScript but before navigation.
export async function primeSqlJs(page: Page): Promise<void> {
	await page.addInitScript(`
		import('sql.js').then((mod) => {
			const init = mod.default;
			window.__initSqlJsForMock__ = async () => {
				return await init({ locateFile: () => ${JSON.stringify(wasmUrl)} });
			};
		});
	`);
}

/** Inspect a virtual-FS file from the test. */
export async function readVirtualFs(page: Page, path: string): Promise<Uint8Array | undefined> {
	return page.evaluate((p) => window.__notchyMock?.readFs(p), path);
}

/** List virtual-FS files under a directory. */
export async function listVirtualFs(page: Page, dir: string): Promise<string[]> {
	return page.evaluate((d) => window.__notchyMock?.listFs(d) ?? [], dir);
}

/** Write a file into the virtual FS (used to mint corrupt/mismatch test files). */
export async function writeVirtualFs(page: Page, path: string, bytes: Uint8Array): Promise<void> {
	await page.evaluate(({ p, b }) => window.__notchyMock?.writeFs(p, new Uint8Array(b)), { p: path, b: Array.from(bytes) });
}

/**
 * Fixture: injects the mock before navigation. Configure via test.use:
 *   test.use({ tauriMockOptions: { seedMeta: {...} } })
 */
export const test = base.extend<{ tauriMockPage: Page; tauriMockOptions: TauriMockOptions }>({
	tauriMockOptions: [{}, { option: true }],
	tauriMockPage: async ({ page, tauriMockOptions }, use) => {
		await primeSqlJs(page);
		await injectTauriMock(page, tauriMockOptions);
		await use(page);
	},
});
```

- [ ] **Step 2: Write `persist.ts`**

Create `src/tests/e2e/fixtures/persist.ts`:

```typescript
import type { Page } from '@playwright/test';

/**
 * Flip the mock's IndexedDB persistence ON for reload-survival tests.
 * After this, the live DB flushes to IndexedDB on every write and rehydrates
 * on the next Database.load('sqlite:notchy.db') — so a page.reload() reopens
 * the same data. Must be called BEFORE the first navigation (mock injected
 * with persist:true at addInitScript time), OR used by configuring the fixture
 * with tauriMockOptions: { persist: true }.
 */
export async function persistDb(page: Page): Promise<void> {
	// Persistence is configured at mock-injection time (persist: true), not toggled
	// at runtime — so this is a no-op placeholder. Use the fixture option instead.
	// Kept for spec readability and future runtime-toggle support.
	await page.evaluate(() => {
		(window as unknown as { __NOTCHY_TAURI_MOCK_OPTIONS__?: { persist?: boolean } }).__NOTCHY_TAURI_MOCK_OPTIONS__ = {
			...((window as unknown as { __NOTCHY_TAURI_MOCK_OPTIONS__?: object }).__NOTCHY_TAURI_MOCK_OPTIONS__),
			persist: true,
		};
	});
}
```

**Note:** the reload-survival test instead uses `test.use({ tauriMockOptions: { persist: true } })` since persistence must be active from the first `loadDb`. `persistDb` is kept for readability and documents the contract.

- [ ] **Step 3: Type-check**

Run: `pnpm check`
Expected: 0 errors. The mock's in-page script is a template string (untyped), so typecheck only covers the TS surface.

- [ ] **Step 4: Sanity-check the mock with a throwaway test**

Create a temporary `src/tests/e2e/_mock-sanity.spec.ts` to verify the mock wires up: app boots as if Tauri, a transaction persists in the sql.js-backed `notchy.db`, and `readVirtualFs` works.

```typescript
import { test, expect } from './fixtures/onboarded';
import { injectTauriMock, primeSqlJs, readVirtualFs } from './fixtures/tauri-mock';

test('MOCK SANITY: tauri mock boots and serves sql.js', async ({ page }) => {
	await primeSqlJs(page);
	await injectTauriMock(page, {});
	// Onboard through the (mocked) Tauri path.
	await page.goto('/');
	await page.getByRole('button', { name: /^English/ }).click();
	await page.getByRole('button', { name: 'Continue →' }).click();
	await page.getByRole('button', { name: /VND — Vietnamese đồng/ }).click();
	await page.getByRole('button', { name: 'Continue →' }).click();
	await page.getByLabel('Name').fill('Mock Acct');
	await page.getByRole('button', { name: 'Finish setup' }).click();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
});
```

Run: `pnpm test:e2e src/tests/e2e/_mock-sanity.spec.ts`
Expected: PASS. If it fails, the most likely cause is sql.js not loading in `addInitScript` (the `__initSqlJsForMock__` prime step). Debug the prime/inject ordering. Iterate until green, then delete the sanity file.

- [ ] **Step 5: Delete the sanity file and commit**

```bash
rm src/tests/e2e/_mock-sanity.spec.ts
git add src/tests/e2e/fixtures/tauri-mock.ts src/tests/e2e/fixtures/persist.ts
git commit -m "test(e2e): Tauri IPC mock (sql.js + virtual FS + IndexedDB persist)"
```

---

## Task 9: `backup-restore.spec.ts` (depth + reload-survival)

**Files:**
- Create: `src/tests/e2e/backup-restore.spec.ts`

**Interfaces:**
- Consumes: `test` from `./fixtures/tauri-mock` (`tauriMockPage` + `tauriMockOptions`); `onboard` from `./helpers/ui`; `readVirtualFs`, `writeVirtualFs`, `listVirtualFs` from `./fixtures/tauri-mock`. The app functions under test are invoked via `page.evaluate` through the real plugin SQL/FS code: `createBackup(db, dir)`, `importDatabase(path, 3)`.

- [ ] **Step 1: Write the spec**

Create `src/tests/e2e/backup-restore.spec.ts`:

```typescript
import { test, expect } from './fixtures/tauri-mock';
import { onboard } from './helpers/ui';

const APP_DATA_DIR = '/notchy/appdata';
const BACKUP_DIR = APP_DATA_DIR + '/backups';

test.describe('backup / restore (Tauri IPC mock)', () => {
	test('backup → diverge → restore round-trip', async ({ tauriMockPage: page }) => {
		await onboard(page, { accountName: 'RoundTrip' });
		// Capture an identifying row count in the live DB before backup.
		const before = await page.evaluate(async () => {
			const { getDb } = await import('$lib/db');
			const db = await getDb();
			return db.query<{ c: number }>('SELECT COUNT(*) AS c FROM accounts WHERE deleted_at IS NULL');
		});
		const beforeCount = before[0].c;

		// Back up via the real createBackup (runs real SQL on the mock's sql.js).
		const backupPath = await page.evaluate(async () => {
			const { getDb } = await import('$lib/db');
			const { createBackup } = await import('$lib/backup');
			const db = await getDb();
			return createBackup(db, BACKUP_DIR_PLACEHOLDER());
		});

		// Diverge: add another account directly via SQL through the live DB.
		await page.evaluate(async () => {
			const { getDb } = await import('$lib/db');
			const db = await getDb();
			await db.execute(
				`INSERT INTO accounts (id, name, type, currency, created_at, updated_at)
				 VALUES ('01DIVERGE', 'Diverged', 'checking', 'VND', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')`
			);
		});

		// Restore from the backup file. importDatabase closes the live DB, copies
		// the backup over the live path, and the app reloads to reopen it.
		const result = await page.evaluate(async (p) => {
			const { importDatabase } = await import('$lib/backup');
			return importDatabase(p, 3);
		}, backupPath);
		expect(result.valid).toBe(true);

		// Reload so getDb() reopens the copied file.
		await page.reload();
		await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

		// The divergent account is gone; count is back to before.
		const after = await page.evaluate(async () => {
			const { getDb } = await import('$lib/db');
			const db = await getDb();
			return db.query<{ c: number }>('SELECT COUNT(*) AS c FROM accounts WHERE deleted_at IS NULL');
		});
		expect(after[0].c).toBe(beforeCount);
		expect(after.some((r) => r.id === '01DIVERGE')).toBe(false);
	});

	test('corrupt import is rejected, live DB untouched', async ({ tauriMockPage: page }) => {
		await onboard(page, { accountName: 'CorruptGuard' });
		const before = await page.evaluate(async () => {
			const { getDb } = await import('$lib/db');
			const db = await getDb();
			return db.query<{ c: number }>('SELECT COUNT(*) AS c FROM accounts WHERE deleted_at IS NULL');
		});

		// Mint a valid-shape sql.js DB but missing app_meta (fails required-tables check).
		const corruptBytes = await page.evaluate(async () => {
			const init = window.__initSqlJsForMock__;
			const SQL = await init();
			const db = new SQL.Database();
			db.run('CREATE TABLE junk (x INTEGER)');
			return Array.from(db.export());
		});
		await writeVirtualFs(page, APP_DATA_DIR + '/corrupt.sqlite', new Uint8Array(corruptBytes));

		const result = await page.evaluate(async () => {
			const { importDatabase } = await import('$lib/backup');
			return importDatabase(APP_DATA_DIR + '/corrupt.sqlite', 3);
		});
		expect(result.valid).toBe(false);

		// Live DB unchanged.
		const after = await page.evaluate(async () => {
			const { getDb } = await import('$lib/db');
			const db = await getDb();
			return db.query<{ c: number }>('SELECT COUNT(*) AS c FROM accounts WHERE deleted_at IS NULL');
		});
		expect(after[0].c).toBe(before[0].c);
	});

	test('schema-version mismatch is rejected', async ({ tauriMockPage: page }) => {
		await onboard(page, { accountName: 'VersionGuard' });
		// Build a full-shape DB with schema_version != 3.
		const mismatchBytes = await page.evaluate(async () => {
			const init = window.__initSqlJsForMock__;
			const SQL = await init();
			const db = new SQL.Database();
			db.run('CREATE TABLE app_meta (key TEXT PRIMARY KEY, value TEXT)');
			db.run('CREATE TABLE accounts (id TEXT, name TEXT, type TEXT, currency TEXT)');
			db.run("INSERT INTO app_meta (key, value) VALUES ('schema_version', '99')");
			return Array.from(db.export());
		});
		await writeVirtualFs(page, APP_DATA_DIR + '/wrongver.sqlite', new Uint8Array(mismatchBytes));

		const result = await page.evaluate(async () => {
			const { importDatabase } = await import('$lib/backup');
			return importDatabase(APP_DATA_DIR + '/wrongver.sqlite', 3);
		});
		expect(result.valid).toBe(false);
		expect(result.error).toContain('Schema version');
	});

	test('auto-backup runs on launch and writes a file', async ({ page }) => {
		// This test customizes tauriMockOptions via test.use at the describe level
		// is not possible per-test; instead inject directly with seedMeta.
		const { injectTauriMock, primeSqlJs } = await import('./fixtures/tauri-mock');
		await primeSqlJs(page);
		await injectTauriMock(page, { seedMeta: { last_backup_at: '2020-01-01T00:00:00.000Z' } });
		await onboard(page, { accountName: 'AutoBak' });

		// runAutoBackup is fire-and-forget during init; poll the virtual FS.
		await expect.poll(async () => listVirtualFs(page, BACKUP_DIR)).toEqual(
			expect.arrayContaining([expect.stringMatching(/notchy-backup-.*\.sqlite$/)])
		);
	});
});

// Helper: the importDatabase path uses appDataDir() which the mock resolves to APP_DATA_DIR.
function BACKUP_DIR_PLACEHOLDER() {
	return APP_DATA_DIR + '/backups';
}
```

- [ ] **Step 2: Run the spec**

Run: `pnpm test:e2e src/tests/e2e/backup-restore.spec.ts`
Expected: PASS. This is the highest-risk spec. Likely failure points and their fixes:
  - **`importDatabase` readonly open fails in mock:** the mock's `loadDb` doesn't special-case `?readonly`; it treats `'sqlite:<path>?readonly'` as a distinct registry key. `importDatabase` (`backup/index.ts:182-186`) falls back to the non-readonly open on catch. The mock should strip `?readonly` before keying the registry — add `.replace(/\?readonly$/, '')` to the `args.db` value in the `plugin:sql|load` and `select`/`execute` handlers.
  - **`closeDb` + reload ordering:** after `importDatabase`, `getDb()`'s cached `_db` is nulled but `dbs` map still holds the closed instance. On `page.reload()`, the full JS context resets (new `dbs` map), and `loadDb('sqlite:notchy.db')` reads the copied bytes from the virtual FS via `copyFile`. Verify `copy_file` writes to the LIVE_PATH key.
  - **`createBackup` VACUUM INTO in mock:** after Task 1's fix, the statement is `VACUUM INTO '<path>'` — sql.js *does* support VACUUM INTO a literal, but only into a file it can open. In the mock, sql.js can't write to the virtual FS. **The mock's `execute` handler must special-case `VACUUM INTO`** — detect it and `db.export()` to the virtual FS at the parsed path. Add this override to the `plugin:sql|execute` handler before `db.run`.

  Add this override block inside the `plugin:sql|execute` branch of the mock (before `db.run`):
  ```javascript
  if (/^\\s*VACUUM\\s+INTO/i.test(args.query)) {
	  const m = args.query.match(/INTO\\s+'([^']+)'/i);
	  if (m) fs.set(m[1], db.export());
	  return [0, 0];
  }
  ```

- [ ] **Step 3: Commit**

```bash
git add src/tests/e2e/backup-restore.spec.ts src/tests/e2e/fixtures/tauri-mock.ts
git commit -m "test(e2e): backup/restore round-trip, corrupt/mismatch rejection, auto-backup"
```

---

## Task 10: Reload-survival + full suite green

**Files:**
- Create: `src/tests/e2e/reload-survival.spec.ts`

- [ ] **Step 1: Write the reload-survival spec**

Create `src/tests/e2e/reload-survival.spec.ts`:

```typescript
import { test, expect } from './fixtures/tauri-mock';
import { onboard, addTransaction } from './helpers/ui';

// Persistence is on from the first loadDb, so configure the fixture.
test.use({ tauriMockOptions: { persist: true } });

test('a transaction survives a full page reload (IndexedDB persist)', async ({ tauriMockPage: page }) => {
	await onboard(page, { accountName: 'Survivor' });
	await addTransaction(page, { kind: 'expense', amount: '50k' });
	await expect(page.getByText(/Saved · expense ·/)).toBeVisible();

	// Full reload: JS context resets, _db cache gone, getDb() re-runs and
	// rehydrates from IndexedDB. The transaction must still be there.
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await page.getByRole('link', { name: 'Transactions' }).click();
	await expect(page.getByRole('main').getByText('-₫50,000')).toBeVisible();
});
```

- [ ] **Step 2: Run the full E2E suite**

Run: `pnpm test:e2e`
Expected: ALL specs pass — onboarding (2), transactions (4), accounts (3), budgets (2), debts (1), goals (1), reports (1), categories (1), backup-restore (4), reload-survival (1).

- [ ] **Step 3: Run the full gate suite**

Run: `pnpm test && pnpm check`
Expected: unit tests 255+ green (Task 1 added 1), typecheck 0 errors.

- [ ] **Step 4: Commit**

```bash
git add src/tests/e2e/reload-survival.spec.ts
git commit -m "test(e2e): reload-survival (IndexedDB persistence) guarantee"
```

---

## Verification (run before declaring done)

- [ ] `pnpm test` — unit suite green (254 + 1 new createBackup test = 255).
- [ ] `pnpm check` — 0 errors, 0 warnings.
- [ ] `pnpm test:e2e` — all specs green.

## Self-Review Notes (resolved during planning)

- **Spec coverage:** breadth (10 routes) → Tasks 3-7; depth on transactions/accounts/budgets → Tasks 4-6; backup/restore full IPC → Task 9; reload-survival → Task 10; `VACUUM INTO` bug fix → Task 1. All spec success criteria have a task.
- **Type consistency:** `onboard`, `addTransaction`, `expectOnDashboard` defined in Task 2, consumed unchanged in 3-10. `tauriMockPage`/`tauriMockOptions` defined in Task 8, consumed in 9-10. `readVirtualFs`/`writeVirtualFs`/`listVirtualFs` defined in 8, consumed in 9.
- **Known implementer risks documented:** the sql.js-in-addInitScript loading (Task 8 prime step), the `VACUUM INTO` mock override (Task 9 Step 2), the `?readonly` registry key (Task 9 Step 2), and selector mismatches (each breadth spec flags "verify against the route file"). These are flagged inline, not hidden.
