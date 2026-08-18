import { test, expect } from './fixtures/onboarded';

// Motion-regression smoke: popovers must scale from their anchor (not center),
// and the More sheet's Svelte transition must not break open/close. Runs in a
// real browser so computed transform-origin and WAAPI are actually exercised.

test.describe('More sheet (mobile)', () => {
	test.use({ viewport: { width: 390, height: 844 } });

	test('opens, then closes via backdrop and via Escape', async ({ onboardedPage: page }) => {
		const more = page.getByRole('button', { name: 'More' });
		// The dashboard also shows an "Accounts" link, so scope to the sheet itself.
		const sheet = page.locator('.rounded-t-lg');
		const sheetAccounts = sheet.getByText('Accounts');

		await more.click();
		await expect(sheetAccounts).toBeVisible();

		// Close via the backdrop — the sheet has an out transition and must disappear.
		// (The More toggle is unreachable while open: the z-40 backdrop covers the
		// z-30 nav, so a second tap lands on the backdrop instead.)
		await page.locator('.bg-black\\/50').click();
		await expect(sheetAccounts).toBeHidden();

		// Reopen, then close via Escape (BottomNav's keydown path).
		await more.click();
		await expect(sheetAccounts).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(sheetAccounts).toBeHidden();
	});
});

test.describe('Popover origins', () => {
	test('autocomplete listbox scales from its top edge, not center', async ({ onboardedPage: page }) => {
		// Create a tag so the listbox has an option to render.
		await page.getByRole('link', { name: 'Settings', exact: true }).click();
		await page.getByRole('link', { name: /Categories/ }).first().click();
		await page.getByRole('button', { name: '+ Add tag' }).click();
		const modal = page.getByRole('dialog');
		await modal.getByLabel('Name').fill('Food');
		await modal.getByRole('button', { name: 'Create' }).click();
		await expect(page.getByText('Food')).toBeVisible();

		// Open the Tag autocomplete (id-mode) in the transaction modal.
		await page.getByRole('button', { name: 'Add transaction' }).click();
		const txModal = page.getByRole('dialog');
		await txModal.getByLabel('Tag').fill('F');
		const listbox = page.getByRole('listbox');
		await expect(listbox).toBeVisible();
		// origin-top resolves to 50% of the element's own width, 0px.
		const fromTop = await listbox.evaluate((el) => {
			const box = el as HTMLElement;
			return getComputedStyle(el).transformOrigin === `${box.offsetWidth / 2}px 0px`;
		});
		expect(fromTop).toBe(true);
	});

	test('context menu scales from its top-right anchor', async ({ onboardedPage: page }) => {
		// The onboarding account gives the accounts page one row with a ⋮ menu.
		await page.getByRole('link', { name: 'Accounts', exact: true }).click();
		await expect(page.getByRole('heading', { name: 'Accounts' })).toBeVisible();
		await page.getByRole('button', { name: 'Edit', exact: true }).first().click();
		const menu = page.getByRole('menu');
		await expect(menu).toBeVisible();
		// origin-top-right resolves to 100% of the element's own width, 0px.
		const fromTopRight = await menu.evaluate((el) => {
			const box = el as HTMLElement;
			return getComputedStyle(el).transformOrigin === `${box.offsetWidth}px 0px`;
		});
		expect(fromTopRight).toBe(true);
	});
});
