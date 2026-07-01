import { test, expect } from './fixtures/onboarded';
import type { Page } from '@playwright/test';

/**
 * Browser-reachable slice of tray quick-capture: the /quick-add route parses
 * shorthand, saves against the sql.js in-browser DB, and the saved row appears
 * in the main transaction list. The tray-icon click and OS global shortcut are
 * OS-level and not exercisable from Playwright — they are verified manually
 * (Task 10). The cross-window `transaction:saved` event is Tauri-only and a
 * no-op in-browser; navigating to /transactions re-runs loadPage, so the row
 * surfaces regardless.
 *
 * Why client-side navigation: the in-memory sql.js DB (in-memory.ts) is a
 * module-level singleton and is volatile — a full page.goto reload wipes
 * onboarding state, and the layout then redirects to /onboarding. SvelteKit
 * intercepts internal <a> clicks for client-side routing, which preserves the
 * module graph (and thus the DB) across the route change. There is no sidebar
 * link to /quick-add (it is a separate window in the real app), so we inject a
 * temporary anchor and click it. SvelteKit's click delegation is on document,
 * so dynamically-added anchors are handled.
 */
async function gotoClientSide(page: Page, href: string): Promise<void> {
	// SvelteKit's click delegation is on document and intercepts internal <a>
	// clicks for client-side routing, preserving the module graph (and thus the
	// volatile sql.js DB) across the route change. There is no sidebar link to
	// /quick-add (it is a separate window in the real app), so we inject a
	// temporary anchor and dispatch a synthetic click (the element is visually
	// hidden, so page.click's visibility checks would reject it).
	await page.evaluate((h) => {
		const a = document.createElement('a');
		a.href = h;
		a.id = 'test-client-nav';
		document.body.appendChild(a);
		a.click();
		a.remove();
	}, href);
}

test.describe('quick-add route', () => {
	test('saves an expense and it appears in the transaction list', async ({ onboardedPage: page }) => {
		// onboardedPage leaves us on / (Dashboard) with one account "Test Checking",
		// which is the quick-add default-account fallback (accounts[0]).
		await gotoClientSide(page, '/quick-add');

		const input = page.locator('#qa-input');
		await expect(input).toBeVisible();
		// The input is disabled until onMount finishes (dbStore.init + account load).
		await expect(input).toBeEnabled();

		await input.fill('50k coffee');
		await page.keyboard.press('Enter');

		// The save is async. Navigate client-side to /transactions (the quick-add
		// route has no sidebar; use the injected-anchor nav to preserve the volatile
		// sql.js DB), which runs loadPage() on mount and re-reads the DB.
		await gotoClientSide(page, '/transactions');
		const main = page.getByRole('main');
		// Payee renders verbatim (transactions/+page.svelte:94). VND under en-US
		// formats with no fraction digits → "-₫50,000" (transactions/+page.svelte:102).
		await expect(main.getByText('coffee')).toBeVisible({ timeout: 10000 });
		await expect(main.getByText('-₫50,000')).toBeVisible();
	});

	test('saves an income with the + prefix', async ({ onboardedPage: page }) => {
		await gotoClientSide(page, '/quick-add');

		const input = page.locator('#qa-input');
		await expect(input).toBeEnabled();

		// Leading '+' switches parseQuickInput to income (quick_parse.ts:31-32).
		await input.fill('+50k salary');
		await page.keyboard.press('Enter');

		await gotoClientSide(page, '/transactions');
		const main = page.getByRole('main');
		await expect(main.getByText('salary')).toBeVisible({ timeout: 10000 });
		// Income has no '-' prefix (transactions/+page.svelte:102).
		await expect(main.getByText('₫50,000')).toBeVisible();
	});
});
