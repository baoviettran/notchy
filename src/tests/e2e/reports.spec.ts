import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';

// NOTE on navigation: in-browser tests run against the in-memory sql.js DB
// (src/lib/db/index.ts), which is NOT persisted across a full page reload.
// page.goto() would reload the page, wipe the in-memory DB, and re-trigger
// onboarding. So every navigation here uses SPA (client-side) link clicks,
// which keep the same in-memory DB alive for the whole test.

// Verified against src/lib/components/layout/ReportsNav.svelte:
//  - The sidebar exposes a "Reports" link (m.nav_reports).
//  - ReportsNav uses 3 grouped tabs ("Flow", "Breakdown", "Compare") with
//    sub-items visible per active group. The reports overview page heading
//    is "Overview" (m.reports_overview).

test('reports sub-pages load with no console errors', async ({ onboardedPage: page }) => {
	const errors: string[] = [];
	page.on('console', (msg) => {
		if (msg.type() === 'error') errors.push(msg.text());
	});

	// Seed data so the reports have something to render (SPA nav only).
	await addTransaction(page, { kind: 'expense', amount: '50k' });

	// Navigate to /reports via the sidebar (SPA — keeps the DB alive).
	await page.getByRole('link', { name: 'Reports', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();
	await expect(page.getByRole('main')).toBeVisible();

	// Trend is a sub-item of the Flow group (visible on overview).
	await page.getByRole('link', { name: 'Trend', exact: true }).click();
	await expect(page.getByRole('main')).toBeVisible();

	// Compare is a group tab — click it to switch to the Compare group.
	await page.getByRole('tab', { name: 'Compare', exact: true }).click();
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
	await expect(page.getByRole('heading', { name: 'Overview', exact: true })).toBeVisible();

	// Net = 25,000,000 − 50,000 = 24,950,000. If the contract drifts again,
	// this figure never appears (the page sticks on its skeleton).
	const statement = page.getByLabel(/net cash flow/i);
	await expect(statement).toBeVisible();
	await expect(statement.getByText('24,950,000')).toHaveCount(1);
});
