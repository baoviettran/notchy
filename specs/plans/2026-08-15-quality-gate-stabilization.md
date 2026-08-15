# Quality-Gate Stabilization Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore a green, trustworthy baseline by fixing async report database access, report/chart TypeScript errors, one brittle E2E selector, and Rust version metadata drift.

**Architecture:** Keep the current report repositories, stores, charts, and routes intact. Fix each defect at its source: resolve the database promise at the store boundary, provide the type information D3 and LayerCake need, narrow route constants at declaration, target the intended semantic table element in E2E, and synchronize generated Rust package metadata.

**Tech Stack:** SvelteKit 5, Svelte 5 runes, TypeScript 5.8, Vitest 3, Playwright 1.52, LayerCake 8, D3 scale/shape, Tauri v2, Rust/Cargo.

## Global Constraints

- Use Node `22.22.3` and pnpm `10.11.0`.
- Follow tabs and single quotes in TypeScript and Svelte files.
- Do not change financial behavior, report calculations, chart appearance, or database schemas.
- Do not edit generated `src/lib/paraglide/` files.
- Do not modify `.codegraph/`.
- Keep all package and manifest versions at `0.1.3`.
- Write and observe a failing regression test before changing report-store production code.
- Use exact, semantic selectors in Playwright.

---

### Task 1: Resolve the report database before repository calls

**Files:**
- Modify: `src/lib/stores/reports.test.ts`
- Modify: `src/lib/stores/reports.svelte.ts:22-40`

**Interfaces:**
- Consumes: `getDb(): Promise<DatabaseService>` from `$lib/db`.
- Produces: `ReportsStore.loadNetWorth()`, `loadCategoryTrend(tagId)`, `loadStackedComposition()`, and `loadYearOverYear(yearA, yearB)` that pass a resolved `DatabaseService` to their repositories.

- [ ] **Step 1: Replace the shallow report-store test setup with hoisted dependency mocks**

Add `vi` to the Vitest import and place these mocks before importing `ReportsStore`:

```typescript
import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
	db: { marker: 'resolved-db' },
	getDb: vi.fn(),
	getNetWorthSeries: vi.fn(),
	getCategoryTrend: vi.fn(),
	getStackedCategorySeries: vi.fn(),
	getYearOverYear: vi.fn()
}));

vi.mock('$lib/db', () => ({ getDb: mocks.getDb }));
vi.mock('$lib/db/repos/reports', () => ({
	getNetWorthSeries: mocks.getNetWorthSeries,
	getCategoryTrend: mocks.getCategoryTrend,
	getStackedCategorySeries: mocks.getStackedCategorySeries,
	getYearOverYear: mocks.getYearOverYear
}));

import { ReportsStore } from './reports.svelte';
```

In `beforeEach`, reset the mocks and make `getDb` resolve asynchronously:

```typescript
beforeEach(() => {
	vi.clearAllMocks();
	mocks.getDb.mockResolvedValue(mocks.db);
	mocks.getNetWorthSeries.mockResolvedValue([]);
	mocks.getCategoryTrend.mockResolvedValue([]);
	mocks.getStackedCategorySeries.mockResolvedValue([]);
	mocks.getYearOverYear.mockResolvedValue([]);
	store = new ReportsStore();
});
```

- [ ] **Step 2: Add a failing regression test covering every loader**

```typescript
it('resolves the database before loading every report', async () => {
	await store.loadNetWorth();
	await store.loadCategoryTrend('tag-1');
	await store.loadStackedComposition();
	await store.loadYearOverYear(2025, 2026);

	expect(mocks.getNetWorthSeries).toHaveBeenCalledWith(mocks.db, 12, false);
	expect(mocks.getCategoryTrend).toHaveBeenCalledWith(mocks.db, 'tag-1', 12, false);
	expect(mocks.getStackedCategorySeries).toHaveBeenCalledWith(mocks.db, 12, false);
	expect(mocks.getYearOverYear).toHaveBeenCalledWith(mocks.db, 2025, 2026, false);
});
```

- [ ] **Step 3: Run the focused test and confirm the red state**

Run: `pnpm vitest run src/lib/stores/reports.test.ts`

Expected: FAIL because the repository mocks receive `Promise` instances instead of `mocks.db`.

- [ ] **Step 4: Implement the minimal async-boundary fix**

Change each loader from:

```typescript
const db = getDb();
```

to:

```typescript
const db = await getDb();
```

Do not change repository signatures or report calculations.

- [ ] **Step 5: Verify the focused and store tests are green**

