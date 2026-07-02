# Smoke Test Checklist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Author a single comprehensive manual deep-regression smoke-test checklist markdown file (`specs/2026-07-02-smoke-test-checklist.md`) that a human tester runs against `pnpm tauri dev` / `pnpm tauri build` before release, with an inline bug-report workflow.

**Architecture:** This is a documentation/test artifact, not application code. The deliverable is one markdown file authored section-by-section following the structure in `specs/2026-07-02-smoke-test-checklist-design.md`. Each task appends one or more checklist sections to the file, then commits. There is no TDD red-green cycle (the spec states "no automated tests — it is the test artifact"); verification is a structural completeness check against the spec at the end of each task and a full self-check in the final task.

**Tech Stack:** Markdown only. No code, no dependencies.

## Global Constraints

(Copied from the design spec `specs/2026-07-02-smoke-test-checklist-design.md` and `CLAUDE.md`.)

- **Output file:** `specs/2026-07-02-smoke-test-checklist.md` (repo root `specs/`, NOT `docs/superpowers/` — `docs/` is a git submodule invisible to main-repo commits).
- **Item format — every check uses this exact template, no exceptions:**
  ```markdown
  - [ ] **Action description** — _Expected outcome_
    - 🐛 BUG:
  ```
  The `🐛 BUG:` line stays blank on pass; on failure the tester fills in observed-vs-expected.
- **Cross-cutting checks in every feature section (1–9):** dark mode (default), Vietnamese locale (switch via Settings), light mode, empty state, error state. Sections 10 (Tauri Desktop) and 11 (Release Build) are OS/desktop-specific and do NOT carry mode/locale sub-checks (already covered in 1–9).
- **Section order is fixed (0–11); do not reorder or renumber.**
- **Scope:** all v0.1 features (ROADMAP.md § "v0.1.0 Delivered") + v0.1.2 tray quick-capture. OUT: automated test additions, v0.2 web-build checks, perf benchmarking, WCAG audit, cross-platform matrix.
- **Commit prefix:** `docs:` (per CLAUDE.md — this is a documentation artifact).
- **Current automated-test gates (for Section 0 Pre-flight):** Vitest unit/component 297/297, `pnpm check` 0 errors/0 warnings, Playwright E2E 22/22. Re-run to confirm current counts before recording them in the checklist.

---

## File Structure

A single file, `specs/2026-07-02-smoke-test-checklist.md`, built top-to-bottom in this order:

1. **Header** — title, date, tester-name field, how-to-use instructions.
2. **Section 0: Pre-flight** — automated test + build gates.
3. **Sections 1–9** — feature walkthroughs, each with cross-cutting checks.
4. **Section 10: Tauri Desktop Smoke** — tray/shortcut/quick-add/cross-window.
5. **Section 11: Release Build** — binary compile + launch + version + no dev artifacts.
### Task 1: Scaffold file, header, Section 0 (Pre-flight), and Results Summary skeleton

**Files:**
- Create: `specs/2026-07-02-smoke-test-checklist.md`

**Interfaces:**
- Consumes: design spec `specs/2026-07-02-smoke-test-checklist-design.md` (section table, item format, file-location decision).
- Produces: the output file with its header and Section 0. Later tasks append below Section 0 in section order.

- [ ] **Step 1: Confirm current automated-test counts**

Run each gate and note the actual passing counts (the spec cites 297 unit / 22 E2E; confirm they still match before baking them into the checklist):

```bash
pnpm test 2>&1 | tail -5
pnpm check 2>&1 | tail -5
pnpm test:e2e 2>&1 | tail -5
```

Expected: unit tests all passing (note the exact count), `svelte-check` 0 errors / 0 warnings, E2E all passing (note the exact count). Record the two counts for use in Step 2.

- [ ] **Step 2: Create the file with header, Section 0, and Results Summary skeleton**

