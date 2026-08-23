import { test, expect } from '@playwright/test';
import { onboard, expectOnDashboard, addTransaction } from './helpers/ui';

test('onboarding → dashboard → add transaction', async ({ page }) => {
	await onboard(page);
	await addTransaction(page, { kind: 'expense', amount: '50k' });
	await expect(page.getByText(/Saved · expense ·/)).toBeVisible();
	await page.getByRole('link', { name: 'Transactions' }).click();
	await expect(page.getByRole('main').getByText('−₫50,000')).toBeVisible();
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

test('currency step: flags render as designed dies, not inline glyphs', async ({ page }) => {
	// Each flag now lives in its own stamped die (onboarding/+page.svelte:33-34)
	// rather than a trailing glyph in the row's text. The code + name still form
	// the button's accessible name, so both selection-by-name paths keep working.
	await page.goto('/');
	await page.getByRole('button', { name: /^English/ }).click();
	await page.getByRole('button', { name: 'Continue →' }).click();
	// The flag is its own exact-text element inside the row.
	await expect(page.getByText('🇻🇳', { exact: true })).toBeVisible();
	await expect(page.getByText('🇺🇸', { exact: true })).toBeVisible();
	// Accessible names preserved.
	await expect(page.getByRole('button', { name: /VND — Vietnamese đồng/ })).toBeVisible();
	await expect(page.getByRole('button', { name: /USD — US Dollar/ })).toBeVisible();
});
