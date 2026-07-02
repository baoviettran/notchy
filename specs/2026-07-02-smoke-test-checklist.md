# Notchy — Pre-Release Smoke Test Checklist

**Date run:** _______________
**Tester:** _______________
**App version:** v0.1.2
**Spec:** `specs/2026-07-02-smoke-test-checklist-design.md`

## How to use this checklist

1. Run `pnpm tauri dev` for sections 0–10. Run `pnpm tauri build` for section 11.
2. Work top to bottom. For each item, perform the **bold action** and confirm the _italicised expected outcome_.
3. On pass, leave the `🐛 BUG:` line blank. On failure, fill in what happened vs. what was expected.
4. **Two ways to report bugs:**
   - **Inline (batch):** fill `🐛 BUG:` as you go; say "done" in chat at the end and the assistant reads this file.
   - **Interrupt (one now):** copy the **Quick Bug Report Template** at the bottom of this file, fill it, paste into chat for an immediate fix without finishing the run.
5. Every feature section (1–9) includes cross-cutting checks: **dark mode** (default), **Vietnamese locale**, **light mode**, **empty state**, **error state**. Switch theme/locale via Settings.

---

## Section 0 — Pre-flight (≈5 min)

Automated gates must be green before manual testing begins.

- [ ] **`pnpm install` completes with no errors** — _Dependencies resolve cleanly._
  - 🐛 BUG:
- [ ] **`pnpm test` — all unit/component tests pass** — _Expected: 297/297 passing (Vitest)._
  - 🐛 BUG:
- [ ] **`pnpm check` — type check clean** — _Expected: 0 errors, 0 warnings (svelte-check)._
  - 🐛 BUG:
- [ ] **`pnpm test:e2e` — all Playwright tests pass** — _Expected: 22/22 passing._
  - 🐛 BUG:
- [ ] **`pnpm tauri dev` launches the desktop app** — _Main window opens, no errors in the dev console (open devtools), app loads on the dashboard or onboarding._
  - 🐛 BUG:

---

## Section 1 — Onboarding (≈10 min)

Fresh-start path. To reach onboarding, wipe the app data (delete the Tauri app-data DB / use a clean install) so the app has no accounts, then relaunch `pnpm tauri dev`.

- [ ] **With no existing data, the app opens on the onboarding flow** — _First screen asks to choose a language (English / Tiếng Việt)._
  - 🐛 BUG:
- [ ] **Choose English → choose a currency → create the first account (e.g. a checking account)** — _Onboarding completes and the app lands on the dashboard (`/`) with the new account visible._
  - 🐛 BUG:
- [ ] **Vietnamese path: wipe data, relaunch, choose Tiếng Việt** — _All onboarding step labels, buttons, and placeholders render in Vietnamese (no English fallback strings)._
  - 🐛 BUG:
- [ ] **Vietnamese path: complete onboarding (currency → first account)** — _Completes and lands on the dashboard with Vietnamese labels._
  - 🐛 BUG:
- [ ] **Light mode: switch theme to Light (Settings → Light), then re-run onboarding** — _Onboarding screens are readable in light mode (correct contrast, no dark-on-dark text)._
  - 🐛 BUG:
- [ ] **Empty state: fresh launch with no data** — _Onboarding is the only screen offered; no empty dashboard or broken nav is reachable before the first account is created._
  - 🐛 BUG:
- [ ] **Error state: try to advance past the currency/account step without making a selection** — _The Continue/Next button is disabled or shows a validation error; the app does not proceed with empty required fields._
  - 🐛 BUG:
- [ ] **Error state: enter an invalid account name (e.g. whitespace-only) or invalid opening balance** — _Input is rejected with a clear error message; no account is created with bad data._
  - 🐛 BUG:

## Section 2 — Dashboard (≈5 min)

Route: `/` (the app shell landing).

- [ ] **Dashboard loads with widgets visible** — _Account-balance summary, recent-transactions list, and any budget/goal status widgets render with real values from the data created in Section 1._
  - 🐛 BUG:
- [ ] **Dark mode (default): dashboard renders in the dark theme** — _Phosphor/amber accents, tape background, readable ledger text._
  - 🐛 BUG:
- [ ] **Vietnamese: switch locale to Tiếng Việt (Settings → Tiếng Việt)** — _Dashboard headings, widget labels, and navigation items render in Vietnamese._
  - 🐛 BUG:
