# Reporting Depth — Design

**Date:** 2026-07-06
**Status:** Design (pending implementation plan)
**Branch:** `feat/actual`

## Summary

Add four new time-series reports — net-worth-over-time, category drilldown trend, stacked category composition, and year-over-year — plus Layercake-based chart components and a reports store. Every series is **computed from transactions at query time**; nothing is stored as a balance snapshot. This honors Notchy's "derived, not stored" architecture (the principle learned from Actual Budget) — a net-worth point recomputed today equals the point recomputed next month, so reports can never drift from the source of truth.

No new architectural layer. Extends the existing reports repo, adds a store, and adds presentational chart components alongside the existing `DonutChart`.

## Goals

- A net-worth-over-time chart (the most-requested report) that derives history from transactions — no snapshot table, no denormalized balances.
- A category drilldown trend and a stacked composition view, giving the "what am I spending on, and is it changing" answer the current donut can't show over time.
- A year-over-year comparison extending the existing two-month compare to full years.
- Move chart rendering off hand-rolled SVG-axis math onto Layercake (already a dependency, Svelte-native), while keeping full visual control.
- Keep all finance calculation in the repo layer (testable with the DB-pattern) and all chart math in presentational components.

## Non-goals (explicit YAGNI)

- Cash-flow-by-account breakdown, net-worth projections/forecasts.
- Custom report builder, formula-driven reports (HyperFormula explicitly rejected — see session notes).
- Saved/persisted report configurations, printable/PDF export.
- A balance-snapshot table (Option B from brainstorming — rejected; violates derived-not-stored).
- Multi-currency aggregation (Notchy is single-currency; flagged as a future concern only).

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Net-worth historical data source | **Compute from transactions** (Option A) | Honors derived-not-stored; never drifts; no new storage |
| Charting | **Layercake** (already installed) | Svelte-native, no new dep, ends hand-rolled axis math, keeps visual control |
| Report scope | Net worth over time + category drilldown + stacked composition + year-over-year | Four cohesive reports sharing one data pattern |
| Architecture | **Approach A** — repo fn per report + pure charts + reports store | Matches existing layering; each report independently testable |

## Architecture

```
routes/reports/{net-worth,category,composition,yoy}/+page.svelte (UI)
  → reports.svelte.ts (store: window 6/12/24mo + adjustments toggle, loads/caches series)
      ├─→ reports.ts (repo: existing getOverview/getTrend/getComparison
      │                + 4 new series functions — SQL only, follow getTrend pattern)
      └─→ components/charts/ (LineChart, StackedAreaChart, GroupedBarChart — Svelte + Layercake)
```

### The four reports

| Report | New repo fn | Chart | Data source |
|---|---|---|---|
| Net worth over time | `getNetWorthSeries(db, months, includeAdjustments?)` | LineChart (area) | Cumulative-sum of all signed balances at each month-end |
| Category drilldown trend | `getCategoryTrend(db, tagId, months, includeAdjustments?)` | LineChart | Per-month expense sum for one tag, over N months |
| Stacked category composition | `getStackedCategorySeries(db, months, includeAdjustments?)` | StackedAreaChart | Per-month expense grouped by tag, all tags stacked |
| Year-over-year | `getYearOverYear(db, yearA, yearB, includeAdjustments?)` | GroupedBarChart | Per-month expense+income, two years side-by-side |

### Two shared principles (all four reports)

1. **Derived from transactions, never stored.** Every series is a SQL query over `transactions`. No snapshot table, no cached balance column.
2. **Transfers are net-neutral by construction.** Notchy's single-row transfer model means a transfer's amount counts once (source side); it never double-counts in net worth. The net-worth query sums signed balances exactly as `getBalance` does (`accounts.ts:98`), inheriting the same transfer handling — no special-casing.

## Repo queries — `reports.ts`

Four new functions following the existing `getTrend` loop pattern (month-ends, `kind IN (…)`, `deleted_at IS NULL`, `includeAdjustments` flag).

### `getNetWorthSeries(db, months, includeAdjustments?)` → `{ month: string; netWorth: number }[]`

