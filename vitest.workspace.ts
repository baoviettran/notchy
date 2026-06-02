import { defineWorkspace } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { vitePreprocess } from '@sveltejs/vite-plugin-svelte';
import path from 'path';

export default defineWorkspace([
	// Node tests: DB repos, stores, utilities (sveltekit SSR is fine)
	'vitest.config.ts',
	// Component tests: jsdom + client-side Svelte compilation
	{
		plugins: [
			svelte({
				preprocess: vitePreprocess(),
				compilerOptions: { hydratable: false }
			})
		],
		resolve: {
			alias: {
				'$lib': path.resolve(__dirname, 'src/lib')
			},
			conditions: ['browser']
		},
		test: {
			name: 'components',
			environment: 'jsdom',
			include: ['src/tests/unit/components/**/*.test.ts'],
			setupFiles: ['src/tests/unit/helpers/setup-dom.ts']
		}
	}
]);
