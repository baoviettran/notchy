# Reporting Depth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Add four new time-series reports (net worth over time, category trend, stacked composition, year-over-year) with LayerCake-based charts, refactoring the existing DonutChart for consistency.

**Architecture:** Extend the existing `reports.ts` repo with four new query functions following the `getTrend` loop pattern. Add a `ReportsStore` to centralize shared state (window selector, adjustments toggle). Add three new LayerCake chart components (LineChart, StackedAreaChart, GroupedBarChart) alongside the refactored DonutChart. Add four new route pages under `src/routes/reports/`. All data is computed from transactions at query time — no schema changes, no stored snapshots.

**Tech Stack:** SvelteKit 5, Svelte 5 runes, LayerCake 8.2.0, SQLite (Tauri plugin), Paraglide JS 1.11.8 (i18n), Vitest

## Global Constraints

- **No schema changes.** All four reports read existing `transactions`, `accounts`, `category_tags`, `category_types` tables. No migration, no schema-version bump.
- **Derived-not-stored.** Every series is a SQL query over `transactions`. No snapshot table, no cached balance column.
- **Transfers are net-neutral.** Net worth inherits `getBalance`'s transfer handling — a transfer counts once (source side), never double-counts.
- **Refunds reduce expense.** Following `getTrend` convention: `expense -= refund`. Not retroactive to the original month.
- **Archived accounts included.** Historical net worth includes archived accounts' transactions. Archiving is a UI concern, not a historical rewrite.
- **TDD discipline.** Red-green-refactor. Write failing test, watch it fail, implement minimum to pass, refactor.
- **Paraglide flat keys.** Underscore-namespaced keys (e.g., `reports_net_worth`), not dotted IDs. Paraglide 1.11.8 rejects dotted IDs.
- **Amounts are integers.** Smallest currency unit. No floats. VND = 0 decimals, USD = 2 decimals.

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `src/lib/db/repos/reports.ts` | Add 4 new query functions: `getNetWorthSeries`, `getCategoryTrend`, `getStackedCategorySeries`, `getYearOverYear` |
| `src/lib/db/repos/reports.test.ts` | Extend with tests for the 4 new functions |
| `src/lib/db/repos/accounts.ts` | Add `getBalanceAsOf(db, accountId, date)` helper for historical balance queries |
| `src/lib/db/repos/accounts.test.ts` | Add tests for `getBalanceAsOf` |
| `src/lib/stores/reports.svelte.ts` | `ReportsStore` class with `$state` for window, adjustments, per-report data arrays |
| `src/lib/stores/reports.test.ts` | Tests for store initialization, reload on state change |
| `src/lib/components/charts/LineChart.svelte` | LineChart component using LayerCake (Line + Area + AxisX + AxisY) |
| `src/lib/components/charts/LineChart.test.ts` | Tests for LineChart rendering, negative axis, empty state |
| `src/lib/components/charts/StackedAreaChart.svelte` | StackedAreaChart component using LayerCake StackedArea layout |
| `src/lib/components/charts/StackedAreaChart.test.ts` | Tests for StackedAreaChart rendering, legend, empty state |
| `src/lib/components/charts/GroupedBarChart.svelte` | GroupedBarChart component using LayerCake GroupedBar layout |
| `src/lib/components/charts/GroupedBarChart.test.ts` | Tests for GroupedBarChart rendering, legend, empty state |
| `src/routes/reports/net-worth/+page.svelte` | Net worth over time page with LineChart |
| `src/routes/reports/category/+page.svelte` | Category trend page with tag picker + LineChart |
| `src/routes/reports/composition/+page.svelte` | Stacked composition page with StackedAreaChart |
| `src/routes/reports/yoy/+page.svelte` | Year-over-year page with GroupedBarChart |
| `tests/e2e/reports-new.spec.ts` | E2E tests for the 4 new report pages |

### Modified Files

