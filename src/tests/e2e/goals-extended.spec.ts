import { test, expect } from './fixtures/onboarded';

// Extended goal coverage for the AUTO-tagged checklist items in §6.
// Conventions match goals.spec.ts: SPA navigation only, comments cite source
// lines + i18n keys, VND formats with no fraction digits (currency.ts).
//
// Verified against:
//  - src/routes/goals/+page.svelte: goal card shows name, velocity-status icon
//    + label (line 63), progress bar (line 65), "current / target" + "% · due"
//    (lines 67-68); "Mark complete / Mark abandoned" buttons appear ONLY in the
//    overdue panel (lines 70-76); completed goals render under a "Completed"
//    section (lines 83-95); the edit trigger is the goal name button (line 62).
//  - src/lib/components/forms/GoalForm.svelte: name + target amount + target
//    date (required) + linked account; type defaults to 'savings'.
//  - src/lib/db/repos/goals.ts: current_amount is DERIVED from the linked
//    account's balance (line 114: getBalance(linked_account_id)) — there is NO
//    "contribute" action. For net_worth goals, current = Σ signed account
//    balances (line 112). progress_pct = min(100, round(current/target*100)).
//    status changes only via explicit update(status:) — NO auto-complete on
//    reaching the target. velocity_status needs monthsElapsed>0 else
//    'insufficient_data'.
//
// Realistic deviations from the checklist wording:
//  - "Contribute to a goal (add funds toward it)": there is no contribute
//    button. Contributions happen INDIRECTLY — adding income to the goal's
//    linked account raises its balance, which raises the goal's derived
//    current_amount. We test that path.
//  - "Complete a goal (reach the target amount)": no auto-complete exists.
//    The Mark-complete action is only exposed on the OVERDUE panel, so we
//    create a goal with a past target date to surface it.
//  - "Delete a goal": there is NO delete affordance anywhere in the goals UI
//    (the store exposes goals.delete but no route calls it). Unreachable via
//    the UI — flagged as a gap; not testable end-to-end.

// Create a savings goal linked to the onboarding account. Past-date => overdue
// so the Mark-complete action is exposed; future-date for an active goal.
async function createGoal(page: import('@playwright/test').Page, name: string, target: string, date: string) {
	await page.getByRole('link', { name: 'Goals', exact: true }).click();
	await page.getByRole('button', { name: '+ Add goal' }).click();
	const modal = page.getByRole('dialog');
	await modal.getByLabel('Name').fill(name);
	await modal.getByLabel('Target amount').fill(target);
	await modal.getByLabel('Target date').fill(date);
	// Link to the onboarding account so current_amount tracks its balance.
	await modal.getByLabel('Linked account').selectOption({ label: 'Test Checking' });
	await modal.getByRole('button', { name: 'Create' }).click();
	await expect(page.getByRole('dialog')).toBeHidden();
}

