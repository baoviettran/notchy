import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	plugins: [sveltekit()],
	test: {
		include: ['src/**/*.{test,spec}.{js,ts}'],
		exclude: ['src/tests/unit/components/**'],
		environment: 'node',
		setupFiles: ['src/tests/unit/helpers/setup-dom.ts'],
		coverage: {
			provider: 'istanbul',
			reporter: ['text', 'text-summary', 'html'],
			reportsDirectory: 'coverage',
			include: ['src/lib/**/*.ts', 'src/lib/**/*.svelte'],
			exclude: [
				'src/lib/paraglide/**',
				'src/lib/db/migrations/**',
				'src/lib/stores/**',  // $state() runes incompatible with Istanbul instrumentation
				'src/**/*.d.ts',
				'src/tests/**'
			]
		}
	}
});
