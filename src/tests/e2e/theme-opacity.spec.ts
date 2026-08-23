import { test, expect } from './fixtures/onboarded';
import type { Locator } from '@playwright/test';

// Regression for the systemic alpha bug: tailwind.config.ts mapped palette
// tokens to CSS var() hex strings, so Tailwind v3's opacity modifier (/10,
// /60, /95) could not apply an alpha channel and every such utility computed
// to rgba(0,0,0,0). Asserts three real surfaces resolve non-transparent.

const TRANSPARENT = 'rgba(0, 0, 0, 0)';

async function backgroundOf(locator: Locator): Promise<string> {
	return locator.evaluate((el: HTMLElement) => getComputedStyle(el).backgroundColor);
}

test.describe('token opacity modifiers render', () => {
	test('sidebar active tint (bg-phosphor/10) is visible', async ({ onboardedPage: page }) => {
		const active = page.locator('aside a[aria-current="page"]').first();
		await expect(active).toBeVisible();
		const bg = await backgroundOf(active);
		expect(bg).not.toBe(TRANSPARENT);
	});

	test('budget meter track segments (bg-line/60) are visible', async ({ onboardedPage: page }) => {
		// A freshly onboarded app has no allocations, so every segment is the
		// unfilled track color — the bar should read as a visible track, not a
		// hollow box.
		const meter = page.getByRole('progressbar').first();
		await expect(meter).toBeVisible();
		const firstSegment = meter.locator('div').first();
		const bg = await backgroundOf(firstSegment);
		expect(bg).not.toBe(TRANSPARENT);
	});

	test('mobile bottom-nav surface (bg-tape/95) is opaque', async ({ onboardedPage: page }) => {
		// The nav must not float transparent over scrolling content.
		await page.setViewportSize({ width: 390, height: 844 });
		const nav = page.locator('nav.fixed.bottom-0');
		await expect(nav).toBeVisible();
		const bg = await backgroundOf(nav);
		expect(bg).not.toBe(TRANSPARENT);
	});
});
