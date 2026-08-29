# Fix Tailwind Opacity Modifiers on Theme Tokens — Implementation Plan
**Serves:** STORY-014

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every opacity-modified utility (`bg-phosphor/10`, `bg-line/60`, `bg-tape/95`, …) actually render an alpha tint instead of computing to `rgba(0,0,0,0)` — restoring the app's designed hierarchy (active-nav tints, progress-bar tracks, mobile bottom-nav surface, banners, hover states).

**Architecture:** The palette tokens are defined as hex CSS vars in `src/app.css` and mapped into Tailwind as `'phosphor': 'var(--phosphor)'`. Tailwind v3 cannot apply an opacity modifier to a color expressed as a bare `var()` reference, so the emitted utility is unusable and the computed background is transparent. Fix: define parallel space-separated RGB-triplet vars (`--phosphor-rgb: 255 180 84`) and map each token in `tailwind.config.ts` as `rgb(var(--phosphor-rgb) / <alpha-value>)` — the documented Tailwind v3 CSS-variable pattern. The existing hex vars stay untouched, so chart components and `palette.ts` (which reference `var(--phosphor)` directly in inline SVG styles) are unaffected.

**Tech Stack:** SvelteKit 2 + Svelte 5, Tailwind CSS 3.4.17, Playwright (`src/tests/e2e`, runs against `pnpm build && pnpm preview`), Vitest.

**Spec:** `/impeccable critique` snapshot `.impeccable/critique/2026-08-21T15-05-19Z__src-routes.md`, Priority Issue 1 (P1 — systemic opacity bug). Verified in the live app: 43 call sites, 13 unique modifier classes.

## Global Constraints

- **Tailwind pinned at 3.4.17** — use the v3 `<alpha-value>` pattern; do NOT migrate to Tailwind v4 `@theme`.
- **Keep the existing hex vars** (`--ink`, `--phosphor`, …) unchanged. `src/lib/utils/palette.ts`, `GroupedBarChart.svelte`, `LineChart.svelte`, `StackedAreaChart.svelte`, and `quick-add/+page.svelte` reference them directly; the unit tests `src/tests/unit/components/*Chart.test.ts` assert `var(--phosphor)` / `var(--line)` / `var(--dim)` literally appear in style blocks — those assertions must keep passing.
- **Theme classes:** `:root` is the dark default, `html.light` is the light variant. The settings store toggles `html.light`/`html.dark` (`src/lib/stores/settings.svelte.ts:47-48`); there is no `html.dark` CSS block, so `html.dark` inherits `:root`. RGB-triplet vars must be added in BOTH `:root` and `html.light`.
- **E2E runs against the built app** (`pnpm build && pnpm preview`, port 4173) per `playwright.config.ts`. Never assert against the dev server.
- **Commit prefix `fix:`.** All tests green before commit (CLAUDE.md TDD discipline).

---

### Task 1: Render opacity modifiers on theme tokens

**Files:**
- Create: `src/tests/e2e/theme-opacity.spec.ts`
- Modify: `src/app.css` (add `--*-rgb` vars to `:root` and `html.light`)
- Modify: `tailwind.config.ts` (rewrite the `colors` block to the `<alpha-value>` pattern)

**Interfaces:**
- Consumes: the existing `onboardedPage` fixture (`src/tests/e2e/fixtures/onboarded.ts`), which runs real onboarding and leaves the app on the Dashboard with one account and no budget/transactions.
- Produces: no new module interfaces — this is a token/CSS change. The regression spec below is the contract that later tasks' styling must keep green.

- [x] **Step 1: Write the failing regression test**

Create `src/tests/e2e/theme-opacity.spec.ts`:

```ts
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
```

- [x] **Step 2: Run the test and verify it fails**

Run: `pnpm exec playwright test src/tests/e2e/theme-opacity.spec.ts`
Expected: all 3 tests FAIL — each assertion sees the computed background `rgba(0, 0, 0, 0)` (the nav/sidebar/meter render, but with no usable background). Playwright config builds the app first (`pnpm build && pnpm preview`), so allow a few minutes on first run.

