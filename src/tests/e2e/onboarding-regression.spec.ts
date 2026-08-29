import { test, expect } from '@playwright/test';

// Regression flow for row 8 of the coverage-bug inventory (commit dbcb436).
//
// Bug: switching language at step 1 awaited settings.setLocale() BEFORE
// persisting the next step; the {#key settings.locale} remount destroyed the
// component mid-await, so persistedStep stayed at 1 — the app bounced back to
// the language step and the user had to click Continue a SECOND time to leave
// it. Fix (onboarding/+page.svelte:73): persist the next step BEFORE
// setLocale; the module-level persistedStep survives the remount.
//
// This spec reproduces the single-click user flow and asserts it advances —
// RED on the pre-fix build (dbcb436^ needs two clicks), GREEN on HEAD.

test.describe('onboarding — regression (dbcb436 single-click advance)', () => {
	test('a single Continue click reaches the currency step after switching to Vietnamese', async ({ page }) => {
		await page.goto('/');
		await page.getByRole('radiogroup').first().waitFor();

		// Choose Vietnamese — the locale switch that triggers the remount.
		await page.getByRole('radio', { name: /Tiếng Việt/ }).click();
		// Exactly ONE click on Continue. The UI is still English until this
		// click sets the locale, so the button reads "Continue →". Pre-fix,
		// the remount drops back to the language step.
		await page.getByRole('button', { name: 'Continue →' }).click();

		// The VN code plate renders only on the currency step — its presence
		// proves a single click moved us off the language step.
		await expect(page.getByText('VN', { exact: true })).toBeVisible();
	});
});