Create `specs/2026-07-02-smoke-test-checklist.md` with exactly this content (replace `UNIT_COUNT` and `E2E_COUNT` with the numbers from Step 1):

```markdown
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
- [ ] **`pnpm test` — all unit/component tests pass** — _Expected: UNIT_COUNT/UNIT_COUNT passing (Vitest)._
  - 🐛 BUG:
- [ ] **`pnpm check` — type check clean** — _Expected: 0 errors, 0 warnings (svelte-check)._
  - 🐛 BUG:
- [ ] **`pnpm test:e2e` — all Playwright tests pass** — _Expected: E2E_COUNT/E2E_COUNT passing._
  - 🐛 BUG:
- [ ] **`pnpm tauri dev` launches the desktop app** — _Main window opens, no errors in the dev console (open devtools), app loads on the dashboard or onboarding._
  - 🐛 BUG:

---

<!-- Feature sections 1–11 are appended below by subsequent tasks. -->

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
```

- [ ] **Step 3: Verify the file structure**

Run:
```bash
grep -c "🐛 BUG:" specs/2026-07-02-smoke-test-checklist.md
```
Expected: `5` (five check items in Section 0). Also confirm the file starts with `# Notchy — Pre-Release Smoke Test Checklist`.

- [ ] **Step 4: Commit**

```bash
git add specs/2026-07-02-smoke-test-checklist.md
git commit -m "docs: scaffold smoke test checklist + Section 0 pre-flight"
```

---

6. **Results Summary** — fill-in pass/fail counts + total bug count.
7. **Quick Bug Report Template** — paste-into-chat template for a single urgent bug.

Each task below appends its section(s) to the file and commits. The file is the only artifact; no source code changes.

---
### Task 2: Sections 1 (Onboarding) and 2 (Dashboard)

**Files:**
- Modify: `specs/2026-07-02-smoke-test-checklist.md` (insert two sections immediately above the `## Results Summary` line; also delete the `<!-- Feature sections 1–11 are appended below by subsequent tasks. -->` comment line).

**Interfaces:**
- Consumes: route `/onboarding` (language → currency → first account), route `/` (dashboard). Settings theme toggle (auto/light/dark) and locale toggle (en/vi).
- Produces: Sections 1 and 2 in the checklist. The anchor `## Results Summary` remains the insertion point for later tasks.

- [ ] **Step 1: Insert Section 1 (Onboarding) and Section 2 (Dashboard) above `## Results Summary`**

Delete the placeholder comment line `<!-- Feature sections 1–11 are appended below by subsequent tasks. -->`, then insert this block immediately above `## Results Summary`:

```markdown
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

```

- [ ] **Step 2: Verify**

```bash
grep -c "🐛 BUG:" specs/2026-07-02-smoke-test-checklist.md
```
Expected: `5 + 8 + 7 = 20` (Section 0: 5, Section 1: 8, Section 2: 7). Confirm `## Section 1` and `## Section 2` headings appear above `## Results Summary`.

- [ ] **Step 3: Commit**

```bash
git add specs/2026-07-02-smoke-test-checklist.md
git commit -m "docs: smoke checklist sections 1 (onboarding) + 2 (dashboard)"
```

---

### Task 3: Section 3 (Transactions)

**Files:**
- Modify: `specs/2026-07-02-smoke-test-checklist.md` (insert Section 3 immediately above `## Results Summary`).

**Interfaces:**
- Consumes: route `/transactions`. Transaction kinds: expense, income, transfer, refund, adjustment (single-row model; transfers share a `transfer_pair_id`). Locale-aware `parseAmount` expands `k`/`m`/`tr` suffixes; Vietnamese diacritics survive in payees.
- Produces: Section 3 in the checklist. Anchor `## Results Summary` unchanged.

- [ ] **Step 1: Insert Section 3 above `## Results Summary`**

Insert this block immediately above `## Results Summary`:

```markdown
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

```

- [ ] **Step 2: Verify**

