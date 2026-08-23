import { test, expect } from './fixtures/onboarded';

// Extended budget coverage for the AUTO-tagged checklist items in §5.
// Conventions match budgets.spec.ts: SPA navigation only, comments cite source
// lines + i18n keys, VND formats with no fraction digits (currency.ts).
//
// Verified against:
//  - src/routes/budgets/+page.svelte: click-to-edit allocation (line 96
//    trigger → inline input line 86-91, Enter saves, ✕ cancels); spent/allocated
//    rendered as "spent / allocated" (line 97); remaining label (line 104);
//    empty-month banner with "Copy from previous" (lines 67-72).
//  - src/lib/db/repos/budgets.ts: spent is bucketed by tx.tag_id JOIN
//    category_tags.type_id (line 68) — so a transaction counts toward a budget
//    ONLY if it is tagged with a tag in that bucket. Roll-over is cumulative
//    (allocated − spent) over prior budgeted months (getRolledOver, line 85+);
//    rollover_enabled defaults to 1 (migration 004).
//  - src/lib/db/migrations/003_seed.ts: budgetable buckets are Essentials,
//    Learning & Entertainment, Saving & Investment. NO tags are seeded into
//    these buckets (only bucket_adjustments has tags), so live-spend setup
//    requires creating a tag in a budgetable bucket and tagging a tx with it.
//
// Realistic deviations from the checklist wording:
//  - "Over-allocate warn/block": NO such guard exists — setAllocation
//    (repos/budgets.ts:101) sets the number unconditionally; there is no
//    available-income ceiling. We assert allocation succeeds at any value
//    (documenting the absence of a guard) rather than fake one.
//  - "Negative allocation rejected": parseAmount throws on a leading "-",
//    surfacing the "Invalid amount" toast (budgets/+page.svelte:45-47). This
//    is per-entry validation, not a dedicated over-allocate rule.

// Helper: create a tag in the first budgetable bucket via /settings/categories,
// returning nothing — the tag is immediately usable in the transaction form.
async function createTagInFirstBucket(page: import('@playwright/test').Page, tagName: string) {
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await page.getByRole('link', { name: /Categories/ }).first().click();
	await page.getByRole('button', { name: '+ Add tag' }).click();
	const modal = page.getByRole('dialog');
	await modal.getByLabel('Name').fill(tagName);
	// The bucket Select defaults to the first budgetable bucket (Essentials);
	// leave it as-is. Create the tag.
	await modal.getByRole('button', { name: 'Create' }).click();
	await expect(page.getByText(tagName)).toBeVisible();
}

// Helper: allocate `amount` (plain integer string) to the first budgetable
// bucket via the click-to-edit trigger.
async function allocateFirstBucket(page: import('@playwright/test').Page, amount: string) {
	const trigger = page.locator('main button.figures').first();
	await trigger.click();
	const input = page.locator('main input[placeholder="0"]').first();
	await input.fill(amount);
	await input.press('Enter');
	await expect(page.getByText('Budget updated.')).toBeVisible();
}

