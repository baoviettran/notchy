import { test, expect } from './fixtures/onboarded';

// Regression flow for row 8 of the coverage-bug inventory (commit dbcb436).
//
// Bug: DatePicker was a native <input type=…> with no Today/Clear affordance
// and no localized month names, and its panel could be clipped inside a modal
// stacking context. The fix replaced it with a custom overlay: position:fixed
// to escape the modal stacking context, Intl.DateTimeFormat for locale-aware
// display, measured panel height, and i18n Today/Clear buttons. Driving the
// overlay's Today/Clear actions is flow-level coverage the native input never
// had — RED on the pre-fix build (dbcb436^ has neither button), GREEN on HEAD.
//
// Uses the goal form's "Target date" field (GoalForm.svelte:73) as the host.
// The trigger is a <button> whose accessible name comes from the <label for>
// text ("Target date"), so getByLabel works whether a value is set or not.

async function openGoalDatePage(page: import('@playwright/test').Page) {
	await page.getByRole('link', { name: 'Goals', exact: true }).click();
	await page.getByRole('button', { name: '+ Add goal' }).click();
	const modal = page.getByRole('dialog');
	await modal.getByLabel('Target date').click();
	return { modal, panel: page.getByRole('dialog', { name: 'Date picker' }) };
}

test.describe('DatePicker — regression (dbcb436 custom overlay)', () => {
	test('Today sets the current date and closes the overlay', async ({ onboardedPage: page }) => {
		const { modal, panel } = await openGoalDatePage(page);

		// The overlay's Today action did not exist on the native input.
		await expect(panel.getByRole('button', { name: 'Today' })).toBeVisible();
		await panel.getByRole('button', { name: 'Today' }).click();
		await expect(panel).toBeHidden();

		// The trigger now shows today's en-US date (mm/dd/yyyy).
		const n = new Date();
		const today = `${String(n.getMonth() + 1).padStart(2, '0')}/${String(n.getDate()).padStart(2, '0')}/${n.getFullYear()}`;
		await expect(modal.getByText(today)).toBeVisible();
	});

	test('Clear resets a previously set date back to the placeholder', async ({ onboardedPage: page }) => {
		const { modal, panel } = await openGoalDatePage(page);

		// Pick a day in the current month (the overlay opens at the current month).
		await panel.getByRole('button', { name: '15', exact: true }).click();

		// Re-open the overlay and hit Clear.
		await modal.getByLabel('Target date').click();
		const panel2 = page.getByRole('dialog', { name: 'Date picker' });
		await panel2.getByRole('button', { name: 'Clear' }).click();
		await expect(panel2).toBeHidden();

		// Placeholder is back — the value was reset.
		await expect(modal.getByText('dd/mm/yyyy')).toBeVisible();
	});
});