import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Run the 3-step onboarding flow. Defaults match the original onboarding spec.
 * Leaves the app on the Dashboard. Called by the onboardedPage fixture AND by
 * the onboarding.spec.ts happy path so the setup itself stays under test.
 */
export async function onboard(
	page: Page,
	opts: { lang?: RegExp; currency?: RegExp; accountName?: string } = {}
): Promise<void> {
	const lang = opts.lang ?? /^English/;
	const currency = opts.currency ?? /VND — Vietnamese đồng/;
	const accountName = opts.accountName ?? 'Test Checking';

	await page.goto('/');

	// Step 1: language
	await page.getByRole('button', { name: lang }).click();
	await page.getByRole('button', { name: 'Continue →' }).click();

	// Step 2: currency
	await page.getByRole('button', { name: currency }).click();
	await page.getByRole('button', { name: 'Continue →' }).click();

	// Step 3: first account (Finish disabled until a name is entered)
	await page.getByLabel('Name').fill(accountName);
	await page.getByRole('button', { name: 'Finish setup' }).click();

	await expectOnDashboard(page);
}

export async function expectOnDashboard(page: Page): Promise<void> {
	await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}

/**
 * Add a transaction via the dashboard FAB + modal. `amount` is the raw string
 * typed into the Amount field — pass '50k' to exercise parseAmount's shortcut.
 * The modal is scoped via getByRole('dialog') because the dashboard also has an
 * inline quick form with its own Amount/Save controls.
 */
export async function addTransaction(
	page: Page,
	opts: { kind: 'expense' | 'income' | 'transfer'; amount: string }
): Promise<void> {
	await page.getByRole('button', { name: 'Add transaction' }).click();
	const modal = page.getByRole('dialog');
	await expect(modal.getByRole('heading', { name: 'Add transaction' })).toBeVisible();
	await modal.getByRole('button', { name: opts.kind === 'transfer' ? 'Transfer' : capitalize(opts.kind), exact: true }).click();
	await modal.getByLabel('Amount').fill(opts.amount);
	await modal.getByRole('button', { name: 'Save' }).click();
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