- [ ] **Light mode: switch theme to Light** — _Dashboard is readable: good contrast, no washed-out text, charts/widgets legible._
  - 🐛 BUG:
- [ ] **Navigation: click each nav item (Transactions, Accounts, Budgets, Goals, Debts, Reports, Settings)** — _Each route loads without error and shows its own header/content._
  - 🐛 BUG:
- [ ] **Empty state: with a fresh DB (only the onboarding account, no transactions/budgets/goals/debts)** — _Dashboard shows sensible empty states (e.g. "no recent transactions") rather than blank panels or `undefined`._
  - 🐛 BUG:
- [ ] **Error state: malformed/missing data — delete the DB file while the app is running, then trigger a dashboard refetch (e.g. window focus / add a transaction)** — _App handles the missing DB gracefully (re-onboards or shows an error), does not crash to a white screen._
  - 🐛 BUG:

## Section 3 — Transactions (≈15 min)

Route: `/transactions`. Covers all 5 transaction kinds, CRUD, locale shorthand, and edge cases.

- [ ] **Add an expense: open the transaction form, choose an account + category, enter an amount and payee, save** — _Row appears in the transaction list with the correct kind, amount (formatted in the active locale), and reduced account balance._
  - 🐛 BUG:
- [ ] **Add an income (e.g. `+` prefix or kind selector = income)** — _Row appears as income; the account balance increases by that amount._
  - 🐛 BUG:
- [ ] **Add a transfer between two different accounts** — _A single transfer row is created (shared `transfer_pair_id`); source balance decreases and destination balance increases by the amount._
  - 🐛 BUG:
- [ ] **Add a refund** — _Refund row is created and linked correctly; the refunded expense/category balance reflects the refund._
  - 🐛 BUG:
- [ ] **Add an adjustment** — _Adjustment row is created; the account balance is corrected by the adjustment amount._
  - 🐛 BUG:
- [ ] **Edit an existing transaction (change amount and payee)** — _Row updates in place; the affected account balance recalculates._
  - 🐛 BUG:
- [ ] **Delete a transaction** — _Row is removed; the affected account balance recalculates._
  - 🐛 BUG:
- [ ] **Dark mode (default): transaction list and form render in the dark theme** — _Amounts, kind icons, and dates are readable._
  - 🐛 BUG:
- [ ] **Vietnamese: switch to Tiếng Việt; add a transaction using shorthand `1.5tr lương`** — _Parses to 1,500,000; payee `lương` is saved with diacritics intact; the list renders Vietnamese labels and the locale-formatted amount._
  - 🐛 BUG:
- [ ] **Vietnamese: add `50k cà phê` (expense) and `+50k lương` (income)** — _`50k` expands to 50,000; income prefix `+` is honoured; diacritics preserved._
  - 🐛 BUG:
- [ ] **Light mode: switch to Light** — _Transaction list, form, and modal are readable in light mode (correct contrast on amounts, rows, and buttons)._
  - 🐛 BUG:
- [ ] **Empty state: with no transactions (fresh data after onboarding)** — _List shows an empty-state message, not a blank table or `undefined`._
  - 🐛 BUG:
- [ ] **Error state: submit the form with a missing required field (no account or no amount)** — _Save is blocked with a clear validation error; no partial transaction is written._
  - 🐛 BUG:
- [ ] **Error state: enter a non-numeric / negative amount where not allowed** — _`parseAmount` rejects it; the form shows an error and does not save a negative expense._
  - 🐛 BUG:
- [ ] **Edge case: very large amount with suffix (e.g. `2tr`)** — _Expands to 2,000,000 and saves correctly; the formatted value does not overflow its column._
  - 🐛 BUG:
- [ ] **Edge case: transfer from an account to itself** — _Rejected or handled without creating a bogus balance change (no self-transfer double-count)._
  - 🐛 BUG:

## Section 4 — Accounts & Reconciliation (≈10 min)

Routes: `/accounts` (list) and `/accounts/[id]` (detail).

- [ ] **Accounts list loads and shows every account with its current balance** — _Each account row shows name, type, and a balance formatted in the active locale; balances match the dashboard._
  - 🐛 BUG:
- [ ] **Create an account of each of the 6 supported types (checking, savings, cash, credit card, personal loan, …)** — _Each type is selectable in the create form and saves successfully; the new account appears in the list._
  - 🐛 BUG:
- [ ] **Edit an account (rename, change opening balance)** — _Changes persist and the balance recalculates._
  - 🐛 BUG:
