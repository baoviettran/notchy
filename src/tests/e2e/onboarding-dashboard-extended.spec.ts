import { test, expect } from './fixtures/onboarded';
import { test as baseTest } from '@playwright/test';

// §1 Onboarding + §2 Dashboard coverage for the AUTO-tagged checklist items.
// Conventions: SPA navigation only post-onboarding, comments cite source lines
// + i18n keys. §1 tests use the BASE Playwright test (bare { page }) since they
// exercise pre-onboarding state; §2 tests use the onboardedPage fixture.
//
// Verified against:
//  - src/routes/onboarding/+page.svelte: 3 steps (lang → currency → account).
//    Currency (step 2) defaults to 'VND' (line 14) and nextStep() advances
//    unconditionally (line 40-43) — there is NO "no selection" guard because a
//    currency is always pre-selected. Finish is disabled only when accountName
//    is falsy (line 141: disabled={!accountName || saving}); whitespace-only
//    names are NOT trimmed (line 47: if (!accountName)) — a real gap. Invalid
//    initial balances are swallowed (line 52: catch → balance = undefined),
//    creating the account with no opening balance and NO error — another gap.
//  - src/routes/+page.svelte (dashboard): heading m.nav_dashboard="Dashboard";
//    empty recent-txns state shows dashboard_no_txns_yet (line 129).

// ─── §1 Onboarding (pre-onboarding, base fixture) ─────────────────────────

baseTest.describe('onboarding — extended (§1)', () => {
	baseTest('currency step: Continue is enabled and advances (currency is pre-selected)', async ({ page }) => {
		// onboarding/+page.svelte:14 defaults currency='VND'; nextStep() at step 2
		// advances unconditionally. There is no "advance without a selection"
		// state because a currency is always chosen. We assert Continue is
		// enabled and the step advances — the genuine behaviour.
		await page.goto('/');
		await page.getByRole('button', { name: /^English/ }).click();
		await page.getByRole('button', { name: 'Continue →' }).click();
		// Now on step 2 (currency). Continue is enabled.
		const continueBtn = page.getByRole('button', { name: 'Continue →' });
		await expect(continueBtn).toBeEnabled();
		await continueBtn.click();
		// Advanced to step 3 — the account-creation form (Finish setup button).
		await expect(page.getByRole('button', { name: 'Finish setup' })).toBeVisible();
	});

	baseTest('Finish setup is disabled until an account name is entered', async ({ page }) => {
		// onboarding/+page.svelte:141 disabled={!accountName || saving}.
		await page.goto('/');
		await page.getByRole('button', { name: /^English/ }).click();
		await page.getByRole('button', { name: 'Continue →' }).click();
		await page.getByRole('button', { name: 'Continue →' }).click();
		await expect(page.getByRole('button', { name: 'Finish setup' })).toBeDisabled();
		await page.getByLabel('Name').fill('My Account');
		await expect(page.getByRole('button', { name: 'Finish setup' })).toBeEnabled();
	});

	baseTest('GAP: whitespace-only account name is accepted (no trim validation)', async ({ page }) => {
		// KNOWN GAP: onboarding finish() (line 47) checks !accountName, not
		// name.trim() — so a spaces-only name passes. (AccountForm.create uses
		// trim validation, but onboarding bypasses it.) This test documents the
		// current behaviour; if the gap is fixed, flip the assertion.
		await page.goto('/');
		await page.getByRole('button', { name: /^English/ }).click();
		await page.getByRole('button', { name: 'Continue →' }).click();
		await page.getByRole('button', { name: 'Continue →' }).click();
		await page.getByLabel('Name').fill('   ');
		// The button enables (truthy string) — Finish is NOT blocked.
		await expect(page.getByRole('button', { name: 'Finish setup' })).toBeEnabled();
	});

	baseTest('GAP: invalid opening balance is silently ignored, not rejected', async ({ page }) => {
		// KNOWN GAP: onboarding finish() (line 52) catches parseAmount failure
		// and sets balance=undefined — the account is created with NO opening
		// balance and the user gets NO error. (AccountForm surfaces
		// validation_invalid_amount; onboarding does not.) This test documents
		// the current behaviour; if the gap is fixed, expect an error instead.
		await page.goto('/');
		await page.getByRole('button', { name: /^English/ }).click();
		await page.getByRole('button', { name: 'Continue →' }).click();
		await page.getByRole('button', { name: 'Continue →' }).click();
		await page.getByLabel('Name').fill('Bad Balance');
		await page.getByLabel('Initial balance (optional)').fill('not a number');
		await page.getByRole('button', { name: 'Finish setup' }).click();
		// Onboarding completes (lands on dashboard) despite the bad balance —
		// no validation error blocked it.
		await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
	});
});

// ─── §2 Dashboard (onboarded fixture) ─────────────────────────────────────

test.describe('dashboard — extended (§2)', () => {
	test('every nav route loads without console errors', async ({ onboardedPage: page }) => {
		// Navigate to each top-level route; capture console errors across the
		// sweep. Mirrors reports.spec.ts's no-console-errors pattern.
		const errors: string[] = [];
		page.on('console', (msg) => {
			if (msg.type() === 'error') errors.push(`${page.url()}: ${msg.text()}`);
		});
		const routes = [
			{ name: 'Transactions', exact: true },
			{ name: 'Accounts', exact: true },
			{ name: 'Budgets', exact: true },
			{ name: 'Goals', exact: true },
			{ name: 'Debts', exact: true },
			{ name: 'Reports', exact: true },
			{ name: 'Settings', exact: true }
		];
		for (const r of routes) {
			// Scope to the sidebar nav — the dashboard also has same-named
			// shortcut links (e.g. "Accounts →") that make a bare link query
			// ambiguous. The nav lives in the complementary (sidebar) landmark.
			await page.getByRole('complementary').getByRole('link', r).click();
			// Each route renders a top-level h1; wait for it so the page is
			// actually mounted before moving on.
			await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
		}
		expect(errors).toEqual([]);
	});

	test('dashboard empty state: fresh onboarding shows the no-transactions prompt', async ({ onboardedPage: page }) => {
		// Fresh onboarding → one account, no transactions. The dashboard recent
		// section shows dashboard_no_txns_yet (+page.svelte:129).
		const main = page.getByRole('main');
		await expect(main.getByText(/No transactions yet/)).toBeVisible();
		// Net position readout renders (₫0 for a fresh account with no balance).
		await expect(main.getByText('Net position')).toBeVisible();
	});
});
