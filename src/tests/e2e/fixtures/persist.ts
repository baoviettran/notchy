import type { Page } from '@playwright/test';

/**
 * Flip the mock's IndexedDB persistence ON for reload-survival tests.
 * After this, the live DB flushes to IndexedDB on every write and rehydrates
 * on the next Database.load('sqlite:notchy.db') — so a page.reload() reopens
 * the same data. Must be called BEFORE the first navigation (mock injected
 * with persist:true at addInitScript time), OR used by configuring the fixture
 * with tauriMockOptions: { persist: true }.
 *
 * Note: persistence is configured at mock-injection time (persist: true), not
 * toggled at runtime — so this sets the option global, which the mock reads on
 * loadDb. For guaranteed effect across a reload, inject the mock with
 * persist:true in the first place. Kept for spec readability and future
 * runtime-toggle support.
 */
export async function persistDb(page: Page): Promise<void> {
	await page.evaluate(() => {
		(window as unknown as { __NOTCHY_TAURI_MOCK_OPTIONS__?: { persist?: boolean } }).__NOTCHY_TAURI_MOCK_OPTIONS__ = {
			...((window as unknown as { __NOTCHY_TAURI_MOCK_OPTIONS__?: object }).__NOTCHY_TAURI_MOCK_OPTIONS__),
			persist: true,
		};
	});
}
