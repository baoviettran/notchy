import { test, expect } from '@playwright/test';

/**
 * End-to-end happy path, driven against the in-memory sql.js DB fallback
 * (active because Playwright's chromium has no `window.__TAURI_INTERNALS__`).
 *
 * Covers: onboarding (language → currency → first account) → dashboard lands
 * → add a transaction via the FAB + modal using the `50k` amount shortcut
 * → the transaction appears in the Transactions list.
 */
test('onboarding → dashboard → add transaction', async ({ page }) => {
	await page.goto('/');

	// --- Step 1: language ---
	await expect(page.getByRole('heading', { name: 'Choose your language' })).toBeVisible();
	await page.getByRole('button', { name: /^English/ }).click();
	await page.getByRole('button', { name: 'Continue →' }).click();

	// --- Step 2: currency ---
	await expect(page.getByRole('heading', { name: 'Choose your currency' })).toBeVisible();
	await page.getByRole('button', { name: /VND — Vietnamese đồng/ }).click();
	await page.getByRole('button', { name: 'Continue →' }).click();

	// --- Step 3: first account ---
	await expect(page.getByRole('heading', { name: 'Create your first account' })).toBeVisible();
	const finish = page.getByRole('button', { name: 'Finish setup' });
	await expect(finish).toBeDisabled();
	await page.getByLabel('Name').fill('Test Checking');
	await expect(finish).toBeEnabled();
	await finish.click();

	// --- Dashboard ---
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

	// --- Add a transaction via FAB + modal ---
	await page.getByRole('button', { name: 'Add transaction' }).click();
	// The dashboard also has an inline "+ Add transaction" quick form with its
	// own Amount/Save controls, so scope subsequent interactions to the modal.
	const modal = page.getByRole('dialog');
	await expect(modal.getByRole('heading', { name: 'Add transaction' })).toBeVisible();
	await modal.getByRole('button', { name: 'Expense', exact: true }).click();
	// `50k` exercises parseAmount's shortcut parsing → 50,000.
	await modal.getByLabel('Amount').fill('50k');
	// Account auto-selects the first (only) account; Save is disabled until
	// amount is entered.
	await modal.getByRole('button', { name: 'Save' }).click();

	// Save toast confirms persistence + formatting (50,000 in VND).
	await expect(page.getByText(/Saved · expense ·/)).toBeVisible();

	// --- The transaction shows up in the Transactions list ---
	await page.getByRole('link', { name: 'Transactions' }).click();
	await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();
	// 50,000 VND under the 'en' locale → "₫50,000"; expenses render with a
	// leading minus. Scope to main to avoid matching the lingering save toast.
	// Asserting the formatted amount proves the row persisted and rendered.
	await expect(page.getByRole('main').getByText('-₫50,000')).toBeVisible();
});