Run: `pnpm vitest run src/lib/stores/reports.test.ts`

Expected: all `ReportsStore` tests PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add src/lib/stores/reports.test.ts src/lib/stores/reports.svelte.ts
git commit -m "fix(reports): await database before loading series"
```

---

### Task 2: Restore clean TypeScript and Svelte diagnostics

**Files:**
- Modify: `package.json`
- Modify: `pnpm-lock.yaml`
- Modify: `src/lib/components/charts/DonutChart.svelte`
- Modify: `src/lib/components/charts/LineChart.svelte`
- Modify: `src/lib/components/charts/StackedAreaChart.svelte`
- Modify: `src/routes/reports/net-worth/+page.svelte`
- Modify: `src/routes/reports/category/+page.svelte`
- Modify: `src/routes/reports/composition/+page.svelte`

**Interfaces:**
- Consumes: D3 `Scale*`, `SeriesPoint`, `line`, `area`, and `stack` typings.
- Produces: unchanged chart component props and a shared local route constant typed as `readonly [6, 12, 24]` in each affected route.

- [ ] **Step 1: Reconfirm the diagnostic baseline**

Run: `pnpm check`

Expected: FAIL with report-store promise errors, missing declarations for `d3-scale`/`d3-shape`, implicit callback `any` errors, the stacked `month` type error, and widened report window values. If Task 1 is complete, the four report-store errors will already be absent.

- [ ] **Step 2: Install the official D3 declaration packages**

Run:

```bash
pnpm add --save-dev --save-exact @types/d3-scale @types/d3-shape
```

Expected: `package.json` and `pnpm-lock.yaml` contain pinned declaration-package versions.

- [ ] **Step 3: Give DonutChart callbacks an explicit datum contract**

At the top of `DonutChart.svelte`, define and use a named datum type:

```typescript
type DonutDatum = { label: string; value: number; color: string };

let { data = [] }: { data: DonutDatum[] } = $props();
```

Then type both LayerCake callbacks:

```svelte
<LayerCake data={data} x={(d: DonutDatum) => d.value} y={(_d: DonutDatum, i: number) => i}>
```

- [ ] **Step 4: Give stacked-area rows and D3 series explicit compatible types**

Import `SeriesPoint` as a type and define the row:

```typescript
import { stack, area, type SeriesPoint } from 'd3-shape';

type StackDatum = {
	month: string;
	[key: string]: string | number;
};
```

Build each row without claiming every value is numeric:

```typescript
const obj: StackDatum = { month: d.month };
```

Configure D3's numeric accessor explicitly:

```typescript
const stackGen = stack<StackDatum>()
	.keys(tags.map((t) => t.tagId))
	.value((datum, key) => Number(datum[key] ?? 0))
	.order(null)
	.offset(null);
```

Type the area generator:

```typescript
const areaGen = area<SeriesPoint<StackDatum>>()
	.x((d) => (xScl(d.data.month) ?? 0) + xScl.bandwidth() / 2)
	.y0((d) => yScl(d[0]))
	.y1((d) => yScl(d[1]));
