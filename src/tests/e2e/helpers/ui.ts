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
	// Wait for the Svelte app to hydrate and sql.js WASM to finish initializing
	// before interacting — prevents race-condition timeouts under parallel workers.
	// 60s: WASM init + Svelte hydration under parallel CI workers can exceed the
	// default 30s, especially on the first test that cold-loads the WASM binary.
	await page.getByRole('radiogroup').first().waitFor({ timeout: 60_000 });

	// Step 1: language
	await page.getByRole('radio', { name: lang }).click();
	await page.getByRole('button', { name: 'Continue →' }).click();

	// Step 2: currency
	await page.getByRole('radio', { name: currency }).click();
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
 * `payee` and `tag` are optional: `payee` fills the Payee autocomplete (free-text),
 * `tag` fills the Tag autocomplete (id-mode, selects by name).
 * The modal is scoped via getByRole('dialog') to isolate the controls.
 */
export async function addTransaction(
	page: Page,
	opts: { kind: 'expense' | 'income' | 'transfer' | 'refund' | 'adjustment'; amount: string; payee?: string; tag?: string }
): Promise<void> {
	// The FAB ("Add transaction (N)") and the empty-state springboard CTA
	// ("Add transaction") both match this name. Disambiguate to the first in
	// DOM order so strict mode doesn't throw "resolved to 2 elements".
	await page.getByRole('button', { name: 'Add transaction' }).first().click();
	const modal = page.getByRole('dialog');
	await expect(modal.getByRole('heading', { name: 'Add transaction' })).toBeVisible();
	// Transfer/refund/adjustment are advanced kinds behind the "More" toggle
	// (TransactionForm progressive disclosure).
	if (opts.kind !== 'expense' && opts.kind !== 'income') {
		await modal.getByRole('button', { name: 'More' }).click();
	}
	await modal.getByRole('button', { name: capitalize(opts.kind), exact: true }).click();

	// Fill payee first (triggers auto-fill if a rule exists)
	if (opts.payee) {
		await modal.getByLabel('Payee').fill(opts.payee);
	}

	// Tag — explicitly select, overriding any auto-fill. The Tag Autocomplete
	// is id-mode (allowFreeText=false), so fill typed text → click the matching option.
	if (opts.tag) {
		const tagCombo = modal.getByLabel('Tag');
		await tagCombo.fill(opts.tag);
		const option = page.getByRole('option', { name: opts.tag });
		await expect(option).toBeVisible();
		await option.click();
	}

	await modal.getByLabel('Amount').fill(opts.amount);
	await modal.getByRole('button', { name: 'Save' }).click();
}

function capitalize(s: string): string {
	return s.charAt(0).toUpperCase() + s.slice(1);
}
