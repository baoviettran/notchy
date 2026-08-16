import { describe, it, expect } from 'vitest';
import { computeDatabasePaths } from '$lib/db/platform';

describe('computeDatabasePaths', () => {
	it('keeps the live database under the config dir and backups under the data dir', () => {
		expect(computeDatabasePaths('/data', '/config')).toEqual({
			dataDir: '/data',
			databasePath: '/config/notchy.db',
			routineBackupDir: '/data/backups',
			upgradeBackupDir: '/data/backups/upgrades'
		});
	});
});