```

- [ ] **Step 5: Narrow window options at declaration in each affected report route**

Add this constant inside each route script:

```typescript
const windowOptions = [6, 12, 24] as const;
```

Replace:

```svelte
{#each [6, 12, 24] as n}
```

with:

```svelte
{#each windowOptions as n}
```

Apply only to net worth, category trend, and composition routes.

- [ ] **Step 6: Run diagnostics and address only remaining in-scope type errors**

Run: `pnpm check`

Expected: exit code `0` and `0 errors`. The existing `autofocus` warning and year-input label warnings may remain because they do not fail the command and are outside this stabilization scope.

If D3's installed declarations reveal a more precise generic signature, adjust the explicit types while preserving the `StackDatum` string `month`, numeric `.value(...)` accessor, and unchanged output.

- [ ] **Step 7: Run the chart and report-store tests**

Run:

```bash
pnpm vitest run src/lib/stores/reports.test.ts src/tests/unit/components/DonutChart.test.ts src/tests/unit/components/LineChart.test.ts src/tests/unit/components/GroupedBarChart.test.ts src/tests/unit/components/StackedAreaChart.test.ts
```

Expected: all selected tests PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add package.json pnpm-lock.yaml src/lib/components/charts/DonutChart.svelte src/lib/components/charts/LineChart.svelte src/lib/components/charts/StackedAreaChart.svelte src/routes/reports/net-worth/+page.svelte src/routes/reports/category/+page.svelte src/routes/reports/composition/+page.svelte
git commit -m "fix(reports): restore chart type safety"
```

---

### Task 3: Stabilize the compare-report E2E assertion

**Files:**
- Modify: `src/tests/e2e/reports-extended.spec.ts:84-94`

**Interfaces:**
- Consumes: the compare report's semantic `<th>` with accessible name `Category`.
- Produces: an exact Playwright locator that cannot match the `Category Trend` navigation link.

- [ ] **Step 1: Reproduce the focused red state**

Run:

```bash
pnpm playwright test src/tests/e2e/reports-extended.spec.ts --grep "compare renders the two selected months"
```

Expected: FAIL with a strict-mode violation because `getByText('Category')` resolves to both the `Category Trend` link and `Category` column header.

- [ ] **Step 2: Replace only the ambiguous assertion**

Replace:

```typescript
await expect(main.getByText('Category')).toBeVisible();
```

with:

```typescript
await expect(main.getByRole('columnheader', { name: 'Category', exact: true })).toBeVisible();
```

- [ ] **Step 3: Verify the focused E2E is green**

Run:

```bash
pnpm playwright test src/tests/e2e/reports-extended.spec.ts --grep "compare renders the two selected months"
```

Expected: `1 passed`.

- [ ] **Step 4: Commit Task 3**

```bash
git add src/tests/e2e/reports-extended.spec.ts
git commit -m "test(e2e): target compare category header"
```

---

### Task 4: Synchronize Rust package metadata and run the full gate

**Files:**
- Modify: `src-tauri/Cargo.lock:2203`

**Interfaces:**
- Consumes: version `0.1.3` from `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json`.
- Produces: Cargo lock metadata for local package `notchy` at version `0.1.3`.

- [ ] **Step 1: Prove the version mismatch**

Run:

```bash
node -e "const fs=require('node:fs'); const lock=fs.readFileSync('src-tauri/Cargo.lock','utf8'); const match=lock.match(/\[\[package\]\]\nname = \"notchy\"\nversion = \"([^\"]+)\"/); if (match?.[1] !== '0.1.3') { console.error('Cargo.lock Notchy version:', match?.[1]); process.exit(1); }"
```

Expected: exit code `1` and `Cargo.lock Notchy version: 0.1.2`.

- [ ] **Step 2: Regenerate the local package entry through Cargo**

Run: `cargo check --manifest-path src-tauri/Cargo.toml`

Expected: Cargo updates the local `notchy` lock entry to `0.1.3` and compilation succeeds.

- [ ] **Step 3: Verify all four version records**

Run:

```bash
node -e "const fs=require('node:fs'); const pkg=require('./package.json'); const cargo=fs.readFileSync('src-tauri/Cargo.toml','utf8').match(/^version = \"([^\"]+)\"/m)?.[1]; const conf=JSON.parse(fs.readFileSync('src-tauri/tauri.conf.json','utf8')).version; const lock=fs.readFileSync('src-tauri/Cargo.lock','utf8').match(/\[\[package\]\]\nname = \"notchy\"\nversion = \"([^\"]+)\"/)?.[1]; const versions={package:pkg.version,cargo,tauri:conf,lock}; console.log(versions); if (new Set(Object.values(versions)).size !== 1 || pkg.version !== '0.1.3') process.exit(1);"
```

Expected: all four fields print `0.1.3` and the command exits `0`.

- [ ] **Step 4: Run the complete automated verification suite**

Run each command independently and require exit code `0`:

```bash
pnpm check
pnpm test
pnpm test:e2e
pnpm build
cargo test --manifest-path src-tauri/Cargo.toml
git diff --check
```

Expected:

- `pnpm check`: `0 errors`.
- `pnpm test`: all unit and component tests pass.
- `pnpm test:e2e`: all Playwright tests pass.
- `pnpm build`: production frontend build succeeds.
- `cargo test`: Rust host compiles and the command exits `0`.
- `git diff --check`: no whitespace errors.

- [ ] **Step 5: Confirm scope and repository hygiene**

Run:

```bash
git status --short
git diff --stat HEAD~3..HEAD
```

Expected: only the planned files changed across the three implementation commits; `.codegraph/` remains untracked and untouched.

- [ ] **Step 6: Commit Task 4**

```bash
git add src-tauri/Cargo.lock
git commit -m "chore: synchronize Rust package version"
```

If Task 4's full verification discovers an unrelated pre-existing failure, do not broaden scope silently. Record the exact command and failure, then use systematic debugging to determine whether it blocks this quality-gate goal.
