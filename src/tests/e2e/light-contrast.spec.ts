import { test, expect } from './fixtures/onboarded';

// Regression for light-mode WCAG 1.4.3: html.light --phosphor (#B8721A)
// gave 3.35:1 on primary buttons/FAB and 3.25:1 on the active nav — both
// under 4.5. Deepening to #9A5700 must lift every amber surface to AA.
// Measures the rendered ratio the way a user sees it: text color against
// the *blended* background (bg-phosphor/10 over the parent surface).

function srgb(c: number): number {
	c /= 255;
	return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
}
function luminance(rgb: [number, number, number]): number {
	const [r, g, b] = rgb.map(srgb);
	return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
function contrast(a: [number, number, number], b: [number, number, number]): number {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
}
function parseRgb(c: string): [number, number, number] {
	const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
	if (!m) throw new Error(`unparseable color: ${c}`);
	return [+m[1], +m[2], +m[3]];
}
function parseRgba(c: string): [number, number, number, number] {
	const m = c.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/);
	if (!m) throw new Error(`unparseable color: ${c}`);
	return [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]];
}
function blendOver(fg: [number, number, number, number], bg: [number, number, number]): [number, number, number] {
	return fg.slice(0, 3).map((f, i) => f * fg[3] + bg[i] * (1 - fg[3])) as [number, number, number];
}

async function setLightTheme(page: import('@playwright/test').Page) {
	await page.evaluate(() => {
		document.documentElement.classList.add('light');
		document.documentElement.classList.remove('dark');
	});
}

test.describe('light-mode contrast meets AA', () => {
	test('FAB: text-ink on bg-phosphor ≥ 4.5:1', async ({ onboardedPage: page }) => {
		await setLightTheme(page);
		const fab = page.locator('[data-tour="add"]');
		await expect(fab).toBeVisible();
		const style = await fab.evaluate((el) => {
			const cs = getComputedStyle(el);
			return { color: cs.color, bg: cs.backgroundColor };
		});
		expect(contrast(parseRgb(style.color), parseRgb(style.bg))).toBeGreaterThanOrEqual(4.5);
	});

	test('active sidebar nav: label against the /10 tint blend ≥ 4.5:1', async ({ onboardedPage: page }) => {
		await setLightTheme(page);
		const active = page.locator('aside a[aria-current="page"]').first();
		await expect(active).toBeVisible();
		const style = await active.evaluate((el) => {
			const cs = getComputedStyle(el);
			// Walk up to the first opaque ancestor for the backdrop the 10% tint sits on.
			let over = null as string | null;
			let n = el.parentElement;
			while (n) {
				const c = getComputedStyle(n);
				const m = c.backgroundColor.match(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)(?:\s*,\s*([\d.]+))?/);
				if (m && (m[4] === undefined || m[4] === '1')) { over = `rgb(${m[1]}, ${m[2]}, ${m[3]})`; break; }
				n = n.parentElement;
			}
			return { color: cs.color, fg: cs.backgroundColor, over };
		});
		expect(style.over).not.toBeNull();
		const blended = blendOver(parseRgba(style.fg), parseRgb(style.over!));
		expect(contrast(parseRgb(style.color), blended)).toBeGreaterThanOrEqual(4.5);
	});
});
