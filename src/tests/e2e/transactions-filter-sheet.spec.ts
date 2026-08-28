import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';

test.describe('transactions filter sheet (mobile)', () => {
	test.use({ viewport: { width: 375, height: 812 } });

	test('opens filter sheet, scrim closes it, filter persists', async ({ onboardedPage: page }) => {
		// Seed a transaction so we have something to filter.
		await addTransaction(page, { kind: 'expense', amount: '50k', payee: 'Coffee' });
		await addTransaction(page, { kind: 'income', amount: '100k', payee: 'Salary' });

		// Navigate to Transactions page.
		await page.getByRole('link', { name: 'Transactions', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Transactions' })).toBeVisible();

		// Filters button exists.
		const filtersBtn = page.getByRole('button', { name: /Filters/ });
		await expect(filtersBtn).toBeVisible();

		// Before opening: filter selects are NOT visible (hidden on mobile).
		const dialog = page.getByRole('dialog', { name: 'Filters' });
		await expect(dialog.getByLabel('Kind')).not.toBeVisible();

		// Open filter sheet.
		await filtersBtn.click();

		// Sheet opens: filter selects are now visible inside the dialog.
		const kindSelect = dialog.getByLabel('Kind');
		await expect(kindSelect).toBeVisible();
		await expect(dialog.getByLabel('Account')).toBeVisible();

		// Select a filter.
		await kindSelect.selectOption('expense');

		// Close via scrim (the fixed inset-0 overlay behind the sheet).
		await page.locator('.fixed.inset-0.z-40').click({ force: true });
		await expect(kindSelect).not.toBeVisible();

		// Badge count should now show 1 (one active filter).
		await expect(filtersBtn).toContainText('1');

		// Reopen: filter should persist.
		await filtersBtn.click();
		await expect(kindSelect).toHaveValue('expense');
	});

	test('Escape closes the filter sheet', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Transactions', exact: true }).click();
		const filtersBtn = page.getByRole('button', { name: /Filters/ });
		await filtersBtn.click();
		const dialog = page.getByRole('dialog', { name: 'Filters' });
		await expect(dialog.getByLabel('Kind')).toBeVisible();

		await page.keyboard.press('Escape');
		await expect(dialog.getByLabel('Kind')).not.toBeVisible();
	});
});

test.describe('transactions filter (desktop)', () => {
	test('filters render inline, not in a sheet', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Transactions', exact: true }).click();
		const filtersBtn = page.getByRole('button', { name: /Filters/ });
		await filtersBtn.click();

		// On desktop, filter selects should be visible inline (not in a sheet).
		// Scope to the inline container (hidden md:block) to avoid matching the
		// dialog's duplicate filter selects that also exist in the DOM.
		const inlineFilters = page.locator('.hidden.md\\:block');
		await expect(inlineFilters.getByLabel('Kind')).toBeVisible();

		// Scrim overlay is CSS-hidden on desktop (md:hidden) — not visible.
		await expect(page.locator('.fixed.inset-0.z-40')).not.toBeVisible();
	});
});