The headline report. For each of N month-ends (most recent first, like `getTrend`), net worth = Σ(every account's signed balance as-of that month-end):
```sql
-- per month-end point:
SELECT SUM(<signed amount>) AS net_worth FROM transactions
WHERE date <= :monthEnd AND deleted_at IS NULL AND <kind filter>
```
- This is **exactly** what `goals.ts` computes for a `net_worth` goal, but at a historical date — so it reuses the same balance-sign convention (assets positive, liabilities negative magnitude).
- **Refunds/adjustments**: `includeAdjustments` gates whether `refund`/`adjustment` kinds are summed — consistent with the existing flag's semantics across `getOverview`/`getTrend`/`getComparison`.
- **Transfer handling**: inherited from the balance computation — a transfer counts once (no double-count), so net-worth-over-time shows "money moved between my own accounts" as flat, not a spike.
- **Performance**: N points × one cumulative query. For 24 months and a few thousand transactions this is milliseconds; the loop style matches `getTrend` so there's no surprise. A window-function single-query version is a plan-level optimization, deferred.

### `getCategoryTrend(db, tagId, months, includeAdjustments?)` → `{ month: string; spent: number }[]`

Per-month expense sum for one tag. Identical structure to `getTrend` with the `bucketJoin` fixed to the single `tagId` and only `expense` (minus refunds for that tag) summed. The "drill into one category" view.

### `getStackedCategorySeries(db, months, includeAdjustments?)` → `{ month: string; tags: { tagId: string|null; name: string; total: number }[] }[]`

Per-month expense grouped by tag, all tags. One query per month (loop) `GROUP BY tag_id`, same as `getComparison`'s per-month query but across N months. "Uncategorised" (`tag_id IS NULL`) is its own stack slice, matching `getComparison`'s `COALESCE` convention.

### `getYearOverYear(db, yearA, yearB, includeAdjustments?)` → `{ month; yearAIncome; yearAExpense; yearBIncome; yearBExpense }[]`

12 points (Jan–Dec), each comparing the two years' income + expense. Reuses `getComparison`'s two-query shape but for full years instead of single months.

### Consistency rule across all four

The `includeAdjustments` flag and the `kind IN (…)` filter are **identical strings** to the existing three functions — extracted if it reduces duplication, but not at the cost of a leaky generic query (the Approach-B trap). Refunds always reduce expense (`expense -= refund`, the `getTrend` convention), so a category's "spent" is net of refunds in every report.

## Charts — `src/lib/components/charts/`

Three new components alongside the existing `DonutChart`, all Svelte + Layercake, all **presentational only** (props in, SVG out, no DB, no store coupling):

- **`LineChart.svelte`** — net-worth-over-time + category-trend. Layercake `Svg` + `Line` + `Area` + `AxisX`/`AxisY`. Props: `data: {x:Date,y:number}[]`, `yFormat` (currency), `xFormat` (month label). Net worth gets an area fill; category trend is a line. Currency formatting reuses the existing `formatCurrency(amount, currency, locale)` so VND (0 decimals) and USD (2) render correctly on axes.
- **`StackedAreaChart.svelte`** — composition. Layercake `StackedArea` over the per-tag series. Legend lists tags with color swatches.
- **`GroupedBarChart.svelte`** — year-over-year. Layercake `GroupedBar`.

Component-testable by feeding fixed data arrays (like `DonutChart` today). Layercake provides scales/axes/tooltips; Notchy controls colors/typography to match the retro aesthetic — no black-box widget styling to fight.

## Store — `reports.svelte.ts`

Centralizes loading + the shared window selector (mirroring `accounts.svelte.ts`):

```typescript
class ReportsStore {
    window = $state<6 | 12 | 24>(12);          // shared across net-worth/category/composition
    includeAdjustments = $state(false);         // shared toggle, matches existing reports
    netWorth = $state<NetWorthPoint[]>([]);
    // … per-report arrays + loading/error
    async loadNetWorth(): Promise<void>;
    async loadCategoryTrend(tagId): Promise<void>;
    // …
}
```
- `window` and `includeAdjustments` are `$state` so changing either **re-derives and reloads** the active report's series — one control, live update.
- Category drilldown adds a `selectedTag` selector; changing it reloads `getCategoryTrend`.

## Routes — four new pages under `src/routes/reports/`

- `reports/net-worth/+page.svelte` — net worth over time + window selector + adjustments toggle.
- `reports/category/+page.svelte` — category-trend; a tag picker (drives `getCategoryTrend`).
- `reports/composition/+page.svelte` — stacked category composition.
- `reports/yoy/+page.svelte` — year-over-year; two year pickers.
- The existing `reports/+page.svelte` (overview) gains a nav card linking to each new report, matching the pattern that already links overview/trend/compare.

## Edge cases

- **Empty/new user (no transactions)** — every chart shows an empty state, not a broken axis or `NaN`. `getNetWorthSeries` returns `netWorth: 0` per month; `getCategoryTrend`/composition return zero series; YoY returns zeros. No null-deref in chart components.
- **Partial first month** — a user who started in March querying 12 months: earlier months are `0` net worth / flat spending. The chart shows the real ramp-up. Correct, not hidden.
- **Net worth goes negative** (debts exceed assets) — the y-axis must render below zero. Layercake auto-domains handle this; the area fill must not clip at zero. Test fixture: a liability-heavy scenario.
- **Archived accounts** — net worth **includes** archived accounts' transactions; only `transactions.deleted_at IS NULL` rows are excluded. Archiving is a UI concern, not a historical rewrite — "your net worth was X on that date" must still reflect the money that was real then. Matches `goals.ts` net-worth calc.
- **Currency** — Notchy is single-currency (`enforceSingleCurrency`). All sums are in one currency; `formatCurrency` renders the configured currency. No multi-currency aggregation (unlike Actual). If multi-currency is ever added, this becomes a real issue — flagged, out of scope.
- **Refund of an earlier-month transaction** — a refund booked in May for an April expense: following `getTrend`'s existing behavior (sums by `t.date` in the window), the refund lands in **May's** bucket, reducing May's expense — not retroactively fixing April. Inherited existing behavior; locked here with a test so the new reports don't drift.

## Schema impact — NONE

No migration, no schema-version bump. All four read the existing `transactions`/`accounts`/`category_tags` tables. Code-only. Like CSV import, the schema-version-call-site gotcha does not apply — the lowest-risk spec of the three.

## i18n

New `reports_*` keys in both `messages/en.json` and `messages/vi.json` (flat underscore keys, per Paraglide 1.11.8 pin): net worth, composition, year-over-year labels; axis legends; window-selector labels; empty-state messages. Distinct from the existing `settings_backup_*` / `transactions_*` families.

## Testing

Following project TDD discipline (red-green-refactor) and the "do not mock the DB / pure functions" conventions:

- **`reports.test.ts`** (extend, DB-pattern with `createTestDb` + `runMigrations`) — seed a known transaction set, assert:
  - `getNetWorthSeries` — net worth ramps correctly month to month; a transfer between own accounts is flat; a deleted transaction is excluded; archived account's txns included; negative-net-worth fixture.
  - `getCategoryTrend` — single-tag monthly sums; refund reduces the refund-month's expense.
  - `getStackedCategorySeries` — per-month per-tag; "Uncategorised" is its own slice.
  - `getYearOverYear` — two years, 12 months each, correct.
  - Empty DB → all zeros, no throws.
- **Chart component tests** — feed fixed arrays; assert axis renders below zero for negative data; empty-array → empty state, no crash.
- **E2E** — seed via the running app, navigate to each report, assert the chart renders (SVG container + axis labels present). One spec per report or one multi-step spec.

## Open questions

None at design time. Defaults pinned in the body: net-worth cumulative-sum computed from transactions (loop style, window-function optimization deferred); Layercake charts; four reports; archived-account txns included in historical net worth; refunds land in their own month. The implementation plan may revisit the loop-vs-window-function net-worth query and the YoY bar grouping (income/expense vs yearA/yearB), but should treat the above as the baseline.
