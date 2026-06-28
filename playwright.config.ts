import { defineConfig } from '@playwright/test';

export default defineConfig({
	webServer: {
		command: 'pnpm build && pnpm preview',
		port: 4173,
		reuseExistingServer: !process.env.CI
	},
	testDir: 'src/tests/e2e',
	projects: [{ name: 'chromium', use: { browserName: 'chromium' } }],
	expect: {
		// The in-memory DB init + 3 migrations under WASM can take a moment on
		// first load; give assertions breathing room.
		timeout: 10_000
	},
	trace: 'on-first-retry'
});