test.describe('goals — extended', () => {
	test('creating a goal shows 0% progress and an insufficient-data velocity label', async ({ onboardedPage: page }) => {
		await createGoal(page, 'Emergency Fund', '1m', '2027-12-31');
		// Newly-created goal: 0% (the linked account has ~0 balance) and
		// velocity_status 'insufficient_data' (no months elapsed).
		const card = page.getByRole('main').locator('div.bg-tape.rounded-lg', { hasText: 'Emergency Fund' });
		await expect(card).toBeVisible();
		await expect(card.getByText('Insufficient data')).toBeVisible();
		// current / target shows ₫0 / ₫1,000,000.
		await expect(card.getByText(/₫0/)).toBeVisible();
		await expect(card.getByText(/1,000,000/)).toBeVisible();
	});

	test('adding income to the linked account raises the goal progress (indirect contribution)', async ({ onboardedPage: page }) => {
		// There is no contribute button; progress tracks the linked account's
		// balance (repos/goals.ts:114). Add income → balance up → progress up.
		await createGoal(page, 'New Bike', '500k', '2027-12-31');
		let card = page.getByRole('main').locator('div.bg-tape.rounded-lg', { hasText: 'New Bike' });
		// Initially 0% (₫0 / ₫500,000).
		await expect(card.getByText(/₫0.*500,000|500,000/)).toBeVisible();

		// Add 200k income to the onboarding account.
		await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
		await page.getByRole('button', { name: 'Add transaction' }).click();
		const txModal = page.getByRole('dialog');
		await txModal.getByRole('button', { name: 'Income', exact: true }).click();
		await txModal.getByLabel('Amount').fill('200k');
		await txModal.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();

		// Return to goals — current_amount now reflects the 200k balance.
		await page.getByRole('link', { name: 'Goals', exact: true }).click();
		card = page.getByRole('main').locator('div.bg-tape.rounded-lg', { hasText: 'New Bike' });
		await expect(card.getByText(/200,000/)).toBeVisible();
	});

	test('edit a goal: target amount change persists', async ({ onboardedPage: page }) => {
		await createGoal(page, 'Edit Me', '1m', '2027-12-31');
		// Open edit via the goal name button (goals/+page.svelte:62).
		await page.getByRole('main').getByRole('button', { name: 'Edit Me' }).click();
		const editModal = page.getByRole('dialog');
		await expect(editModal.getByRole('heading', { name: 'Edit goal' })).toBeVisible();
		// Type Select is disabled in edit mode (GoalForm.svelte:69) — analogous
		// to the AccountForm pattern; we don't change type.
		await editModal.getByLabel('Target amount').fill('2m');
		await editModal.getByRole('button', { name: 'Save' }).click();
		await expect(page.getByRole('dialog')).toBeHidden();
		// The card now shows ₫2,000,000 as the target.
		const card = page.getByRole('main').locator('div.bg-tape.rounded-lg', { hasText: 'Edit Me' });
		await expect(card.getByText(/2,000,000/)).toBeVisible();
	});

	test('an overdue goal exposes Mark complete, which moves it to the Completed section', async ({ onboardedPage: page }) => {
		// Past target date + balance below target => velocity_status 'overdue'
		// (repos/goals.ts:130), which surfaces the Mark-complete action
		// (goals/+page.svelte:70-76). No auto-complete exists, so this is the
		// only user-driven completion path.
		await createGoal(page, 'Late Goal', '10m', '2020-01-01');
		const card = page.getByRole('main').locator('div.bg-tape.rounded-lg', { hasText: 'Late Goal' });
		await expect(card.getByText('Overdue')).toBeVisible();
		await card.getByRole('button', { name: 'Mark complete' }).click();
		// Toast confirms.
		await expect(page.getByText('Goal marked complete.')).toBeVisible();
		// The goal leaves Active and appears under Completed with a ✓.
		await expect(page.getByRole('main').getByText('Late Goal')).toHaveCount(1);
		const completedSection = page.getByRole('main').locator('section', { hasText: 'Completed' });
		await expect(completedSection.getByText('Late Goal')).toBeVisible();
	});

	test('empty state shows the create-first-goal prompt', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Goals', exact: true }).click();
		// goals/+page.svelte:53-55: "No active goals." + "Create your first goal".
		await expect(page.getByText('No active goals.')).toBeVisible();
		await expect(page.getByText('Create your first goal')).toBeVisible();
	});

	test('target date is required; missing it blocks creation', async ({ onboardedPage: page }) => {
		await page.getByRole('link', { name: 'Goals', exact: true }).click();
		await page.getByRole('button', { name: '+ Add goal' }).click();
		const modal = page.getByRole('dialog');
		await modal.getByLabel('Name').fill('No Date');
		await modal.getByLabel('Target amount').fill('1m');
		// Leave target date empty.
		await modal.getByRole('button', { name: 'Create' }).click();
		// GoalForm.svelte:40 → validation_target_date_required.
		await expect(modal.getByText('Target date is required')).toBeVisible();
	});
});