```bash
grep -c "🐛 BUG:" specs/2026-07-02-smoke-test-checklist.md
```
Expected: `20 + 16 = 36`. Confirm `## Section 3` appears above `## Results Summary` and below `## Section 2`.

- [ ] **Step 3: Commit**

```bash
git add specs/2026-07-02-smoke-test-checklist.md
git commit -m "docs: smoke checklist section 3 (transactions)"
```

---

### Task 4: Section 4 (Accounts & Reconciliation)

**Files:**
- Modify: `specs/2026-07-02-smoke-test-checklist.md` (insert Section 4 immediately above `## Results Summary`).

**Interfaces:**
- Consumes: routes `/accounts` (list) and `/accounts/[id]` (detail). 6 account types: checking, savings, cash, credit card, personal loans (and one more per ROADMAP — verify the type list in the create form). Reconciliation creates an adjustment transaction.
- Produces: Section 4 in the checklist. Anchor `## Results Summary` unchanged.

- [ ] **Step 1: Insert Section 4 above `## Results Summary`**

Insert this block immediately above `## Results Summary`:

```markdown
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

```

- [ ] **Step 2: Verify**

```bash
grep -c "🐛 BUG:" specs/2026-07-02-smoke-test-checklist.md
```
Expected: `36 + 12 = 48`. Confirm `## Section 4` appears above `## Results Summary` and below `## Section 3`.

- [ ] **Step 3: Commit**

```bash
git add specs/2026-07-02-smoke-test-checklist.md
git commit -m "docs: smoke checklist section 4 (accounts & reconciliation)"
```

---

### Task 5: Section 5 (Budgets)

**Files:**
- Modify: `specs/2026-07-02-smoke-test-checklist.md` (insert Section 5 immediately above `## Results Summary`).

**Interfaces:**
- Consumes: route `/budgets`. Monthly envelope budgets per bucket; envelope allocation; month navigation; roll-over (v0.1.1 feature).
- Produces: Section 5 in the checklist. Anchor `## Results Summary` unchanged.

- [ ] **Step 1: Insert Section 5 above `## Results Summary`**

Insert this block immediately above `## Results Summary`:

```markdown
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

```

- [ ] **Step 2: Verify**

```bash
grep -c "🐛 BUG:" specs/2026-07-02-smoke-test-checklist.md
```
Expected: `48 + 10 = 58`. Confirm `## Section 5` appears above `## Results Summary` and below `## Section 4`.

- [ ] **Step 3: Commit**

```bash
git add specs/2026-07-02-smoke-test-checklist.md
git commit -m "docs: smoke checklist section 5 (budgets)"
```

---

### Task 6: Sections 6 (Goals) and 7 (Debts)

**Files:**
- Modify: `specs/2026-07-02-smoke-test-checklist.md` (insert Sections 6 and 7, in that order, immediately above `## Results Summary`).

**Interfaces:**
- Consumes: route `/goals` (goals with velocity tracking; create/progress/lifecycle). Route `/debts` (personal debts: I owe / owed to me; counterparty field).
- Produces: Sections 6 and 7 in the checklist. Anchor `## Results Summary` unchanged.

- [ ] **Step 1: Insert Section 6 (Goals) above `## Results Summary`**

Insert this block immediately above `## Results Summary`:

```markdown
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

```

- [ ] **Step 2: Insert Section 7 (Debts) above `## Results Summary`**

Insert this block immediately above `## Results Summary` (it lands below Section 6):

```markdown
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

```

- [ ] **Step 3: Verify**

```bash
grep -c "🐛 BUG:" specs/2026-07-02-smoke-test-checklist.md
```
Expected: `58 + 11 + 11 = 80`. Confirm `## Section 6` and `## Section 7` appear, in order, above `## Results Summary`.

- [ ] **Step 4: Commit**

```bash
git add specs/2026-07-02-smoke-test-checklist.md
git commit -m "docs: smoke checklist sections 6 (goals) + 7 (debts)"
```

