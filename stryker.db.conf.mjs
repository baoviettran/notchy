// @ts-check

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
	plugins: ['@stryker-mutator/vitest-runner'],
	testRunner: 'vitest',
	ignorePatterns: ['/\.codegraph', '/\.codegraph/**'],
	mutate: [
		'src/lib/db/repos/transactions.ts',
		// The Tauri-only runAutoBackup/importDatabase paths are exercised by
		// Playwright, which Vitest/Stryker does not run. Keep these ranges to the
		// backup helpers covered by the real-SQL Vitest suite.
		'src/lib/backup/index.ts:13-21',
		'src/lib/backup/index.ts:96-100',
		'src/lib/backup/index.ts:105-123',
		'src/lib/backup/index.ts:129-163',
		'src/lib/backup/index.ts:209-222',
		'src/lib/db/schema.ts',
		'src/lib/backup/validation.ts',
		'src/lib/backup/upgrade.ts'
		// startup.ts and recovery.ts are added after Task 5 creates them.
	]
};

export default config;
