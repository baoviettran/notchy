import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';
import type { Page } from '@playwright/test';

// Reuses the setup pattern from budgets-extended.spec.ts: the first budgetable
// bucket is Essentials; no tags are seeded into it, so live spend needs a tag.

async function createTagInFirstBucket(page: Page, tagName: string) {
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await page.getByRole('link', { name: /Categories/ }).first().click();
	await page.getByRole('button', { name: '+ Add tag' }).click();
	const modal = page.getByRole('dialog');
	await modal.getByLabel('Name').fill(tagName);
	await modal.getByRole('button', { name: 'Create' }).click();
	await expect(page.getByText(tagName)).toBeVisible();
}

async function allocateFirstBucket(page: Page, amount: string) {
	await page.locator('main button.figures').first().click();
	const input = page.locator('main input[placeholder="0"]').first();
	// parseAmount rejects a literal "0" (result <= 0 throws), so a zero
	// allocation goes through the app's blank-field path: startEdit leaves the
	// field empty when the current allocation is 0, and saveEdit coalesces a
	// blank to 0 — which still inserts the budgets row the carry needs to render.
	if (amount !== '0') await input.fill(amount);
	await input.press('Enter');
	await expect(page.getByText('Budget updated.')).toBeVisible();
}

test.describe('budgets — rollover toggle', () => {
	test('flipping rollover off claws an overspent bucket into the pool', async ({ onboardedPage: page }) => {
		// Current month: allocate 100k to Essentials, then overspend by 200k.
		await page.getByRole('link', { name: 'Budgets', exact: true }).click();
		await allocateFirstBucket(page, '100000');
		await createTagInFirstBucket(page, 'Groceries');
		await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
		await addTransaction(page, { kind: 'expense', amount: '300000', tag: 'Groceries' });

		// Next month: give the bucket a row (allocated 0) so the carry renders.
		await page.getByRole('link', { name: 'Budgets', exact: true }).click();
		await page.getByRole('button', { name: 'Next month' }).click();
		await allocateFirstBucket(page, '0');

		const pool = page.getByTestId('to-budget');
		const firstBucket = page.locator('main .surface.rounded-lg.space-y-2').first();
		const toggle = firstBucket.getByRole('checkbox');
		await expect(toggle).toBeVisible();
		await expect(toggle).toBeChecked(); // defaults to ON (migration 004)

		const bucketText = async () => (await firstBucket.textContent()) ?? '';
		const poolText = async () => (await pool.textContent()) ?? '';
		// Onboarding defaults to en/VND, so formatCurrency(-200000, 'VND', 'en')
		// is "-₫200,000". Rollover ON: the bucket carries -200,000 and the pool
		// reads -100,000 (this month's 100,000 allocation, unfunded).
		const bucketOn = await bucketText();
		const poolOn = await poolText();
		expect(bucketOn).toContain('-₫200,000');
		expect(poolOn).toContain('-₫100,000');

		// Flip OFF: the bucket's negative carry floors at 0, and the pool moves
		// to -300,000 (the current month's shortfall is clawed back).
		await toggle.uncheck();
		await expect.poll(bucketText).not.toBe(bucketOn);
		await expect.poll(poolText).not.toBe(poolOn);
		expect(await bucketText()).not.toContain('-₫200,000');
		expect(await poolText()).toContain('-₫300,000');

		// Flip back ON: the carry is restored.
		await toggle.check();
		await expect.poll(bucketText).toBe(bucketOn);
		await expect.poll(poolText).toBe(poolOn);
	});
});
