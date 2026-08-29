import type { Locator } from '@playwright/test';
import { expect } from '@playwright/test';

/**
 * Set a date through the DatePicker component (`src/lib/components/primitives/DatePicker.svelte`).
 *
 * The trigger is a `<button>` (aria-haspopup="dialog", id="dp-…") that opens a
 * `role="dialog"` aria-label="Date picker" panel — it is NOT a native
 * `<input type=date>`, so `.fill()/type()` cannot set it. Interaction model:
 *   1. click the trigger,
 *   2. navigate to the target month using the header ◀/▶ buttons,
 *   3. click the numbered day-cell button.
 *
 * With an empty value (new goals/mutations) the panel opens at the current
 * month, so the number of ◀/▶ clicks is computed from `new Date()`. Keep test
 * dates within ~a few years of today to bound the navigation; far-future dates
 * (e.g. 2099) would need hundreds of month-clicks.
 *
 * The nav header is `div.flex.items-center.justify-between.mb-2` containing
 * [◀ prev button, month/year label span, ▶ next button] (DatePicker.svelte:200-204).
 */
export async function pickDate(trigger: Locator, isoDate: string): Promise<void> {
	const [targetYear, targetMonth, targetDay] = isoDate.split('-').map(Number);

	await trigger.click();

	const dialog = trigger.page().getByRole('dialog', { name: 'Date picker' });
	await expect(dialog).toBeVisible();

	// Header = [◀ prev, month/year label span, ▶ next] — the label is a <span>,
	// not a <button>, so the buttons are nth(0)=prev and nth(1)=next.
	const nav = dialog.locator('div.flex.items-center.justify-between.mb-2 button');
	const prevBtn = nav.nth(0);
	const nextBtn = nav.nth(1);

	const now = new Date();
	let months = (targetYear - now.getFullYear()) * 12 + (targetMonth - (now.getMonth() + 1));

	while (months !== 0) {
		if (months > 0) {
			await nextBtn.click();
			months--;
		} else {
			await prevBtn.click();
			months++;
		}
	}

	// exact:true so day "1" does not also match 11/21/31; only the day cells
	// carry a bare-number accessible name (footer is "Today"/"Clear").
	await dialog.getByRole('button', { name: String(targetDay), exact: true }).click();
}