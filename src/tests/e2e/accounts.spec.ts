import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';

test.describe('accounts', () => {
	test('create an account and open its detail', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Accounts', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();

		// Add-account button: i18n accounts_add() → "+ Add account".
		await page.getByRole('button', { name: /\+?\s*Add account/i }).click();
		const modal = page.getByRole('dialog');
		await modal.getByLabel('Name').fill('Savings');
		// AccountForm new-account confirm button is forms_create() → "Create".
		await modal.getByRole('button', { name: 'Create' }).click();

		// Account appears in the Assets list as a link; open its detail.
		await page.getByRole('link', { name: /Savings/ }).first().click();
		// Detail heading renders the account name (h1, figures class).
		await expect(page.getByRole('heading', { name: 'Savings' })).toBeVisible();
	});

	test('reconcile happy path — actual matches expected', async ({ onboardedPage: page }) => {
		// Seed a known balance so the actual-balance field can be a positive
		// number that exactly matches expected. A 50,000 VND income makes the
		// onboarded account balance +50,000 (VND has 0 fraction digits; "50k"
		// → 50000). parseAmount() rejects inputs <= 0, so reconciling a fresh
		// zero-balance account directly is impossible — hence the seed.
		await addTransaction(page, { kind: 'income', amount: '50k' });

		await page.getByRole('link', { name: 'Accounts', exact: true }).click();
		await page.getByRole('link', { name: /Test Checking/ }).first().click();
		await expect(page.getByRole('heading', { name: 'Test Checking' })).toBeVisible();

		// Open the reconcile modal. The detail page's Reconcile button is
		// accounts_reconcile() → "Reconcile" (scoped to the detail header).
		await page.getByRole('button', { name: 'Reconcile' }).click();
		const modal = page.getByRole('dialog');

		// The modal pre-fills actualBalance with the account's expected balance
		// (see +page.svelte: onclick sets actualBalance = String(account.balance)).
		// After the 50k income that pre-fill is "50000" — re-submitting it yields
		// discrepancy 0 and the clean reconcile path.
		// The Input is labeled accounts_actual_balance_label() → "Actual balance".
		await expect(modal.getByLabel('Actual balance')).toHaveValue('50000');

		// Confirm — the modal's confirm button is also "Reconcile"; scope to dialog.
		await modal.getByRole('button', { name: 'Reconcile' }).click();

		// accounts_reconciled_toast() → "Account reconciled." (discrepancy 0).
		await expect(page.getByText('Account reconciled.')).toBeVisible();
	});

	test('reconcile large discrepancy warns before confirming', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Accounts', exact: true }).click();
		await page.getByRole('link', { name: /Test Checking/ }).first().click();
		await expect(page.getByRole('heading', { name: 'Test Checking' })).toBeVisible();

		await page.getByRole('button', { name: 'Reconcile' }).click();
		const modal = page.getByRole('dialog');

		// Fresh onboarded account: expected balance 0. Entering 5,000,000 gives a
		// discrepancy of +5,000,000 > LARGE_DISCREPANCY_THRESHOLD (1,000,000), so
		// startReconcile() sets confirmLarge=true instead of reconciling directly.
		await modal.getByLabel('Actual balance').fill('5000000');
		await modal.getByRole('button', { name: 'Reconcile' }).click();

		// ConfirmDialog (NOT a role=dialog) appears with
		// accounts_large_discrepancy_title() → "Large discrepancy detected".
		await expect(page.getByText('Large discrepancy detected')).toBeVisible();
	});
});
