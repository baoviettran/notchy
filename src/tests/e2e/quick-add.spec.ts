import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';
import { formatCurrencyCompact } from '../../lib/utils/currency';

// Quick-add window has its own test surface: it skips dbStore.init() and
// manages its own DB connection via getDb(). The layout.svelte detects
// /quick-add and renders it without the sidebar/chrome.

test.describe('quick-add', () => {
	test('shows a hint when no accounts exist', async ({ page }) => {
		// Navigate directly to /quick-add without onboarding — the layout
		// skips dbStore.init() for quick-add URLs, so no redirect to
		// /onboarding occurs. The in-memory sql.js DB starts empty.
		await page.goto('/quick-add');
		await page.waitForSelector('#qa-input');
		// With no accounts, activeAccount is null → input disabled.
		await expect(page.locator('#qa-input')).toBeDisabled();
		// The hint must be visible, guiding the user to create an account.
		const hint = page.locator('#qa-hint');
		await expect(hint).toBeVisible();
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
