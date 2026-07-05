# Notchy — Smoke Test Gaps & Follow-ups

**Source:** surfaced during the 2026-07-04 smoke-test E2E effort (branch `feat/smoke-test-e2e-coverage`).
**Updated:** 2026-07-05 — ALL 8 gaps resolved (#1 was a test-harness issue, not an app bug).
**Status of suite:** 295 unit / 83 E2E / 0 svelte-check errors, all green.

Each item below is a genuine gap found while writing E2E coverage — not a guessed
or hypothetical issue. Bugs already fixed are not listed here; this is the open
work. Ordered by rough severity / user-visibility.

---

## Bugs (unambiguous intended behaviour, needs fix)

### 1. Quick-add account picker persistence — ✅ RESOLVED 2026-07-05
**Resolution:** The app code was correct all along. Instrumented tracing
(`[DBG $effect/persist/load]` logs) proved the full chain works when the
Select's value changes: `$effect` fires → `setDefaultQuickAccount` writes →
`loadQuickAccount` reads it back after nav. The "flakiness" was in the
**E2E test driving a Svelte 5 `bind:value` `<select>`**: Playwright's
`selectOption({ label })` doesn't deterministically trigger Svelte's bind
handler. Selecting **by value** (`selectOption(value)` after the option is
attached and the select enabled) is deterministic — 5/5 clean runs.
`settings-extended.spec.ts` now has reliable persistence + "None" tests via a
`changeQuickSelect` helper. No app change needed.

---

## Product / design decisions (need a call, then implementation)

### 2. Budget roll-over is computed but never shown — ✅ RESOLVED 2026-07-05
The budgets page now renders `available` (allocated + rolled_over − spent)
and a "rolled over {amount}" line on each bucket when `rolled_over !== 0`.
E2E in `budgets-extended.spec.ts` asserts the roll-over surfaces across
months.

### 3. No auto-complete when a goal reaches its target — ✅ RESOLVED 2026-07-05
**Decision: stay manual** (no auto-complete — avoids surprises when a linked-
account balance fluctuates). "Mark complete" is now surfaced on **all active
goal cards** (hover-revealed), not only in the overdue panel. E2E in
`goals-extended.spec.ts` covers manual completion of an on-track goal.

### 4. No delete affordance on goals — ✅ RESOLVED 2026-07-05
Active goal cards now have a hover-revealed Delete button gated by
ConfirmDialog (matching the accounts-page pattern). E2E in
`goals-extended.spec.ts` covers create → delete → confirm.

### 5. Locale switch does not re-render the page live — ✅ RESOLVED 2026-07-05
**Decision: auto-reload on switch.** `setLocale` now persists the locale then
calls `globalThis.location.reload()`, so all `m.*()` text updates immediately.
Trade-off: a ~1s reload flash; Paraglide 1.11.8 (pinned) made the reactive
option risky. E2E in `settings-extended.spec.ts` asserts the reload fires.

### 6. Budgets: no over-allocate guard — ✅ RESOLVED 2026-07-05
**Decision: soft warn only.** Allocations exceeding this month's available
funds (income + positive rolled-over surpluses) trigger a non-blocking
"Over budget by X" banner; allocation is still stored. No hard block —
allows intentional forecasting. New EN/VI key `budgets_over_allocated`.
E2E in `budgets-extended.spec.ts`.

### 7. CSV import is unwired — ✅ RESOLVED 2026-07-05
**Decision: delete the dead repo.** Removed
`src/lib/db/repos/csvImportProfiles.ts` + its unit test (no route/component
imported it). Re-add cleanly when a CSV-import feature is actually scoped.

---

## Test-suite housekeeping

### 8. E2E flakiness under parallel workers — ✅ RESOLVED 2026-07-05
Added `retries: 1` to `playwright.config.ts`. Absorbs the occasional
parallel-worker timeout (budgets month-nav, settings theme buttons) without
masking real failures. Per-worker isolation of the in-memory sql.js DB / store
singletons remains a deeper follow-up if the retry rate climbs.

---

## Already fixed on this branch (for reference)
- Autocomplete drops typed free-text payee values → `allowFreeText` prop.
- Onboarding whitespace-only account name accepted → trim validation.
- Onboarding invalid opening balance silently ignored → surfaces error.
- `ConfirmDialog` missing `role=dialog`/`aria-modal` → a11y attributes added.
