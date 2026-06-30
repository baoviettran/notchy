import { test, expect } from './fixtures/onboarded';

// Verified against src/routes/budgets/+page.svelte:
//  - Month nav buttons are literal ◀/▶ text (lines 61,63).
//  - Month label is span.figures.font-medium (line 62); its text is the budget
//    month as "YYYY-MM" (e.g. the current month).
//  - Allocation is click-to-edit, not a bare input. Each budgetable bucket row
//    has a button showing "spent / allocated" (line 96-98); clicking it reveals
//    an input bound to editValue (line 86-91). Enter calls saveEdit (line 88),
//    which calls budgets.setAllocation + toast.show(budgets_updated()).
//  - Toast text is "Budget updated." (en i18n budgets_updated).
//  - Three budgetable buckets are seeded (003_seed.ts: Essentials, Learning,
//    Saving) so a row is always present without setup.

test.describe('budgets', () => {
	test('allocate to a category and it persists across SPA navigation', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Budgets', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Budgets' })).toBeVisible();

		// Click the first bucket's "spent / allocated" button to enter edit mode.
		const editTrigger = page.locator('main button.figures').first();
		await editTrigger.click();

		// The edit input is scoped to <main> so we don't grab the global search box.
		const input = page.locator('main input[placeholder="0"]').first();
		await expect(input).toBeVisible();
		await input.fill('500000');
		await input.press('Enter');

		await expect(page.getByText('Budget updated.')).toBeVisible();

		// Prove the allocation persisted by leaving and re-entering the Budgets
		// route. A full page.reload() would tear down the in-memory DB the
		// Playwright harness uses (non-Tauri fallback in src/lib/db/index.ts),
		// so SPA navigation is the strongest persistence proof available here;
		// the budgets store re-loads from the still-alive DB on mount.
		await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
		await page.getByRole('link', { name: 'Budgets', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Budgets' })).toBeVisible();

		// The trigger button shows "spent / allocated". Onboarding defaults to
		// en/VND, so formatCurrency(500000, 'VND', 'en') = "₫500,000".
		const triggerAfter = page.locator('main button.figures').first();
		await expect(triggerAfter).toContainText('500,000');
	});

	test('prev/next month navigation changes the month and isolates allocations', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Budgets', exact: true }).click();

		const monthLabel = page.locator('span.figures.font-medium');
		const initialMonth = await monthLabel.textContent();
		expect(initialMonth).toBeTruthy();
		expect(initialMonth!).toMatch(/^\d{4}-\d{2}$/);

		// Navigate next month — label changes.
		await page.getByRole('button', { name: '▶' }).click();
		await expect(monthLabel).not.toHaveText(initialMonth!);

		// Allocate in month N+1.
		await page.locator('main button.figures').first().click();
		const input = page.locator('main input[placeholder="0"]').first();
		await expect(input).toBeVisible();
		await input.fill('300000');
		await input.press('Enter');
		await expect(page.getByText('Budget updated.')).toBeVisible();

		// Back to the original month — label returns and allocation is isolated.
		await page.getByRole('button', { name: '◀' }).click();
		await expect(monthLabel).toHaveText(initialMonth!);

		// The original month's first bucket is genuinely empty: its trigger shows
		// "₫0 / ₫0" (spent / allocated, both zero) — not "₫300,000". This proves the
		// month-N+1 allocation did not leak backwards into month N.
		const triggerOriginal = page.locator('main button.figures').first();
		await expect(triggerOriginal).toContainText('₫0 / ₫0');
		await expect(triggerOriginal).not.toContainText('300,000');
	});
});
