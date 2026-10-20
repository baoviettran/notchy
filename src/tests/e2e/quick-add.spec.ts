import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';
import { formatCurrencyCompact } from '../../lib/utils/currency';

// Quick Add is a separate window and must wait for a selected, set-up profile.
test.describe('quick-add', () => {
	test('asks the user to open the main window when no profile exists', async ({ page }) => {
		await page.goto('/quick-add');
		await expect(page.locator('#qa-input')).toBeDisabled();
		await expect(page.getByText('Choose or finish setting up a profile in the main window.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Open main window' })).toBeVisible();
	});
});

test.describe('quick-add account switch', () => {
	test('account-switch tape shows the active account balance', async ({ onboardedPage: page }) => {
		// Seed a known non-zero balance through the dashboard helper (income
		// 20k → balance 20,000). '20k' exercises parseAmount's k-expansion.
		await addTransaction(page, { kind: 'income', amount: '20k', payee: 'salary' });

		// Client-side navigation preserves the volatile sql.js DB (see
		// tray-quick-capture.spec.ts). The quick-add route reads the account
		// list on mount, so the balance must appear in the account-switch tape.
		await page.evaluate((href) => {
			const a = document.createElement('a');
			a.href = href;
			a.id = 'test-client-nav';
			document.body.appendChild(a);
			a.click();
			a.remove();
		}, '/quick-add');

		const input = page.locator('#qa-input');
		// The input is disabled until onMount finishes (DB init + account load).
		await expect(input).toBeEnabled();

		// Compute the expected compact string with the real formatter so the
		// assertion tracks ICU/locale output rather than a hardcoded glyph.
		const expected = formatCurrencyCompact(20000, 'VND', 'en');
		await expect(page.locator('.account-switch')).toContainText(expected);
	});
});