- [ ] **Delete an account that has no transactions** — _Account is removed from the list without error._
  - 🐛 BUG:
- [ ] **Delete an account that still has transactions** — _App either blocks deletion with a clear error or requires confirmation; no orphaned transactions are left in a broken state._
  - 🐛 BUG:
- [ ] **Open an account detail page (`/accounts/[id]`)** — _Detail shows the account's transaction history filtered to that account, plus balance and type._
  - 🐛 BUG:
- [ ] **Reconciliation: from an account detail, start a reconciliation, mark transactions cleared, and finish with an out-of-balance adjustment** — _An adjustment transaction is created to close the gap; the account balance and cleared-balance update correctly._
  - 🐛 BUG:
- [ ] **Dark mode (default): account list and detail render in the dark theme** — _Balances, type badges, and the reconciliation UI are readable._
  - 🐛 BUG:
- [ ] **Vietnamese: switch to Tiếng Việt** — _Account type names, list headers, detail labels, and reconciliation prompts render in Vietnamese._
  - 🐛 BUG:
- [ ] **Light mode: switch to Light** — _Account list, detail, and reconciliation dialog are readable with correct contrast._
  - 🐛 BUG:
- [ ] **Empty state: delete all accounts except the onboarding one (or reach a state with a single account)** — _List still renders cleanly with the remaining account; no layout breakage._
  - 🐛 BUG:
- [ ] **Error state: create an account with an invalid opening balance (non-numeric) or empty name** — _Form rejects with a validation error; no account is created with bad data._
  - 🐛 BUG:

## Section 5 — Budgets (≈10 min)

Route: `/budgets`. Monthly envelope budgets per category bucket, with month navigation and roll-over.

- [ ] **Create a monthly envelope budget for a category/bucket and allocate funds to it** — _The envelope shows the allocated amount and the spent/remaining against transactions in that category for the month._
  - 🐛 BUG:
- [ ] **Spend against a budgeted category (add an expense in that category)** — _The envelope's spent amount increases and remaining decreases in real time._
  - 🐛 BUG:
- [ ] **Navigate to the next month and the previous month** — _Budget view switches months; allocations for the new month load (or show as unset for a future month)._
  - 🐛 BUG:
- [ ] **Roll-over: overspend a category in month N, then navigate to month N+1** — _The overspent amount (or unspent surplus) rolls over into month N+1 per the v0.1.1 roll-over rules; the starting available balance for N+1 reflects it._
  - 🐛 BUG:
- [ ] **Dark mode (default): budget view renders in the dark theme** — _Envelope bars, allocated/remaining figures, and month nav are readable._
  - 🐛 BUG:
- [ ] **Vietnamese: switch to Tiếng Việt** — _Budget headers, category names, month labels, and roll-over indicators render in Vietnamese._
  - 🐛 BUG:
- [ ] **Light mode: switch to Light** — _Envelope bars and figures are readable with correct contrast._
  - 🐛 BUG:
- [ ] **Empty state: a month with no budgets allocated** — _Shows an empty-state prompt to create a budget, not a blank page or `undefined`._
  - 🐛 BUG:
- [ ] **Error state: allocate a negative or non-numeric amount to an envelope** — _Input is rejected with a validation error; no negative allocation is saved._
  - 🐛 BUG:
- [ ] **Edge case: over-allocate the total available income across envelopes** — _App warns or blocks when allocations exceed available funds (per the budget model)._
  - 🐛 BUG:

## Section 6 — Goals (≈10 min)

Route: `/goals`. Goals with target, progress, lifecycle, and velocity tracking.

- [ ] **Create a goal (name, target amount, target date)** — _Goal appears in the list with 0% progress and a velocity indicator._
  - 🐛 BUG:
- [ ] **Contribute to a goal (add funds toward it)** — _Progress percentage and saved amount increase; the goal moves toward its target._
  - 🐛 BUG:
- [ ] **Velocity tracking: the goal shows a savings-velocity figure based on contribution history** — _Velocity updates as contributions are added across the timeline._
  - 🐛 BUG:
- [ ] **Lifecycle: complete a goal (reach the target amount)** — _Goal is marked complete/done; the UI reflects the finished state._
  - 🐛 BUG:
- [ ] **Edit a goal (change target amount or date)** — _Changes persist; progress/velocity recalculate._
  - 🐛 BUG:
- [ ] **Delete a goal** — _Goal is removed without error._
  - 🐛 BUG:
- [ ] **Dark mode (default): goals view renders in the dark theme** — _Progress bars, velocity, and dates are readable._
  - 🐛 BUG:
- [ ] **Vietnamese: switch to Tiếng Việt** — _Goal labels, progress text, and lifecycle states render in Vietnamese._
  - 🐛 BUG:
- [ ] **Light mode: switch to Light** — _Progress bars and figures are readable with correct contrast._
  - 🐛 BUG:
- [ ] **Empty state: no goals created** — _Shows an empty-state prompt to create a goal._
  - 🐛 BUG:
- [ ] **Error state: create a goal with an invalid target (negative/non-numeric) or past target date** — _Form rejects with a validation error; no bad goal is saved._
  - 🐛 BUG:

## Section 7 — Debts (≈10 min)

Route: `/debts`. Personal debts split into "I owe" and "Owed to me", each with a counterparty.

- [ ] **Create a debt under "I owe" with a counterparty, amount, and date** — _Debt appears in the "I owe" list with the counterparty name and outstanding balance._
  - 🐛 BUG:
- [ ] **Create a debt under "Owed to me" with a counterparty** — _Debt appears in the "Owed to me" list._
  - 🐛 BUG:
- [ ] **Record a payment against a debt** — _Outstanding balance decreases; the debt moves toward settled._
  - 🐛 BUG:
- [ ] **Mark a debt as fully settled (pay off the balance)** — _Debt is marked settled/closed; the UI reflects the finished state._
  - 🐛 BUG:
- [ ] **Edit a debt (amount, counterparty)** — _Changes persist; balance recalculates._
  - 🐛 BUG:
- [ ] **Delete a debt** — _Debt is removed without error._
  - 🐛 BUG:
- [ ] **Dark mode (default): debts view renders in the dark theme** — _The two sections (I owe / Owed to me), counterparty names, and balances are readable._
  - 🐛 BUG:
- [ ] **Vietnamese: switch to Tiếng Việt** — _Section headers, counterparty labels, and status terms render in Vietnamese._
  - 🐛 BUG:
- [ ] **Light mode: switch to Light** — _Debt lists are readable with correct contrast._
  - 🐛 BUG:
- [ ] **Empty state: no debts recorded** — _Both sections show empty-state prompts._
  - 🐛 BUG:
- [ ] **Error state: create a debt with an invalid amount or empty counterparty** — _Form rejects with a validation error; no bad debt is saved._
  - 🐛 BUG:

## Section 8 — Reports (≈10 min)

Routes: `/reports` (overview), `/reports/trend` (trend), `/reports/compare` (compare).

- [ ] **Overview report (`/reports`) loads with charts/summaries** — _Income, expense, and net figures render for the current period; charts display using the data from earlier sections._
  - 🐛 BUG:
- [ ] **Trend report (`/reports/trend`) loads** — _The trend chart shows changes over time (monthly buckets); axis labels and values are legible._
  - 🐛 BUG:
- [ ] **Compare report (`/reports/compare`) loads** — _The comparison view shows two periods/categories side by side with deltas._
  - 🐛 BUG:
- [ ] **Change the report date range / period selector on each report** — _Charts and figures update to reflect the selected range; no stale data remains._
  - 🐛 BUG:
- [ ] **Dark mode (default): all three reports render in the dark theme** — _Chart series, legends, and figures are readable on the tape background._
  - 🐛 BUG:
- [ ] **Vietnamese: switch to Tiếng Việt** — _Report titles, axis labels, legends, and period selectors render in Vietnamese._
  - 🐛 BUG:
- [ ] **Light mode: switch to Light** — _Charts are legible in light mode (series colours distinguishable, no low-contrast lines)._
  - 🐛 BUG:
- [ ] **Empty state: a report range with no transactions** — _Reports show an empty-state message or a zeroed chart, not a broken/blank render or `undefined`._
  - 🐛 BUG:
- [ ] **Error state: select an invalid range (e.g. end date before start date, if supported)** — _App blocks or handles gracefully; no crash or malformed chart._
  - 🐛 BUG:
- [ ] **Edge case: a range with a single transaction** — _Reports render correctly without division-by-zero or empty-axis artifacts._
  - 🐛 BUG:

## Results Summary

Fill in after completing all sections.

- Sections passed: ___ / 12
- Total check items: ___
- Items passed: ___
- Items failed: ___
- Total bugs logged: ___

---

## Quick Bug Report Template

(Appended in the final task.)