---

### Task 7: Section 8 (Reports)

**Files:**
- Modify: `specs/2026-07-02-smoke-test-checklist.md` (insert Section 8 immediately above `## Results Summary`).

**Interfaces:**
- Consumes: routes `/reports` (overview), `/reports/trend` (trend), `/reports/compare` (compare). Three reports total.
- Produces: Section 8 in the checklist. Anchor `## Results Summary` unchanged.

- [ ] **Step 1: Insert Section 8 above `## Results Summary`**

Insert this block immediately above `## Results Summary`:

```markdown
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

```

- [ ] **Step 2: Verify**

```bash
grep -c "🐛 BUG:" specs/2026-07-02-smoke-test-checklist.md
```
Expected: `80 + 10 = 90`. Confirm `## Section 8` appears above `## Results Summary` and below `## Section 7`.

- [ ] **Step 3: Commit**

```bash
git add specs/2026-07-02-smoke-test-checklist.md
git commit -m "docs: smoke checklist section 8 (reports)"
```

---

### Task 8: Section 9 (Settings)

**Files:**
- Modify: `specs/2026-07-02-smoke-test-checklist.md` (insert Section 9 immediately above `## Results Summary`).

**Interfaces:**
- Consumes: routes `/settings` (theme auto/light/dark, language en/vi, quick-add account picker incl. "None", version), `/settings/categories` (category CRUD), `/settings/backup` (CSV export, SQLite export/import, auto-backup). Keyboard shortcuts defined app-wide.
- Produces: Section 9 in the checklist. Anchor `## Results Summary` unchanged.

- [ ] **Step 1: Insert Section 9 above `## Results Summary`**

Insert this block immediately above `## Results Summary`:

```markdown
## Section 9 — Settings (≈15 min)

Routes: `/settings`, `/settings/categories`, `/settings/backup`.

- [ ] **Settings page loads showing: Categories link, Backup link, Theme (auto/light/dark), Language (English/Tiếng Việt), Quick-add account picker, and a version line** — _All sections render; version shows `v0.1.2`._
  - 🐛 BUG:
- [ ] **Theme → Auto: select Auto** — _Theme follows the OS preference (verify against your OS light/dark setting)._
  - 🐛 BUG:
- [ ] **Theme → Light / Dark: select each** — _App immediately switches theme and persists the choice across a window reload._
  - 🐛 BUG:
- [ ] **Language → Tiếng Việt / English: select each** — _App immediately switches locale and persists the choice across a window reload._
  - 🐛 BUG:
- [ ] **Categories (`/settings/categories`): create, rename, and delete a category** — _Changes persist and are reflected in the transaction form's category list._
  - 🐛 BUG:
- [ ] **Backup → CSV export (`/settings/backup`): export transactions/accounts to CSV** — _A CSV file is written to the chosen path; opening it shows the expected rows and locale-formatted amounts._
  - 🐛 BUG:
- [ ] **Backup → SQLite export: export the database file** — _A `.sqlite`/DB file is written to the chosen path._
  - 🐛 BUG:
- [ ] **Backup → SQLite import: import the file just exported** — _Round-trip succeeds; data is restored with no loss or schema-version error._
  - 🐛 BUG:
- [ ] **Backup → Auto-backup: confirm auto-backup is configured/triggered per the app's schedule** — _A backup is produced automatically (verify the backup location or indicator)._
  - 🐛 BUG:
- [ ] **Quick-add account picker: select an account and reload the window** — _The chosen account persists as the default quick-add account._
  - 🐛 BUG:
- [ ] **Quick-add account picker: select "None"** — _The meta key is cleared (the `accounts[0]` fallback takes effect); the picker persists "None" across a reload._
  - 🐛 BUG:
- [ ] **Keyboard shortcuts: trigger the documented shortcuts (e.g. new transaction, navigation)** — _Each shortcut performs its documented action._
  - 🐛 BUG:
- [ ] **Dark mode (default): all settings pages render in the dark theme** — _Forms, pickers, and links are readable._
  - 🐛 BUG:
- [ ] **Vietnamese: with locale = Tiếng Việt, view all settings pages** — _Every label, description, and button renders in Vietnamese (no English fallback)._
  - 🐛 BUG:
- [ ] **Light mode: switch to Light and view all settings pages** — _All pages are readable with correct contrast._
  - 🐛 BUG:
- [ ] **Error state: import a corrupted / wrong-schema SQLite file** — _Import is rejected with a clear error; the existing DB is left intact._
  - 🐛 BUG:
- [ ] **Error state: cancel the file dialog mid-export/import** — _App returns to the backup page without error or partial write._
  - 🐛 BUG:

```

