import { test, expect } from '@playwright/test';

// Quick-add window has its own test surface: it skips dbStore.init() and
// manages its own DB connection via getDb(). The layout.svelte detects
// /quick-add and renders it without the sidebar/chrome.

test.describe('quick-add', () => {
	test('shows a hint when no accounts exist', async ({ page }) => {
		// Navigate directly to /quick-add without onboarding — the layout
		// skips dbStore.init() for quick-add URLs, so no redirect to
		// /onboarding occurs. The in-memory sql.js DB starts empty.
		await page.goto('/quick-add');
		await page.waitForSelector('#qa-input');
		// With no accounts, activeAccount is null → input disabled.
		await expect(page.locator('#qa-input')).toBeDisabled();
		// The hint must be visible, guiding the user to create an account.
		const hint = page.locator('#qa-hint');
		await expect(hint).toBeVisible();
	});
});
