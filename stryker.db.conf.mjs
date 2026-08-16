// @ts-check

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
	plugins: ['@stryker-mutator/vitest-runner'],
	testRunner: 'vitest',
	ignorePatterns: ['/\.codegraph', '/\.codegraph/**'],
	mutate: [
		'src/lib/db/schema.ts',
		'src/lib/backup/validation.ts',
		'src/lib/backup/upgrade.ts'
	]
};

export default config;