- [ ] **Step 2: Verify**

```bash
grep -c "🐛 BUG:" specs/2026-07-02-smoke-test-checklist.md
```
Expected: `90 + 17 = 107`. Confirm `## Section 9` appears above `## Results Summary` and below `## Section 8`.

- [ ] **Step 3: Commit**

```bash
git add specs/2026-07-02-smoke-test-checklist.md
git commit -m "docs: smoke checklist section 9 (settings)"
```

---

### Task 9: Sections 10 (Tauri Desktop Smoke) and 11 (Release Build)

**Files:**
- Modify: `specs/2026-07-02-smoke-test-checklist.md` (insert Sections 10 and 11, in that order, immediately above `## Results Summary`).

**Interfaces:**
- Consumes: Tauri desktop host (`src-tauri/src/lib.rs`) — tray icon, global shortcut `CmdOrCtrl+Shift+N`, the `/quick-add` webview, and the `transaction:saved` cross-window event. Release binary from `pnpm tauri build`.
- Produces: Sections 10 and 11 in the checklist. These are OS/desktop-specific and do NOT carry the mode/locale sub-checks (covered in 1–9). Anchor `## Results Summary` unchanged.

- [ ] **Step 1: Insert Section 10 (Tauri Desktop Smoke) above `## Results Summary`**

Insert this block immediately above `## Results Summary`. (These items are taken from the v0.1.2 manual-smoke note `specs/notes/2026-07-01-v0.1.2.md` — keep them aligned with that note.)

```markdown
## Section 10 — Tauri Desktop Smoke (≈10 min)

OS-level desktop features that Playwright cannot exercise. Run `pnpm tauri dev`. No mode/locale sub-checks here (covered in sections 1–9).

- [ ] **A tray icon is present in the OS tray** — _Icon appears in the system tray area._
  - 🐛 BUG:
- [ ] **Left-click the tray icon** — _The quick-add window appears (360×200, decoration-less "tape" style)._
  - 🐛 BUG:
- [ ] **Tray menu → Quick Add** — _Opens the quick-add window._
  - 🐛 BUG:
- [ ] **Tray menu → Show Notchy** — _Focuses/shows the main window._
  - 🐛 BUG:
- [ ] **Tray menu → Quit** — _The app exits cleanly._
  - 🐛 BUG:
- [ ] **Global shortcut `Cmd/Ctrl+Shift+N`** — _Opens the quick-add window. If the OS rejects the combo (another app owns it), the app logs and continues without crashing._
  - 🐛 BUG:
- [ ] **In the quick-add window, type `50k coffee` and press Enter** — _Window hides; the transaction is saved; on focusing the main window the new expense row appears in `/transactions`._
  - 🐛 BUG:
- [ ] **Vietnamese quick-add: type `1.5tr lương` and press Enter** — _Saves 1,500,000 with payee `lương` (diacritics intact); the row appears in the main transaction list._
  - 🐛 BUG:
- [ ] **Income quick-add: type `+50k salary` and press Enter** — _Saves as income (kind = income); the row appears and the account balance increases._
  - 🐛 BUG:
- [ ] **Cross-window refresh: after a quick-add save, focus the main window** — _The main transaction list has refreshed to show the new row without a manual reload (the `transaction:saved` event refetched the list)._
  - 🐛 BUG:
- [ ] **Press Escape in the quick-add window** — _The quick-add window dismisses/hides without saving._
  - 🐛 BUG:
- [ ] **Quick-add only supports expense and income** — _Attempting a transfer/refund shorthand does not produce those kinds (they require the full form) — confirm the quick-add does not crash or mis-categorise._
  - 🐛 BUG:

```

