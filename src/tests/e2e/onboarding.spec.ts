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
