import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';

// NOTE on navigation: in-browser tests run against the in-memory sql.js DB
// (src/lib/db/index.ts), which is NOT persisted across a full page reload.
// page.goto() would reload the page, wipe the in-memory DB, and re-trigger
// onboarding. So every navigation here uses SPA (client-side) link clicks,
// which keep the same in-memory DB alive for the whole test.

// Verified against src/routes/reports/+page.svelte and the root layout:
//  - The sidebar exposes a "Reports" link (m.nav_reports).
//  - The reports index page renders in-page tab links labelled "Overview",
//    "Trend", "Compare" (+page.svelte:38-40).
//  - The root layout wraps every route's children in a <main> element
//    (+layout.svelte:56), so getByRole('main') is a reliable "mounted"
//    signal for each report route.

test('reports sub-pages load with no console errors', async ({ onboardedPage: page }) => {
	const errors: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});

	// Seed data so the reports have something to render (SPA nav only).
	await addTransaction(page, { kind: 'expense', amount: '50k' });

	// Navigate to /reports via the sidebar (SPA — keeps the DB alive).
	await page.getByRole('link', { name: 'Reports', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();
	await expect(page.getByRole('main')).toBeVisible();

	// Trend + Compare are reachable as in-page tab links on /reports.
	await page.getByRole('link', { name: 'Trend', exact: true }).click();
	await expect(page.getByRole('main')).toBeVisible();

	await page.getByRole('link', { name: 'Compare', exact: true }).click();
	await expect(page.getByRole('main')).toBeVisible();

	expect(errors).toEqual([]);
});

// Regression: the overview statement must render actual figures once the
// report resolves. The native/frontend OverviewReport contract once drifted
// (Rust returned income/net; the UI read total_income/net_cash_flow), which
// left this page on its skeleton forever — visibility assertions alone passed
// while the page was dead. Assert the numbers, not just the chrome.
test('overview statement renders real figures after the report loads', async ({ onboardedPage: page }) => {
	await addTransaction(page, { kind: 'income', amount: '25tr' });
	await addTransaction(page, { kind: 'expense', amount: '50k' });

	await page.getByRole('link', { name: 'Reports', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Reports', exact: true })).toBeVisible();

	// Net = 25,000,000 − 50,000 = 24,950,000. If the contract drifts again,
	// this figure never appears (the page sticks on its skeleton).
	const statement = page.getByLabel(/net cash flow/i);
	await expect(statement).toBeVisible();
	await expect(statement.getByText('24,950,000')).toHaveCount(1);
});
