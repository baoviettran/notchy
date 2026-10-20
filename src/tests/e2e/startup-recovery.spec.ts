import { test, expect, clearFaults, listVirtualFs } from './fixtures/tauri-mock';

const RECOVERY = 'Could not open the selected profile';

test.describe('selected profile recovery', () => {
	test.describe('newer schema', () => {
	test.use({ tauriMockOptions: { initialSchemaVersion: 7 } });
	test('keeps finance routes closed and offers recovery for the selected profile', async ({ tauriMockPage: page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: RECOVERY })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Transactions' })).toHaveCount(0);
	await expect(page.getByRole('button', { name: 'Restore backup' }).first()).toBeVisible();
});
});

test.describe('failed migration', () => {
	test.use({ tauriMockOptions: { initialSchemaVersion: 4, failMigrationVersion: 5 } });

test('keeps a verified pre-upgrade backup without opening finance data', async ({ tauriMockPage: page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: RECOVERY })).toBeVisible();
	const backups = await listVirtualFs(page, '/notchy/appdata/profiles/legacy-profile/backups/upgrades/');
	expect(backups.some((path) => path.includes('notchy-pre-upgrade-v4'))).toBe(true);
	await expect(page.getByRole('link', { name: 'Transactions' })).toHaveCount(0);
});

test('retry stays in recovery while the migration fault remains', async ({ tauriMockPage: page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: RECOVERY })).toBeVisible();
	await page.getByRole('button', { name: 'Retry opening profile' }).click();
	await expect(page.getByRole('heading', { name: RECOVERY })).toBeVisible();
	await expect(page.getByRole('link', { name: 'Transactions' })).toHaveCount(0);
});

test('retry opens the selected profile after the fault is cleared', async ({ tauriMockPage: page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: RECOVERY })).toBeVisible();
	await clearFaults(page);
	await page.getByRole('button', { name: 'Retry opening profile' }).click();
	await expect(page.getByRole('radiogroup').first()).toBeVisible();
});
});

test.describe('failed upgrade backup', () => {
	test.use({ tauriMockOptions: { initialSchemaVersion: 4, failUpgradeBackup: true } });

test('does not claim a verified backup was created', async ({ tauriMockPage: page }) => {
	await page.goto('/');
	await expect(page.getByRole('heading', { name: RECOVERY })).toBeVisible();
	const backups = await listVirtualFs(page, '/notchy/appdata/profiles/legacy-profile/backups/upgrades/');
	expect(backups).toEqual([]);
});
});
});
