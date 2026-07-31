import { test, expect } from './fixtures/onboarded';

// Task 16: Navigation updates for new time-series reports
// Tests verify that:
// 1. Overview page has navigation cards for the 4 new reports in the main content
// 2. All report pages (overview, trend, compare) have all 7 tabs in the header nav

test.describe('reports navigation — all 7 reports', () => {
	test('overview page displays navigation cards for the 4 new reports', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		const main = page.getByRole('main');

		// The 4 new report navigation cards should be visible in the main content
		await expect(main.getByRole('link', { name: 'Net Worth' }).first()).toBeVisible();
		await expect(main.getByRole('link', { name: 'Category Trend' }).first()).toBeVisible();
		await expect(main.getByRole('link', { name: 'Composition' }).first()).toBeVisible();
		await expect(main.getByRole('link', { name: 'Year Over Year' }).first()).toBeVisible();
	});

	test('overview page navigation cards link to correct routes', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		const main = page.getByRole('main');

		// Click each navigation card and verify it navigates to the correct route
		await main.getByRole('link', { name: 'Net Worth' }).first().click();
		await expect(page).toHaveURL(/\/reports\/net-worth$/);

		await page.goBack();
		await main.getByRole('link', { name: 'Category Trend' }).first().click();
		await expect(page).toHaveURL(/\/reports\/category$/);

		await page.goBack();
		await main.getByRole('link', { name: 'Composition' }).first().click();
		await expect(page).toHaveURL(/\/reports\/composition$/);

		await page.goBack();
		await main.getByRole('link', { name: 'Year Over Year' }).first().click();
		await expect(page).toHaveURL(/\/reports\/yoy$/);
	});

	test('overview page has all 7 tabs in header navigation', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();

		// All 7 tabs should be visible in the header navigation
		await expect(page.getByRole('link', { name: 'Overview' }).first()).toBeVisible();
		await expect(page.getByRole('link', { name: 'Trend', exact: true }).first()).toBeVisible();
		await expect(page.getByRole('link', { name: 'Compare', exact: true }).first()).toBeVisible();
		await expect(page.getByRole('link', { name: 'Net Worth' }).first()).toBeVisible();
		await expect(page.getByRole('link', { name: 'Category Trend' }).first()).toBeVisible();
		await expect(page.getByRole('link', { name: 'Composition' }).first()).toBeVisible();
		await expect(page.getByRole('link', { name: 'Year Over Year' }).first()).toBeVisible();
	});

	test('trend page has all 7 tabs in navigation', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Trend', exact: true }).click();
		const main = page.getByRole('main');

		// All 7 tabs should be visible in the navigation bar
		await expect(main.getByRole('link', { name: 'Overview' }).first()).toBeVisible();
		await expect(main.getByRole('link', { name: 'Trend', exact: true }).first()).toBeVisible();
		await expect(main.getByRole('link', { name: 'Compare', exact: true }).first()).toBeVisible();
		await expect(main.getByRole('link', { name: 'Net Worth' }).first()).toBeVisible();
		await expect(main.getByRole('link', { name: 'Category Trend' }).first()).toBeVisible();
		await expect(main.getByRole('link', { name: 'Composition' }).first()).toBeVisible();
		await expect(main.getByRole('link', { name: 'Year Over Year' }).first()).toBeVisible();
	});

	test('compare page has all 7 tabs in navigation', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Compare', exact: true }).click();
		const main = page.getByRole('main');

		// All 7 tabs should be visible in the navigation bar
		await expect(main.getByRole('link', { name: 'Overview' }).first()).toBeVisible();
		await expect(main.getByRole('link', { name: 'Trend', exact: true }).first()).toBeVisible();
		await expect(main.getByRole('link', { name: 'Compare', exact: true }).first()).toBeVisible();
		await expect(main.getByRole('link', { name: 'Net Worth' }).first()).toBeVisible();
		await expect(main.getByRole('link', { name: 'Category Trend' }).first()).toBeVisible();
		await expect(main.getByRole('link', { name: 'Composition' }).first()).toBeVisible();
		await expect(main.getByRole('link', { name: 'Year Over Year' }).first()).toBeVisible();
	});

	test('trend page navigation tabs link to correct routes', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Trend', exact: true }).click();
		const main = page.getByRole('main');

		// Click each new tab and verify navigation
		await main.getByRole('link', { name: 'Net Worth' }).first().click();
		await expect(page).toHaveURL(/\/reports\/net-worth$/);

		await page.goBack();
		await main.getByRole('link', { name: 'Category Trend' }).first().click();
		await expect(page).toHaveURL(/\/reports\/category$/);

		await page.goBack();
		await main.getByRole('link', { name: 'Composition' }).first().click();
		await expect(page).toHaveURL(/\/reports\/composition$/);

		await page.goBack();
		await main.getByRole('link', { name: 'Year Over Year' }).first().click();
		await expect(page).toHaveURL(/\/reports\/yoy$/);
	});

	test('compare page navigation tabs link to correct routes', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Compare', exact: true }).click();
		const main = page.getByRole('main');

		// Click each new tab and verify navigation
		await main.getByRole('link', { name: 'Net Worth' }).first().click();
		await expect(page).toHaveURL(/\/reports\/net-worth$/);

		await page.goBack();
		await main.getByRole('link', { name: 'Category Trend' }).first().click();
		await expect(page).toHaveURL(/\/reports\/category$/);

		await page.goBack();
		await main.getByRole('link', { name: 'Composition' }).first().click();
		await expect(page).toHaveURL(/\/reports\/composition$/);

		await page.goBack();
		await main.getByRole('link', { name: 'Year Over Year' }).first().click();
		await expect(page).toHaveURL(/\/reports\/yoy$/);
	});
});
