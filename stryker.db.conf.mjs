// @ts-check

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
	plugins: ['@stryker-mutator/vitest-runner'],
	testRunner: 'vitest',
	mutate: [
		'src/lib/db/repos/transactions.ts',
		// The Tauri-only runAutoBackup/importDatabase paths are exercised by
		// Playwright, which Vitest/Stryker does not run. Keep this target to the
		// backup helpers covered by the real-SQL Vitest suite.
		'src/lib/backup/index.ts:13-21',
		'src/lib/backup/index.ts:96-100',
		'src/lib/backup/index.ts:105-123',
		'src/lib/backup/index.ts:129-195',
		'src/lib/backup/index.ts:221-234',
		'src/lib/backup/validation.ts',
		'src/lib/backup/upgrade.ts',
		'src/lib/db/schema.ts',
		'src/lib/db/startup.ts',
		'src/lib/recovery.ts'
	]
};

export default config;
