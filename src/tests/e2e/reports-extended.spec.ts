import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';

// Extended report coverage for the AUTO-tagged checklist items in §8.
// Conventions match reports.spec.ts: SPA navigation only, comments cite source
// lines + i18n keys, VND formats with no fraction digits (currency.ts).
//
// Verified against:
//  - src/routes/reports/+page.svelte (overview): scoped to the CURRENT month
//    only (currentMonth(), line 25-28) — there is NO date-range selector, only
//    an "Include adjustments" checkbox (line 50). Summary tiles: income /
//    expenses / net cash flow (lines 56-67). Empty state: reports_empty
//    (line 115) when no spending-by-bucket AND no top-transactions.
//  - src/routes/reports/trend/+page.svelte: month-count buttons 6/12/24
//    (lines 37-41, reports_months = "{count} months"); bars sized by
//    height:% guarded by Math.max(...,1) (line 22) — no div-by-zero; empty
//    state reports_trend_empty (line 82).
//  - src/routes/reports/compare/+page.svelte: two type="month" inputs (monthA,
//    monthB, lines 46/48); NO ordering validation — both months render with a
//    computed change delta regardless of which is earlier; empty state
//    reports_compare_empty (line 85).
//
// Realistic deviations from the checklist wording:
//  - "Change the date range / period selector on each report": overview has NO
//    range selector (current-month only). Trend has the 6/12/24-month buttons;
//    compare has two month inputs. We test the selectors that exist.
//  - "Invalid range (end before start)": compare does NOT block this — it just
//    computes a delta. We assert it renders without crashing (no malformed
//    chart) rather than asserting a validation error.
//  - Reports are read-only views; tests must seed transactions first.

test.describe('reports — extended', () => {
	test('overview reflects current-month income, expenses, and net cash flow', async ({ onboardedPage: page }) => {
		// Seed a 100k expense and a 200k income in the current month.
		await addTransaction(page, { kind: 'expense', amount: '100k' });
		await addTransaction(page, { kind: 'income', amount: '200k' });
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		const main = page.getByRole('main');
		// Three summary tiles (reports/+page.svelte:56-67). Assert the tile
		// labels + currency values. "Income" also appears elsewhere, so scope
		// each label to its tile paragraph.
		await expect(main.getByText('Income', { exact: true }).first()).toBeVisible();
		await expect(main.getByText('Expenses', { exact: true }).first()).toBeVisible();
		await expect(main.getByText('Net Cash Flow', { exact: true })).toBeVisible();
		// Income tile value ₫200,000; the ₫100,000 expense also appears in net
		// cash flow + top-transactions, so just assert presence.
		await expect(main.getByText('₫200,000', { exact: true }).first()).toBeVisible();
		await expect(main.getByText('₫100,000', { exact: true }).first()).toBeVisible();
	});

	test('overview empty state shows the no-data prompt', async ({ onboardedPage: page }) => {
		// Fresh onboarding → no transactions → overview empty state.
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		// reports/+page.svelte:115 reports_empty.
		await expect(page.getByRole('main').getByText('No data for this month. Add transactions to see reports.')).toBeVisible();
	});

	test('trend month-count selector (6/12/24) switches the view without error', async ({ onboardedPage: page }) => {
		// Seed a transaction so trend has data.
		await addTransaction(page, { kind: 'expense', amount: '50k' });
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Trend', exact: true }).click();
		const main = page.getByRole('main');
		// The three month-count buttons (reports_months → "6 months" etc.).
		await expect(main.getByRole('button', { name: '6 months' })).toBeVisible();
		await expect(main.getByRole('button', { name: '12 months' })).toBeVisible();
		await expect(main.getByRole('button', { name: '24 months' })).toBeVisible();
		// Switch to 12 months — the data table renders the current month with
		// the ₫50,000 expense (the table at trend/+page.svelte:68-79 lists each
		// month). Asserting the table value avoids the legend-label ambiguity.
		await main.getByRole('button', { name: '12 months' }).click();
		await expect(main.getByText('₫50,000', { exact: true }).first()).toBeVisible();
		// No NaN leaked from the chart math.
		await expect(main.getByText('NaN')).toHaveCount(0);
	});

	test('trend empty state shows the no-data prompt', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Trend', exact: true }).click();
		// trend/+page.svelte:82 reports_trend_empty.
		await expect(page.getByRole('main').getByText('No trend data yet. Add transactions across multiple months.')).toBeVisible();
	});

	test('compare renders the two selected months with a change column', async ({ onboardedPage: page }) => {
		// Seed a current-month expense so compare has data.
		await addTransaction(page, { kind: 'expense', amount: '50k' });
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('tab', { name: 'Compare', exact: true }).click();
		await page.getByRole('link', { name: 'Compare', exact: true }).click();
		const main = page.getByRole('main');
		// Two month inputs + a table with Category / monthA / monthB / Change.
		await expect(main.getByText('vs')).toBeVisible();
		await expect(main.getByText('Change')).toBeVisible();
		await expect(main.locator('thead').getByText('Tag', { exact: true })).toBeVisible();
	});

	test('compare with months in reverse order renders without crashing', async ({ onboardedPage: page }) => {
		// "Invalid range" — monthA later than monthB. compare/+page.svelte does
		// NOT validate ordering; it computes a delta either way. Seed an expense
		// in the current month, then set monthA = current, monthB = previous so
		// the table has data and we exercise the reverse-order delta path.
		await addTransaction(page, { kind: 'expense', amount: '50k' });
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('tab', { name: 'Compare', exact: true }).click();
		await page.getByRole('link', { name: 'Compare', exact: true }).click();
		const main = page.getByRole('main');
		// Defaults: monthA = previous month, monthB = current month. Swap them
		// so monthA is LATER than monthB (reverse range).
		const inputs = main.locator('input[type="month"]');
		const a = await inputs.nth(0).inputValue();
		const b = await inputs.nth(1).inputValue();
		await inputs.nth(0).fill(b); // later (current) into monthA
		await inputs.nth(1).fill(a); // earlier (previous) into monthB
		// The "vs" label and Change column still render — no crash, no NaN text.
		await expect(main.getByText('vs')).toBeVisible();
		await expect(main.getByRole('heading', { name: 'Compare' })).toBeVisible();
		await expect(main.getByText('NaN')).toHaveCount(0);
	});

	test('compare empty state shows the no-data prompt', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('tab', { name: 'Compare', exact: true }).click();
		await page.getByRole('link', { name: 'Compare', exact: true }).click();
		// compare/+page.svelte:85 reports_compare_empty.
		await expect(page.getByRole('main').getByText('No comparison data. Add expenses in both months to compare.')).toBeVisible();
	});

	test('single-transaction range renders without div-by-zero artifacts', async ({ onboardedPage: page }) => {
		// One expense — the trend chart's maxValue is guarded by Math.max(...,1)
		// (trend/+page.svelte:22), so a single point can't cause a div-by-zero.
		// Assert the data table renders the amount and no NaN leaks.
		await addTransaction(page, { kind: 'expense', amount: '50k' });
		await page.getByRole('link', { name: 'Reports', exact: true }).click();
		await page.getByRole('link', { name: 'Trend', exact: true }).click();
		const main = page.getByRole('main');
		await expect(main.getByText('₫50,000', { exact: true }).first()).toBeVisible();
		await expect(main.getByText('NaN')).toHaveCount(0);
	});
});
