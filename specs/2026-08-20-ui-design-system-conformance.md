# UI Design-System Conformance — Design Review (Spec)

**Date:** 2026-08-20
**Status:** Approved for implementation planning

## The design system (the brief)

Notchy's identity is the **Adding Machine**: a warm near-black casing
(`--ink #14110C`, `--tape #1C1812`) with amber-phosphor figures (`--phosphor
#FFB454`, `--phosphor-bright #FFD79A`), oxblood debit (`--debit #E5484D`),
IBM Plex Mono as the display face, `.plate` uppercase micro-labels, and
segmented VFD meters. Dark is native; light is the paper variant — every token
flips via `html.light` / `html.dark` (CSS variables in `src/app.css`).

This identity is strong and already applied with discipline (contrast-tuned
`--line`, focus rings, reduced-motion handling). This spec fixes the parts of
the UI that **do not follow the system**, plus a handful of inconsistencies
and dead controls.

## Findings

### 1. Charts render in library-default colors (breaking the system)

- `src/lib/components/charts/LineChart.svelte:113,119` uses
  `var(--color-phosphor, #00ff00)` — the variable does not exist (the app's
  token is `--phosphor`), so lines and area fills fall back to **pure
  `#00ff00` green**.
- All four chart components reference `var(--color-chalk, #666)` (undefined →
  `#666`) for axis lines and tick labels.
- **Decision:** chart `<style>` blocks must reference the real tokens:
  `--phosphor` (line/area), `--line` (axis + tick lines), `--dim` (labels +
  legend text).

### 2. Chart data colors use Tailwind's default categorical palette

- Reports overview donut: `src/routes/reports/+page.svelte:13-16` hardcodes
  `#f59e0b / #8b5cf6 / #10b981 / #64748b` (Tailwind defaults).
- Composition stacked area: `src/routes/reports/composition/+page.svelte:22`
  hardcodes `['#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4',
  '#84cc16']`.
- Year-over-year grouped bars: `src/lib/components/charts/GroupedBarChart.svelte:23-28`
  hardcodes emerald/amber hexes.
- **Decision:** a shared categorical ramp derived from the design tokens
  (`--phosphor`, `--debit`, `--phosphor-bright`, `--dim`, `--line`,
  `--ledger`). New module `src/lib/utils/palette.ts` with `reportSeriesColors`
  and `seriesColor(i)`.
- **YOY special case:** income is always `--phosphor`, expense always
  `--debit` (the app-wide convention). Year is encoded as **intensity**, not
  new hues: year A full strength, year B at 55% opacity. Same two inks, two
  strengths.

### 3. SVG colors must use the `style` attribute

SVG **presentation attributes do not accept CSS `var()`**. Any chart that sets
`fill={hex}` from a data color must switch to `style="fill: {color}"` so
token references resolve and flip with the theme.

### 4. Page-title typography is inconsistent

The dashboard's page title is a `.plate` eyebrow
(`src/routes/+page.svelte:45`); every other page title is
`figures text-xl text-ledger tracking-wide` (transactions, budgets, accounts,
goals, debts, reports, settings — 16/17 routes already conform).
- **Decision:** page titles are `figures text-xl text-ledger tracking-wide`;
  section headings stay `.plate`.

### 5. Reports sub-nav is duplicated across 7 pages and can overflow

The same 7-link pill row is copy-pasted into all report pages
(`src/routes/reports/{+page,trend,compare,composition,yoy,net-worth,category}/+page.svelte`).
It is a single flex row with no wrap — overflow risk on narrow widths — and it
duplicates the overview's card grid.
- **Decision:** extract `src/lib/components/layout/ReportsNav.svelte`; give the
  container `flex-wrap`. Exact-match active state.

### 6. Dead controls in the top bar

- **Search** (`src/lib/components/layout/TopBar.svelte:15-19`) binds nothing.
  The `/` shortcut (`src/routes/+layout.svelte:82`) focuses it, and it does
  nothing.
  **Decision:** Enter navigates to `/transactions?q=<query>`; the transactions
  page initializes its search from the `q` URL param.
- **Language toggle** (`TopBar.svelte:21`) has no `onclick`; it renders "EN"
  and is inert, despite en/vi both shipping.
  **Decision:** the button toggles via `settings.setLocale()` (store already
  implements it, `src/lib/stores/settings.svelte.ts:20-25`) and shows the
  *target* locale code.

### 7. Body type falls back to system-ui

Only IBM Plex Mono is loaded (`src/routes/+layout.svelte:6-8`); body text uses
`ui-sans-serif`. IBM Plex Sans is designed to pair with Plex Mono.
- **Decision:** load `@fontsource/ibm-plex-sans` (400/500/600) and make it the
  `sans` face, so the whole app stays one machine-type family.

### 8. The donut's center is empty

The adding-machine's signature moment belongs in the dial. The donut center
hole (`src/lib/components/charts/DonutChart.svelte:42`) is a blank
`fill-tape` circle.
- **Decision:** optional `centerLabel` prop on `DonutChart`; the overview
  passes total spending as a `figures` readout.

## Non-goals

- No changes to the color tokens themselves, the `.plate` / `.figures`
  typography system, the Progress segmented meter, layout shell, or motion
  language. This pass only brings outliers into conformance.
- No new i18n strings: ReportsNav reuses existing message keys; the language
  toggle shows a plain language code.

## Acceptance criteria

- `pnpm test` green; `pnpm check` clean.
- No `#00ff00`, `#666`, or `--color-*` references remain in `src/lib/components/charts/`.
- No raw hex colors in any report page or chart component — all chart colors
  come from the token ramp or the two-ink intensity pair.
- All 17 route page titles use `figures text-xl text-ledger tracking-wide`.
- Reports sub-nav exists exactly once, wraps on narrow widths, and marks the
  active route.
- TopBar search routes to `/transactions?q=...`; the transactions page
  respects the param. The language button toggles en/vi.
- Donut shows total spending in its center.
