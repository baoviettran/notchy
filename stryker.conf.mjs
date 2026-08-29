// @ts-check

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
	plugins: ['@stryker-mutator/vitest-runner'],
	testRunner: 'vitest',
	ignorePatterns: ['/\.codegraph', '/\.codegraph/**', '/\.claude/**', '/\.stryker-tmp'],
	mutate: [
		'src/lib/utils/rules_matcher.ts',
		'src/lib/utils/dedup.ts',
		// db/native/client.ts is only meaningful once native-boundary.test.ts
		// (Task 2) locks op -> command name + arg shape; command-string or
		// arg-key mutants are now caught there.
		'src/lib/db/native/client.ts'
	]
};

export default config;
