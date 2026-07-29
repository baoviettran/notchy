// @ts-check

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
	plugins: ['@stryker-mutator/vitest-runner'],
	testRunner: 'vitest',
	mutate: [
		'src/lib/utils/rules_matcher.ts',
		'src/lib/utils/dedup.ts',
		'src/lib/db/repos/transactions.ts',
		'src/lib/backup/index.ts'
	]
};

export default config;