- [x] **Step 3: Add RGB-triplet vars to `src/app.css`**

In the `:root` block (dark default), after the existing `--debit: #E5484D;` line, add:

```css
		--ink-rgb: 20 17 12;
		--tape-rgb: 28 24 18;
		--ledger-rgb: 214 207 192;
		--dim-rgb: 138 129 112;
		--line-rgb: 128 119 99;
		--phosphor-rgb: 255 180 84;
		--phosphor-bright-rgb: 255 215 154;
		--debit-rgb: 229 72 77;
```

In the `html.light` block, after `--debit: #C23B3F;`, add:

```css
		--ink-rgb: 244 239 226;
		--tape-rgb: 251 248 241;
		--ledger-rgb: 31 27 20;
		--dim-rgb: 107 99 83;
		--line-rgb: 154 140 110;
		--phosphor-rgb: 184 114 26;
		--phosphor-bright-rgb: 184 114 26;
		--debit-rgb: 194 59 63;
```

Do NOT touch the existing hex vars or any direct `var(--x)` usage elsewhere in the file — they stay for inline SVG/chart/quick-add styles.

- [x] **Step 4: Update `tailwind.config.ts` to the `<alpha-value>` pattern**

Replace the entire `colors` block:

```ts
			colors: {
				// Adding Machine palette — values are RGB-triplet CSS variables
				// (defined in app.css as --*-rgb) so Tailwind v3's opacity
				// modifier can apply an alpha channel via <alpha-value>. The
				// triplet flips with the html.light / html.dark class, same as
				// the hex --* vars they pair with.
				ink: 'rgb(var(--ink-rgb) / <alpha-value>)',
				tape: 'rgb(var(--tape-rgb) / <alpha-value>)',
				ledger: 'rgb(var(--ledger-rgb) / <alpha-value>)',
				dim: 'rgb(var(--dim-rgb) / <alpha-value>)',
				line: 'rgb(var(--line-rgb) / <alpha-value>)',
				phosphor: 'rgb(var(--phosphor-rgb) / <alpha-value>)',
				'phosphor-bright': 'rgb(var(--phosphor-bright-rgb) / <alpha-value>)',
				debit: 'rgb(var(--debit-rgb) / <alpha-value>)'
			},
```

Leave `darkMode: 'class'`, `content`, and `fontFamily` as they are.

- [x] **Step 5: Run the regression test and verify it passes**

Run: `pnpm exec playwright test src/tests/e2e/theme-opacity.spec.ts`
Expected: all 3 tests PASS. The active nav now shows `rgba(<phosphor>, 0.1)`, the meter track `rgba(<line>, 0.6)`, and the bottom nav `rgba(<tape>, 0.95)`.

- [x] **Step 6: Run unit tests and typecheck**

Run: `pnpm test` and `pnpm check`
Expected: both green. The chart unit tests must still pass — they assert `var(--phosphor)` / `var(--line)` / `var(--dim)` literally in SVG style blocks, which the fix preserves.

- [x] **Step 7: Run the full E2E suite**

Run: `pnpm test:e2e`
Expected: all specs pass (retries absorb the known in-memory-DB worker flakiness). This is the gate for a change that touches every screen's generated CSS.

- [x] **Step 8: Commit**

```bash
git add src/tests/e2e/theme-opacity.spec.ts src/app.css tailwind.config.ts
git commit -m "$(cat <<'EOF'
fix(ui): render opacity modifiers on theme tokens via rgb <alpha-value>

bg-phosphor/10, bg-line/60, bg-tape/95 etc. computed to rgba(0,0,0,0)
because the palette mapped to bare CSS var() hex strings, which Tailwind
v3 cannot apply an alpha channel to. Add --*-rgb triplet vars and map
tokens as rgb(var(--*-rgb) / <alpha-value>); keep the hex vars for
inline SVG/chart/quick-add styles. Regression spec: theme-opacity.spec.ts.
EOF
)"
```
