import { test, expect } from './fixtures/onboarded';

// ReportsNav (src/lib/components/layout/ReportsNav.svelte) uses grouped links:
//   Flow:      Overview, Trend, Year Over Year
//   Breakdown: Tag Trend, Composition
//   Compare:   Compare, Net Worth
//
// Only the active group's sub-items are visible. Group headers and sub-items are
// all <a> links (the active group link carries aria-current="page", not a tab
// widget), so locators use getByRole('link').

/** Click a ReportsNav group link by its label. */
async function clickGroupTab(page: import('@playwright/test').Page, name: string) {
	await page.getByRole('link', { name, exact: true }).click();
}

test.describe('reports navigation — grouped tab structure', () => {
	test('overview page shows Flow group tabs and sub-items', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();

		// All 3 group tabs should be visible.
		await expect(page.getByRole('link', { name: 'Flow', exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Breakdown', exact: true })).toBeVisible();
		await expect(page.getByRole('link', { name: 'Compare', exact: true })).toBeVisible();

		// Flow sub-items visible (active group on /reports).
		await expect(page.getByRole('link', { name: 'Overview' }).first()).toBeVisible();
		await expect(page.getByRole('link', { name: 'Trend', exact: true }).first()).toBeVisible();
		await expect(page.getByRole('link', { name: 'Year Over Year' }).first()).toBeVisible();
	});

	test('clicking Breakdown tab shows its sub-items', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await clickGroupTab(page, 'Breakdown');

		await expect(page.getByRole('link', { name: 'Tag Trend' }).first()).toBeVisible();
		await expect(page.getByRole('link', { name: 'Composition' }).first()).toBeVisible();
	});

	test('clicking Compare tab shows its sub-items', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await clickGroupTab(page, 'Compare');

		await expect(page.getByRole('link', { name: 'Compare', exact: true }).first()).toBeVisible();
		await expect(page.getByRole('link', { name: 'Net Worth' }).first()).toBeVisible();
	});

	test('Flow sub-items link to correct routes', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();

		await page.getByRole('link', { name: 'Trend', exact: true }).first().click();
		await expect(page).toHaveURL(/\/reports\/trend$/);

		await page.goBack();
		await page.getByRole('link', { name: 'Year Over Year' }).first().click();
		await expect(page).toHaveURL(/\/reports\/yoy$/);
	});

	test('Breakdown sub-items link to correct routes', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await clickGroupTab(page, 'Breakdown');

		await page.getByRole('link', { name: 'Tag Trend' }).first().click();
		await expect(page).toHaveURL(/\/reports\/category$/);

		await page.goBack();
		await clickGroupTab(page, 'Breakdown');
		await page.getByRole('link', { name: 'Composition' }).first().click();
		await expect(page).toHaveURL(/\/reports\/composition$/);
	});

	test('Compare sub-items link to correct routes', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await clickGroupTab(page, 'Compare');

		await page.getByRole('link', { name: 'Net Worth' }).first().click();
		await expect(page).toHaveURL(/\/reports\/net-worth$/);

		await page.goBack();
		await clickGroupTab(page, 'Compare');
		await page.getByRole('link', { name: 'Compare', exact: true }).first().click();
		await expect(page).toHaveURL(/\/reports\/compare$/);
	});

	test('trend page keeps Flow group active with sub-items', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Trend', exact: true }).click();

		// Flow tab should be active; sub-items still visible.
		await expect(page.getByRole('link', { name: 'Flow', exact: true })).toHaveAttribute('aria-current', 'page');
		await expect(page.getByRole('link', { name: 'Overview' }).first()).toBeVisible();
		await expect(page.getByRole('link', { name: 'Year Over Year' }).first()).toBeVisible();
	});

	test('compare page keeps Compare group active with sub-items', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await clickGroupTab(page, 'Compare');
		await page.getByRole('link', { name: 'Compare', exact: true }).click();

		// Compare tab should be active; sub-items still visible.
		// The "Compare" sub-item link shares this name, so scope to the group tab.
		await expect(page.getByRole('link', { name: 'Compare', exact: true }).first()).toHaveAttribute('aria-current', 'page');
		await expect(page.getByRole('link', { name: 'Net Worth' }).first()).toBeVisible();
	});
});
