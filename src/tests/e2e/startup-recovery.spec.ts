import { test, expect, clearFaults, lastOpenedPath, listVirtualFs } from './fixtures/tauri-mock';
import type { Page } from '@playwright/test';

/**
 * Protected-startup recovery journeys (Task 8).
 *
 * Drives the REAL startup coordinator (initializeMainDatabase → prepareDatabase),
 * migration runner, and recovery UI against the Tauri IPC mock with seeded
 * released-schema databases and injected upgrade/migration failures:
 *   - initialSchemaVersion 6 → database_schema_newer (finance routes blocked)
 *   - initialSchemaVersion 4 + failMigrationVersion 5 → migration_failed with a
 *     verified pre-upgrade backup (v4→v5) available for restore
 *   - initialSchemaVersion 4 + failUpgradeBackup → upgrade_backup_failed with
 *     no restore action available
 * The restore journey clears the injected fault via the mock-only callback,
 * clicks Restore, and asserts the fixture transaction survives at schema 5.
 */
async function liveQuery<T>(page: Page, sql: string): Promise<T[]> {
	return page.evaluate((sql) => {
		const hooks = (window as unknown as {
			__notchyTestHooks?: { getDb: () => Promise<{ query: (sql: string) => Promise<unknown[]> }> };
		}).__notchyTestHooks;
		if (!hooks) throw new Error('__notchyTestHooks not exposed');
		return hooks.getDb().then((db) => db.query(sql));
	}, sql) as Promise<T[]>;
}

test.describe('protected startup', () => {
	test.describe('schema newer', () => {
		test.use({ tauriMockOptions: { initialSchemaVersion: 6 } });

		test('blocks finance routes when the database schema is newer', async ({ tauriMockPage: page }) => {
			await page.goto('/');
			await expect(page.getByRole('heading', { name: 'Notchy needs attention' })).toBeVisible();
			await expect(page.getByText(/schema 6/i)).toBeVisible();
			await expect(page.getByRole('link', { name: 'Transactions' })).toHaveCount(0);
		});
	});

	test.describe('migration failure', () => {
		test.use({ tauriMockOptions: { initialSchemaVersion: 4, failMigrationVersion: 5 } });

		test('shows a verified backup after a migration failure', async ({ tauriMockPage: page }) => {
			await page.goto('/');
			await expect(page.getByRole('button', { name: 'Restore verified backup' })).toBeVisible();
			await expect(page.getByText(/notchy-pre-upgrade-v4-to-v5/)).toBeVisible();
		});

		test('retry does not reach finance UI while the fault remains', async ({ tauriMockPage: page }) => {
			await page.goto('/');
			await expect(page.getByRole('heading', { name: 'Notchy needs attention' })).toBeVisible();

			// A verified pre-upgrade backup exists after the failed startup.
			const backupsBefore = await listVirtualFs(page, '/notchy/appdata/backups/upgrades');
			expect(backupsBefore.length).toBeGreaterThan(0);

			// Retry re-runs startup; the still-armed fault produces a NEW pre-upgrade
			// backup and fails migration again — finance UI is never reached.
			await page.getByRole('button', { name: 'Retry' }).click();
			await expect
				.poll(async () => (await listVirtualFs(page, '/notchy/appdata/backups/upgrades')).length)
				.toBe(backupsBefore.length + 1);
			await expect(page.getByRole('heading', { name: 'Notchy needs attention' })).toBeVisible();
			await expect(page.getByRole('link', { name: 'Transactions' })).toHaveCount(0);
		});

		test('open backup folder records the upgrade backup directory', async ({ tauriMockPage: page }) => {
			await page.goto('/');
			await page.getByRole('button', { name: 'Open backup folder' }).click();
			await expect.poll(() => lastOpenedPath(page)).toBe('/notchy/appdata/backups/upgrades');
		});
	});

	test.describe('migration failure restore', () => {
		test.use({
			tauriMockOptions: {
				persist: true,
				initialSchemaVersion: 4,
				failMigrationVersion: 5,
				seedMeta: { first_run_complete: '1' }
			}
		});

		test('restore clears the injected fault and migrates forward', async ({ tauriMockPage: page }) => {
			await page.goto('/');
			await expect(page.getByRole('button', { name: 'Restore verified backup' })).toBeVisible();

			// Disarm the injected migration failure (mock-only; survives the reload
			// so the post-restore startup can migrate forward).
			await clearFaults(page);

			await page.getByRole('button', { name: 'Restore verified backup' }).click();
			await page.getByRole('dialog').getByRole('button', { name: 'Restore verified backup' }).click();

			// restoreCompatibleDatabase replaces the live file and reloads; startup
			// re-runs against the restored schema-4 backup, migration 005 is
			// idempotent, and the app reaches the Dashboard at schema 5.
			await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();

			// The original released-fixture transaction survives the round trip.
			const rows = await liveQuery<{ id: string; amount: number }>(
				page,
				"SELECT id, amount FROM transactions WHERE id = 'txn_fixture_v004'"
			);
			expect(rows).toEqual([{ id: 'txn_fixture_v004', amount: 987654321 }]);

			// Forward migration completed: the live DB is back on the current schema.
			const schema = await liveQuery<{ value: string }>(
				page,
				"SELECT value FROM app_meta WHERE key = 'schema_version'"
			);
			expect(schema[0].value).toBe('5');
		});
	});

	test.describe('upgrade backup failure', () => {
		test.use({ tauriMockOptions: { initialSchemaVersion: 4, failUpgradeBackup: true } });

		test('shows no restore button when the pre-upgrade backup fails', async ({ tauriMockPage: page }) => {
			await page.goto('/');
			await expect(page.getByRole('heading', { name: 'Notchy needs attention' })).toBeVisible();
			await expect(page.getByRole('button', { name: 'Restore verified backup' })).toHaveCount(0);
		});
	});
});
