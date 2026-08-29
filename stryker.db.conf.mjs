// @ts-check

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
	plugins: ['@stryker-mutator/vitest-runner'],
	testRunner: 'vitest',
	ignorePatterns: ['/\.codegraph', '/\.codegraph/**', '/\.claude/**', '/\.stryker-tmp'],
	mutate: [
		// db/repos/* are thin forwarders re-exporting browser/repos/*; the
		// implementation is what carries the bug-prone logic, so mutate that.
		'src/lib/db/browser/repos/transactions.ts',
		'src/lib/db/browser/repos/budgets.ts',
		// The Tauri-only runAutoBackup/restore wrappers are exercised by
		// Playwright, which Vitest/Stryker does not run. Keep these ranges to the
		// backup helpers covered by the real-SQL Vitest suite (recovery.ts's
		// tauriRestoreDependencies is excluded for the same reason).
		'src/lib/backup/index.ts:13-21',
		'src/lib/backup/index.ts:96-100',
		'src/lib/backup/index.ts:105-123',
		'src/lib/backup/index.ts:132-145',
		'src/lib/db/browser/schema.ts',
		'src/lib/backup/validation.ts',
		'src/lib/backup/upgrade.ts',
		// src/lib/db/startup.ts does not exist; the migration-ordering engine is
		// prepareDatabase in index.ts (inspect -> backup -> migrate -> verify).
		'src/lib/db/index.ts:231-301',
		'src/lib/recovery.ts:1-75'
	]
};

export default config;