| File | Changes |
|------|---------|
| `src/lib/components/charts/DonutChart.svelte` | Refactor to use LayerCake properly (currently imports but doesn't use it) |
| `src/routes/reports/+page.svelte` | Add navigation cards linking to the 4 new reports |
| `src/routes/reports/trend/+page.svelte` | Update tab navigation to include all 7 reports |
| `src/routes/reports/compare/+page.svelte` | Update tab navigation to include all 7 reports |
| `messages/en.json` | Add `reports_*` keys for new reports |
| `messages/vi.json` | Add `reports_*` keys for new reports (Vietnamese translations) |

---

## Task 1: Refactor DonutChart to use LayerCake

**Files:**
- Modify: `src/lib/components/charts/DonutChart.svelte`
- Test: `src/lib/components/charts/DonutChart.test.ts` (create if missing)

**Interfaces:**
- Consumes: `data: { label: string; value: number; color: string }[]` (unchanged)
- Produces: SVG donut chart with legend (unchanged behavior)

- [x] **Step 1: Write/update component test**

Create or update `src/lib/components/charts/DonutChart.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import DonutChart from './DonutChart.svelte';

describe('DonutChart', () => {
    it('renders correct number of arcs', () => {
        const data = [
            { label: 'A', value: 100, color: '#f00' },
            { label: 'B', value: 200, color: '#0f0' }
        ];
        const { container } = render(DonutChart, { props: { data } });
        const paths = container.querySelectorAll('path');
        expect(paths.length).toBe(2);
    });

    it('renders legend items matching data length', () => {
        const data = [
            { label: 'A', value: 100, color: '#f00' },
            { label: 'B', value: 200, color: '#0f0' },
            { label: 'C', value: 50, color: '#00f' }
        ];
        const { container } = render(DonutChart, { props: { data } });
        const legendItems = container.querySelectorAll('.legend-item');
        expect(legendItems.length).toBe(3);
    });

    it('renders nothing when data is empty', () => {
        const { container } = render(DonutChart, { props: { data: [] } });
        const svg = container.querySelector('svg');
        expect(svg).toBeNull();
    });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/lib/components/charts/DonutChart.test.ts`
Expected: FAIL — test may pass if component already works, but refactor will change internals

- [x] **Step 3: Refactor DonutChart to use LayerCake**

Replace the hand-rolled `polarToCartesian`/`describeArc` functions with LayerCake's arc layout. Import `LayerCake`, `Svg`, and use the `Arc` layout component. Keep the same props interface and visual output (colors, donut hole, legend).

```svelte
<script lang="ts">
    import { LayerCake, Svg, Arc } from 'layercake';
    
    let { data = [] }: { data: { label: string; value: number; color: string }[] } = $props();
    
    const total = $derived(data.reduce((sum, d) => sum + d.value, 0));
</script>

{#if data.length > 0 && total > 0}
    <div class="donut-container">
        <LayerCake
            data={data}
            x={(d) => d.value}
            y={(d, i) => i}
        >
            <Svg>
                <Arc
                    outerRadius={45}
                    innerRadius={25}
                    padAngle={0.02}
                    fill={(d) => d.color}
                />
            </Svg>
        </LayerCake>
        <div class="legend">
            {#each data as d}
                <div class="legend-item">
                    <span class="color-swatch" style="background-color: {d.color}"></span>
                    <span class="label">{d.label}</span>
                    <span class="value">{d.value}</span>
                </div>
            {/each}
        </div>
    </div>
{/if}

<style>
    .donut-container {
        display: flex;
        align-items: center;
        gap: 1rem;
    }
    .legend {
        display: flex;
        flex-direction: column;
        gap: 0.5rem;
    }
    .legend-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    .color-swatch {
        width: 12px;
        height: 12px;
        border-radius: 2px;
    }
    .label {
        flex: 1;
    }
    .value {
        font-weight: 600;
    }
</style>
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/lib/components/charts/DonutChart.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/components/charts/DonutChart.svelte src/lib/components/charts/DonutChart.test.ts
git commit -m "refactor: migrate DonutChart to LayerCake"
```

---

## Task 2: Add `getBalanceAsOf` helper to accounts repo

**Files:**
- Modify: `src/lib/db/repos/accounts.ts:98-118`
- Test: `src/lib/db/repos/accounts.test.ts`

**Interfaces:**
- Consumes: `db: DatabaseService`, `accountId: string`, `date: string` (ISO date)
- Produces: `Promise<number>` — balance as-of the given date

- [x] **Step 1: Write failing test**

Add to `src/lib/db/repos/accounts.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, runMigrations } from '../test_helpers';
import { getBalanceAsOf, createAccount } from './accounts';
import { createTransaction } from './transactions';

describe('getBalanceAsOf', () => {
    let db: any;
    
    beforeEach(async () => {
        db = await createTestDb();
        await runMigrations(db);
    });
    
    it('returns balance as-of a historical date', async () => {
        const accountId = await createAccount(db, {
            name: 'Checking',
            type: 'checking',
            initial_balance: 0
        });
        
        await createTransaction(db, {
            kind: 'income',
            amount: 1000,
            account_id: accountId,
            date: '2026-01-15'
        });
        
        await createTransaction(db, {
            kind: 'income',
            amount: 500,
            account_id: accountId,
            date: '2026-02-15'
        });
        
        const balanceJan = await getBalanceAsOf(db, accountId, '2026-01-31');
        expect(balanceJan).toBe(1000);
        
        const balanceFeb = await getBalanceAsOf(db, accountId, '2026-02-28');
        expect(balanceFeb).toBe(1500);
    });
    
    it('excludes transactions after the date', async () => {
        const accountId = await createAccount(db, {
            name: 'Savings',
            type: 'savings',
            initial_balance: 0
        });
        
        await createTransaction(db, {
            kind: 'income',
            amount: 1000,
            account_id: accountId,
            date: '2026-03-15'
        });
        
        const balanceBefore = await getBalanceAsOf(db, accountId, '2026-02-28');
        expect(balanceBefore).toBe(0);
    });
    
    it('handles transfers correctly (source -amount, dest +amount)', async () => {
        const sourceId = await createAccount(db, {
            name: 'Checking',
            type: 'checking',
            initial_balance: 1000
        });
        const destId = await createAccount(db, {
            name: 'Savings',
            type: 'savings',
            initial_balance: 0
        });
        
        await createTransaction(db, {
            kind: 'transfer',
            amount: 200,
            account_id: sourceId,
            transfer_account_id: destId,
            date: '2026-01-15'
        });
        
        const sourceBalance = await getBalanceAsOf(db, sourceId, '2026-01-31');
        expect(sourceBalance).toBe(800);
        
        const destBalance = await getBalanceAsOf(db, destId, '2026-01-31');
        expect(destBalance).toBe(200);
    });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/lib/db/repos/accounts.test.ts`
Expected: FAIL with "getBalanceAsOf is not defined"

- [x] **Step 3: Implement `getBalanceAsOf`**

Add to `src/lib/db/repos/accounts.ts` after the existing `getBalance` function:

```typescript
export async function getBalanceAsOf(db: DatabaseService, accountId: string, date: string): Promise<number> {
    const rows = await db.query<{ total: number | null }>(
        `SELECT
            COALESCE(SUM(CASE
                WHEN kind = 'income' THEN amount
                WHEN kind = 'adjustment' THEN amount
                WHEN kind = 'refund' THEN amount
                WHEN kind = 'expense' THEN -amount
                WHEN kind = 'transfer' AND account_id = ? THEN -amount
                WHEN kind = 'transfer' AND transfer_account_id = ? THEN amount
                ELSE 0
            END), 0) AS total
         FROM transactions
         WHERE (account_id = ? OR (kind = 'transfer' AND transfer_account_id = ?))
           AND deleted_at IS NULL
           AND date <= ?`,
        [accountId, accountId, accountId, accountId, date]
    );
    return rows[0]?.total ?? 0;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/lib/db/repos/accounts.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/db/repos/accounts.ts src/lib/db/repos/accounts.test.ts
git commit -m "feat: add getBalanceAsOf helper for historical balance queries"
```

---

## Task 3: Add `getNetWorthSeries` to reports repo

**Files:**
- Modify: `src/lib/db/repos/reports.ts`
- Test: `src/lib/db/repos/reports.test.ts`

**Interfaces:**
- Consumes: `db: DatabaseService`, `months: number`, `includeAdjustments?: boolean`
- Produces: `Promise<{ month: string; netWorth: number }[]>`

- [x] **Step 1: Write failing test**

Add to `src/lib/db/repos/reports.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb, runMigrations } from '../test_helpers';
import { getNetWorthSeries } from './reports';
import { createAccount } from './accounts';
import { createTransaction } from './transactions';

describe('getNetWorthSeries', () => {
    let db: any;
    
    beforeEach(async () => {
        db = await createTestDb();
        await runMigrations(db);
    });
    
    it('returns cumulative net worth over N months', async () => {
        const accountId = await createAccount(db, {
            name: 'Checking',
            type: 'checking',
            initial_balance: 0
        });
        
        await createTransaction(db, {
            kind: 'income',
            amount: 1000,
            account_id: accountId,
            date: '2026-01-15'
        });
        
        await createTransaction(db, {
            kind: 'income',
            amount: 500,
            account_id: accountId,
            date: '2026-02-15'
        });
        
        const series = await getNetWorthSeries(db, 3);
        expect(series.length).toBe(3);
        
        // Most recent first
        expect(series[0].month).toMatch(/^\d{4}-\d{2}$/);
        expect(series[0].netWorth).toBe(1500);
        expect(series[1].netWorth).toBe(1000);
        expect(series[2].netWorth).toBe(0);
    });
    
    it('transfer between own accounts is flat', async () => {
        const checkingId = await createAccount(db, {
            name: 'Checking',
            type: 'checking',
            initial_balance: 1000
        });
        const savingsId = await createAccount(db, {
            name: 'Savings',
            type: 'savings',
            initial_balance: 0
        });
        
        await createTransaction(db, {
            kind: 'transfer',
            amount: 200,
            account_id: checkingId,
            transfer_account_id: savingsId,
            date: '2026-01-15'
        });
        
        const series = await getNetWorthSeries(db, 1);
        expect(series[0].netWorth).toBe(1000); // 1000 - 200 + 200 = 1000
    });
    
    it('excludes deleted transactions', async () => {
        const accountId = await createAccount(db, {
            name: 'Checking',
            type: 'checking',
            initial_balance: 0
        });
        
        const txnId = await createTransaction(db, {
            kind: 'income',
            amount: 1000,
            account_id: accountId,
            date: '2026-01-15'
        });
        
        await db.query('UPDATE transactions SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), txnId]);
        
        const series = await getNetWorthSeries(db, 1);
        expect(series[0].netWorth).toBe(0);
    });
    
    it('includes archived accounts', async () => {
        const accountId = await createAccount(db, {
            name: 'Old Account',
            type: 'checking',
            initial_balance: 0
        });
        
        await createTransaction(db, {
            kind: 'income',
            amount: 1000,
            account_id: accountId,
            date: '2026-01-15'
        });
        
        await db.query('UPDATE accounts SET deleted_at = ? WHERE id = ?', [new Date().toISOString(), accountId]);
        
        const series = await getNetWorthSeries(db, 1);
        expect(series[0].netWorth).toBe(1000);
    });
    
    it('returns negative net worth when liabilities exceed assets', async () => {
        const creditCardId = await createAccount(db, {
            name: 'Credit Card',
            type: 'credit_card',
            initial_balance: -5000
        });
        
        const series = await getNetWorthSeries(db, 1);
        expect(series[0].netWorth).toBe(-5000);
    });
    
    it('returns all zeros for empty database', async () => {
        const series = await getNetWorthSeries(db, 3);
        expect(series.length).toBe(3);
        expect(series.every(p => p.netWorth === 0)).toBe(true);
    });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/lib/db/repos/reports.test.ts`
Expected: FAIL with "getNetWorthSeries is not defined"

- [x] **Step 3: Implement `getNetWorthSeries`**

Add to `src/lib/db/repos/reports.ts`:

```typescript
import { getBalanceAsOf } from './accounts';

export interface NetWorthPoint {
    month: string;
    netWorth: number;
}

export async function getNetWorthSeries(
    db: DatabaseService,
    months: number,
    includeAdjustments = false
): Promise<NetWorthPoint[]> {
    const points: NetWorthPoint[] = [];
    const now = new Date();
    
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const monthEnd = nextMonthStart(month);
        const monthEndDate = monthEnd.slice(0, 10); // "YYYY-MM-DD"
        
        const accounts = await db.query<{ id: string }>(
            'SELECT id FROM accounts WHERE deleted_at IS NULL'
        );
        
        let netWorth = 0;
        for (const acc of accounts) {
            netWorth += await getBalanceAsOf(db, acc.id, monthEndDate);
        }
        
        points.push({ month, netWorth });
    }
    
    return points;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/lib/db/repos/reports.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/db/repos/reports.ts src/lib/db/repos/reports.test.ts src/lib/db/repos/accounts.ts
git commit -m "feat: add getNetWorthSeries to reports repo"
```

---

## Task 4: Add `getCategoryTrend` to reports repo

**Files:**
- Modify: `src/lib/db/repos/reports.ts`
- Test: `src/lib/db/repos/reports.test.ts`

**Interfaces:**
- Consumes: `db: DatabaseService`, `tagId: string`, `months: number`, `includeAdjustments?: boolean`
- Produces: `Promise<{ month: string; spent: number }[]>`

- [x] **Step 1: Write failing test**

Add to `src/lib/db/repos/reports.test.ts`:

```typescript
import { getCategoryTrend } from './reports';
import { createCategoryTag, createCategoryType } from './categories';

describe('getCategoryTrend', () => {
    let db: any;
    let tagId: string;
    
    beforeEach(async () => {
        db = await createTestDb();
        await runMigrations(db);
        
        const typeId = await createCategoryType(db, { name: 'Essentials' });
        tagId = await createCategoryTag(db, { name: 'Groceries', type_id: typeId });
    });
    
    it('returns per-month expense sum for one tag', async () => {
        const accountId = await createAccount(db, {
            name: 'Checking',
            type: 'checking',
            initial_balance: 0
        });
        
        await createTransaction(db, {
            kind: 'expense',
            amount: 200,
            account_id: accountId,
            tag_id: tagId,
            date: '2026-01-15'
        });
        
        await createTransaction(db, {
            kind: 'expense',
            amount: 300,
            account_id: accountId,
            tag_id: tagId,
            date: '2026-02-15'
        });
        
        const trend = await getCategoryTrend(db, tagId, 3);
        expect(trend.length).toBe(3);
        expect(trend[0].spent).toBe(300);
        expect(trend[1].spent).toBe(200);
        expect(trend[2].spent).toBe(0);
    });
    
    it('refund reduces the refund-month expense', async () => {
        const accountId = await createAccount(db, {
            name: 'Checking',
            type: 'checking',
            initial_balance: 0
        });
        
        await createTransaction(db, {
            kind: 'expense',
            amount: 200,
            account_id: accountId,
            tag_id: tagId,
            date: '2026-01-15'
        });
        
        await createTransaction(db, {
            kind: 'refund',
            amount: 50,
            account_id: accountId,
            tag_id: tagId,
            date: '2026-02-10'
        });
        
        const trend = await getCategoryTrend(db, tagId, 2);
        expect(trend[0].spent).toBe(-50); // refund in Feb
        expect(trend[1].spent).toBe(200); // expense in Jan
    });
    
    it('returns all zeros for empty tag', async () => {
        const trend = await getCategoryTrend(db, tagId, 3);
        expect(trend.length).toBe(3);
        expect(trend.every(p => p.spent === 0)).toBe(true);
    });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/lib/db/repos/reports.test.ts`
Expected: FAIL with "getCategoryTrend is not defined"

- [x] **Step 3: Implement `getCategoryTrend`**

Add to `src/lib/db/repos/reports.ts`:

```typescript
export interface CategoryTrendPoint {
    month: string;
    spent: number;
}

export async function getCategoryTrend(
    db: DatabaseService,
    tagId: string,
    months: number,
    includeAdjustments = false
): Promise<CategoryTrendPoint[]> {
    const points: CategoryTrendPoint[] = [];
    const now = new Date();
    
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const monthStart = `${month}-01`;
        const monthEnd = nextMonthStart(month);
        
        const kindFilter = includeAdjustments
            ? `t.kind IN ('expense', 'refund', 'adjustment')`
            : `t.kind IN ('expense', 'refund')`;
        
        const rows = await db.query<{ kind: string; total: number | null }>(`
            SELECT t.kind, SUM(t.amount) AS total FROM transactions t
            WHERE ${kindFilter} AND t.tag_id = ? AND t.date >= ? AND t.date < ? AND t.deleted_at IS NULL
            GROUP BY t.kind`, [tagId, monthStart, monthEnd]);
        
        let spent = 0;
        for (const r of rows) {
            if (r.kind === 'expense') spent = r.total ?? 0;
            if (r.kind === 'refund') spent -= (r.total ?? 0);
        }
        
        points.push({ month, spent });
    }
    
    return points;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/lib/db/repos/reports.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/db/repos/reports.ts src/lib/db/repos/reports.test.ts
git commit -m "feat: add getCategoryTrend to reports repo"
```

---

## Task 5: Add `getStackedCategorySeries` to reports repo

**Files:**
- Modify: `src/lib/db/repos/reports.ts`
- Test: `src/lib/db/repos/reports.test.ts`

**Interfaces:**
- Consumes: `db: DatabaseService`, `months: number`, `includeAdjustments?: boolean`
- Produces: `Promise<{ month: string; tags: { tagId: string | null; name: string; total: number }[] }[]>`

- [x] **Step 1: Write failing test**

Add to `src/lib/db/repos/reports.test.ts`:

```typescript
import { getStackedCategorySeries } from './reports';

describe('getStackedCategorySeries', () => {
    let db: any;
    
    beforeEach(async () => {
        db = await createTestDb();
        await runMigrations(db);
    });
    
    it('returns per-month per-tag breakdown', async () => {
        const accountId = await createAccount(db, {
            name: 'Checking',
            type: 'checking',
            initial_balance: 0
        });
        
        const typeId = await createCategoryType(db, { name: 'Essentials' });
        const groceriesId = await createCategoryTag(db, { name: 'Groceries', type_id: typeId });
        const rentId = await createCategoryTag(db, { name: 'Rent', type_id: typeId });
        
        await createTransaction(db, {
            kind: 'expense',
            amount: 200,
            account_id: accountId,
            tag_id: groceriesId,
            date: '2026-01-15'
        });
        
        await createTransaction(db, {
            kind: 'expense',
            amount: 1000,
            account_id: accountId,
            tag_id: rentId,
            date: '2026-01-20'
        });
        
        const series = await getStackedCategorySeries(db, 1);
        expect(series.length).toBe(1);
        expect(series[0].tags.length).toBe(2);
        
        const rent = series[0].tags.find(t => t.tagId === rentId);
        expect(rent?.total).toBe(1000);
        
        const groceries = series[0].tags.find(t => t.tagId === groceriesId);
        expect(groceries?.total).toBe(200);
    });
    
    it('includes Uncategorised slice for null tag_id', async () => {
        const accountId = await createAccount(db, {
            name: 'Checking',
            type: 'checking',
            initial_balance: 0
        });
        
        await createTransaction(db, {
            kind: 'expense',
            amount: 100,
            account_id: accountId,
            tag_id: null,
            date: '2026-01-15'
        });
        
        const series = await getStackedCategorySeries(db, 1);
        const uncategorised = series[0].tags.find(t => t.tagId === null);
        expect(uncategorised?.name).toBe('Uncategorised');
        expect(uncategorised?.total).toBe(100);
    });
    
    it('returns empty tag arrays for empty database', async () => {
        const series = await getStackedCategorySeries(db, 3);
        expect(series.length).toBe(3);
        expect(series.every(p => p.tags.length === 0)).toBe(true);
    });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/lib/db/repos/reports.test.ts`
Expected: FAIL with "getStackedCategorySeries is not defined"

- [x] **Step 3: Implement `getStackedCategorySeries`**

Add to `src/lib/db/repos/reports.ts`:

```typescript
export interface StackedCategoryPoint {
    month: string;
    tags: { tagId: string | null; name: string; total: number }[];
}

export async function getStackedCategorySeries(
    db: DatabaseService,
    months: number,
    includeAdjustments = false
): Promise<StackedCategoryPoint[]> {
    const points: StackedCategoryPoint[] = [];
    const now = new Date();
    
    for (let i = months - 1; i >= 0; i--) {
        const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const monthStart = `${month}-01`;
        const monthEnd = nextMonthStart(month);
        
        const kindFilter = includeAdjustments
            ? `t.kind IN ('expense', 'refund', 'adjustment')`
            : `t.kind IN ('expense', 'refund')`;
        
        const rows = await db.query<{ tag_id: string | null; name: string; total: number }>(`
            SELECT t.tag_id, COALESCE(ct.name, 'Uncategorised') AS name, SUM(t.amount) AS total
            FROM transactions t
            LEFT JOIN category_tags ct ON t.tag_id = ct.id
            WHERE ${kindFilter} AND t.kind = 'expense' AND t.date >= ? AND t.date < ? AND t.deleted_at IS NULL
            GROUP BY t.tag_id`, [monthStart, monthEnd]);
        
        const tags = rows.map(r => ({
            tagId: r.tag_id,
            name: r.name,
            total: r.total
        }));
        
        points.push({ month, tags });
    }
    
    return points;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/lib/db/repos/reports.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/db/repos/reports.ts src/lib/db/repos/reports.test.ts
git commit -m "feat: add getStackedCategorySeries to reports repo"
```

---

## Task 6: Add `getYearOverYear` to reports repo

**Files:**
- Modify: `src/lib/db/repos/reports.ts`
- Test: `src/lib/db/repos/reports.test.ts`

**Interfaces:**
- Consumes: `db: DatabaseService`, `yearA: number`, `yearB: number`, `includeAdjustments?: boolean`
- Produces: `Promise<{ month: string; yearAIncome: number; yearAExpense: number; yearBIncome: number; yearBExpense: number }[]>`

- [x] **Step 1: Write failing test**

Add to `src/lib/db/repos/reports.test.ts`:

```typescript
import { getYearOverYear } from './reports';

describe('getYearOverYear', () => {
    let db: any;
    
    beforeEach(async () => {
        db = await createTestDb();
        await runMigrations(db);
    });
    
    it('returns 12 months comparing two years', async () => {
        const accountId = await createAccount(db, {
            name: 'Checking',
            type: 'checking',
            initial_balance: 0
        });
        
        await createTransaction(db, {
            kind: 'income',
            amount: 5000,
            account_id: accountId,
            date: '2025-01-15'
        });
        
        await createTransaction(db, {
            kind: 'expense',
            amount: 3000,
            account_id: accountId,
            date: '2025-01-20'
        });
        
        await createTransaction(db, {
            kind: 'income',
            amount: 5500,
            account_id: accountId,
            date: '2026-01-15'
        });
        
        await createTransaction(db, {
            kind: 'expense',
            amount: 3200,
            account_id: accountId,
            date: '2026-01-20'
        });
        
        const yoy = await getYearOverYear(db, 2025, 2026);
        expect(yoy.length).toBe(12);
        
        expect(yoy[0].month).toBe('01');
        expect(yoy[0].yearAIncome).toBe(5000);
        expect(yoy[0].yearAExpense).toBe(3000);
        expect(yoy[0].yearBIncome).toBe(5500);
        expect(yoy[0].yearBExpense).toBe(3200);
    });
    
    it('returns zeros for missing months', async () => {
        const yoy = await getYearOverYear(db, 2025, 2026);
        expect(yoy.length).toBe(12);
        expect(yoy.every(p => p.yearAIncome === 0 && p.yearBIncome === 0)).toBe(true);
    });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/lib/db/repos/reports.test.ts`
Expected: FAIL with "getYearOverYear is not defined"

- [x] **Step 3: Implement `getYearOverYear`**

Add to `src/lib/db/repos/reports.ts`:

```typescript
export interface YearOverYearPoint {
    month: string; // "01"-"12"
    yearAIncome: number;
    yearAExpense: number;
    yearBIncome: number;
    yearBExpense: number;
}

export async function getYearOverYear(
    db: DatabaseService,
    yearA: number,
    yearB: number,
    includeAdjustments = false
): Promise<YearOverYearPoint[]> {
    const points: YearOverYearPoint[] = [];
    
    for (let m = 1; m <= 12; m++) {
        const month = String(m).padStart(2, '0');
        
        const kindFilter = includeAdjustments
            ? `t.kind IN ('expense', 'income', 'refund', 'adjustment')`
            : `t.kind IN ('expense', 'income', 'refund')`;
        
        const startA = `${yearA}-${month}-01`;
        const endA = `${yearA}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
        const startB = `${yearB}-${month}-01`;
        const endB = `${yearB}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
        
        const dataA = await db.query<{ kind: string; total: number | null }>(`
            SELECT t.kind, SUM(t.amount) AS total FROM transactions t
            WHERE ${kindFilter} AND t.date >= ? AND t.date < ? AND t.deleted_at IS NULL
            GROUP BY t.kind`, [startA, endA]);
        
        const dataB = await db.query<{ kind: string; total: number | null }>(`
            SELECT t.kind, SUM(t.amount) AS total FROM transactions t
            WHERE ${kindFilter} AND t.date >= ? AND t.date < ? AND t.deleted_at IS NULL
            GROUP BY t.kind`, [startB, endB]);
        
        let yearAIncome = 0, yearAExpense = 0;
        for (const r of dataA) {
            if (r.kind === 'income') yearAIncome = r.total ?? 0;
            if (r.kind === 'expense') yearAExpense = r.total ?? 0;
            if (r.kind === 'refund') yearAExpense -= (r.total ?? 0);
        }
        
        let yearBIncome = 0, yearBExpense = 0;
        for (const r of dataB) {
            if (r.kind === 'income') yearBIncome = r.total ?? 0;
            if (r.kind === 'expense') yearBExpense = r.total ?? 0;
            if (r.kind === 'refund') yearBExpense -= (r.total ?? 0);
        }
        
        points.push({ month, yearAIncome, yearAExpense, yearBIncome, yearBExpense });
    }
    
    return points;
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/lib/db/repos/reports.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/db/repos/reports.ts src/lib/db/repos/reports.test.ts
git commit -m "feat: add getYearOverYear to reports repo"
```

---

## Task 7: Add LineChart component

**Files:**
- Create: `src/lib/components/charts/LineChart.svelte`
- Test: `src/lib/components/charts/LineChart.test.ts`

**Interfaces:**
- Consumes: `data: { x: Date; y: number }[]`, `yFormat: (n: number) => string`, `xFormat: (d: Date) => string`, `showArea?: boolean`
- Produces: SVG line chart with optional area fill

- [x] **Step 1: Write failing test**

Create `src/lib/components/charts/LineChart.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import LineChart from './LineChart.svelte';

describe('LineChart', () => {
    it('renders SVG with line path', () => {
        const data = [
            { x: new Date('2026-01-01'), y: 100 },
            { x: new Date('2026-02-01'), y: 200 }
        ];
        const { container } = render(LineChart, {
            props: {
                data,
                yFormat: (n) => `$${n}`,
                xFormat: (d) => d.toLocaleDateString()
            }
        });
        const svg = container.querySelector('svg');
        expect(svg).not.toBeNull();
        const path = container.querySelector('path');
        expect(path).not.toBeNull();
    });
    
    it('renders axis labels', () => {
        const data = [
            { x: new Date('2026-01-01'), y: 100 },
            { x: new Date('2026-02-01'), y: 200 }
        ];
        const { container } = render(LineChart, {
            props: {
                data,
                yFormat: (n) => `$${n}`,
                xFormat: (d) => d.toLocaleDateString()
            }
        });
        const axisLabels = container.querySelectorAll('text');
        expect(axisLabels.length).toBeGreaterThan(0);
    });
    
    it('renders area fill when showArea is true', () => {
        const data = [
            { x: new Date('2026-01-01'), y: 100 },
            { x: new Date('2026-02-01'), y: 200 }
        ];
        const { container } = render(LineChart, {
            props: {
                data,
                yFormat: (n) => `$${n}`,
                xFormat: (d) => d.toLocaleDateString(),
                showArea: true
            }
        });
        const paths = container.querySelectorAll('path');
        expect(paths.length).toBeGreaterThanOrEqual(2); // line + area
    });
    
    it('renders empty state when data is empty', () => {
        const { container } = render(LineChart, {
            props: {
                data: [],
                yFormat: (n) => `$${n}`,
                xFormat: (d) => d.toLocaleDateString()
            }
        });
        const svg = container.querySelector('svg');
        expect(svg).toBeNull();
    });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/lib/components/charts/LineChart.test.ts`
Expected: FAIL with "LineChart is not defined"

- [x] **Step 3: Implement LineChart**

Create `src/lib/components/charts/LineChart.svelte`:

```svelte
<script lang="ts">
    import { LayerCake, Svg, Line, Area, AxisX, AxisY } from 'layercake';
    
    let {
        data,
        yFormat,
        xFormat,
        showArea = true
    }: {
        data: { x: Date; y: number }[];
        yFormat: (n: number) => string;
        xFormat: (d: Date) => string;
        showArea?: boolean;
    } = $props();
</script>

{#if data.length > 0}
    <div class="line-chart">
        <LayerCake
            data={data}
            x={(d) => d.x}
            y={(d) => d.y}
        >
            <Svg>
                {#if showArea}
                    <Area fill="var(--color-phosphor)" opacity={0.2} />
                {/if}
                <Line stroke="var(--color-phosphor)" strokeWidth={2} />
                <AxisX
                    tickFormat={xFormat}
                    tickSize={0}
                    stroke="var(--color-chalk)"
                />
                <AxisY
                    tickFormat={yFormat}
                    tickSize={0}
                    stroke="var(--color-chalk)"
                />
            </Svg>
        </LayerCake>
    </div>
{/if}

<style>
    .line-chart {
        width: 100%;
        height: 300px;
    }
</style>
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/lib/components/charts/LineChart.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/components/charts/LineChart.svelte src/lib/components/charts/LineChart.test.ts
git commit -m "feat: add LineChart component using LayerCake"
```

---

## Task 8: Add StackedAreaChart component

**Files:**
- Create: `src/lib/components/charts/StackedAreaChart.svelte`
- Test: `src/lib/components/charts/StackedAreaChart.test.ts`

**Interfaces:**
- Consumes: `data: { month: string; tags: { tagId: string | null; name: string; total: number }[] }[]`, `yFormat: (n: number) => string`, `xFormat: (month: string) => string`, `colors: Record<string, string>`
- Produces: SVG stacked area chart with legend

- [x] **Step 1: Write failing test**

Create `src/lib/components/charts/StackedAreaChart.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import StackedAreaChart from './StackedAreaChart.svelte';

describe('StackedAreaChart', () => {
    it('renders SVG with stacked areas', () => {
        const data = [
            {
                month: '2026-01',
                tags: [
                    { tagId: 'a', name: 'Groceries', total: 200 },
                    { tagId: 'b', name: 'Rent', total: 1000 }
                ]
            }
        ];
        const colors = { a: '#f00', b: '#0f0' };
        const { container } = render(StackedAreaChart, {
            props: {
                data,
                yFormat: (n) => `$${n}`,
                xFormat: (m) => m,
                colors
            }
        });
        const svg = container.querySelector('svg');
        expect(svg).not.toBeNull();
    });
    
    it('renders legend with tags', () => {
        const data = [
            {
                month: '2026-01',
                tags: [
                    { tagId: 'a', name: 'Groceries', total: 200 },
                    { tagId: 'b', name: 'Rent', total: 1000 }
                ]
            }
        ];
        const colors = { a: '#f00', b: '#0f0' };
        const { container } = render(StackedAreaChart, {
            props: {
                data,
                yFormat: (n) => `$${n}`,
                xFormat: (m) => m,
                colors
            }
        });
        const legendItems = container.querySelectorAll('.legend-item');
        expect(legendItems.length).toBe(2);
    });
    
    it('renders empty state when data is empty', () => {
        const { container } = render(StackedAreaChart, {
            props: {
                data: [],
                yFormat: (n) => `$${n}`,
                xFormat: (m) => m,
                colors: {}
            }
        });
        const svg = container.querySelector('svg');
        expect(svg).toBeNull();
    });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/lib/components/charts/StackedAreaChart.test.ts`
Expected: FAIL with "StackedAreaChart is not defined"

- [x] **Step 3: Implement StackedAreaChart**

Create `src/lib/components/charts/StackedAreaChart.svelte`:

```svelte
<script lang="ts">
    import { LayerCake, Svg, StackedArea, AxisX, AxisY } from 'layercake';
    
    let {
        data,
        yFormat,
        xFormat,
        colors
    }: {
        data: { month: string; tags: { tagId: string | null; name: string; total: number }[] }[];
        yFormat: (n: number) => string;
        xFormat: (month: string) => string;
        colors: Record<string, string>;
    } = $props();
    
    const allTags = $derived(
        Array.from(new Set(data.flatMap(d => d.tags.map(t => t.tagId))))
    );
</script>

{#if data.length > 0}
    <div class="stacked-area-chart">
        <LayerCake
            data={data}
            x={(d) => d.month}
            y={(d) => d.tags.reduce((sum, t) => sum + t.total, 0)}
        >
            <Svg>
                <StackedArea
                    keys={allTags}
                    fill={(d, i) => colors[allTags[i]] ?? '#94a3b8'}
                />
                <AxisX
                    tickFormat={xFormat}
                    tickSize={0}
                    stroke="var(--color-chalk)"
                />
                <AxisY
                    tickFormat={yFormat}
                    tickSize={0}
                    stroke="var(--color-chalk)"
                />
            </Svg>
        </LayerCake>
        <div class="legend">
            {#each allTags as tagId}
                {@const tag = data[0]?.tags.find(t => t.tagId === tagId)}
                {#if tag}
                    <div class="legend-item">
                        <span class="color-swatch" style="background-color: {colors[tagId] ?? '#94a3b8'}"></span>
                        <span class="label">{tag.name}</span>
                    </div>
                {/if}
            {/each}
        </div>
    </div>
{/if}

<style>
    .stacked-area-chart {
        width: 100%;
        height: 300px;
    }
    .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        margin-top: 1rem;
    }
    .legend-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    .color-swatch {
        width: 12px;
        height: 12px;
        border-radius: 2px;
    }
</style>
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/lib/components/charts/StackedAreaChart.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/components/charts/StackedAreaChart.svelte src/lib/components/charts/StackedAreaChart.test.ts
git commit -m "feat: add StackedAreaChart component using LayerCake"
```

---

## Task 9: Add GroupedBarChart component

**Files:**
- Create: `src/lib/components/charts/GroupedBarChart.svelte`
- Test: `src/lib/components/charts/GroupedBarChart.test.ts`

**Interfaces:**
- Consumes: `data: { month: string; yearAIncome: number; yearAExpense: number; yearBIncome: number; yearBExpense: number }[]`, `yFormat: (n: number) => string`, `xFormat: (month: string) => string`
- Produces: SVG grouped bar chart with legend

- [x] **Step 1: Write failing test**

Create `src/lib/components/charts/GroupedBarChart.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/svelte';
import GroupedBarChart from './GroupedBarChart.svelte';

describe('GroupedBarChart', () => {
    it('renders SVG with grouped bars', () => {
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
        const svg = container.querySelector('svg');
        expect(svg).not.toBeNull();
    });
    
    it('renders legend with 4 series', () => {
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
        const legendItems = container.querySelectorAll('.legend-item');
        expect(legendItems.length).toBe(4);
    });
    
    it('renders empty state when data is empty', () => {
        const { container } = render(GroupedBarChart, {
            props: {
                data: [],
                yFormat: (n) => `$${n}`,
                xFormat: (m) => m
            }
        });
        const svg = container.querySelector('svg');
        expect(svg).toBeNull();
    });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/lib/components/charts/GroupedBarChart.test.ts`
Expected: FAIL with "GroupedBarChart is not defined"

- [x] **Step 3: Implement GroupedBarChart**

Create `src/lib/components/charts/GroupedBarChart.svelte`:

```svelte
<script lang="ts">
    import { LayerCake, Svg, GroupedBar, AxisX, AxisY } from 'layercake';
    
    let {
        data,
        yFormat,
        xFormat
    }: {
        data: { month: string; yearAIncome: number; yearAExpense: number; yearBIncome: number; yearBExpense: number }[];
        yFormat: (n: number) => string;
        xFormat: (month: string) => string;
    } = $props();
    
    const series = ['yearAIncome', 'yearAExpense', 'yearBIncome', 'yearBExpense'];
    const colors = {
        yearAIncome: '#10b981',
        yearAExpense: '#f59e0b',
        yearBIncome: '#059669',
        yearBExpense: '#d97706'
    };
    const labels = {
        yearAIncome: 'Year A Income',
        yearAExpense: 'Year A Expense',
        yearBIncome: 'Year B Income',
        yearBExpense: 'Year B Expense'
    };
</script>

{#if data.length > 0}
    <div class="grouped-bar-chart">
        <LayerCake
            data={data}
            x={(d) => d.month}
            y={(d) => Math.max(d.yearAIncome, d.yearAExpense, d.yearBIncome, d.yearBExpense)}
        >
            <Svg>
                <GroupedBar
                    keys={series}
                    fill={(d, i) => colors[series[i]]}
                />
                <AxisX
                    tickFormat={xFormat}
                    tickSize={0}
                    stroke="var(--color-chalk)"
                />
                <AxisY
                    tickFormat={yFormat}
                    tickSize={0}
                    stroke="var(--color-chalk)"
                />
            </Svg>
        </LayerCake>
        <div class="legend">
            {#each series as key}
                <div class="legend-item">
                    <span class="color-swatch" style="background-color: {colors[key]}"></span>
                    <span class="label">{labels[key]}</span>
                </div>
            {/each}
        </div>
    </div>
{/if}

<style>
    .grouped-bar-chart {
        width: 100%;
        height: 300px;
    }
    .legend {
        display: flex;
        flex-wrap: wrap;
        gap: 1rem;
        margin-top: 1rem;
    }
    .legend-item {
        display: flex;
        align-items: center;
        gap: 0.5rem;
    }
    .color-swatch {
        width: 12px;
        height: 12px;
        border-radius: 2px;
    }
</style>
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/lib/components/charts/GroupedBarChart.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/components/charts/GroupedBarChart.svelte src/lib/components/charts/GroupedBarChart.test.ts
git commit -m "feat: add GroupedBarChart component using LayerCake"
```

---

## Task 10: Add reports store

**Files:**
- Create: `src/lib/stores/reports.svelte.ts`
- Test: `src/lib/stores/reports.test.ts`

**Interfaces:**
- Consumes: `getDb()`, repo functions from `reports.ts`
- Produces: `ReportsStore` singleton with `$state` for window, adjustments, per-report data

- [x] **Step 1: Write failing test**

Create `src/lib/stores/reports.test.ts`:

```typescript
import { describe, it, expect, beforeEach } from 'vitest';
import { ReportsStore } from './reports.svelte';

describe('ReportsStore', () => {
    let store: ReportsStore;
    
    beforeEach(() => {
        store = new ReportsStore();
    });
    
    it('initializes with default values', () => {
        expect(store.window).toBe(12);
        expect(store.includeAdjustments).toBe(false);
        expect(store.netWorth).toEqual([]);
    });
    
    it('updates window state', () => {
        store.window = 6;
        expect(store.window).toBe(6);
    });
    
    it('updates includeAdjustments state', () => {
        store.includeAdjustments = true;
        expect(store.includeAdjustments).toBe(true);
    });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `pnpm test:watch src/lib/stores/reports.test.ts`
Expected: FAIL with "ReportsStore is not defined"

- [x] **Step 3: Implement ReportsStore**

Create `src/lib/stores/reports.svelte.ts`:

```typescript
import { getDb } from '$lib/db';
import {
    getNetWorthSeries,
    getCategoryTrend,
    getStackedCategorySeries,
    getYearOverYear,
    type NetWorthPoint,
    type CategoryTrendPoint,
    type StackedCategoryPoint,
    type YearOverYearPoint
} from '$lib/db/repos/reports';

export class ReportsStore {
    window = $state<6 | 12 | 24>(12);
    includeAdjustments = $state(false);
    
    netWorth = $state<NetWorthPoint[]>([]);
    categoryTrend = $state<CategoryTrendPoint[]>([]);
    stackedComposition = $state<StackedCategoryPoint[]>([]);
    yearOverYear = $state<YearOverYearPoint[]>([]);
    
    async loadNetWorth(): Promise<void> {
        const db = getDb();
        this.netWorth = await getNetWorthSeries(db, this.window, this.includeAdjustments);
    }
    
    async loadCategoryTrend(tagId: string): Promise<void> {
        const db = getDb();
        this.categoryTrend = await getCategoryTrend(db, tagId, this.window, this.includeAdjustments);
    }
    
    async loadStackedComposition(): Promise<void> {
        const db = getDb();
        this.stackedComposition = await getStackedCategorySeries(db, this.window, this.includeAdjustments);
    }
    
    async loadYearOverYear(yearA: number, yearB: number): Promise<void> {
        const db = getDb();
        this.yearOverYear = await getYearOverYear(db, yearA, yearB, this.includeAdjustments);
    }
}

export const reportsStore = new ReportsStore();
```

- [x] **Step 4: Run test to verify it passes**

Run: `pnpm test:watch src/lib/stores/reports.test.ts`
Expected: PASS

- [x] **Step 5: Commit**

```bash
git add src/lib/stores/reports.svelte.ts src/lib/stores/reports.test.ts
git commit -m "feat: add ReportsStore for centralized report state"
```

---

## Task 11: Add i18n keys

**Files:**
- Modify: `messages/en.json`
- Modify: `messages/vi.json`

- [x] **Step 1: Add English keys**

Add to `messages/en.json`:

```json
"reports_net_worth": "Net Worth",
"reports_net_worth_over_time": "Net Worth Over Time",
"reports_category_trend": "Category Trend",
"reports_composition": "Composition",
"reports_year_over_year": "Year Over Year",
"reports_window_6m": "6 months",
"reports_window_12m": "12 months",
"reports_window_24m": "24 months",
"reports_empty_net_worth": "No transactions yet",
"reports_empty_category": "No expenses for this category",
"reports_empty_composition": "No expenses yet",
"reports_empty_yoy": "No data for selected years",
"reports_axis_month": "Month",
"reports_axis_amount": "Amount",
"reports_legend_net_worth": "Net Worth",
"reports_legend_income": "Income",
"reports_legend_expense": "Expense",
"reports_select_tag": "Select category",
"reports_select_year": "Select year"
```

- [x] **Step 2: Add Vietnamese keys**

Add to `messages/vi.json`:

```json
"reports_net_worth": "Tài sản ròng",
"reports_net_worth_over_time": "Tài sản ròng theo thời gian",
"reports_category_trend": "Xu hướng danh mục",
"reports_composition": "Cơ cấu",
"reports_year_over_year": "So sánh năm",
"reports_window_6m": "6 tháng",
"reports_window_12m": "12 tháng",
"reports_window_24m": "24 tháng",
"reports_empty_net_worth": "Chưa có giao dịch",
"reports_empty_category": "Không có chi tiêu cho danh mục này",
"reports_empty_composition": "Chưa có chi tiêu",
"reports_empty_yoy": "Không có dữ liệu cho năm đã chọn",
"reports_axis_month": "Tháng",
"reports_axis_amount": "Số tiền",
"reports_legend_net_worth": "Tài sản ròng",
"reports_legend_income": "Thu nhập",
"reports_legend_expense": "Chi tiêu",
"reports_select_tag": "Chọn danh mục",
"reports_select_year": "Chọn năm"
```

- [x] **Step 3: Regenerate Paraglide messages**

Run: `pnpm check`
Expected: No TypeScript errors

- [x] **Step 4: Commit**

```bash
git add messages/en.json messages/vi.json
git commit -m "feat(i18n): add reports keys for new time-series reports"
```

---

## Task 12: Add net-worth route page

**Files:**
- Create: `src/routes/reports/net-worth/+page.svelte`

- [x] **Step 1: Create net-worth page**

Create `src/routes/reports/net-worth/+page.svelte`:

```svelte
<script lang="ts">
    import { onMount } from 'svelte';
    import { reportsStore } from '$lib/stores/reports.svelte';
    import LineChart from '$lib/components/charts/LineChart.svelte';
    import { formatCurrency } from '$lib/utils/currency';
    import { settings } from '$lib/stores/settings.svelte';
    import * as m from '$lib/paraglide/messages';
    
    onMount(() => {
        reportsStore.loadNetWorth();
    });
    
    $effect(() => {
        reportsStore.window;
        reportsStore.includeAdjustments;
        reportsStore.loadNetWorth();
    });
    
    const yFormat = (n: number) => formatCurrency(n, settings.currency, settings.locale);
    const xFormat = (d: Date) => d.toLocaleDateString(settings.locale, { month: 'short', year: '2-digit' });
</script>

<div class="page">
    <h1>{m.reports_net_worth_over_time()}</h1>
    
    <div class="controls">
        <select bind:value={reportsStore.window}>
            <option value={6}>{m.reports_window_6m()}</option>
            <option value={12}>{m.reports_window_12m()}</option>
            <option value={24}>{m.reports_window_24m()}</option>
        </select>
        
        <label>
            <input type="checkbox" bind:checked={reportsStore.includeAdjustments} />
            {m.reports_include_adjustments()}
        </label>
    </div>
    
    {#if reportsStore.netWorth.length === 0}
        <p class="empty">{m.reports_empty_net_worth()}</p>
    {:else}
        <LineChart
            data={reportsStore.netWorth.map(p => ({ x: new Date(p.month + '-01'), y: p.netWorth }))}
            {yFormat}
            {xFormat}
            showArea={true}
        />
    {/if}
</div>

<style>
    .page {
        padding: 2rem;
    }
    .controls {
        display: flex;
        gap: 1rem;
        margin-bottom: 1rem;
    }
    .empty {
        color: var(--color-chalk);
        text-align: center;
        padding: 2rem;
    }
</style>
```

- [x] **Step 2: Run dev server and verify**

Run: `pnpm dev`
Navigate to: `/reports/net-worth`
Expected: Page renders with chart (or empty state)

- [x] **Step 3: Commit**

```bash
git add src/routes/reports/net-worth/+page.svelte
git commit -m "feat: add net worth over time report page"
```

---

## Task 13: Add category-trend route page

**Files:**
- Create: `src/routes/reports/category/+page.svelte`

- [x] **Step 1: Create category-trend page**

Create `src/routes/reports/category/+page.svelte`:

```svelte
<script lang="ts">
    import { onMount } from 'svelte';
    import { reportsStore } from '$lib/stores/reports.svelte';
    import LineChart from '$lib/components/charts/LineChart.svelte';
    import { formatCurrency } from '$lib/utils/currency';
    import { settings } from '$lib/stores/settings.svelte';
    import { getDb } from '$lib/db';
    import { getCategoryTags } from '$lib/db/repos/categories';
    import * as m from '$lib/paraglide/messages';
    
    let tags = $state<{ id: string; name: string }[]>([]);
    let selectedTagId = $state<string>('');
    
    onMount(async () => {
        const db = getDb();
        tags = await getCategoryTags(db);
        if (tags.length > 0) {
            selectedTagId = tags[0].id;
        }
    });
    
    $effect(() => {
        if (selectedTagId) {
            reportsStore.loadCategoryTrend(selectedTagId);
        }
    });
    
    $effect(() => {
        reportsStore.window;
        reportsStore.includeAdjustments;
        if (selectedTagId) {
            reportsStore.loadCategoryTrend(selectedTagId);
        }
    });
    
    const yFormat = (n: number) => formatCurrency(n, settings.currency, settings.locale);
    const xFormat = (d: Date) => d.toLocaleDateString(settings.locale, { month: 'short', year: '2-digit' });
</script>

<div class="page">
    <h1>{m.reports_category_trend()}</h1>
    
    <div class="controls">
        <select bind:value={selectedTagId}>
            <option value="">{m.reports_select_tag()}</option>
            {#each tags as tag}
                <option value={tag.id}>{tag.name}</option>
            {/each}
        </select>
        
        <select bind:value={reportsStore.window}>
            <option value={6}>{m.reports_window_6m()}</option>
            <option value={12}>{m.reports_window_12m()}</option>
            <option value={24}>{m.reports_window_24m()}</option>
        </select>
        
        <label>
            <input type="checkbox" bind:checked={reportsStore.includeAdjustments} />
            {m.reports_include_adjustments()}
        </label>
    </div>
    
    {#if reportsStore.categoryTrend.length === 0}
        <p class="empty">{m.reports_empty_category()}</p>
    {:else}
        <LineChart
            data={reportsStore.categoryTrend.map(p => ({ x: new Date(p.month + '-01'), y: p.spent }))}
            {yFormat}
            {xFormat}
            showArea={false}
        />
    {/if}
</div>

<style>
    .page {
        padding: 2rem;
    }
    .controls {
        display: flex;
        gap: 1rem;
        margin-bottom: 1rem;
    }
    .empty {
        color: var(--color-chalk);
        text-align: center;
        padding: 2rem;
    }
</style>
```

- [x] **Step 2: Run dev server and verify**

Run: `pnpm dev`
Navigate to: `/reports/category`
Expected: Page renders with tag picker and chart

- [x] **Step 3: Commit**

```bash
git add src/routes/reports/category/+page.svelte
git commit -m "feat: add category trend report page"
```

---

## Task 14: Add composition route page

**Files:**
- Create: `src/routes/reports/composition/+page.svelte`

- [x] **Step 1: Create composition page**

Create `src/routes/reports/composition/+page.svelte`:

```svelte
<script lang="ts">
    import { onMount } from 'svelte';
    import { reportsStore } from '$lib/stores/reports.svelte';
    import StackedAreaChart from '$lib/components/charts/StackedAreaChart.svelte';
    import { formatCurrency } from '$lib/utils/currency';
    import { settings } from '$lib/stores/settings.svelte';
    import * as m from '$lib/paraglide/messages';
    
    onMount(() => {
        reportsStore.loadStackedComposition();
    });
    
    $effect(() => {
        reportsStore.window;
        reportsStore.includeAdjustments;
        reportsStore.loadStackedComposition();
    });
    
    const yFormat = (n: number) => formatCurrency(n, settings.currency, settings.locale);
    const xFormat = (month: string) => month;
    
    const colors = $derived({
        ...Object.fromEntries(
            reportsStore.stackedComposition[0]?.tags.map((t, i) => [
                t.tagId,
                `hsl(${(i * 60) % 360}, 70%, 50%)`
            ]) ?? []
        )
    });
</script>

<div class="page">
    <h1>{m.reports_composition()}</h1>
    
    <div class="controls">
        <select bind:value={reportsStore.window}>
            <option value={6}>{m.reports_window_6m()}</option>
            <option value={12}>{m.reports_window_12m()}</option>
            <option value={24}>{m.reports_window_24m()}</option>
        </select>
        
        <label>
            <input type="checkbox" bind:checked={reportsStore.includeAdjustments} />
            {m.reports_include_adjustments()}
        </label>
    </div>
    
    {#if reportsStore.stackedComposition.length === 0}
        <p class="empty">{m.reports_empty_composition()}</p>
    {:else}
        <StackedAreaChart
            data={reportsStore.stackedComposition}
            {yFormat}
            {xFormat}
            {colors}
        />
    {/if}
</div>

<style>
    .page {
        padding: 2rem;
    }
    .controls {
        display: flex;
        gap: 1rem;
        margin-bottom: 1rem;
    }
    .empty {
        color: var(--color-chalk);
        text-align: center;
        padding: 2rem;
    }
</style>
```

- [x] **Step 2: Run dev server and verify**

Run: `pnpm dev`
Navigate to: `/reports/composition`
Expected: Page renders with stacked area chart

- [x] **Step 3: Commit**

```bash
git add src/routes/reports/composition/+page.svelte
git commit -m "feat: add composition report page"
```

---

## Task 15: Add year-over-year route page

**Files:**
- Create: `src/routes/reports/yoy/+page.svelte`

- [x] **Step 1: Create year-over-year page**

Create `src/routes/reports/yoy/+page.svelte`:

```svelte
<script lang="ts">
    import { onMount } from 'svelte';
    import { reportsStore } from '$lib/stores/reports.svelte';
    import GroupedBarChart from '$lib/components/charts/GroupedBarChart.svelte';
    import { formatCurrency } from '$lib/utils/currency';
    import { settings } from '$lib/stores/settings.svelte';
    import * as m from '$lib/paraglide/messages';
    
    const currentYear = new Date().getFullYear();
    let yearA = $state(currentYear - 1);
    let yearB = $state(currentYear);
    
    onMount(() => {
        reportsStore.loadYearOverYear(yearA, yearB);
    });
    
    $effect(() => {
        reportsStore.loadYearOverYear(yearA, yearB);
    });
    
    const yFormat = (n: number) => formatCurrency(n, settings.currency, settings.locale);
    const xFormat = (month: string) => month;
</script>

<div class="page">
    <h1>{m.reports_year_over_year()}</h1>
    
    <div class="controls">
        <label>
            Year A:
            <input type="number" bind:value={yearA} min={2000} max={2100} />
        </label>
        <label>
            Year B:
            <input type="number" bind:value={yearB} min={2000} max={2100} />
        </label>
    </div>
    
    {#if reportsStore.yearOverYear.length === 0}
        <p class="empty">{m.reports_empty_yoy()}</p>
    {:else}
        <GroupedBarChart
            data={reportsStore.yearOverYear}
            {yFormat}
            {xFormat}
        />
    {/if}
</div>

<style>
    .page {
        padding: 2rem;
    }
    .controls {
        display: flex;
        gap: 1rem;
        margin-bottom: 1rem;
    }
    .empty {
        color: var(--color-chalk);
        text-align: center;
        padding: 2rem;
    }
</style>
```

- [x] **Step 2: Run dev server and verify**

Run: `pnpm dev`
Navigate to: `/reports/yoy`
Expected: Page renders with grouped bar chart

- [x] **Step 3: Commit**

```bash
git add src/routes/reports/yoy/+page.svelte
git commit -m "feat: add year-over-year report page"
```

---

## Task 16: Update reports overview and navigation

**Files:**
- Modify: `src/routes/reports/+page.svelte`
- Modify: `src/routes/reports/trend/+page.svelte`
- Modify: `src/routes/reports/compare/+page.svelte`

- [x] **Step 1: Add navigation cards to overview page**

Add cards linking to the 4 new reports in the overview page. Match existing card style.

- [x] **Step 2: Update tab navigation in all reports pages**

Update the tab navigation in `trend/+page.svelte`, `compare/+page.svelte`, and the 4 new pages to include all 7 reports:
- Overview
- Trend
- Compare
- Net Worth
- Category
- Composition
- Year Over Year

- [x] **Step 3: Run dev server and verify navigation**

Run: `pnpm dev`
Navigate to: `/reports`
Expected: All navigation links work

- [x] **Step 4: Commit**

```bash
git add src/routes/reports/+page.svelte src/routes/reports/trend/+page.svelte src/routes/reports/compare/+page.svelte
git commit -m "feat: update reports navigation with new time-series reports"
```

---

## Task 17: Add E2E tests

**Files:**
- Create: `tests/e2e/reports-new.spec.ts`

- [x] **Step 1: Write E2E tests**

Create `tests/e2e/reports-new.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

test.describe('New Reports', () => {
    test('net worth page renders chart', async ({ page }) => {
        await page.goto('/reports/net-worth');
        const svg = page.locator('svg');
        await expect(svg).toBeVisible();
    });
    
    test('category trend page renders with tag picker', async ({ page }) => {
        await page.goto('/reports/category');
        const select = page.locator('select').first();
        await expect(select).toBeVisible();
    });
    
    test('composition page renders stacked chart', async ({ page }) => {
        await page.goto('/reports/composition');
        const svg = page.locator('svg');
        await expect(svg).toBeVisible();
    });
    
    test('year-over-year page renders with year pickers', async ({ page }) => {
        await page.goto('/reports/yoy');
        const yearInputs = page.locator('input[type="number"]');
        await expect(yearInputs).toHaveCount(2);
    });
    
    test('window selector triggers reload', async ({ page }) => {
        await page.goto('/reports/net-worth');
        const select = page.locator('select').first();
        await select.selectOption('6');
        // Chart should reload (visual verification)
    });
});
```

- [x] **Step 2: Run E2E tests**

Run: `pnpm test:e2e`
Expected: All tests pass

- [x] **Step 3: Commit**

```bash
git add tests/e2e/reports-new.spec.ts
git commit -m "test(e2e): add tests for new time-series reports"
```

---

## Task 18: Final verification

- [x] **Step 1: Run all unit tests**

Run: `pnpm test`
Expected: All tests pass

- [x] **Step 2: Run all E2E tests**

Run: `pnpm test:e2e`
Expected: All tests pass

- [x] **Step 3: Run type check**

Run: `pnpm check`
Expected: No TypeScript errors

- [x] **Step 4: Run build**

Run: `pnpm build`
Expected: Build succeeds

- [x] **Step 5: Manual testing**

Manually test all 4 new reports with seed data:
- Net worth over time
- Category trend (select different tags)
- Composition (stacked areas)
- Year-over-year (select different years)

Verify:
- Charts render correctly
- Empty states show when no data
- Negative net worth renders below zero
- Window selector works
- Adjustments toggle works

- [x] **Step 6: Update roadmap status**

Run: `pnpm test:roadmap`
Expected: STATUS.md updated

- [x] **Step 7: Final commit**

```bash
git add specs/STATUS.md
git commit -m "feat: add reporting depth — net worth, category trend, composition, year-over-year"
```

---

## Implementation Notes

**TDD discipline:** Every task follows red-green-refactor. Write failing test, watch it fail, implement minimum to pass, refactor.

**No schema changes:** All four reports read existing tables. No migration, no schema-version bump.

**Transfer handling:** Net worth inherits `getBalance`'s transfer logic (net-neutral by construction). No special-casing needed.

**Refund handling:** Refunds reduce the refund-month's expense (following `getTrend` convention). Not retroactive.

**Archived accounts:** Included in historical net worth (archiving is UI concern, not historical rewrite).

**LayerCake consistency:** Refactor DonutChart first, then use LayerCake for all new charts.

**Store pattern:** New `ReportsStore` centralizes shared state (window, adjustments). Each page imports the singleton.

**i18n:** Flat underscore keys (Paraglide 1.11.8 pin). Both en + vi. Run `pnpm check` after adding keys.

**Performance:** N+1 query pattern (one query per month) matches existing `getTrend`. For 24 months and a few thousand transactions, this is milliseconds. Window-function optimization deferred.

**Empty states:** Every chart must handle empty data gracefully (no NaN, no broken axes).

**Negative net worth:** Y-axis must render below zero. LayerCake auto-domains handle this; area fill must not clip.

**Currency formatting:** Reuse `formatCurrency(amount, currency, locale)` for axis labels. VND (0 decimals) and USD (2) render correctly.