- [ ] **Step 2: Insert Section 11 (Release Build) above `## Results Summary`**

Insert this block immediately above `## Results Summary` (it lands below Section 10):

```markdown
## Section 11 — Release Build (≈5 min)

Run `pnpm tauri build`, then launch the produced binary. No mode/locale sub-checks here.

- [ ] **`pnpm tauri build` completes without errors** — _A release binary is produced in the Tauri output directory._
  - 🐛 BUG:
- [ ] **Launch the release binary** — _The app opens to the dashboard/onboarding without crashing._
  - 🐛 BUG:
- [ ] **About/Settings version string** — _Displays `v0.1.2` (no leftover `v0.1.0`)._
  - 🐛 BUG:
- [ ] **No dev artifacts visible in the release binary** — _No devtools auto-open, no source maps exposed in the UI, no dev-only console logs/errors shown to the user, no "development build" banner._
  - 🐛 BUG:
- [ ] **Core round-trip in the release binary: add an account, add a transaction, view it on the dashboard, export a backup** — _The release binary performs the core flow end-to-end with no errors._
  - 🐛 BUG:

```

- [ ] **Step 3: Verify**

```bash
grep -c "🐛 BUG:" specs/2026-07-02-smoke-test-checklist.md
```
Expected: `107 + 12 + 5 = 124`. Confirm `## Section 10` and `## Section 11` appear, in order, above `## Results Summary`.

- [ ] **Step 4: Commit**

```bash
git add specs/2026-07-02-smoke-test-checklist.md
git commit -m "docs: smoke checklist sections 10 (tauri desktop) + 11 (release build)"
```

---

### Task 10: Fill Quick Bug Report Template and run the full self-check

**Files:**
- Modify: `specs/2026-07-02-smoke-test-checklist.md` (replace the `(Appended in the final task.)` placeholder under `## Quick Bug Report Template` with the real template; optionally add an "After the run" note).

**Interfaces:**
- Consumes: design spec § "Bug Report Workflow" and § "Quick Bug Report Template" for the exact template fields.
- Produces: the complete, finished checklist file. No more placeholders.

- [ ] **Step 1: Replace the Quick Bug Report Template placeholder**

In `specs/2026-07-02-smoke-test-checklist.md`, find the line under `## Quick Bug Report Template` that reads `(Appended in the final task.)` and replace it with this block:

```markdown
Copy this block, fill it in, and paste it into chat to report a single urgent bug mid-run (without finishing the whole checklist).

**Section:** [section number and name]
**Check item:** [the failing check]
**What happened:** [observed behavior]
**What was expected:** [expected behavior per the check]
**Screenshot (if helpful):** [paste or describe]

### After the run

When you have finished (or want a batch fix), say "done" or "ready for review" in chat. The assistant reads this file, processes every filled `🐛 BUG:` entry, and works through fixes one at a time.
```

- [ ] **Step 2: Confirm no placeholders remain in the checklist file**

Run:
```bash
grep -nE "TBD|TODO|Appended in the final task|fill in|<.+>" specs/2026-07-02-smoke-test-checklist.md || echo "no placeholders"
```
Expected: `no placeholders` (the `___` fill-in blanks in the header/Results Summary are intentional, not placeholders — they are not matched by the pattern above).

- [ ] **Step 3: Confirm the full item count and section order**

