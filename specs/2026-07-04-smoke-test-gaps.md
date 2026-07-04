# Notchy — Smoke Test Gaps & Follow-ups

**Source:** surfaced during the 2026-07-04 smoke-test E2E effort (branch `feat/smoke-test-e2e-coverage`).
**Status of suite at handoff:** 303 unit / 79 E2E / 0 svelte-check errors, all green.

Each item below is a genuine gap found while writing E2E coverage — not a guessed
or hypothetical issue. Bugs already fixed on this branch are not listed here;
this is the open work. Ordered by rough severity / user-visibility.

---

## Bugs (unambiguous intended behaviour, needs fix)

### 1. Quick-add account picker persistence is flaky (deeper reactivity issue)
**Where:** `src/routes/settings/+page.svelte` — the quick-add account `<Select>`.
**Symptom:** The `$effect` that persists the selection to the DB meta
(`setDefaultQuickAccount`) does not reliably flush before an SPA navigation
reads the meta back. The selection is sometimes lost across nav. Debugging
showed even an explicit `onchange` handler fires inconsistently under
Playwright, and a `console.log` inside the handler appeared on some runs and
not others — pointing at a Svelte 5 `$effect` + `<select bind:value>` +
async-DB-write interaction, not a simple race.
**Mitigation in place:** `accounts[0]` fallback means the quick-add window
still functions; the in-session bound-value update works reliably.
**Test status:** `settings-extended.spec.ts` asserts in-session behaviour
only; cross-nav assertion is documented as a KNOWN GAP in the test.
**To fix:** Reproduce in isolation (component test, not E2E). Likely needs
the persist driven synchronously from the Select change event with the
`Select` primitive forwarding `onchange` (currently it doesn't), or a
rework of the `$effect` dependency tracking.

---

## Product / design decisions (need a call, then implementation)

### 2. Budget roll-over is computed but never shown
**Where:** `src/lib/db/repos/budgets.ts` — `BudgetSummary.available` and
`.rolled_over` are fully computed (and unit-tested in `budgets.test.ts`),
but `src/routes/budgets/+page.svelte` renders only `remaining`
(allocated − spent). The roll-over feature is half-built: data layer
complete, UI layer missing.
**Checklist impact:** the §5 "roll-over … starting available balance for N+1
reflects it" item describes behaviour the UI doesn't expose.
**To fix:** Render `available` (allocated + rolled_over − spent) on each
bucket row, plus a roll-over indicator. Then upgrade the
`budgets-extended.spec.ts` "prior-month allocation persists" test to
assert `available` reflects the roll-over.

### 3. No auto-complete when a goal reaches its target
**Where:** `src/lib/db/repos/goals.ts` — `status` changes only via explicit
`update(status: 'completed'|'abandoned')`. Reaching 100% progress raises the
bar visually but does not mark the goal complete. The only user-driven
completion path is the "Mark complete" button, exposed solely in the
**overdue** panel (`goals/+page.svelte:70-76`) — so a goal fulfilled on-track
stays "active" forever unless it goes overdue.
**Design call:** auto-complete at 100%, or keep manual? If manual, surface
"Mark complete" outside the overdue panel too.

### 4. No delete affordance on goals
**Where:** `src/routes/goals/+page.svelte` — no delete button anywhere. The
store exposes `goals.delete` (`stores/goals.svelte.ts:36`) but no route calls
it. The "Delete a goal" checklist item is unreachable via the UI.
**To fix:** Add a hover-revealed Delete (with ConfirmDialog, matching the
accounts-page pattern) to each active goal card.

### 5. Locale switch does not re-render the page live
**Where:** `src/routes/settings/+page.svelte` → `settings.setLocale()` →
Paraglide `setLanguageTag()`. The bound `settings.locale` updates reactively
(the active-button class flips), but the rendered `m.*()` text does not
re-evaluate — Paraglide's message calls aren't reactive to Svelte's render
cycle. The new locale only takes effect after a full reload.
**Checklist impact:** the §9 "immediately switches locale" item is only
half-true.
**To fix (design call):** either (a) reload the page on locale switch
(simple, slightly jarring), or (b) wire Paraglide's language tag into a
reactive trigger so `m.*()` calls re-run (more work, smoother). The
`settings-extended.spec.ts` locale test asserts the active-class flip only
and documents this limitation.

### 6. Budgets: no over-allocate guard
**Where:** `src/lib/db/repos/budgets.ts` `setAllocation` sets any value
unconditionally; there's no available-income ceiling. The §5 checklist's
"over-allocate warn/block" item describes non-existent behaviour.
**Design call:** should allocations exceeding available income be blocked or
warned? (YNAB blocks; many apps don't.) If yes, decide the rule and add it;
if no, drop the checklist item.

### 7. CSV import is unwired
**Where:** `src/lib/db/repos/csvImportProfiles.ts` is a complete repo (with
unit tests in `repos/csvImportProfiles.test.ts`) but no route or component
imports it. `src/lib/backup/index.ts` exports only `exportCsv` +
`importDatabase` (SQLite). The §9 checklist notes CSV import has no UI.
**To fix (design call):** either wire a CSV-import route (bank-statement
import via profiles) for a future release, or delete the dead repo + its
tests to avoid confusion.

---

## Test-suite housekeeping

### 8. E2E flakiness under parallel workers
Running the full suite with Playwright's default parallel workers occasionally
times out 1–2 tests (budgets month-nav, settings theme buttons) that pass
cleanly when re-run serially. Root cause suspected: global store singletons
(`transactions`, `accounts`) leaking state across workers sharing the preview
server.
**To fix:** add `retries: 2` to `playwright.config.ts` for resilience, and/or
investigate whether the in-memory sql.js DB / store singletons need per-worker
isolation. Not a correctness issue with the tests themselves.

---

## Already fixed on this branch (for reference)
- Autocomplete drops typed free-text payee values → `allowFreeText` prop.
- Onboarding whitespace-only account name accepted → trim validation.
- Onboarding invalid opening balance silently ignored → surfaces error.
- `ConfirmDialog` missing `role=dialog`/`aria-modal` → a11y attributes added.
