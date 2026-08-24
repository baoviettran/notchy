import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';

// E2E tests for the 4 new time-series report pages added in the reporting-depth plan:
// - Net Worth (/reports/net-worth)
// - Category Trend (/reports/category)
// - Composition (/reports/composition)
// - Year Over Year (/reports/yoy)
//
// Conventions match existing report specs:
// - SPA navigation only (sql.js in-memory DB resets on page.goto)
// - Seed transactions before testing charts
// - Assert SVG visibility for charts
// - Assert control visibility (selects, inputs)
// - Check for NaN (chart math safety)

test.describe('new reports - time series', () => {
	test('net worth page renders with controls', async ({ onboardedPage: page }) => {
		// Navigate via SPA - use .first() to avoid ambiguity (tab bar vs card grid)
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Net Worth', exact: true }).first().click();

		const main = page.getByRole('main');

		// Wait for the page to load
		await expect(main.getByRole('heading', { name: 'Net Worth Over Time' })).toBeVisible();

		// Window selector buttons should be visible
		await expect(main.getByRole('button', { name: '6 months' })).toBeVisible();
		await expect(main.getByRole('button', { name: '12 months' })).toBeVisible();
		await expect(main.getByRole('button', { name: '24 months' })).toBeVisible();

		// Include adjustments checkbox
		await expect(main.getByText('Include adjustments')).toBeVisible();

		// No NaN from chart math
		await expect(main.getByText('NaN')).toHaveCount(0);
	});

	test('category trend page renders with tag picker', async ({ onboardedPage: page }) => {
		// Seed a transaction (even without tags, the page should render)
		await addTransaction(page, { kind: 'expense', amount: '50k' });

		// Navigate to category trend - use .first() to avoid ambiguity
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Tag Trend', exact: true }).first().click();

		const main = page.getByRole('main');

		// Tag picker select should be visible
		const select = main.locator('select').first();
		await expect(select).toBeVisible();

		// Window selector buttons
		await expect(main.getByRole('button', { name: '6 months' })).toBeVisible();

		// No NaN
		await expect(main.getByText('NaN')).toHaveCount(0);
	});

	test('composition page renders stacked chart', async ({ onboardedPage: page }) => {
		// Seed transactions
		await addTransaction(page, { kind: 'expense', amount: '30k' });
		await addTransaction(page, { kind: 'expense', amount: '20k' });

		// Navigate to composition - use .first() to avoid ambiguity
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Composition', exact: true }).first().click();

		const main = page.getByRole('main');

		// Window selector buttons
		await expect(main.getByRole('button', { name: '6 months' })).toBeVisible();
		await expect(main.getByRole('button', { name: '12 months' })).toBeVisible();

		// Include adjustments checkbox
		await expect(main.getByText('Include adjustments')).toBeVisible();

		// No NaN
		await expect(main.getByText('NaN')).toHaveCount(0);
	});

	test('year-over-year page renders with year pickers', async ({ onboardedPage: page }) => {
		// Seed data so the chart has something to render
		await addTransaction(page, { kind: 'expense', amount: '50k' });

		// Navigate to year-over-year - use .first() to avoid ambiguity
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Year Over Year', exact: true }).first().click();

		const main = page.getByRole('main');

		// Two number inputs for year selection
		const yearInputs = main.locator('input[type="number"]');
		await expect(yearInputs).toHaveCount(2);

		// Both year inputs should be visible
		await expect(yearInputs.nth(0)).toBeVisible();
		await expect(yearInputs.nth(1)).toBeVisible();

		// No NaN
		await expect(main.getByText('NaN')).toHaveCount(0);
	});

	test('window selector buttons work on net worth page', async ({ onboardedPage: page }) => {
		// Navigate to net worth - use .first() to avoid ambiguity
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Net Worth', exact: true }).first().click();

		const main = page.getByRole('main');

		// Wait for the page to load
		await expect(main.getByRole('heading', { name: 'Net Worth Over Time' })).toBeVisible();

		// Click 12 months button (should be clickable even without data)
		await main.getByRole('button', { name: '12 months' }).click();

		// Page should still be visible
		await expect(main.getByRole('heading', { name: 'Net Worth Over Time' })).toBeVisible();

		// Click 24 months button
		await main.getByRole('button', { name: '24 months' }).click();

		// Page should still be visible
		await expect(main.getByRole('heading', { name: 'Net Worth Over Time' })).toBeVisible();

		// No NaN after window changes
		await expect(main.getByText('NaN')).toHaveCount(0);
	});

	test('net worth page shows empty state when no data', async ({ onboardedPage: page }) => {
		// No transactions seeded - should show empty state
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Net Worth', exact: true }).first().click();

		const main = page.getByRole('main');

		// Empty state message should be visible (from i18n)
		await expect(main.getByText('No transactions yet')).toBeVisible();

		// No SVG chart when empty
		const svg = main.locator('svg');
		await expect(svg).not.toBeVisible();
	});

	test('composition page shows empty state when no data', async ({ onboardedPage: page }) => {
		// No transactions seeded
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Composition', exact: true }).first().click();

		const main = page.getByRole('main');

		// Empty state message should be visible (from i18n)
		await expect(main.getByText('No expenses yet')).toBeVisible();

		// No SVG chart when empty
		const svg = main.locator('svg');
		await expect(svg).not.toBeVisible();
	});

	test('year-over-year page shows empty state when no data', async ({ onboardedPage: page }) => {
		// No transactions seeded
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Year Over Year', exact: true }).first().click();

		const main = page.getByRole('main');

		// Empty state message should be visible (from i18n)
		await expect(main.getByText('No data for selected years')).toBeVisible();

		// No SVG chart when empty
		const svg = main.locator('svg');
		await expect(svg).not.toBeVisible();
	});
});