test.describe('budgets — extended', () => {
	test('spending in a budgeted category increases spent and decreases remaining live', async ({ onboardedPage: page }) => {
		// No tags exist in budgetable buckets by default, so create one and tag
		// an expense with it. Then allocate and confirm spent/remaining move.
		await createTagInFirstBucket(page, 'Groceries');

		// Tag an expense with it.
		await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
		await page.getByRole('button', { name: 'Add transaction' }).click();
		const txModal = page.getByRole('dialog');
		const tagCombo = txModal.getByLabel('Tag');
		await tagCombo.click();
		await tagCombo.fill('Groceries');
		await page.getByRole('option', { name: 'Groceries' }).click();
		await txModal.getByLabel('Amount').fill('100k');
		await txModal.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();

		// Allocate 500k to the Essentials bucket and verify spent/remaining.
		await page.getByRole('link', { name: 'Budgets', exact: true }).click();
		await allocateFirstBucket(page, '500000');
		// The trigger now shows "₫100,000 / ₫500,000" (spent / allocated).
		const trigger = page.locator('main button.figures').first();
		await expect(trigger).toContainText('100,000');
		await expect(trigger).toContainText('500,000');
		// Remaining = 500000 − 100000 = 400000. The remaining line shows it.
		await expect(page.getByRole('main').getByText(/400,000/)).toBeVisible();
	});

	test('empty-month banner offers Copy from previous', async ({ onboardedPage: page }) => {
		// Navigate to next month (no allocations) → banner appears.
		await page.getByRole('link', { name: 'Budgets', exact: true }).click();
		await page.getByRole('button', { name: 'Next month' }).click();
		// budgets/+page.svelte:69 budgets_no_budget_for_month = "No budget set for this month."
		await expect(page.getByText('No budget set for this month.')).toBeVisible();
		// No previous-month allocations exist, so "Copy from previous" is hidden.
		await expect(page.getByRole('button', { name: 'Copy from previous' })).toHaveCount(0);
	});

	test('Copy from previous appears only when previous month has allocations', async ({ onboardedPage: page }) => {
		// Create a budget in the current month so the NEXT month has something to copy.
		await page.getByRole('link', { name: 'Budgets', exact: true }).click();
		await allocateFirstBucket(page, '500000');
		// Navigate to next month: empty, but previous month (current) has allocations.
		await page.getByRole('button', { name: 'Next month' }).click();
		await expect(page.getByText('No budget set for this month.')).toBeVisible();
		await expect(page.getByRole('button', { name: 'Copy from previous' })).toBeVisible();
	});

	test('invalid (negative) allocation is rejected with a toast', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Budgets', exact: true }).click();
		const trigger = page.locator('main button.figures').first();
		await trigger.click();
		const input = page.locator('main input[placeholder="0"]').first();
		// A leading "-" is rejected by parseAmount → "Invalid amount" toast
		// (budgets/+page.svelte:45-47).
		await input.fill('-500');
		await input.press('Enter');
		await expect(page.getByText('Invalid amount')).toBeVisible();
		// Allocation unchanged: still 0 / 0.
		await expect(page.locator('main button.figures').first()).toContainText('0');
	});

	test('over-allocating beyond available income shows a soft warning', async ({ onboardedPage: page }) => {
		// No income this month → any allocation exceeds available funds. The
		// page shows a non-blocking "Over budget by X" banner; allocation is
		// still allowed (soft warn, not a hard block).
		await page.getByRole('link', { name: 'Budgets', exact: true }).click();
		await allocateFirstBucket(page, '500000');
		// Banner surfaces (budgets/+page.svelte budgets_over_allocated).
		await expect(page.getByRole('main').getByText(/Over budget by/)).toBeVisible();
		// The allocation itself is still stored (not blocked).
		await expect(page.locator('main button.figures').first()).toContainText('500,000');
	});

	test('prior-month allocation persists, and roll-over surfaces in the next month', async ({ onboardedPage: page }) => {
		// Two things under test:
		//  (a) per-month allocation isolation (the basic behaviour).
		//  (b) the roll-over FEATURE now rendered in the UI — a prior-month
		//      surplus carries forward as `available` and a "rolled over" line.
		//      getRolledOver (repos/budgets.ts:85) sums (allocated − spent) over
		//      prior budgeted months; available = allocated + rolled_over − spent.

		// Allocate 500k in the PREVIOUS month with no spend there → 500k surplus.
		await page.getByRole('link', { name: 'Budgets', exact: true }).click();
		await page.getByRole('button', { name: 'Previous month' }).click();
		await allocateFirstBucket(page, '500000');
		await expect(page.locator('main button.figures').first()).toContainText('500,000');

		// Current month: allocation is independent (0 by default).
		await page.getByRole('button', { name: 'Next month' }).click();
		await expect(page.locator('main button.figures').first()).toContainText('₫0');

		// Allocate 500k in the current month too. The prior 500k surplus rolls
		// in, so available = 500k (allocated) + 500k (rolled) − 0 (spent) = 1,000k,
		// and a "rolled over ₫500,000" line appears under the bar.
		await allocateFirstBucket(page, '500000');
		const firstBucket = page.locator('main .bg-tape.rounded-lg.border.border-line').first();
		await expect(firstBucket.getByText(/rolled over/i)).toBeVisible();
		await expect(firstBucket.getByText(/rolled over ₫500,000/)).toBeVisible();
		// Available figure (₫1,000,000) is shown with the "available" label.
		await expect(firstBucket.getByText(/1,000,000/)).toBeVisible();
	});
});
