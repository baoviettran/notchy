import { describe, it, expect } from 'vitest';
import { getDatabasePaths } from '$lib/db';

describe('browser database paths', () => {
	it('returns synthetic paths without opening a native global database', async () => {
		expect(await getDatabasePaths()).toEqual({
			dataDir: '/web',
			databasePath: '/web/notchy.db',
			routineBackupDir: '/web/backups',
			upgradeBackupDir: '/web/backups/upgrades'
		});
	});
});
