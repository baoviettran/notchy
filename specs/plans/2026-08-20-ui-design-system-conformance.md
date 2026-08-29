# UI Design-System Conformance Implementation Plan
**Serves:** STORY-014

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Bring Notchy's outliers into the Adding Machine design system — chart colors, page titles, the reports sub-nav, and the top bar's dead controls.

**Architecture:** All chart colors become CSS-variable references to the design tokens defined in `src/app.css`, so they flip with `html.light` / `html.dark` like every other surface. A shared `src/lib/utils/palette.ts` provides a token-derived categorical ramp; charts pass colors to SVG via the `style` attribute (presentation attributes can't resolve `var()`). `ReportsNav` extracts the duplicated 7-link sub-nav; `TopBar` wires its inert search and language button. Body type gains IBM Plex Sans to pair with Plex Mono.

**Tech Stack:** Svelte 5 runes, Tailwind v3 (CSS-var tokens), LayerCake/d3 charts, Vitest + @testing-library/svelte, @fontsource.

**Spec:** `specs/2026-08-20-ui-design-system-conformance.md` (design review). The plan argues from that spec; executors read both.

## Global Constraints

- **Token-only colors:** every chart color must reference the app.css tokens (`--phosphor`, `--debit`, `--phosphor-bright`, `--dim`, `--line`, `--ledger`). No raw hexes in chart components or report pages. Copy values verbatim from `src/app.css` when in doubt.
- **SVG + `var()`:** SVG presentation attributes (`fill=`, `stroke=`) cannot resolve CSS `var()`. Any color that is a token reference must reach the SVG element through `style="fill: var(--...)"` (a `style` attribute), not an attribute.
- **TDD red-green-refactor:** write the failing test first, watch it fail, implement the minimum, watch it pass, then commit. `pnpm test` must be fully green before each commit.
- **TDD exceptions (per project CLAUDE.md, "ask first"):** Tasks 7 (markup class convention) and the wiring steps of Task 8 (behavioral glue for `goto` / `setLocale`) and Task 9 (config/dependency) have no meaningful unit test without mocking stores or the DB — the testing conventions in `src/tests/CLAUDE.md` forbid those mocks. These steps are verified with `pnpm check`, `pnpm dev`, and grep instead, and are called out where they occur.
- **Paraglide:** ReportsNav reuses existing message keys only — no new i18n strings. The language toggle shows a plain language code (not a translated string).
- **Commit prefixes:** `feat:`, `fix:`, `refactor:` per change.
- **Roadmap discipline:** as each task's commit lands, flip that task's step checkboxes to `[x]` in this file. After the final task, run `pnpm test:roadmap` and commit the regenerated `specs/STATUS.md`.

---

### Task 1: Chart styles use design tokens, not undefined library vars

**Files:**
- Test: `src/tests/unit/components/LineChart.test.ts` (append)
- Modify: `src/lib/components/charts/LineChart.svelte:112-141` (the `<style>` block)
- Test: `src/tests/unit/components/StackedAreaChart.test.ts` (append)
- Modify: `src/lib/components/charts/StackedAreaChart.svelte:173-217` (the `<style>` block)
- Test: `src/tests/unit/components/GroupedBarChart.test.ts` (append)
- Modify: `src/lib/components/charts/GroupedBarChart.svelte:167-211` (the `<style>` block)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: chart components whose CSS uses `var(--phosphor)`, `var(--line)`, `var(--dim)` — the basis for every later chart task.

Fixes the spec finding #1: `var(--color-phosphor, #00ff00)` → green fallback, `var(--color-chalk, #666)` → gray fallback. The real tokens are `--phosphor`, `--line`, `--dim`.

- [x] **Step 1: Write the failing test for LineChart**

Append to `src/tests/unit/components/LineChart.test.ts`:

```ts
	it('uses design-system tokens, not library fallbacks', () => {
		render(LineChart, {
			props: { data: sampleData, xFormat, yFormat, showArea: true }
		});
		const style = Array.from(document.querySelectorAll('style'))
			.map((s) => s.textContent ?? '')
			.join('\n');
		expect(style).toMatch(/\.line-stroke\s*\{[^}]*var\(--phosphor\)/);
		expect(style).toMatch(/\.tick-label\s*\{[^}]*var\(--dim\)/);
		expect(style).toMatch(/\.axis-line\s*\{[^}]*var\(--line\)/);
		expect(style).not.toContain('--color-');
		expect(style).not.toContain('#00ff00');
		expect(style).not.toContain('#666');
	});
```

- [x] **Step 2: Run the LineChart test to verify it fails**

Run: `pnpm test -- src/tests/unit/components/LineChart.test.ts`
Expected: FAIL — `expect(style).not.toContain('--color-')` (the compiled style still contains `--color-phosphor` / `--color-chalk`).

- [x] **Step 3: Fix the LineChart style block**

In `src/lib/components/charts/LineChart.svelte`, replace the `<style>` rules:

```css
	.area-fill {
		fill: var(--phosphor);
		opacity: 0.2;
	}

	.line-stroke {
		fill: none;
		stroke: var(--phosphor);
		stroke-width: 2;
	}

	.axis-line {
		stroke: var(--line);
		stroke-width: 1;
	}

	.tick-line {
		stroke: var(--line);
		stroke-width: 1;
	}

	.tick-label {
		fill: var(--dim);
		font-size: 10px;
		text-anchor: middle;
	}
```

(`.y-axis .tick-label` is unchanged.)

- [x] **Step 4: Run the LineChart test to verify it passes**

Run: `pnpm test -- src/tests/unit/components/LineChart.test.ts`
Expected: PASS (all tests in the file).

- [x] **Step 5: Write the failing test for StackedAreaChart**

Append to `src/tests/unit/components/StackedAreaChart.test.ts`:

```ts
	it('uses design-system tokens, not library fallbacks', () => {
		render(StackedAreaChart, {
			props: {
				data: [{ month: '01', tags: [] }],
				colors: {},
				yFormat: (n) => `$${n}`,
				xFormat: (m) => m
			}
		});
		const style = Array.from(document.querySelectorAll('style'))
			.map((s) => s.textContent ?? '')
			.join('\n');
		expect(style).toMatch(/\.axis-line\s*\{[^}]*var\(--line\)/);
		expect(style).toMatch(/\.tick-label\s*\{[^}]*var\(--dim\)/);
		expect(style).toMatch(/\.legend-label\s*\{[^}]*var\(--dim\)/);
		expect(style).not.toContain('--color-');
		expect(style).not.toContain('#666');
	});
```

- [x] **Step 6: Run the StackedAreaChart test to verify it fails**

Run: `pnpm test -- src/tests/unit/components/StackedAreaChart.test.ts`
Expected: FAIL — `not.toContain('--color-')`.

- [x] **Step 7: Fix the StackedAreaChart style block**

In `src/lib/components/charts/StackedAreaChart.svelte`, replace the `<style>` rules:

```css
	.axis-line {
		stroke: var(--line);
		stroke-width: 1;
	}

	.tick-line {
		stroke: var(--line);
		stroke-width: 1;
	}

	.tick-label {
		fill: var(--dim);
		font-size: 10px;
		text-anchor: middle;
	}

	.y-axis .tick-label {
		text-anchor: end;
		dominant-baseline: middle;
	}

	.legend-label {
		color: var(--dim);
	}
```

- [x] **Step 8: Run the StackedAreaChart test to verify it passes**

Run: `pnpm test -- src/tests/unit/components/StackedAreaChart.test.ts`
Expected: PASS.

- [x] **Step 9: Write the failing test for GroupedBarChart**

Append to `src/tests/unit/components/GroupedBarChart.test.ts`:

```ts
	it('uses design-system tokens, not library fallbacks', () => {
		render(GroupedBarChart, {
			props: {
				data: [],
				yFormat: (n) => `$${n}`,
				xFormat: (m) => m
			}
		});
		const style = Array.from(document.querySelectorAll('style'))
			.map((s) => s.textContent ?? '')
			.join('\n');
		expect(style).toMatch(/\.axis-line\s*\{[^}]*var\(--line\)/);
		expect(style).toMatch(/\.tick-label\s*\{[^}]*var\(--dim\)/);
		expect(style).toMatch(/\.legend-label\s*\{[^}]*var\(--dim\)/);
		expect(style).not.toContain('--color-');
		expect(style).not.toContain('#666');
	});
```

- [x] **Step 10: Run the GroupedBarChart test to verify it fails**

Run: `pnpm test -- src/tests/unit/components/GroupedBarChart.test.ts`
Expected: FAIL — `not.toContain('--color-')`.

- [x] **Step 11: Fix the GroupedBarChart style block**

In `src/lib/components/charts/GroupedBarChart.svelte`, replace the `<style>` rules exactly as in Step 7 (`.axis-line` → `var(--line)`, `.tick-line` → `var(--line)`, `.tick-label` → `var(--dim)`, `.legend-label` → `var(--dim)`).

- [x] **Step 12: Run the GroupedBarChart test to verify it passes**

Run: `pnpm test -- src/tests/unit/components/GroupedBarChart.test.ts`
Expected: PASS.

- [x] **Step 13: Run the full suite**

Run: `pnpm test`
Expected: all green.

- [x] **Step 14: Commit**

```bash
git add src/lib/components/charts/LineChart.svelte src/lib/components/charts/StackedAreaChart.svelte src/lib/components/charts/GroupedBarChart.svelte src/tests/unit/components/LineChart.test.ts src/tests/unit/components/StackedAreaChart.test.ts src/tests/unit/components/GroupedBarChart.test.ts
git commit -m "fix(charts): use design-system tokens in chart styles"
```

---

### Task 2: Token-derived categorical ramp module

**Files:**
- Create: `src/lib/utils/palette.ts`
- Test: `src/tests/unit/palette.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `reportSeriesColors: readonly string[]` (6 `var(--...)` token strings) and `seriesColor(index: number): string` (cycles, tolerates negatives). Tasks 3 and 4 consume these.

- [x] **Step 1: Write the failing test**

Create `src/tests/unit/palette.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { reportSeriesColors, seriesColor } from '../../lib/utils/palette';

describe('report series palette', () => {
	it('references design-system tokens, never raw hexes', () => {
		expect(reportSeriesColors.length).toBeGreaterThanOrEqual(4);
		for (const color of reportSeriesColors) {
			expect(color).toMatch(/^var\(--[a-z][a-z-]*\)$/);
		}
	});

	it('returns a token reference for any index', () => {
		expect(seriesColor(0)).toBe(reportSeriesColors[0]);
		expect(seriesColor(3)).toBe(reportSeriesColors[3]);
	});

	it('cycles and tolerates negative indices', () => {
		expect(seriesColor(reportSeriesColors.length)).toBe(reportSeriesColors[0]);
		expect(seriesColor(-1)).toBe(reportSeriesColors[reportSeriesColors.length - 1]);
	});
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/tests/unit/palette.test.ts`
Expected: FAIL — module `'../../lib/utils/palette'` cannot be resolved.

- [x] **Step 3: Write the implementation**

Create `src/lib/utils/palette.ts`:

```ts
// Categorical ramp built from the Adding Machine tokens (app.css). Charts never
// carry raw hexes — colors reference the CSS variables so the ramp flips with
// html.light / html.dark like every other surface. Values are CSS var()
// strings; SVG fills/strokes take them via the style attribute (presentation
// attributes cannot resolve var()).
export const reportSeriesColors = [
	'var(--phosphor)',
	'var(--debit)',
	'var(--phosphor-bright)',
	'var(--dim)',
	'var(--line)',
	'var(--ledger)'
] as const;

export function seriesColor(index: number): string {
	const n = reportSeriesColors.length;
	return reportSeriesColors[((index % n) + n) % n];
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/tests/unit/palette.test.ts`
Expected: PASS.

- [x] **Step 5: Commit**

```bash
git add src/lib/utils/palette.ts src/tests/unit/palette.test.ts
git commit -m "feat(ui): add token-derived report palette module"
```

---

### Task 3: Donut uses the token ramp and shows a center readout

**Files:**
- Test: `src/tests/unit/components/DonutChart.test.ts` (append)
- Modify: `src/lib/components/charts/DonutChart.svelte`
- Modify: `src/routes/reports/+page.svelte:13-22,91`

**Interfaces:**
- Consumes: `seriesColor` from Task 2.
- Produces: `DonutChart` gains an optional `centerLabel?: string` prop and renders colors through `style="fill: ..."`. Later tasks do not depend on these, but the ramp is reused in Task 4.

- [x] **Step 1: Write the failing tests for DonutChart**

Append to `src/tests/unit/components/DonutChart.test.ts`:

```ts
	it('applies colors through the style attribute so CSS var() references resolve', () => {
		const data = [{ label: 'A', value: 100, color: 'var(--phosphor)' }];
		const { container } = render(DonutChart, { props: { data } });
		const path = container.querySelector('path');
		expect(path?.getAttribute('style')).toContain('var(--phosphor)');
	});

	it('renders the center label when provided', () => {
		const data = [{ label: 'A', value: 100, color: 'var(--phosphor)' }];
		const { container } = render(DonutChart, {
			props: { data, centerLabel: '1,234 ₫' }
		});
		expect(container.textContent).toContain('1,234 ₫');
	});
```

- [x] **Step 2: Run the DonutChart tests to verify they fail**

Run: `pnpm test -- src/tests/unit/components/DonutChart.test.ts`
Expected: FAIL — first test's path has no `style` attribute (it uses `fill={arc.color}`); second fails because the `centerLabel` prop does not exist yet.

- [x] **Step 3: Modify DonutChart**

In `src/lib/components/charts/DonutChart.svelte`:

1. Extend the props:

```ts
let { data = [], centerLabel = '' }: { data?: DonutDatum[]; centerLabel?: string } = $props();
```

2. Wrap the SVG in a relative container, render arcs with `style`, enlarge the center hole, and add the readout:

```svelte
	<div class="relative">
		<LayerCake data={data} x={(d: DonutDatum) => d.value} y={(_d: DonutDatum, i: number) => i}>
			<Svg>
				<svg viewBox="0 0 100 100" class="w-32 h-32 shrink-0">
					{#each arcs as arc}
						<path d={describeArc(50, 50, 45, arc.startAngle, arc.endAngle)} style="fill: {arc.color}" />
					{/each}
					<circle cx="50" cy="50" r="32" class="fill-tape" />
				</svg>
			</Svg>
		</LayerCake>
		{#if centerLabel}
			<span class="absolute inset-0 flex items-center justify-center figures text-[10px] leading-tight text-ledger truncate pointer-events-none px-1">{centerLabel}</span>
		{/if}
	</div>
```

(The `fill-tape` center circle now sits under the centered `figures` readout.)

- [x] **Step 4: Run the DonutChart tests to verify they pass**

Run: `pnpm test -- src/tests/unit/components/DonutChart.test.ts`
Expected: PASS (existing tests still pass — the arc count is unchanged, the center circle is a `<circle>`, not a `<path>`).

- [x] **Step 5: Write the failing assertion for the overview page's ramp**

The overview's palette change is covered by the module test in Task 2 plus `pnpm check`. There is no page-render test harness for routes (they need stores + DB, which the testing conventions say not to mock). This step is the red-green hook for the page edit: first assert the current state is out of conformance.

Run: `pnpm check`
Expected: PASS against the *current* (non-conforming) page — this documents the baseline. Then proceed to Step 6; Step 7 re-runs `pnpm check` against the conforming page.

- [x] **Step 6: Point the overview donut at the token ramp and pass the total**

In `src/routes/reports/+page.svelte`:

1. Add the import at the top of the script:

```ts
import { seriesColor } from '$lib/utils/palette';
```

2. Replace the `bucketColors` map and `donutData` derived (lines 13-22):

```ts
	// Stable per-bucket ordering so a bucket keeps one color across months.
	const bucketRank = ['Essentials', 'Learning & Entertainment', 'Saving & Investment', 'Adjustments'];

	let totalSpending = $derived(report?.spending_by_bucket.reduce((s, b) => s + b.total, 0) ?? 0);

	let donutData = $derived(
		report?.spending_by_bucket.map((b) => ({
			label: b.name,
			value: b.total,
			color: seriesColor(bucketRank.indexOf(b.name))
		})) ?? []
	);
```

3. Update the `<DonutChart>` usage to pass the center readout:

```svelte
<DonutChart data={donutData} centerLabel={report ? formatCurrency(totalSpending, settings.currency, settings.locale) : ''} />
```

- [x] **Step 7: Verify the page change**

Run: `pnpm check`
Expected: PASS, no type errors (`formatCurrency` and `settings` are already imported in the file).

Run: `pnpm test`
Expected: all green.

- [x] **Step 8: Commit**

```bash
git add src/lib/components/charts/DonutChart.svelte src/routes/reports/+page.svelte src/tests/unit/components/DonutChart.test.ts
git commit -m "feat(ui): donut uses token palette with center total readout"
```

---

### Task 4: Stacked-area chart on-token with a conforming composition page

**Files:**
- Test: `src/tests/unit/components/StackedAreaChart.test.ts` (append)
- Modify: `src/lib/components/charts/StackedAreaChart.svelte:119-125,160-161`
- Modify: `src/routes/reports/composition/+page.svelte:21-32`

**Interfaces:**
- Consumes: `seriesColor` from Task 2.
- Produces: `StackedAreaChart` renders series fills via `style` so `var()` references resolve. No API change.

- [x] **Step 1: Write the failing test for StackedAreaChart**

Append to `src/tests/unit/components/StackedAreaChart.test.ts`:

```ts
	it('renders series fills via style so CSS var() references resolve', () => {
		const data = [{ month: '01', tags: [{ tagId: 't1', name: 'Food', total: 100 }] }];
		const { container } = render(StackedAreaChart, {
			props: {
				data,
				colors: { t1: 'var(--phosphor)' },
				yFormat: (n) => `$${n}`,
				xFormat: (m) => m
			}
		});
		const path = container.querySelector('path');
		expect(path?.getAttribute('style')).toContain('var(--phosphor)');
	});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/tests/unit/components/StackedAreaChart.test.ts`
Expected: FAIL — the `<path>` uses `fill={colors[...]}` (presentation attribute, no `style`).

- [x] **Step 3: Modify StackedAreaChart**

In `src/lib/components/charts/StackedAreaChart.svelte`:

1. The area path:

```svelte
						<path
							d={stackItem.path}
							style="fill: {colors[stackItem.tagId] ?? 'var(--dim)'}"
							opacity="0.7"
						/>
```

2. The legend swatch:

```svelte
						<span class="legend-color" style="background-color: {colors[tag.tagId] ?? 'var(--dim)'}"></span>
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/tests/unit/components/StackedAreaChart.test.ts`
Expected: PASS.

- [x] **Step 5: Point the composition page at the token ramp**

In `src/routes/reports/composition/+page.svelte`:

1. Add the import:

```ts
import { seriesColor } from '$lib/utils/palette';
```

2. Replace the `colors` derived (lines 21-32) — drop the Tailwind-default hex array:

```ts
	const colors = $derived.by(() => {
		const colorMap: Record<string, string> = {};
		chartData.forEach((point) => {
			point.tags.forEach((tag) => {
				if (tag.tagId && !colorMap[tag.tagId]) {
					colorMap[tag.tagId] = seriesColor(Object.keys(colorMap).length);
				}
			});
		});
		return colorMap;
	});
```

- [x] **Step 6: Verify the page change**

Run: `pnpm check`
Expected: PASS.

Run: `pnpm test`
Expected: all green.

- [x] **Step 7: Commit**

```bash
git add src/lib/components/charts/StackedAreaChart.svelte src/routes/reports/composition/+page.svelte src/tests/unit/components/StackedAreaChart.test.ts
git commit -m "fix(ui): stacked-area chart and composition on token ramp"
```

---

### Task 5: Year-over-year bars use the two-ink intensity language

**Files:**
- Test: `src/tests/unit/components/GroupedBarChart.test.ts` (append)
- Modify: `src/lib/components/charts/GroupedBarChart.svelte:22-34,67-98,111-118,151-158`

**Interfaces:**
- Consumes: nothing new (uses the app-wide income/expense ink convention directly, not the categorical ramp).
- Produces: `GroupedBarChart` renders year A at full strength, year B at 55% opacity, both via the `style` attribute. No API change.

Implements spec finding #2's YOY special case: income is `--phosphor`, expense is `--debit`; year is encoded as intensity, not new hues.

- [x] **Step 1: Write the failing test**

Append to `src/tests/unit/components/GroupedBarChart.test.ts`:

```ts
	it('uses the two-ink palette and fades year B to half strength', () => {
		const data = [
			{
				month: '01',
				yearAIncome: 5000,
				yearAExpense: 3000,
				yearBIncome: 5500,
				yearBExpense: 3200
			}
		];
		const { container } = render(GroupedBarChart, {
			props: {
				data,
				yFormat: (n) => `$${n}`,
				xFormat: (m) => m
			}
		});
		const rects = container.querySelectorAll('rect');
		expect(rects.length).toBe(4);
		expect(rects[0].getAttribute('style')).toContain('var(--phosphor)');
		expect(rects[1].getAttribute('style')).toContain('var(--debit)');
		expect(rects[0].getAttribute('opacity')).toBe('1');
		expect(rects[2].getAttribute('opacity')).toBe('0.55');
		expect(rects[3].getAttribute('opacity')).toBe('0.55');
	});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/tests/unit/components/GroupedBarChart.test.ts`
Expected: FAIL — bars render with hex `fill` attributes and no `opacity`.

- [x] **Step 3: Modify GroupedBarChart**

In `src/lib/components/charts/GroupedBarChart.svelte`:

1. Replace the `colors` map (lines 23-28) with the two-ink + intensity scheme:

```ts
	const series = ['yearAIncome', 'yearAExpense', 'yearBIncome', 'yearBExpense'];
	// Two inks, two strengths: income is phosphor, expense is debit (the app-wide
	// convention); year B is the same ink at half strength, so "year" reads as
	// intensity rather than a new set of colors.
	const colors: Record<string, string> = {
		yearAIncome: 'var(--phosphor)',
		yearAExpense: 'var(--debit)',
		yearBIncome: 'var(--phosphor)',
		yearBExpense: 'var(--debit)'
	};
	const faded = new Set(['yearBIncome', 'yearBExpense']);
```

2. Add `opacity` to the bars array type and push (lines 67-98):

```ts
		const bars: Array<{
			x: number;
			y: number;
			width: number;
			height: number;
			fill: string;
			opacity: number;
			key: string;
		}> = [];
```

and inside the push:

```ts
				bars.push({
					x: barX,
					y: barY,
					width: barWidth,
					height: barHeight,
					fill: colors[key as keyof typeof colors],
					opacity: faded.has(key) ? 0.55 : 1,
					key: `${d.month}-${key}`
				});
```

3. Render each bar via `style` + `opacity` (lines 111-118):

```svelte
						<rect
							x={bar.x}
							y={bar.y}
							width={bar.width}
							height={bar.height}
							style="fill: {bar.fill}"
							opacity={bar.opacity}
						/>
```

4. The legend swatch (lines 154-156):

```svelte
					<span class="legend-color" style="background-color: {colors[key as keyof typeof colors]}; opacity: {faded.has(key) ? 0.55 : 1}"></span>
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/tests/unit/components/GroupedBarChart.test.ts`
Expected: PASS.

- [x] **Step 5: Run the full suite and check**

Run: `pnpm test`
Run: `pnpm check`
Expected: all green.

- [x] **Step 6: Commit**

```bash
git add src/lib/components/charts/GroupedBarChart.svelte src/tests/unit/components/GroupedBarChart.test.ts
git commit -m "fix(ui): yoy bars use two-ink intensity language"
```

---

### Task 6: Extract the reports sub-nav into one component

**Files:**
- Create: `src/lib/components/layout/ReportsNav.svelte`
- Test: `src/tests/unit/components/ReportsNav.test.ts`
- Modify (remove the inline 7-link `<div class="flex gap-2 text-sm">` block and import the component):
  - `src/routes/reports/+page.svelte:42-49`
  - `src/routes/reports/trend/+page.svelte:27-35`
  - `src/routes/reports/compare/+page.svelte`
  - `src/routes/reports/net-worth/+page.svelte`
  - `src/routes/reports/category/+page.svelte`
  - `src/routes/reports/composition/+page.svelte:42-50`
  - `src/routes/reports/yoy/+page.svelte`

**Interfaces:**
- Consumes: existing i18n message keys only.
- Produces: `<ReportsNav />` (no props; active state derived from `$page.url.pathname`).

Implements spec findings #4 and #5 (single source of truth, `flex-wrap` for narrow widths).

- [x] **Step 1: Write the failing test**

Create `src/tests/unit/components/ReportsNav.test.ts`:

```ts
// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/svelte';
import ReportsNav from '$lib/components/layout/ReportsNav.svelte';

describe('ReportsNav', () => {
	it('renders all seven report destinations with their routes', () => {
		render(ReportsNav);
		expect(screen.getByRole('link', { name: 'Overview' }).getAttribute('href')).toBe('/reports');
		expect(screen.getByRole('link', { name: 'Trend' }).getAttribute('href')).toBe('/reports/trend');
		expect(screen.getByRole('link', { name: 'Compare' }).getAttribute('href')).toBe('/reports/compare');
		expect(screen.getByRole('link', { name: 'Net Worth' }).getAttribute('href')).toBe('/reports/net-worth');
		expect(screen.getByRole('link', { name: 'Category Trend' }).getAttribute('href')).toBe('/reports/category');
		expect(screen.getByRole('link', { name: 'Composition' }).getAttribute('href')).toBe('/reports/composition');
		expect(screen.getByRole('link', { name: 'Year Over Year' }).getAttribute('href')).toBe('/reports/yoy');
	});
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/tests/unit/components/ReportsNav.test.ts`
Expected: FAIL — `'$lib/components/layout/ReportsNav.svelte'` cannot be resolved.

- [x] **Step 3: Create the component**

Create `src/lib/components/layout/ReportsNav.svelte`:

```svelte
<script lang="ts">
	import { page } from '$app/stores';
	import * as m from '$lib/paraglide/messages';

	const items = [
		{ href: '/reports', label: () => m.reports_overview() },
		{ href: '/reports/trend', label: () => m.reports_trend() },
		{ href: '/reports/compare', label: () => m.reports_compare() },
		{ href: '/reports/net-worth', label: () => m.reports_net_worth() },
		{ href: '/reports/category', label: () => m.reports_category_trend() },
		{ href: '/reports/composition', label: () => m.reports_composition() },
		{ href: '/reports/yoy', label: () => m.reports_year_over_year() }
	];

	function isActive(href: string, path: string): boolean {
		return path === href;
	}
</script>

<nav class="flex flex-wrap gap-2 text-sm">
	{#each items as item}
		<a
			href={item.href}
			aria-current={isActive(item.href, $page.url.pathname) ? 'page' : undefined}
			class="px-3 py-1.5 rounded-md transition-colors
				{isActive(item.href, $page.url.pathname)
					? 'bg-phosphor/15 text-phosphor font-medium'
					: 'text-dim hover:bg-line/40'}"
		>{item.label()}</a>
	{/each}
</nav>
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/tests/unit/components/ReportsNav.test.ts`
Expected: PASS.

- [x] **Step 5: Replace the inline nav in every report page**

For each of the seven report pages, in the header row `<div class="flex items-center justify-between">`, replace the whole inline `<div class="flex gap-2 text-sm">…</div>` block with `<ReportsNav />`, and add the import. Example (reports overview, `src/routes/reports/+page.svelte`):

```svelte
<script lang="ts">
	import ReportsNav from '$lib/components/layout/ReportsNav.svelte';
	// ...existing imports
</script>

		<div class="flex items-center justify-between">
			<h1 class="figures text-xl text-ledger tracking-wide">{m.reports_title()}</h1>
			<ReportsNav />
		</div>
```

Repeat for `trend`, `compare`, `net-worth`, `category`, `composition`, and `yoy`. The pages with other header rows (`compare`, `net-worth`, `category`, `yoy`) keep their `flex items-center justify-between` wrapper; only the inline nav block is replaced.

- [x] **Step 6: Verify**

Run: `pnpm check`
Expected: PASS.

Run: `pnpm test`
Expected: all green.

- [x] **Step 7: Commit**

```bash
git add src/lib/components/layout/ReportsNav.svelte src/tests/unit/components/ReportsNav.test.ts src/routes/reports/+page.svelte src/routes/reports/trend/+page.svelte src/routes/reports/compare/+page.svelte src/routes/reports/net-worth/+page.svelte src/routes/reports/category/+page.svelte src/routes/reports/composition/+page.svelte src/routes/reports/yoy/+page.svelte
git commit -m "refactor(ui): extract ReportsNav component"
```

---

### Task 7: Standardize the page-title type convention

**Files:**
- Modify: `src/routes/+page.svelte:45` (the dashboard h1)
- Verify: all route `+page.svelte` files

**Interfaces:**
- Consumes: nothing.
- Produces: every page title conforms to `figures text-xl text-ledger tracking-wide`.

Implements spec finding #6. **TDD exception** (markup class convention — no unit-test harness for route pages; per `src/tests/CLAUDE.md`, stores/DB are not mocked). Verified with `pnpm check` + grep.

- [x] **Step 1: Write the failing assertion (grep)**

Run:

```bash
grep -rn '<h1' src/routes --include="*.svelte" | grep -v quick-add
```

Expected: one non-conforming title — `src/routes/+page.svelte:45` uses `<h1 class="plate">`; the other 16 routes already use `figures text-xl text-ledger tracking-wide`.

- [x] **Step 2: Fix the dashboard h1**

In `src/routes/+page.svelte:45`, replace:

```svelte
		<h1 class="plate">{m.nav_dashboard()}</h1>
```

with:

```svelte
		<h1 class="figures text-xl text-ledger tracking-wide">{m.nav_dashboard()}</h1>
```

- [x] **Step 3: Verify**

Run the grep from Step 1 again — every `<h1>` should now use `figures text-xl text-ledger tracking-wide`.

Run: `pnpm check`
Expected: PASS.

- [x] **Step 4: Commit**

```bash
git add src/routes/+page.svelte
git commit -m "fix(ui): standardize page-title type convention"
```

---

### Task 8: Wire the top bar search and language toggle

**Files:**
- Create: `src/lib/utils/search.ts`
- Test: `src/tests/unit/search.test.ts`
- Modify: `src/lib/components/layout/TopBar.svelte`
- Modify: `src/routes/transactions/+page.svelte:19`

**Interfaces:**
- Consumes: `settings.setLocale(locale)` (`src/lib/stores/settings.svelte.ts:20-25`), `goto` from `$app/navigation`.
- Produces: `transactionsSearchUrl(query: string): string` — used by TopBar and referenced by the transactions page's URL param.

Implements spec finding #7. The two component wirings (`goto` on Enter, `setLocale` toggle) are behavioral glue — per the testing conventions (no store/DB mocks) they have no unit test; the pure URL helper carries the logic under test. **TDD exception** for the wirings; verify via `pnpm check` + `pnpm dev` + grep.

- [x] **Step 1: Write the failing test for the URL helper**

Create `src/tests/unit/search.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { transactionsSearchUrl } from '../../lib/utils/search';

describe('transactionsSearchUrl', () => {
	it('returns the plain route for an empty or blank query', () => {
		expect(transactionsSearchUrl('')).toBe('/transactions');
		expect(transactionsSearchUrl('   ')).toBe('/transactions');
	});

	it('encodes the query as the q param', () => {
		expect(transactionsSearchUrl('groceries')).toBe('/transactions?q=groceries');
	});

	it('encodes special characters', () => {
		expect(transactionsSearchUrl('coffee & tea')).toBe('/transactions?q=coffee%20%26%20tea');
	});
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `pnpm test -- src/tests/unit/search.test.ts`
Expected: FAIL — `'../../lib/utils/search'` cannot be resolved.

- [x] **Step 3: Write the helper**

Create `src/lib/utils/search.ts`:

```ts
export function transactionsSearchUrl(query: string): string {
	const q = query.trim();
	return q ? `/transactions?q=${encodeURIComponent(q)}` : '/transactions';
}
```

- [x] **Step 4: Run the test to verify it passes**

Run: `pnpm test -- src/tests/unit/search.test.ts`
Expected: PASS.

- [x] **Step 5: Wire the TopBar search and language toggle**

Replace `src/lib/components/layout/TopBar.svelte` with:

```svelte
<script lang="ts">
	import { goto } from '$app/navigation';
	import { transactionsSearchUrl } from '$lib/utils/search';
	import { settings } from '$lib/stores/settings.svelte';
	import * as m from '$lib/paraglide/messages';

	let search = $state('');

	function onSearchKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			goto(transactionsSearchUrl(search));
		}
	}
</script>

<header class="h-14 flex items-center gap-3 px-4 border-b border-line bg-tape shrink-0">
	<label class="relative block flex-1 max-w-md mx-auto">
		<span class="sr-only">{m.layout_search()}</span>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-dim pointer-events-none"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" stroke-linecap="round" /></svg>
		<input
			type="search"
			placeholder={m.layout_search_placeholder()}
			bind:value={search}
			onkeydown={onSearchKeydown}
			class="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-line bg-ink text-ledger placeholder:text-dim/70"
		/>
	</label>
	<button
		onclick={() => settings.setLocale(settings.locale === 'en' ? 'vi' : 'en')}
		class="plate px-2 py-1 rounded border border-line text-dim hover:text-ledger"
	>
		{settings.locale === 'en' ? 'VI' : 'EN'}
	</button>
</header>
```

Notes:
- The `m` import is kept so the search placeholder (`m.layout_search_placeholder()`) and the sr-only label (`m.layout_search()`) stay translated.
- The language button now shows the **target** locale code (`VI` when English is active) — a plain string, not a translated message. This makes `layout_lang_label_en` unused; leave the message in `messages/*.json`.

- [x] **Step 6: Verify the TopBar changes**

Run: `pnpm check`
Expected: PASS.

Run: `pnpm test`
Expected: all green.

- [x] **Step 7: Make the transactions page respect the `q` param**

In `src/routes/transactions/+page.svelte`:

1. Add `page` to the top-of-script imports (it is not imported yet):

```ts
import { page } from '$app/stores';
```

2. Replace line 19, the `search` state:

```ts
	let search = $state($page.url.searchParams.get('q') ?? '');
```

`onMount(loadPage)` already runs `loadPage()`, which queries with `search`, so a `?q=...` navigation searches on arrival.

- [x] **Step 8: Verify the full change**

Run: `pnpm check`
Run: `pnpm test`
Expected: all green.

Run: `pnpm dev`, visit `/transactions?q=coffee`, confirm the search field is pre-filled and results are filtered. On the dashboard, focus the top bar search, type, press Enter, and confirm the app navigates to `/transactions?q=...`. Toggle the language button and confirm the UI flips between EN and VI (settings persist).

- [x] **Step 9: Commit**

```bash
git add src/lib/utils/search.ts src/tests/unit/search.test.ts src/lib/components/layout/TopBar.svelte src/routes/transactions/+page.svelte
git commit -m "feat(ui): wire top bar search and language toggle"
```

---

### Task 9: Pair IBM Plex Sans with Plex Mono

**Files:**
- Modify: `package.json` (dependency)
- Modify: `src/routes/+layout.svelte:6-8`
- Modify: `tailwind.config.ts:20-23`

**Interfaces:**
- Consumes: nothing.
- Produces: the `sans` font family is IBM Plex Sans; body text stays in the Plex family with the mono figures.

Implements spec finding #8. **TDD exception** (dependency/config — the font face is verified visually; `pnpm check` catches class/import errors).

- [x] **Step 1: Add the dependency**

Run:

```bash
pnpm add @fontsource/ibm-plex-sans
```

Expected: `@fontsource/ibm-plex-sans` added to `package.json` (same 5.x line as `@fontsource/ibm-plex-mono`).

- [x] **Step 2: Import the font weights**

In `src/routes/+layout.svelte`, after the three Plex Mono imports, add:

```ts
import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
```

- [x] **Step 3: Point the sans family at Plex Sans**

In `tailwind.config.ts`, update `fontFamily.sans`:

```ts
			fontFamily: {
				mono: ['"IBM Plex Mono"', 'ui-monospace', 'SFMono-Regular', 'Menlo', 'Consolas', 'monospace'],
				sans: ['"IBM Plex Sans"', 'ui-sans-serif', 'system-ui', '-apple-system', 'Segoe UI', 'sans-serif']
			}
```

- [x] **Step 4: Verify**

Run: `pnpm check`
Expected: PASS.

Run: `pnpm dev`
Expected: body text renders in IBM Plex Sans (slightly wider than system UI); `figures`/`.plate` remain Plex Mono. Confirm both light and dark.

- [x] **Step 5: Commit**

```bash
git add package.json pnpm-lock.yaml src/routes/+layout.svelte tailwind.config.ts
git commit -m "feat(ui): pair IBM Plex Sans with Plex Mono"
```

---

### Task 10: Refresh the roadmap rollup

**Files:**
- Modify: `specs/STATUS.md` (generated — do not hand-edit)
- Modify: this plan file's step checkboxes (already flipped as commits landed)

**Interfaces:**
- Consumes: all prior tasks' commits.

- [x] **Step 1: Regenerate the rollup**

Run: `pnpm test:roadmap`
Expected: no `⚠ stale` warning; `specs/STATUS.md` regenerated.

- [x] **Step 2: Commit**

```bash
git add specs/STATUS.md
git commit -m "docs: regenerate roadmap rollup after ui design-system conformance"
```

---

## Self-review notes

- **Spec coverage:** findings 1-8 in `specs/2026-08-20-ui-design-system-conformance.md` each map to a task (1→charts CSS, 2→palette module, 2/3→donut + composition + yoy ramps, 4→page titles, 5→ReportsNav, 7→top bar, 8→Plex Sans). The non-goals (tokens, plate/figures system, layout shell) are untouched.
- **Placeholder scan:** every step carries concrete code or an exact run command; the only TDD-excepted steps (Tasks 7, 8 wirings, 9) are explicitly flagged with the verification that replaces the unit test.
- **Type consistency:** `seriesColor(index: number): string` and `reportSeriesColors` are defined in Task 2 and consumed identically in Tasks 3-4; `transactionsSearchUrl(query: string): string` is defined in Task 8 and used by both TopBar and the transactions page; `centerLabel?: string` is introduced and consumed in Task 3.
