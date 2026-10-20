import { test, expect } from '@playwright/test';
import { onboard, addTransaction } from './helpers/ui';
import { test as nativeTest, flushDb } from './fixtures/tauri-mock';

test('creates the first profile and enters onboarding', async ({ page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: 'Choose a profile' })).toBeVisible();
	await page.getByRole('button', { name: 'Create profile' }).click();
	const dialog = page.getByRole('dialog', { name: 'Create profile' });
	await dialog.getByLabel('Profile name').fill('Personal');
	await dialog.getByRole('button', { name: 'Create profile' }).click();
	await expect(page.getByRole('radiogroup').first()).toBeVisible();
});

test('keeps transactions separate when switching between two profiles', async ({ page }) => {
	await onboard(page);
	await addTransaction(page, { kind: 'expense', amount: '50k', payee: 'Only A' });
	await page.getByRole('link', { name: 'Settings' }).click();
	await page.getByRole('link', { name: 'Profiles' }).click();
	await page.getByRole('button', { name: 'Create profile' }).click();
	const dialog = page.getByRole('dialog', { name: 'Create profile' });
	await dialog.getByLabel('Profile name').fill('Work');
	await dialog.getByRole('button', { name: 'Create profile' }).click();
	await page.getByRole('radio', { name: /^English/ }).click();
	await page.getByRole('button', { name: 'Continue →' }).click();
	await page.getByRole('radio', { name: /VND — Vietnamese đồng/ }).click();
	await page.getByRole('button', { name: 'Continue →' }).click();
	await page.getByLabel('Name').fill('Work Cash');
	await page.getByRole('button', { name: 'Finish setup' }).click();
	await page.getByRole('link', { name: 'Transactions' }).click();
	await expect(page.getByText('Only A')).toHaveCount(0);
	await page.getByRole('link', { name: 'Settings' }).click();
	await page.getByRole('link', { name: 'Profiles' }).click();
	await page.getByRole('button', { name: /^Open Personal/ }).click();
	await page.getByRole('link', { name: 'Transactions' }).click();
	await expect(page.getByText('Only A')).toBeVisible();
});

test('renames a profile without changing its data', async ({ page }) => {
	await onboard(page);
	await page.getByRole('link', { name: 'Settings' }).click();
	await page.getByRole('link', { name: 'Profiles' }).click();
	await page.getByRole('button', { name: /^Rename Personal/ }).click();
	const dialog = page.getByRole('dialog', { name: 'Rename' });
	await dialog.getByLabel('Profile name').fill('Household');
	await dialog.getByRole('button', { name: 'Rename' }).click();
	await expect(page.getByRole('heading', { name: 'Household' })).toBeVisible();
	await page.getByRole('link', { name: 'Accounts', exact: true }).click();
	await expect(page.getByText('Test Checking')).toBeVisible();
});

test('reset clears only the selected profile and returns to onboarding', async ({ page }) => {
	await onboard(page);
	await addTransaction(page, { kind: 'expense', amount: '50k', payee: 'Before reset' });
	await page.getByRole('link', { name: 'Settings' }).click();
	await page.getByRole('link', { name: 'Profiles' }).click();
	await page.getByRole('button', { name: /^Reset profile Personal/ }).click();
	const dialog = page.getByRole('dialog', { name: 'Reset profile' });
	await dialog.getByRole('button', { name: 'Reset profile' }).click();
	await expect(page).toHaveURL(/\/onboarding$/);
	await expect(page.getByRole('radiogroup').first()).toBeVisible();
});

test('deleting the last profile returns to the empty picker', async ({ page }) => {
	await onboard(page);
	await page.getByRole('link', { name: 'Settings' }).click();
	await page.getByRole('link', { name: 'Profiles' }).click();
	await page.getByRole('button', { name: /^Delete profile Personal/ }).click();
	const dialog = page.getByRole('dialog', { name: 'Delete profile' });
	await dialog.getByRole('radio', { name: 'Delete without exporting' }).check();
	await dialog.getByRole('button', { name: 'Delete profile' }).click();
	await expect(page).toHaveURL(/\/profiles$/);
	await expect(page.getByRole('heading', { name: 'Choose a profile' })).toBeVisible();
	await expect(page.getByText('No profiles yet')).toBeVisible();
});

nativeTest.describe('native profile routing', () => {
	nativeTest.use({ tauriMockOptions: { persist: true } });

nativeTest('can leave unfinished profile setup to reopen an existing profile', async ({ tauriMockPage: page }) => {
	await onboard(page);
	await flushDb(page);
	await page.getByRole('link', { name: 'Settings' }).click();
	await page.getByRole('link', { name: 'Profiles' }).click();
	await page.getByRole('button', { name: 'Create profile' }).click();
	const dialog = page.getByRole('dialog', { name: 'Create profile' });
	await dialog.getByLabel('Profile name').fill('Trial');
	await dialog.getByRole('button', { name: 'Create profile' }).click();
	await expect(page).toHaveURL(/\/onboarding$/);
	await page.goto('/profiles');
	await expect(page.getByRole('heading', { name: 'Choose a profile' })).toBeVisible();
	await page.getByRole('button', { name: /^Open Personal/ }).click();
	await expect(page).toHaveURL(/\/$/);
});

nativeTest('can delete a profile before completing its setup', async ({ tauriMockPage: page }) => {
	await page.goto('/');
	await page.getByRole('button', { name: 'Create profile' }).click();
	const create = page.getByRole('dialog', { name: 'Create profile' });
	await create.getByLabel('Profile name').fill('Trial');
	await create.getByRole('button', { name: 'Create profile' }).click();
	await expect(page).toHaveURL(/\/onboarding$/);
	await page.goto('/settings/profiles');
	await expect(page.getByRole('heading', { name: 'Profiles' })).toBeVisible();
	await page.getByRole('button', { name: /^Delete profile Trial/ }).click();
	const remove = page.getByRole('dialog', { name: 'Delete profile' });
	await remove.getByRole('radio', { name: 'Delete without exporting' }).check();
	await remove.getByRole('button', { name: 'Delete profile' }).click();
	await expect(page).toHaveURL(/\/profiles$/);
	await expect(page.getByText('No profiles yet')).toBeVisible();
});

});
