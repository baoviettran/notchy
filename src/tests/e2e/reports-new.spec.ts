import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';

// E2E tests for the 4 new time-series report pages added in the reporting-depth plan:
// - Net Worth (/reports/net-worth)         — Compare group
// - Category Trend (/reports/category)     — Breakdown group
// - Composition (/reports/composition)     — Breakdown group
// - Year Over Year (/reports/yoy)          — Flow group
//
// ReportsNav uses grouped tabs. Each report requires clicking the appropriate
// group tab before the sub-item link is visible.

/** Click a ReportsNav group tab by its label. */
async function clickGroupTab(page: import('@playwright/test').Page, name: string) {
	await page.getByRole('tab', { name, exact: true }).click();
}

test.describe('new reports - time series', () => {
	test('net worth page renders with controls', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await clickGroupTab(page, 'Compare');
		await page.getByRole('link', { name: 'Net Worth', exact: true }).first().click();

		const main = page.getByRole('main');
		await expect(main.getByRole('heading', { name: 'Net Worth Over Time' })).toBeVisible();

		await expect(main.getByRole('button', { name: '6 months' })).toBeVisible();
		await expect(main.getByRole('button', { name: '12 months' })).toBeVisible();
		await expect(main.getByRole('button', { name: '24 months' })).toBeVisible();
		await expect(main.getByText('Include adjustments')).toBeVisible();
		await expect(main.getByText('NaN')).toHaveCount(0);
	});

	test('category trend page renders with tag picker', async ({ onboardedPage: page }) => {
		await addTransaction(page, { kind: 'expense', amount: '50k' });

		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await clickGroupTab(page, 'Breakdown');
		await page.getByRole('link', { name: 'Tag Trend', exact: true }).first().click();

		const main = page.getByRole('main');
		const select = main.locator('select').first();
		await expect(select).toBeVisible();
		await expect(main.getByRole('button', { name: '6 months' })).toBeVisible();
		await expect(main.getByText('NaN')).toHaveCount(0);
	});

	test('composition page renders stacked chart', async ({ onboardedPage: page }) => {
		await addTransaction(page, { kind: 'expense', amount: '30k' });
		await addTransaction(page, { kind: 'expense', amount: '20k' });

		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await clickGroupTab(page, 'Breakdown');
		await page.getByRole('link', { name: 'Composition', exact: true }).first().click();

		const main = page.getByRole('main');
		await expect(main.getByRole('button', { name: '6 months' })).toBeVisible();
		await expect(main.getByRole('button', { name: '12 months' })).toBeVisible();
		await expect(main.getByText('Include adjustments')).toBeVisible();
		await expect(main.getByText('NaN')).toHaveCount(0);
	});

	test('year-over-year page renders with year pickers', async ({ onboardedPage: page }) => {
		await addTransaction(page, { kind: 'expense', amount: '50k' });

		// YoY is in the Flow group — visible on overview without clicking a group tab.
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Year Over Year', exact: true }).first().click();

		const main = page.getByRole('main');
		const yearInputs = main.locator('input[type="number"]');
		await expect(yearInputs).toHaveCount(2);
		await expect(yearInputs.nth(0)).toBeVisible();
		await expect(yearInputs.nth(1)).toBeVisible();
		await expect(main.getByText('NaN')).toHaveCount(0);
	});

	test('window selector buttons work on net worth page', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await clickGroupTab(page, 'Compare');
		await page.getByRole('link', { name: 'Net Worth', exact: true }).first().click();

		const main = page.getByRole('main');
		await expect(main.getByRole('heading', { name: 'Net Worth Over Time' })).toBeVisible();

		await main.getByRole('button', { name: '12 months' }).click();
		await expect(main.getByRole('heading', { name: 'Net Worth Over Time' })).toBeVisible();

		await main.getByRole('button', { name: '24 months' }).click();
		await expect(main.getByRole('heading', { name: 'Net Worth Over Time' })).toBeVisible();
		await expect(main.getByText('NaN')).toHaveCount(0);
	});

	test('net worth page shows empty state when no data', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await clickGroupTab(page, 'Compare');
		await page.getByRole('link', { name: 'Net Worth', exact: true }).first().click();

		const main = page.getByRole('main');
		await expect(main.getByText('No transactions yet')).toBeVisible();
		await expect(main.locator('svg')).not.toBeVisible();
	});

	test('composition page shows empty state when no data', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await clickGroupTab(page, 'Breakdown');
		await page.getByRole('link', { name: 'Composition', exact: true }).first().click();

		const main = page.getByRole('main');
		await expect(main.getByText('No expenses yet')).toBeVisible();
		await expect(main.locator('svg')).not.toBeVisible();
	});

	test('year-over-year page shows empty state when no data', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Year Over Year', exact: true }).first().click();

		const main = page.getByRole('main');
		await expect(main.getByText('No data for selected years')).toBeVisible();
		await expect(main.locator('svg')).not.toBeVisible();
	});
});
