## Task 6: Extract ReportsNav component

**Status:** DONE

### Commits

- `48d177b` refactor(ui): extract ReportsNav component
- `bf31d33` refactor(ui): replace inline reports nav with ReportsNav in all 7 pages

### What was done

1. Created `src/lib/components/layout/ReportsNav.svelte` — a nav component with 7 pill links, `flex-wrap` for narrow widths, active state derived from `$page.url.pathname`.
2. Created `src/tests/unit/components/ReportsNav.test.ts` — verifies all 7 links render with correct `href` attributes.
3. Replaced the inline `<div class="flex gap-2 text-sm">` block in all 7 report pages with `<ReportsNav />`, removing ~49 lines of duplicated markup.

### Files changed

- **Created:** `src/lib/components/layout/ReportsNav.svelte`
- **Created:** `src/tests/unit/components/ReportsNav.test.ts`
- **Modified:** `src/routes/reports/+page.svelte`
- **Modified:** `src/routes/reports/trend/+page.svelte`
- **Modified:** `src/routes/reports/compare/+page.svelte`
- **Modified:** `src/routes/reports/net-worth/+page.svelte`
- **Modified:** `src/routes/reports/category/+page.svelte`
- **Modified:** `src/routes/reports/composition/+page.svelte`
- **Modified:** `src/routes/reports/yoy/+page.svelte`

### Verification

- `pnpm test` — 608 tests pass (73 test files), including the new `ReportsNav.test.ts`
- `pnpm check` — pre-existing Playwright fixture type error (`TauriMockOptions`), unrelated to this change

### Notes

- Route files under `src/routes/reports/` are gitignored (directory-level rule); `git add -f` was required for the page replacements.
- No new i18n strings were added; the component uses existing `reports_*` message keys.
- The `$page` store mock in `src/tests/unit/helpers/app-stores-mock.ts` already provides the `{ url: { pathname: '/' } }` shape needed by the component.
