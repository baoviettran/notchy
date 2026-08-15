# Quality-Gate Stabilization Design

**Date:** 2026-08-15

## Goal

Restore a trustworthy green baseline before implementing Ubuntu upgrade safety. The current financial workflows remain unchanged; this work fixes report regressions, TypeScript errors, one brittle E2E assertion, and version metadata drift.

## Scope

### Async report database access

`getDb()` returns `Promise<DatabaseService>`. Every `ReportsStore` loader must await that promise before calling a report repository. Add a regression test that supplies an asynchronous database result and proves the repository receives the resolved database service.

### Chart and route typing

Use the official `@types/d3-scale` and `@types/d3-shape` packages. Add explicit chart datum types where inference across LayerCake and D3 is insufficient, correct the stacked-series row type so `month` remains a string, and preserve the existing rendered behavior. Type report window choices as `6 | 12 | 24` rather than widening them to `number`.

### E2E selector stability

The compare-report test must scope its exact `Category` assertion to the table header, so it cannot match the `Category Trend` navigation link. Playwright exposes this table's `<th>` as `cell` in the current browser harness, so the scoped locator is more reliable than a mismatched ARIA role assertion.

### Empty report series

An all-zero net-worth or year-over-year series represents no report data and must show the existing empty state rather than an empty chart. A non-zero net-worth series, including an opening balance, remains chartable. This preserves the pre-existing E2E contract now that the report loaders actually resolve their database connection.

### Version metadata

Regenerate or minimally update `src-tauri/Cargo.lock` so its local `notchy` package version matches `package.json`, `src-tauri/Cargo.toml`, and `src-tauri/tauri.conf.json` at `0.1.3`.

## Out of Scope

- Ubuntu backup, migration, recovery, packaging, and update-safety implementation
- Chart redesign or report feature changes
- Automatic updates
- Unrelated warnings or refactors, except warnings that fail an existing required command

## Implementation Approach

Use focused fixes at each root cause rather than suppressing diagnostics or refactoring the chart system. Follow test-driven development for the report-store regression and run the existing checks after each focused change.

## Acceptance Criteria

- `pnpm check` exits successfully with zero errors.
- `pnpm test` passes, including the new async database regression test.
- `pnpm test:e2e` passes all tests without the ambiguous compare-report selector failure.
- `pnpm build` succeeds.
- `cargo test` succeeds.
- All four version records agree on `0.1.3`.
- `.codegraph/` remains untouched.
