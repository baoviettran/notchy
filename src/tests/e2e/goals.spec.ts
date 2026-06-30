import { test, expect } from './fixtures/onboarded';

// Verified against src/routes/goals/+page.svelte and GoalForm.svelte:
//  - Sidebar nav link text is "Goals" (m.nav_goals).
//  - Page heading is {m.goals_title()} = "Goals" (line 47).
//  - Add button is {m.goals_add()} = "+ Add goal" (line 48) — a real <button>.
//  - Modal renders role="dialog" (Modal.svelte:13).
//  - GoalForm Name input label is {m.common_name()} = "Name" (GoalForm.svelte:68).
//  - GoalForm Target amount input label is {m.forms_target_amount()} = "Target amount" (line 70).
//  - GoalForm requires a target date (GoalForm.svelte:40) — a native date input
//    labelled {m.forms_target_date()}. We fill it with a future ISO date.
//  - Create button is {m.forms_create()} = "Create" (line 78).
//  - Created goal name renders in the active list (line 62).

test('goals page loads and a goal can be created', async ({ onboardedPage: page }) => {
	await page.getByRole('link', { name: 'Goals', exact: true }).click();
	await expect(page.getByRole('heading', { name: 'Goals', exact: true })).toBeVisible();

	await page.getByRole('button', { name: '+ Add goal' }).click();
	const modal = page.getByRole('dialog');
	await expect(modal).toBeVisible();
	await modal.getByLabel('Name').fill('Emergency fund');
	await modal.getByLabel('Target amount').fill('10000');
	// Target date is required (GoalForm validation). Use a stable future date.
	await modal.getByLabel('Target date').fill('2099-12-31');
	await modal.getByRole('button', { name: 'Create' }).click();

	await expect(page.getByText('Emergency fund')).toBeVisible();
});
