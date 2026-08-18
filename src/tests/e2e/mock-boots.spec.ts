import { test, expect } from './fixtures/tauri-mock';

// Opt in explicitly: with no tauriMockOptions the app would boot the browser
// fallback, which proves nothing about the mock.
test.use({ tauriMockOptions: {} });

test('mock injects Tauri internals when requested', async ({ tauriMockPage: page }) => {
	await page.goto('/');
	await expect
		.poll(() => page.evaluate(() => typeof (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__))
		.toBe('object');
	await expect
		.poll(() => page.evaluate(() => typeof (window as unknown as Record<string, unknown>).__notchyMock))
		.toBe('object');
});
