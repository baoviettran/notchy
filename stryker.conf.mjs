// @ts-check

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
	plugins: ['@stryker-mutator/vitest-runner'],
	testRunner: 'vitest',
	ignorePatterns: ['/\.codegraph', '/\.codegraph/**'],
	mutate: [
		'src/lib/utils/rules_matcher.ts',
		'src/lib/utils/dedup.ts'
	]
};

export default config;
