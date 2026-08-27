import { test, expect } from './fixtures/onboarded';

test.describe('keyboard shortcuts', () => {
	test('? opens shortcut reference modal', async ({ onboardedPage: page }) => {
		await page.keyboard.press('?');
		const modal = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
		await expect(modal).toBeVisible();
		await expect(modal.getByText('New transaction')).toBeVisible();
		await expect(modal.getByText('Search')).toBeVisible();
		await expect(modal.getByText('Show this dialog')).toBeVisible();
	});

	test('Escape closes shortcut modal', async ({ onboardedPage: page }) => {
		await page.keyboard.press('?');
		await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
		await page.keyboard.press('Escape');
		await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden();
	});

	test('? toggles — press again to close', async ({ onboardedPage: page }) => {
		await page.keyboard.press('?');
		await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeVisible();
		await page.keyboard.press('?');
		await expect(page.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeHidden();
	});

	test('FAB aria-label includes shortcut hint', async ({ onboardedPage: page }) => {
		const fab = page.getByRole('button', { name: /Add transaction/ });
		await expect(fab).toBeVisible();
		const label = await fab.getAttribute('aria-label');
		expect(label).toContain('N');
	});
});
