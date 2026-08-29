import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';

// NOTE on navigation: in-browser tests run against the in-memory sql.js DB
// (src/lib/db/index.ts), which is NOT persisted across a full page reload.
// page.goto() would reload the page, wipe the in-memory DB, and re-trigger
// onboarding. So navigation uses SPA (client-side) link clicks.
//
// The rules engine stores learned rules in the categorize_rules table. Rules
// are learned on save via transactions.learnRule() which checks the last 50
// transactions for 3 consistent (same payee + same tag) entries.
// matchTag() is a $derived rune on the TransactionForm payee field that calls
// rules_matcher.matchRules() against the active rules.

test.describe('Categorize Rules Engine', () => {
	test('auto-fills tag after 3 consistent transactions', async ({ onboardedPage: page }) => {
		// First create a "Food" tag via Settings > Categories. SPA navigate to
		// /settings/categories.
		await page.getByRole('link', { name: 'Settings', exact: true }).click();
		await page.getByRole('link', { name: /Categories/ }).first().click();
		await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();

		await page.getByRole('button', { name: '+ Add tag' }).click();
		let modal = page.getByRole('dialog');
		await modal.getByLabel('Name').fill('Food');
		await modal.getByRole('button', { name: 'Create' }).click();
		await expect(page.getByText('Food')).toBeVisible();

		// SPA navigate back to Dashboard.
		await page.getByRole('link', { name: 'Dashboard', exact: true }).click();

		// Create 3 transactions with same payee + Food tag.
		for (let i = 0; i < 3; i++) {
			await addTransaction(page, { kind: 'expense', amount: '50k', payee: 'starbucks', tag: 'Food' });
		}

		// Create 4th transaction — tag should auto-fill when payee is entered.
		await page.getByRole('button', { name: 'Add transaction' }).first().click();
		const txModal = page.getByRole('dialog');
		await txModal.getByLabel('Payee').fill('starbucks');

		// Wait for the $effect that sets tagId from suggestedTag.
		// The $effect runs synchronously after payee changes trigger the
		// derived rune (suggestedTag), but we wait briefly for reactivity.
		await page.waitForTimeout(600);

		// Verify tag is auto-filled. The Tag field is an Autocomplete (combobox)
		// in id-mode — when a value is selected, the input shows the tag's label.
		// We check the input value attribute.
		const tagInput = txModal.getByLabel('Tag');
		await expect(tagInput).toHaveValue('Food');
	});

	test('auto-fills tag with Vietnamese diacritic variant', async ({ onboardedPage: page }) => {
		// Create a "Food" tag.
		await page.getByRole('link', { name: 'Settings', exact: true }).click();
		await page.getByRole('link', { name: /Categories/ }).first().click();
		await expect(page.getByRole('heading', { name: 'Categories', exact: true })).toBeVisible();

		await page.getByRole('button', { name: '+ Add tag' }).click();
		let modal = page.getByRole('dialog');
		await modal.getByLabel('Name').fill('Food');
		await modal.getByRole('button', { name: 'Create' }).click();
		await expect(page.getByText('Food')).toBeVisible();

		// SPA navigate back to Dashboard.
		await page.getByRole('link', { name: 'Dashboard', exact: true }).click();

		// Create 3 transactions with diacritic variants of the same payee.
		await addTransaction(page, { kind: 'expense', amount: '50k', payee: 'cà phê', tag: 'Food' });
		await addTransaction(page, { kind: 'expense', amount: '50k', payee: 'ca phe', tag: 'Food' });
		await addTransaction(page, { kind: 'expense', amount: '50k', payee: 'CÀ PHÊ', tag: 'Food' });

		// Create 4th transaction with normalized form — tag should auto-fill.
		await page.getByRole('button', { name: 'Add transaction' }).first().click();
		const txModal = page.getByRole('dialog');
		await txModal.getByLabel('Payee').fill('ca phe');

		// Wait for the $effect to propagate.
		await page.waitForTimeout(600);

		// Verify tag is auto-filled.
		const tagInput = txModal.getByLabel('Tag');
		await expect(tagInput).toHaveValue('Food');
	});
});
