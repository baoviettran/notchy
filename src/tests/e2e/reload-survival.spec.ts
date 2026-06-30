import { test, expect } from './fixtures/tauri-mock';
import { flushDb } from './fixtures/tauri-mock';
import { onboard, addTransaction } from './helpers/ui';

// Persistence is enabled for the whole suite: loadDb('sqlite:notchy.db')
// rehydrates from IndexedDB on each load. But the mock does NOT auto-flush on
// every write (db.export() mid-transaction corrupts sql.js's savepoint stack),
// so the test must call flushDb() at the point it wants durability — after the
// transaction is committed, outside any savepoint — then page.reload() rehydrates.
test.use({ tauriMockOptions: { persist: true } });

test('a transaction survives a full page reload (IndexedDB persist)', async ({ tauriMockPage: page }) => {
	await onboard(page, { accountName: 'Survivor' });
	await addTransaction(page, { kind: 'expense', amount: '50k' });
	// Add-mode toast: m.forms_saved({ kind, amount }) = "Saved · expense · ₫50,000"
	// (TransactionForm.svelte:121). Confirms the INSERT committed before we flush.
	await expect(page.getByText(/Saved · expense ·/)).toBeVisible();

	// Force the live sql.js DB to export its bytes into IndexedDB under the live
	// connection key. Without this, reload would rehydrate a stale (empty) DB —
	// the mock never auto-flushes from the execute handler.
	await flushDb(page);

	// Full reload: JS context resets, the in-page _db cache and the DB registry
	// Map are gone, so getDb() re-runs loadDb, which rehydrates from IndexedDB.
	// The transaction written above must still be present.
	await page.reload();
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	await page.getByRole('link', { name: 'Transactions', exact: true }).click();
	// Expense amounts render with a "-" prefix (transactions/+page.svelte:102);
	// VND formats with no fraction digits under en-US → "-₫50,000".
	// Scope to the list row (div.divide-y > div), not a bare getByText: a
	// future summary/totals region sharing the same formatted string would
	// make the unscoped locator resolve to >1 element and trip strict mode.
	const txRow = page.getByRole('main').locator('div.divide-y > div').filter({ hasText: '-₫50,000' });
	await expect(txRow).toBeVisible();
});
