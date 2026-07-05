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
	// A few specs (budgets month-nav, settings theme buttons) occasionally time
	// out under parallel workers — the in-memory sql.js DB + global store
	// singletons can race when multiple workers share the preview server. One
	// retry absorbs that flakiness without masking real failures (a genuinely
	// broken test fails twice in a row). Investigate per-worker isolation if
	// the retry rate climbs.
	retries: 1,
	trace: 'on-first-retry'
});
