import { test, expect } from './fixtures/onboarded';
import type { Page } from '@playwright/test';
import { addTransaction } from './helpers/ui';

async function openRules(page: Page) {
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await page.getByRole('link', { name: /Classification rules/ }).click();
	await expect(page.getByRole('heading', { name: 'Classification rules', exact: true })).toBeVisible();
}

async function createRule(page: Page, payee: string) {
	await page.getByRole('button', { name: 'Add rule', exact: true }).click();
	const dialog = page.getByRole('dialog');
	await dialog.getByLabel('Payee text', { exact: true }).fill(payee);
	await dialog.getByLabel('Tag', { exact: true }).selectOption('tag_gift');
	await dialog.getByRole('button', { name: 'Save', exact: true }).click();
	await expect(dialog).not.toBeVisible();
}

test.describe('classification rule management', () => {
	test('creates, edits, toggles and deletes a manual rule', async ({ onboardedPage: page }) => {
		await openRules(page);
		await expect(page.getByText('No rules yet', { exact: true })).toBeVisible();
		await createRule(page, 'Coffee shop');
		let row = page.getByRole('listitem').filter({ hasText: 'Coffee shop' });
		await expect(row.getByText('Manual', { exact: true })).toBeVisible();
		const toggle = row.getByRole('switch');
		await expect(toggle).toBeChecked();
		await toggle.click();
		await expect(toggle).not.toBeChecked();
		await toggle.focus(); await page.keyboard.press('Space');
		await expect(toggle).toBeChecked();
		await row.getByRole('button', { name: /Edit rule/ }).click();
		const dialog = page.getByRole('dialog');
		await dialog.getByLabel('Payee text', { exact: true }).fill('Coffee kiosk');
		await dialog.getByLabel('Match', { exact: true }).selectOption('contains');
		await dialog.getByRole('button', { name: 'Save', exact: true }).click();
		row = page.getByRole('listitem').filter({ hasText: 'Coffee kiosk' });
		await expect(row).toBeVisible();
		await row.getByRole('button', { name: /Delete rule/ }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Cancel', exact: true }).click();
		await expect(row).toBeVisible();
		await row.getByRole('button', { name: /Delete rule/ }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Delete', exact: true }).click();
		await expect(row).toHaveCount(0);
	});

	test('clears learned rules while retaining manual rules and past transactions', async ({ onboardedPage: page }) => {
		for (let i = 0; i < 3; i++) await addTransaction(page, { kind: 'expense', amount: '25k', payee: 'Learned cafe', tag: 'Gift' });
		await openRules(page);
		await expect(page.getByRole('listitem').filter({ hasText: 'Learned cafe' })).toBeVisible();
		await createRule(page, 'Keep manual');
		await page.screenshot({ path: 'artifacts/0.2.1/rules-ui/desktop.png', fullPage: true });
		await page.setViewportSize({ width: 390, height: 844 });
		await page.screenshot({ path: 'artifacts/0.2.1/rules-ui/mobile.png', fullPage: true });
		await page.setViewportSize({ width: 1280, height: 720 });
		await page.getByRole('button', { name: 'Clear learned rules', exact: true }).click();
		await page.getByRole('dialog').getByRole('button', { name: 'Clear learned rules', exact: true }).click();
		await expect(page.getByRole('listitem').filter({ hasText: 'Learned cafe' })).toHaveCount(0);
		await expect(page.getByRole('listitem').filter({ hasText: 'Keep manual' })).toBeVisible();
		await expect(page.getByRole('button', { name: 'Clear learned rules', exact: true })).toBeDisabled();
		await page.getByRole('link', { name: 'Transactions', exact: true }).click();
		await expect(page.locator('a[href^="/transactions/"]').filter({ hasText: 'Learned cafe' })).toHaveCount(3);
	});

	test('keeps the editor draft and refreshes its labels when the locale changes', async ({ onboardedPage: page }) => {
		await openRules(page);
		await page.getByRole('button', { name: 'Add rule', exact: true }).click();
		await page.getByRole('dialog').getByLabel('Payee text', { exact: true }).fill('Draft cafe');
		await page.getByRole('dialog').getByLabel('Tag', { exact: true }).selectOption('tag_gift');
		await page.getByRole('button', { name: 'Switch to Vietnamese', exact: true }).dispatchEvent('click');
		const dialog = page.getByRole('dialog');
		await expect(dialog.getByLabel('Nội dung người nhận', { exact: true })).toHaveValue('Draft cafe');
		await expect(dialog.getByLabel('Nhãn', { exact: true })).toHaveValue('tag_gift');
		await expect(dialog.getByRole('button', { name: 'Đóng', exact: true })).toBeVisible();
		await page.screenshot({ path: 'artifacts/0.2.1/rules-ui/vietnamese-editor.png', fullPage: true });
		await dialog.getByRole('button', { name: 'Lưu', exact: true }).click();
		await expect(dialog).not.toBeVisible();
		await expect(page.getByRole('listitem').filter({ hasText: 'Draft cafe' })).toBeVisible();
	});
});
