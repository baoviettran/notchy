import { test, expect } from './fixtures/onboarded';

test.describe('settings currency selector', () => {
	test('displays 5 currency options and allows changing', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Settings', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Settings' })).toBeVisible();

		// Currency section should be visible with 5 options.
		const currencyGroup = page.getByRole('radiogroup', { name: /Currency/ });
		await expect(currencyGroup).toBeVisible();
		await expect(currencyGroup.getByRole('radio', { name: 'VND' })).toBeVisible();
		await expect(currencyGroup.getByRole('radio', { name: 'USD' })).toBeVisible();
		await expect(currencyGroup.getByRole('radio', { name: 'EUR' })).toBeVisible();
		await expect(currencyGroup.getByRole('radio', { name: 'JPY' })).toBeVisible();
		await expect(currencyGroup.getByRole('radio', { name: 'THB' })).toBeVisible();

		// VND should be selected by default (onboarding default).
		await expect(currencyGroup.getByRole('radio', { name: 'VND' })).toHaveAttribute('aria-checked', 'true');

		// Change to USD.
		await currencyGroup.getByRole('radio', { name: 'USD' }).click();
		await expect(currencyGroup.getByRole('radio', { name: 'USD' })).toHaveAttribute('aria-checked', 'true');
		await expect(currencyGroup.getByRole('radio', { name: 'VND' })).toHaveAttribute('aria-checked', 'false');
	});
});

test.describe('onboarding currency options', () => {
	test('shows 5 currency choices', async ({ page }) => {
		await page.goto('/');
		// Step 1: language
		await page.getByRole('button', { name: /^English/ }).click();
		await page.getByRole('button', { name: 'Continue →' }).click();

		// Step 2: should show 5 currencies.
		await expect(page.getByRole('button', { name: /VND — Vietnamese đồng/ })).toBeVisible();
		await expect(page.getByRole('button', { name: /USD — US Dollar/ })).toBeVisible();
		await expect(page.getByRole('button', { name: /EUR — Euro/ })).toBeVisible();
		await expect(page.getByRole('button', { name: /JPY — Japanese Yen/ })).toBeVisible();
		await expect(page.getByRole('button', { name: /THB — Thai Baht/ })).toBeVisible();

		// Code plates should render.
		await expect(page.getByText('VN', { exact: true })).toBeVisible();
		await expect(page.getByText('US', { exact: true })).toBeVisible();
		await expect(page.getByText('EU', { exact: true })).toBeVisible();
		await expect(page.getByText('JP', { exact: true })).toBeVisible();
		await expect(page.getByText('TH', { exact: true })).toBeVisible();
	});
});