Run:
```bash
grep -c "🐛 BUG:" specs/2026-07-02-smoke-test-checklist.md
grep -nE "^## (Section [0-9]+|Results Summary|Quick Bug Report Template)" specs/2026-07-02-smoke-test-checklist.md
```
Expected for the count: `124` check items total.
Expected section headings, in this exact order:
- `## Section 0 — Pre-flight`
- `## Section 1 — Onboarding`
- `## Section 2 — Dashboard`
- `## Section 3 — Transactions`
- `## Section 4 — Accounts & Reconciliation`
- `## Section 5 — Budgets`
- `## Section 6 — Goals`
- `## Section 7 — Debts`
- `## Section 8 — Reports`
- `## Section 9 — Settings`
- `## Section 10 — Tauri Desktop Smoke`
- `## Section 11 — Release Build`
- `## Results Summary`
- `## Quick Bug Report Template`

- [ ] **Step 4: Cross-check against the design spec's section table**

Open `specs/2026-07-02-smoke-test-checklist-design.md` and confirm each row of the "Section order" table (0–11) is present in the checklist with the matching name. Confirm the time estimates in the checklist match the spec table. If any mismatch, fix it inline.

- [ ] **Step 5: Confirm cross-cutting coverage**

Every feature section 1–9 must contain checks for: dark mode (default), Vietnamese locale, light mode, empty state, error state. Skim each of sections 1–9 and confirm all five appear. (Sections 10 and 11 intentionally omit them.) Fix any gap inline.

- [ ] **Step 6: Commit**

```bash
git add specs/2026-07-02-smoke-test-checklist.md
git commit -m "docs: smoke checklist quick bug report template + finalize"
```

---

## Self-Review

(Completed by the plan author. Issues found were fixed inline before committing.)

**1. Spec coverage** — Every section of `specs/2026-07-02-smoke-test-checklist-design.md` maps to a task:
- "Checklist Structure" section table (0–11) → Tasks 1–9 (0: Task 1; 1–2: Task 2; 3: Task 3; 4: Task 4; 5: Task 5; 6–7: Task 6; 8: Task 7; 9: Task 8; 10–11: Task 9). ✓
- "Item format" template → Global Constraints + every task uses it verbatim. ✓
- "Cross-cutting checks per section" → Global Constraints + Task 10 Step 5 verifies all five appear in sections 1–9. ✓
- "File Format" (Header, Section 0, 1–11, Results Summary, Quick Bug Report Template) → Task 1 scaffolds header/Section 0/Results Summary/template stub; Tasks 2–9 add 1–11; Task 10 fills the template. ✓
- "Bug Report Workflow" (inline + template + after-run) → inline `🐛 BUG:` in every item; Task 10 adds the template + after-run note. ✓
- "What's explicitly OUT" → Global Constraints. ✓
- "Testing" (no automated tests) → plan Architecture states no TDD cycle. ✓
- Decision #2 (location `specs/`) → Global Constraints. ✓

No gaps.

**2. Placeholder scan** — No "TBD/TODO/implement later/add appropriate error handling" in the plan. `UNIT_COUNT`/`E2E_COUNT` in Task 1 are not placeholders: Step 1 runs the gates and the implementer substitutes the real numbers before writing the file. Every checklist item has concrete action + expected outcome. ✓

**3. Type/structural consistency** — Running `🐛 BUG:` counts verified arithmetically end-to-end: 5 → 20 → 36 → 48 → 58 → 80 → 90 → 107 → 124. Each task's per-section item count matches the items written (S1=8, S2=7, S3=16, S4=12, S5=10, S6=11, S7=11, S8=10, S9=17, S10=12, S11=5). Section order 0–11 is fixed and every task inserts above the stable `## Results Summary` anchor, so order is preserved. ✓

## Execution Handoff

Plan complete and saved to `specs/plans/2026-07-02-smoke-test-checklist.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints.

Which approach?

