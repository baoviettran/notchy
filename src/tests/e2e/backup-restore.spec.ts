import { test, expect, rawQuery, rawExecute, writeVirtualFs, readVirtualFs, flushDb } from './fixtures/tauri-mock';
import { onboard, addTransaction } from './helpers/ui';
import type { Page } from '@playwright/test';

const invoke = <T>(page: Page, command: string, args: Record<string, unknown> = {}): Promise<T> =>
	page.evaluate(async ({ command, args }) => {
		const ipc = (window as any).__TAURI_INTERNALS__;
		if (command.startsWith('backup_automatic_')) args = { ...args, session: (await ipc.invoke('profiles_load')).active };
		return ipc.invoke(command, args);
	}, { command, args });
const active = (page: Page) => invoke<{ active: { profileId: string; generation: string } }>(page, 'profiles_load').then((snapshot) => snapshot.active);

test.describe('profile backup and restore', () => {
	test.use({ tauriMockOptions: { persist: true } });

test('restores a backup as a new profile and preserves the original', async ({ tauriMockPage: page }) => {
	await onboard(page, { accountName: 'Original account' });
	const original = await active(page);
	const path = await invoke<string>(page, 'profile_backup', { id: original.profileId });
	const before = await rawQuery<{ id: string }>(page, 'SELECT id FROM accounts WHERE deleted_at IS NULL');
	expect(before).toHaveLength(1);
	await rawExecute(page, `INSERT INTO accounts (id, name, type, currency, created_at, updated_at) VALUES ('diverged', 'After backup', 'checking', 'VND', '2026-01-01', '2026-01-01')`);
	await flushDb(page);
	const preview = await invoke<{ token: string; schemaVersion: number }>(page, 'profile_inspect_restore', { sourcePath: path });
	expect(preview.schemaVersion).toBe(7);
	await invoke(page, 'profile_restore', { token: preview.token, name: 'Recovered', context: { operationId: 'restore-1', transitionToken: null } });
	expect(await rawQuery<{ id: string }>(page, 'SELECT id FROM accounts WHERE deleted_at IS NULL')).toHaveLength(2);
	await page.reload();
	await page.getByRole('link', { name: 'Settings' }).click();
	await page.getByRole('link', { name: 'Profiles' }).click();
	await page.getByRole('button', { name: /^Open Recovered/ }).click();
	await page.getByRole('link', { name: 'Accounts', exact: true }).click();
	await expect(page.getByText('Original account')).toBeVisible();
	await expect(page.getByText('After backup')).toHaveCount(0);
});

test('rejects corrupt backup bytes without changing the selected profile', async ({ tauriMockPage: page }) => {
	await onboard(page);
	const original = await active(page);
	await writeVirtualFs(page, '/outside/broken.sqlite', new TextEncoder().encode('broken'));
	await expect(invoke(page, 'profile_inspect_restore', { sourcePath: '/outside/broken.sqlite' })).rejects.toThrow();
	expect((await active(page)).profileId).toBe(original.profileId);
	expect(await rawQuery<{ id: string }>(page, 'SELECT id FROM accounts WHERE deleted_at IS NULL')).toHaveLength(1);
});

test('rejects a backup from a newer schema without changing the selected profile', async ({ tauriMockPage: page }) => {
	await onboard(page);
	const original = await active(page);
	await rawExecute(page, "UPDATE app_meta SET value='8' WHERE key='schema_version'");
	const path = await invoke<string>(page, 'profile_backup', { id: original.profileId });
	await rawExecute(page, "UPDATE app_meta SET value='7' WHERE key='schema_version'");
	await expect(invoke(page, 'profile_inspect_restore', { sourcePath: path })).rejects.toThrow();
	expect((await active(page)).profileId).toBe(original.profileId);
});

test('exports a backup to the requested path', async ({ tauriMockPage: page }) => {
	await onboard(page);
	const original = await active(page);
	await invoke(page, 'profile_export_backup', { id: original.profileId, targetPath: '/outside/personal.sqlite' });
	const bytes = await readVirtualFs(page, '/outside/personal.sqlite');
	expect(bytes?.length).toBeGreaterThan(100);
});

test('reset leaves a recoverable snapshot and an empty selected profile', async ({ tauriMockPage: page }) => {
	await onboard(page);
	const original = await active(page);
	await invoke(page, 'profile_reset', { id: original.profileId, context: { operationId: 'reset-1', transitionToken: 'test-token' } });
	const next = await active(page);
	expect(next.profileId).toBe(original.profileId);
	expect(next.generation).not.toBe(original.generation);
	expect(await rawQuery<{ id: string }>(page, 'SELECT id FROM accounts WHERE deleted_at IS NULL')).toHaveLength(0);
	const backups = await invoke<Array<{ path: string }>>(page, 'profile_discover_backups', { id: original.profileId });
	expect(backups.some((backup) => backup.path.includes('/resets/'))).toBe(true);
	await page.reload();
	await expect(page.getByRole('radiogroup').first()).toBeVisible();
});
// IPC is a browser fixture here; native acceptance separately proves real files.
test('shows enabled automatic backups and waits after a same-day second write', async ({ tauriMockPage: page }) => {
	await onboard(page);
	await page.getByRole('link', { name: 'Settings' }).click();
	await page.getByRole('link', { name: 'Backup & Data' }).click();
	const enabled = page.getByRole('checkbox', { name: 'Enable automatic backups' });
	await expect(enabled).toBeChecked();
	await enabled.uncheck();
	await expect(enabled).not.toBeChecked();
	await expect(page.getByText('Paused', { exact: true })).toBeVisible();
	await enabled.check();
	await invoke(page, 'backup_automatic_check');
	await page.reload();
	await expect(page.getByRole('checkbox', { name: 'Enable automatic backups' })).toBeChecked();
	const before = await invoke<{ backedUpRevision: number; lastSuccessAt: string; nextEligibleDate: string }>(page, 'backup_automatic_status');
	await expect(page.getByText(before.lastSuccessAt, { exact: true })).toBeVisible();
	await expect(page.getByText(before.nextEligibleDate, { exact: true })).toBeVisible();
	await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
	await addTransaction(page, { kind: 'expense', amount: '1234', payee: 'After automatic copy' });
	const after = await invoke<{ contentRevision: number; backedUpRevision: number; lastSuccessAt: string }>(page, 'backup_automatic_check');
	expect(after.contentRevision).toBeGreaterThan(after.backedUpRevision);
	expect(after.backedUpRevision).toBe(before.backedUpRevision);
	expect(after.lastSuccessAt).toBe(before.lastSuccessAt);
});

test('keeps a failed backup visible with the previous success and a keyboard retry', async ({ tauriMockPage: page }) => {
	await onboard(page);
	await rawExecute(page, "UPDATE automatic_backup_state SET warning='backup_automatic_failed', last_success_at='2026-10-25T10:00:00Z', last_success_date='2026-10-25', enabled=0");
	await page.getByRole('link', { name: 'Settings' }).click();
	await page.getByRole('link', { name: 'Backup & Data' }).click();
	await expect(page.getByText('2026-10-25T10:00:00Z', { exact: true })).toBeVisible();
	await expect(page.getByRole('status').filter({ hasText: 'The automatic backup could not finish' })).toBeVisible();
	const retry = page.getByRole('button', { name: 'Retry backup check' });
	await retry.focus();
	await page.keyboard.press('Enter');
	await expect(retry).toBeEnabled();
	await expect(page.getByRole('status').filter({ hasText: 'The automatic backup could not finish' })).toBeVisible();
	await expect(page.getByText('2026-10-25T10:00:00Z', { exact: true })).toBeVisible();
});
});
