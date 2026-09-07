import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';
import type { Page } from '@playwright/test';

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
		// Addressed structurally (fullscreen overlay), not by background color,
		// so restyling the scrim doesn't break this test.
		await page.locator('div.fixed.inset-0.z-40').click();
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
		await page.getByRole('button', { name: 'Add transaction' }).first().click();
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
		// Kebab triggers are labeled "Actions: {name}"; the first account is "Test Checking".
		await page.getByRole('button', { name: 'Actions: Test Checking' }).click();
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

test.describe('prefers-reduced-motion', () => {
	// Regression lock: app.css's @media (prefers-reduced-motion: reduce) block
	// already kills the toast's animate-slide-up/animate-flash animations, so
	// green is the expected outcome — the gap was that nothing asserted it.
	// The positive control (default motion → animationName set) keeps the
	// assertions from passing vacuously on a locator that never matches.

	// Same delete flow as transactions.spec.ts: kebab menu → Delete → confirm.
	async function deleteTransactionRow(page: Page, amount: string): Promise<void> {
		await page.getByRole('link', { name: 'Transactions', exact: true }).click();
		const txRow = page.getByRole('main').locator('.group', { hasText: amount });
		await txRow.getByRole('button').last().click();
		await page.getByRole('menuitem', { name: 'Delete' }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Delete' }).click();
	}

	test('toast animations are disabled under prefers-reduced-motion', async ({ onboardedPage: page }) => {
		// Default settings theme is light, where the flash flicker is already
		// disabled by design (html.light .animate-flash — phosphor glow doesn't
		// read on paper). Force dark (same classList pattern as
		// light-contrast.spec.ts) so the flash positive control is meaningful.
		await page.evaluate(() => {
			document.documentElement.classList.remove('light');
			document.documentElement.classList.add('dark');
		});
		await addTransaction(page, { kind: 'expense', amount: '50k' });
		await addTransaction(page, { kind: 'expense', amount: '20k' });

		// Positive control (default motion): the delete undo toast animates.
		await deleteTransactionRow(page, '−₫50,000');
		const toast = page.locator('.animate-slide-up');
		await expect(toast).toBeVisible();
		const flash = toast.locator('.animate-flash');
		expect(await toast.evaluate((el) => getComputedStyle(el).animationName)).not.toBe('none');
		expect(await flash.evaluate((el) => getComputedStyle(el).animationName)).not.toBe('none');

		// Reduced motion applies live — a second delete fires a fresh toast,
		// and neither the toast box nor its message span may animate.
		await page.emulateMedia({ reducedMotion: 'reduce' });
		await deleteTransactionRow(page, '−₫20,000');
		const toastReduced = page.locator('.animate-slide-up');
		await expect(toastReduced).toBeVisible();
		const flashReduced = toastReduced.locator('.animate-flash');
		await expect
			.poll(async () => toastReduced.evaluate((el) => getComputedStyle(el).animationName))
			.toBe('none');
		await expect
			.poll(async () => flashReduced.evaluate((el) => getComputedStyle(el).animationName))
			.toBe('none');
	});
});
