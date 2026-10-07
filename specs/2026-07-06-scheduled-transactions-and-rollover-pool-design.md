# Scheduled Transactions + Rollover To-Budget Pool — Design

**Date:** 2026-07-06
**Status:** Part 1 (scheduled transactions) implemented by `specs/plans/2026-10-03-scheduled-transactions.md`; Part 2 (rollover to-budget pool) design refined twice on 2026-10-07. First pass pinned four decisions (carried negative pool, no account filter, per-month floor, Rust-canonical port method). Second pass corrected the carry rule to a **running floor** (the earlier per-month note creates money — see the counterexample under "The asymmetry fix") and pulled the **per-bucket rollover toggle UI** into Part 2 scope (without it the flag is inert). A plan is still the next artifact.
**Branch:** `feat/actual`
**Serves:** STORY-009 (Part 1), STORY-035 (Part 2)
**Open story question:** the per-bucket rollover toggle (new Part 2 scope) may warrant its own story rather than riding in STORY-035 — see "Open questions".

## Summary

Two coupled pieces of budgeting depth in one spec:

1. **Scheduled/recurring transactions** — a new greenfield feature: define recurring bills/income (weekly/biweekly/monthly/yearly), auto-posted on app open with catch-up for missed periods. Fills the conspicuous gap (rent, salary, subscriptions currently re-entered by hand).

2. **Rollover to-budget pool** — a behavior change to existing budgets: introduce the YNAB "to budget" pool and **asymmetric rollover** (the YNAB/Actual default Notchy currently lacks). Overspending in a rollover-off bucket claws back into the pool instead of carrying as in-category red; income becomes explicitly assignable. This is the single biggest semantic gap between Notchy-as-budgeting-app and Actual-as-budgeting-app.

Both compose: scheduled transactions feed budgets; the pool defines how allocations carry and how overspending is handled.

## Goals

- Define and auto-post recurring transactions on app open, catching up missed periods, without an OS-level scheduler.
- Introduce a correct "to budget" pool — income minus assigned minus clawed-back overspending — sourced from transaction `kind` (no `is_income` schema change).
- Fix rollover asymmetry: rollover-off buckets drop negatives to the pool; `rollover_enabled` buckets keep full pos+neg carryforward (escape hatch).
- Keep the conservation invariant: `(Σ bucket available) + to_budget` never creates or destroys money.
- Keep all finance calculation in the repo layer (testable with the DB-pattern) and all date arithmetic in pure utils.

## Non-goals (explicit YAGNI)

- Full rSchedule / nth-weekday / weekend-skipping / after-N-occurrences recurrence (minimal fixed set only).
- OS-level background scheduler / autostart / cron — posting is on-open only.
- Money-movement primitives (`coverOverspending`, `transferAvailable`, `holdForNextMonth`) and their UI — Approach C, deferred to a later spec.
- An `is_income` flag on categories — income sourced from `kind='income'` instead.
- Historical recompute / data rewrite for the rollover change — numbers recompute live from transactions; no migration of budget rows.
- Schedule discovery (Actual's history-mining "suggest a schedule" feature).

## Decisions (locked during brainstorming)

| Decision | Choice | Rationale |
|---|---|---|
| Scope | **Both in one spec** | Both are "budgeting depth"; scheduled txns feed budgets |
| Schedule trigger | **On app open, catch-up** | Local-first desktop fit; no OS-scheduler/permission surface; no per-window-context traps |
| Recurrence | **Minimal fixed set** (weekly/biweekly/monthly/yearly) | ~95% case (rent/salary/subscriptions/insurance); ~30 lines pure date arithmetic, no library |
| On due | **Auto-post, per-schedule flag** | Predictable bills post themselves; variable bills can be reminder-only |
| Rollover fix | **Full to-budget pool** (Approach A) | Complete YNAB envelope semantics; income from `kind` = no schema change; asymmetry falls out of the pool |
| Money primitives | **Deferred** (not C) | Correct semantics first; primitives are UX nicety, later spec |

## Part 1 — Scheduled Transactions

### Architecture

```
src-tauri/src/lib.rs (on app open → invoke post_due_schedules)
  → schedules.svelte.ts (store: CRUD + postDueSchedules called at boot, main window only)
      ├─→ schedules.ts (repo: schedule table CRUD + markPosted + insert posted txn via createTransaction)
      └─→ schedule_next_due.ts (PURE: nextDueDate(from, freq, interval) — no Date.now)
```

### Data model — migration `006_schedules.ts`

Bumps schema version → the call-site gotcha applies (see Migration interplay). Idempotent via PRAGMA-check (follows `004` pattern).

```sql
CREATE TABLE IF NOT EXISTS schedules (
    id                  TEXT PRIMARY KEY,                         -- ULID
    name                TEXT NOT NULL CHECK (length(name) <= 64),
    kind                TEXT NOT NULL CHECK (kind IN ('expense','income','transfer')),
    amount              INTEGER NOT NULL CHECK (amount > 0 AND amount <= 999999999999),
    account_id          TEXT NOT NULL REFERENCES accounts(id),
    transfer_account_id TEXT REFERENCES accounts(id),             -- set iff kind='transfer'
    tag_id              TEXT REFERENCES category_tags(id),         -- NULL for transfers
    payee               TEXT CHECK (payee IS NULL OR length(payee) <= 128),
    description         TEXT CHECK (description IS NULL OR length(description) <= 1024),
    frequency           TEXT NOT NULL CHECK (frequency IN ('weekly','biweekly','monthly','yearly')),
    start_date          TEXT NOT NULL CHECK (start_date BETWEEN '1970-01-01' AND '2100-12-31'),
    end_date            TEXT CHECK (end_date IS NULL OR end_date >= start_date),
    posts_transaction   INTEGER NOT NULL DEFAULT 1,               -- auto-post vs reminder
    next_due_date       TEXT,                                     -- computed, advanced on post
    last_posted_date    TEXT,                                     -- last actual post
    completed           INTEGER NOT NULL DEFAULT 0,               -- past end_date / manually stopped
    enabled             INTEGER NOT NULL DEFAULT 1,
    created_at          TEXT NOT NULL,
    updated_at          TEXT NOT NULL,
    deleted_at          TEXT
);
CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(enabled, completed, next_due_date, deleted_at);
```

Design choices:
- **Self-contained schedule** — amount/payee/tag/frequency all on one row. Minimal recurrence set doesn't need Actual's rule indirection.
- **`frequency` enum, not rrule** — `schedule_next_due.ts` is pure date arithmetic.
- **`next_due_date` + `last_posted_date`** — the catch-up mechanism.
- **`posts_transaction` flag** — auto-post (1) vs reminder-only (0). Reminder-only advances `next_due_date` but writes no transaction; UI surfaces "due."
- **`kind` includes `transfer`** — scheduled savings moves reuse the existing single-row transfer model.

### Pure date util — `src/lib/utils/schedule_next_due.ts`

```typescript
export type Frequency = 'weekly' | 'biweekly' | 'monthly' | 'yearly';
export function nextDueDate(from: string, freq: Frequency, interval = 1): string;
// weekly → +7d; biweekly → +14d; monthly → same day next month (clamp to month-end);
// yearly → same month/day next year. Pure — `from` passed in, no Date.now.
```
Handles month-end clamping (Jan 31 → Feb 28) — the one real edge case. No library.

### Posting flow

`postDueSchedules()` runs once at boot from `+layout.svelte`, **main window only** (single-writer discipline, per quick-add-contention memory):

1. Query `schedules WHERE enabled=1 AND completed=0 AND deleted_at IS NULL AND next_due_date <= today`.

   **Definition of `today`.** `today` is the **UTC calendar day** (`todayIso()` — `at.toISOString().slice(0, 10)`), matching the convention already used by `repos/accounts.ts`, `repos/debts.ts`, `repos/transactions.ts` and SQLite's own `date('now')`. This is deliberately a single, timezone-free rule rather than one that drifts with the machine's local zone, and the trade-off is accepted: a user east of UTC can see a schedule still due in the local evening before it posts, and a user far west can see one post before their local midnight. It is the rule to change if that trade-off is ever revisited.

2. For each due schedule, loop while `next_due_date <= today`:
   - If `posts_transaction`: create a real transaction via existing `createTransaction` (date = `next_due_date`, amount/kind/account/tag/payee from the schedule). Mark `last_posted_date`.
   - Advance `next_due_date = nextDueDate(next_due_date, freq)`.
   - If `next_due_date > end_date` (or no more occurrences), set `completed=1`.
3. Each schedule posts in its **own `db.transaction`** — one failing schedule doesn't block others. A failure (e.g. account deleted) marks the schedule errored + toast, doesn't brick boot.
4. After posting, emit `transaction:saved` so dashboard/ledger refresh.

Validation reuse: posted transactions go through `createTransaction`, inheriting all constraints (kind/account/tag CHECK, transfer pairing, refund validation). No raw-SQL back door.

### Edge cases

- **Multiple missed periods** (app closed 3 months, monthly rent due): the loop posts *each* missed month as a separate transaction (you owed rent 3 times), bounded by `end_date` and a **safety cap** (max 24 catch-up posts per schedule). Over the cap → schedule errored + flagged, not auto-flooded.
- **`next_due_date` NULL** (new schedule never posted): initialize to `start_date` on create; first boot after `start_date` posts it.
- **Account deleted between schedules**: `createTransaction` fails on FK → schedule errored + toast, not a crash. Deleting an account should warn about active schedules (flagged for plan).
- **`end_date` reached**: `completed=1`; no more posts.
- **Reminder-only schedules** (`posts_transaction=0`): the same loop advances `next_due_date` per missed occurrence (matching auto-post's catch-up behavior) but writes no transaction; the store surfaces one "due" notice per schedule (toast/badge at boot: "2 bills due"), not one per missed occurrence. Informational only.
- **Schedule disabled mid-period**: `enabled=0` excluded from query; re-enabling resumes from current `next_due_date` (no retroactive gap post — predictable).

## Part 2 — Rollover To-Budget Pool

### The core formula — `BudgetOps.getToBudget(month)`

The pool is computed in Rust, as the canonical domain — the same place `get_rolled_over` already lives. The port (`src/lib/db/client.ts`, `BudgetOps`) gains one method:

```typescript
getToBudget(month: string): Promise<ToBudgetBreakdown>;
```

backed by a new Rust command `budget_get_to_budget` → `domains::budgets::get_to_budget` in `src-tauri/src/database/domains/budgets.rs`, with a browser mirror in `src/lib/db/browser/repos/budgets.ts`.

```typescript
export interface ToBudgetBreakdown {
    income: number;               // Σ kind='income' txns in month
    carried_forward: number;      // prior month's to_budget, sign preserved (chained)
    last_month_overspent: number; // Σ min(0, prior-month available) over rollover-OFF buckets (≤0)
    assigned: number;             // Σ allocations across buckets this month (positive count)
    to_budget: number;            // income + carried_forward + last_month_overspent − assigned
    overassigned: number;         // max(0, −to_budget) — assigned more than available
}
```

The fields are snake_case, not camelCase, because the native adapter deserializes the Rust `ToBudgetBreakdown` struct and the ts-rs binding generator emits snake_case field names — a camelCase port type would read `undefined` at runtime rather than failing loudly.

Formula (Actual's, adapted to source income from `kind` not category):
```
to_budget = income + carried_forward + last_month_overspent − assigned
```

- **`income`** — `Σ amount FROM transactions WHERE kind='income' AND date IN month AND deleted_at IS NULL`. Income is defined purely by `kind`; there is **no account predicate**, because Notchy has no per-account budgeting classification at all (`accounts` carries only identity/type/currency/archive fields) — every account's income counts. Sourced from `kind` (Notchy's model), *not* an income category → no `is_income` schema change. (Actual pairs the predicate with an income category group; Notchy tracks income by kind and needs neither.)
- **`carried_forward`** — the prior month's `to_budget`, with **no `max(0, …)` clamp**. A month that ends overassigned carries a negative pool into the next, reducing what is available there until the user unassigns. Clamping to 0 was the bug: it let Σ available + to_budget grow by the overassigned amount, breaking the conservation invariant below.
- **`last_month_overspent`** — `Σ min(0, available_{M−1}(bucket))` over **rollover-OFF buckets**, where "leftover" means the bucket's own prior-month **`available`** (its `allocated + carry − spent` balance), **not** its activity. The set enumerated is every rollover-off bucket that has a `budgets` row in month `M−1` (`deleted_at IS NULL`); a bucket with no prior-month row contributes nothing. Rollover-ON buckets are excluded because they keep their negatives in-category — and that exclusion is exactly what makes the conservation induction cancel: a rollover-off bucket's dropped negative is subtracted here, one-for-one, matching the positive the bucket no longer carries forward. Include the dropped negative and it would be counted twice.
- **`assigned`** — `Σ allocated FROM budgets WHERE month = this AND deleted_at IS NULL`, as a **positive** count of this month's allocations; the formula subtracts it. The sign lives in the subtraction, not in the value (an earlier draft "negated" it — that was self-contradictory with the `− assigned` in the formula).
- **Base case and evaluation order** — the chain is **not** computed by unbounded backward recursion: every month wants its predecessor, so recursion never terminates. It is a **forward fold**, pinned as follows:
  - **(a) Every intervening month is iterated** — from the start month through the requested month inclusive, *including* months that have neither a `budgets` row nor an income transaction. Such a month still has work to do: it is where a rollover-off bucket's prior-month negative is applied as `last_month_overspent`, and where `carried_forward` advances. Skipping it silently drops the clawback, so the fold is over consecutive calendar months — never over "the months that happen to have a row."
  - **(b) The start month** is the minimum, over all months with a `budgets` row (`deleted_at IS NULL`) or an income transaction (`substr(date, 1, 7)`), of that month; the first iteration uses `carried_forward = 0` and `last_month_overspent = 0`. If no such month exists, `to_budget = 0`.
  - **(c) It terminates** — one calendar month per step from a fixed start to a fixed target: a bounded loop, not recursion.
  This is the concrete form of "chains month-to-month; bottoms out at the first budgeted month."

### The asymmetry fix — `get_rolled_over` becomes flag-aware

Today `get_rolled_over` sums `allocated − spent` for all prior months, carrying negatives in-category (Actual's `carryover=true`, applied unconditionally), and `get_budgets_for_month` re-imposes the toggle with an `enabled ? get_rolled_over(...) : 0` gate plus two separate `available` formulas. `get_rolled_over` itself becomes **flag-aware**: it reads `category_types.rollover_enabled` for the given `type_id` and picks the variant.

Both adapters change identically — the Rust canonical `get_rolled_over` in `src-tauri/src/database/domains/budgets.rs` and its browser mirror `getRolledOver` in `src/lib/db/browser/repos/budgets.ts`:

```typescript
function getRolledOver(typeId, month):
    if rollover_enabled[typeId]: return Σ (allocated − spent) for prior months   // full carry (unchanged)
    else: return runningFloor(typeId, month)                                     // NEW: running floor
```

**The rollover-OFF rule is a running floor.** Let `L_m = allocated_m − spent_m` for month `m` (that month's own activity), with `C_base = 0` and `C_M = max(0, C_{M−1} + L_{M−1})`. A rollover-off bucket's carry into month `M` is `C_M` — a **stateful forward fold in chronological month order**. It is neither a per-month sum nor a single cumulative clamp.

Why the floor must run: the per-month sum **creates money**. One rollover-off bucket, no others:

| | income | allocated | spent | carry | available | lmo | to_budget | Σ |
|---|---|---|---|---|---|---|---|---|
| M1 | 100 | 100 | 0 | 0 | 100 | 0 | 0 | 100 |
| M2 | 150 | 0 | 150 | 100 | −50 | 0 | 150 | 100 |
| M3 | 0 | 0 | 0 | 100 | 100 | −50 | 100 | **200** |

Real money in = 250, out = 150 → 100, but the per-month scheme reports 200. The +100 surplus of M1 keeps rolling forever, because M2's overspend never consumes it.

Under the running floor the same three months conserve:

| | income | allocated | spent | carry | available | lmo | to_budget | Σ |
|---|---|---|---|---|---|---|---|---|
| M1 | 100 | 100 | 0 | 0 | 100 | 0 | 0 | 100 |
| M2 | 150 | 0 | 150 | 100 | −50 | 0 | 150 | 100 |
| M3 | 0 | 0 | 0 | **0** | **0** | −50 | 100 | **100** |

`C_{M2} = max(0, C_{M1} + L_{M1}) = max(0, 0 + 100) = 100`; `C_{M3} = max(0, C_{M2} + L_{M2}) = max(0, 100 − 150) = 0`. M3's carry is `0`, its pool is `100`, and Σ = 100 — conserved.

**A trace that hid the flaw.** An earlier draft justified the per-month rule with a two-month trace: leftover `−50` then `+100` gives `100` per-month (conserved) versus `50` for a single cumulative `max(0, Σ …)` (50 lost). That trace is **honest but misleading** — its ordering is negative-then-positive, which is exactly the one ordering where the per-month sum and the running floor **coincide** (`max(0, −50) + max(0, +100) = 100`, and the running floor gives `max(0, max(0, 0 − 50) + 100) = 100`). The flaw appears only in the opposite ordering — a surplus month followed by an overspend month, i.e. the counterexample above — which the trace never exercised. Do not repeat it: that trace is not a proof of the rule.

**Implementation consequence.** With a running floor the carry is a **stateful forward fold over consecutive months**, so it can no longer be computed by an order-independent aggregate. Today `get_rolled_over` / `getRolledOver` fetch the prior budgeted months and sum `allocated − spent` in arbitrary order (Rust `src-tauri/src/database/domains/budgets.rs`, browser `src/lib/db/browser/repos/budgets.ts`); the rollover-off branch must instead iterate month by month **in chronological order**, carrying `C ← max(0, C + L_m)`, and must do so **identically in both adapters**. A `SELECT SUM(...)` aggregate has nowhere to hold the intermediate floor.

**Gating is preserved.** The fold runs over the months that have a `budgets` row for that `type_id` (`deleted_at IS NULL`) — spending in a month with no budget row is ignored today and must stay ignored. Both adapters gate exactly this way: Rust `src-tauri/src/database/domains/budgets.rs:82-103` (`... WHERE type_id = ?1 AND month < ?2 AND deleted_at IS NULL`) and browser `src/lib/db/browser/repos/budgets.ts:85-99` (`... WHERE type_id = ? AND month < ? AND deleted_at IS NULL`). **Verified** at those lines. A month with no budget row contributes `L_m = 0` (neither its allocation nor its spending counts), so the *bucket carry* fold's intervening months are the budgeted ones — whereas the *to-budget* fold above iterates every calendar month.

Consequence: `get_budgets_for_month` (Rust) / `getBudgetsForMonth` (browser) **drops its `enabled ? … : 0` gate**, and `available` stops having two formulas — for both rollover-on and rollover-off buckets it is `available = allocated + rolled_over − spent`. That single formula is exactly what makes a rollover-off bucket floor at 0: its running-floored `rolled_over` never carries a negative, so the bucket's red moves into the pool via `last_month_overspent`.

With the pool: **rollover-off buckets** drop negatives from the category (no persistent red), and those negatives resurface as `last_month_overspent` reducing the pool. **`rollover_enabled` buckets** keep full carryforward (escape hatch for savings). This is Actual's `leftover`/`leftover-pos` asymmetry without Actual's reactive spreadsheet engine — a flag read plus two query variants.

### Contract change — `get_rolled_over` is now flag-aware (blast radius)

Making `get_rolled_over` / `getRolledOver` flag-aware is a **public contract change**: its contract shifts from "full carry, always" to "carry depends on the flag." A Part 2 plan must update every dependent:

- **`src/tests/unit/budgets.test.ts:156-171`** asserts the exact opposite — "ignores the rollover_enabled toggle (toggle gates display, not history)" — and **must be inverted**: under the new rule the flag *does* change `getRolledOver`'s result. **Verified** (`expect(rolled).toBe(1100000)` with the flag set to `0`).
- **`src/tests/unit/budgets.test.ts:127-146`** ("available = allocated − spent (month-only) when rollover disabled") becomes **wrong** under the new rule, because a rollover-off bucket now carries *positives* (clamped at zero by the running floor), so `available` is no longer month-only. **Verified** (`expect(b.rolled_over).toBe(0)` / `expect(b.available).toBe(700000)`).
- **`budget_get_rolled_over` consumers must stay in sync** — the E2E mock handler `src/tests/e2e/fixtures/tauri-mock.ts:850`, and the native-boundary sweep `src/tests/unit/native-boundary.test.ts` (sweep entry `:95`, exercise row `:473`). **Verified.**
- **The new command `budget_get_to_budget`** adds a parallel surface that must be complete on all four sides, or `src/tests/unit/native-boundary.test.ts` fails:
  1. registration in `src-tauri/src/lib.rs`'s `generate_handler!` (alongside `budget_get_rolled_over` at `:94`);
  2. a `NativeBudgetOps.getToBudget` in `src/lib/db/native/client.ts` (the class at `:239`);
  3. a tauri-mock handler in `src/tests/e2e/fixtures/tauri-mock.ts` (near the `budget_get_rolled_over` handler at `:850`);
  4. a native-boundary sweep row in `src/tests/unit/native-boundary.test.ts`. **All four verified as the required sides.**
- **`src/lib/db/native/budgets.ts` is an inactive throwing stub** with no importers — every export throws `'native budgets adapter not wired'`. The **live** native path is `NativeBudgetOps` (`src/lib/db/native/client.ts:239`). The plan **must not extend the stub** — adding a throwing `getToBudget` there changes nothing at runtime and only adds drift.

### Conservation invariant

`(Σ bucket available) + to_budget` is conserved — money is never created or destroyed. A dropped negative in one bucket appears as a reduced pool. This is the property that makes envelope budgeting trustworthy and that Notchy currently lacks.

The negative-pool case is part of it: because `carried_forward` does not clamp, an overassigned month reduces the **next** month's pool rather than vanishing. Test fixtures must cover it — a month with `to_budget < 0` followed by another month — and assert the pair conserves.

### No migration for the pool

`getToBudget` reads existing `transactions` (income) + `budgets` (allocations). The `budgets` row (`src/lib/db/browser/migrations/001_initial.ts:79-89`) is `{ id, type_id → category_types(id), month (CHECK GLOB 'YYYY-MM'), allocated INTEGER NOT NULL CHECK (allocated >= 0), created_at, updated_at, deleted_at, UNIQUE(type_id, month) }` — note the `created_at`, `updated_at`, the `UNIQUE(type_id, month)` constraint, and `CHECK (allocated >= 0)`. The old shorthand that omitted those hid a real consequence: because `allocated` can never be negative, an over-assigned pool can be **reduced to 0 but never repaired with a negative allocation** — to fix an overassignment the user must **unassign elsewhere** (lower some bucket to fund the pool); they cannot push a bucket negative. The rollover flag lives on **`category_types.rollover_enabled`** (added by migration 004, `INTEGER NOT NULL DEFAULT 1`), **not** on `budgets` — an earlier draft wrote `budgets.rollover_enabled`, which does not exist. The asymmetry change is a *query-behavior* change to `getRolledOver`, not a schema change. (Migration `006` is for scheduled transactions only.)

### Behavior change for existing users

| | Before (current) | After (with pool) |
|---|---|---|
| Overspent bucket, rollover **off** | `rolled_over = 0`; the month's `available = allocated − spent` already drops the negative — **nothing persists in-category today** (`src-tauri/src/database/domains/budgets.rs:164-174`). The "persistent red" behaviour belongs to the rollover-**on** row, not this one. | Negative **drops** from category; reduces `to_budget` |
| Overspent bucket, rollover **on** | Full pos+neg carryforward (persistent red) | **Unchanged** — full pos+neg carryforward |
| Income | Tracked, not assignable | **Explicitly assignable** via the pool |
| "Available" check | Soft warning vs month income | **Accurate** — `to_budget` can't go negative without `overassigned` |

The set of users whose displayed numbers change is **empty today**: `category_types.rollover_enabled` defaults to `1` for every row and no production UI ever sets it (see "Per-bucket rollover toggle" below), so every existing bucket is rollover-**on** and its numbers are unchanged. With the toggle kept and the default at `1`, **no existing user's numbers change until they flip a bucket**. The behaviour change is nonetheless deliberate and correct (the YNAB behavior requested); it is a release-note item, not a migration — no data rewrite, numbers recompute live from transactions.

The existing soft warning is **replaced**. `src/routes/budgets/+page.svelte` currently approximates the pool in a local `loadMonthIncome()` as `db.reports.getOverview(month).total_income` **plus** `Σ max(0, bucket.rolled_over)`, and `remainingToAllocate` derives from that sum. That approximation is retired; the port method's `to_budget` replaces it.

### UI — budget screen

- **"To Budget" summary card** at top of budget screen: `income` (in), `assigned` (out), `last month overspent` (clawback) → **`to_budget`** (big number). Negative → "Overassigned" (red).
- Per-bucket `available = allocated + rolled_over − spent` for **every** bucket; the flag-awareness lives inside `rolled_over`, so a rollover-off bucket floors at 0 and its red moves to the pool.
- The card **replaces** `loadMonthIncome()`'s `db.reports.getOverview(month)` call on `src/routes/budgets/+page.svelte` — `to_budget` is the accurate ceiling, so the page no longer approximates it.
- The existing `budgets_over_allocated` / `budgets_over_allocated_with_income` warning becomes driven by `overassigned` (`max(0, −to_budget)`) rather than an income-minus-allocated guess.
- **No money-movement primitives** (deferred): user sets allocations manually; `to_budget` is a read-only accurate constraint + soft warning when `overassigned > 0`.
- **Wiring — through `BudgetsStore`, not a direct `db.budgets.getToBudget` call.** `src/lib/stores/budgets.svelte.ts` today wraps only `getForMonth` (plus `setAllocation` / `copyFromPrevious`), so add a `toBudget` field to the store, populated in `load()` alongside `items`. Reason: the store already owns `month`, and the rollover toggle below must reload the buckets *and* the pool in one pass — reading `db.budgets.getToBudget(month)` straight from the page would re-introduce a second, independently-threaded month source (the exact pattern `loadMonthIncome()` is being retired for).

### Per-bucket rollover toggle (required Part 2 scope)

The pool is **dead code without this control.** `category_types.rollover_enabled` defaults to `1` for every row, and **no production UI ever sets it** — `setRolloverEnabled` has **no caller anywhere in `src/routes`, `src/lib/components`, or `src/lib/stores`** (verified: its only callers are the `CategoryOps` declarations, the browser/native clients, the repos, and tests). Every existing bucket is therefore rollover-**on**, `getRolledOver` always takes the full-carry branch, and the rollover-off running floor never runs. The decision taken: **keep the default at `1` and build the toggle UI**, so no existing user's numbers change until they choose to.

**Placement — a per-bucket toggle on `src/routes/budgets/+page.svelte`, one per budgetable bucket row.** Rationale: rollover semantics only matter in the budgeting context; the "To Budget" card is on the same screen, so flipping a bucket's switch and watching the pool move is visible cause-and-effect; and there is **no bucket-management screen today** (`createBucket` / `renameBucket` have **no UI callers** — verified), so no existing surface is being extended. *Pinned by the controller — flag for review*: the toggle's home was not separately agreed, and a settings-screen home is a plausible alternative.

**Store method.** Add `CategoriesStore.setRolloverEnabled(id, enabled)` to `src/lib/stores/categories.svelte.ts`. The **port method already exists but the store does not expose it**, so without this method the page cannot flip the flag without reaching past the store to `getDb()`.

**Existing plumbing to reuse (do not rebuild — verify, don't re-create).** The write path is already wired end-to-end; the plan supplies callers and UI only:
- Port declaration — `src/lib/db/client.ts:150` (`setRolloverEnabled(id, enabled): Promise<void>` in `CategoryOps`). **Verified.**
- Browser repo — `src/lib/db/browser/repos/categories.ts:62-68` (the `UPDATE category_types SET rollover_enabled = …`). The brief cited `:65`; that is the UPDATE statement itself, inside the function that opens at line 62 — **corrected to `:62-68`.**
- Native client — `src/lib/db/native/client.ts:202` (`invoke('category_set_rollover_enabled', { id, enabled })`). **Verified.**
- Rust command — `category_set_rollover_enabled` (`src-tauri/src/database/commands.rs:353`; registered in `src-tauri/src/lib.rs:83`'s `generate_handler!`). **Verified.**
- Tauri mock — handler at `src/tests/e2e/fixtures/tauri-mock.ts:771`. **Verified.**
- Native-boundary row — `src/tests/unit/native-boundary.test.ts:463` (`categories.setRolloverEnabled` → `category_set_rollover_enabled`), plus the sweep entry at `:84`. **Verified.**

**i18n.** New keys for the toggle (label + help text) in **both** `messages/en.json` and `messages/vi.json`, `budgets_` underscore prefix, no dotted ids (Paraglide pinned at 1.11.8) — e.g. `budgets_rollover_toggle`, `budgets_rollover_toggle_help`.

**E2E — flip the switch and watch the number move.** Add an E2E spec that, on the budget screen, makes a bucket overspent, flips its rollover toggle off, and asserts that the bucket's `available` and the "To Budget" pool both change (the bucket claws its red into the pool rather than persisting it in-category), then flips it back and asserts the carry is restored. This test is the guard against the feature being **inert**: the store/repo/port plumbing can all be present and wired, and the toggle can render and call through, while nothing downstream reads the flag — a test that only asserts the toggle's state, or that the `UPDATE` fired, would still pass. Only an observed change in the displayed number proves the flag actually reaches `getRolledOver` and the pool.

## Migration interplay (schema-version gotcha applies)

- **Numbering.** "`006`" is **browser-side numbering only.** The browser registry (`src/lib/db/browser/migrations/index.ts`) holds six migrations and its `LATEST_SCHEMA_VERSION` — computed as `Math.max(...versions)` at `:18` — is **6**; the Rust `LATEST_SCHEMA_VERSION` is **7** (`src-tauri/src/database/migrations.rs:23`). Both name the same shipped change. Read "migration 006" as "the sixth *browser* migration," never as a version number shared by the two adapters. **Verified.**
- **Part 1 shipped its migration `006`** (scheduled transactions, merged as PR #38, merge commit `499464c`). It bumped the schema version, which required updating *all* `validateImport`/`importDatabase` version literals (UI, unit, E2E fixtures) per the schema-version-call-sites memory note — **that call-site sweep is already done.**
- **Part 2 needs no migration of its own** — the pool is a query-behavior change over existing tables — so no schema-version literal changes are needed, and a Part 2 plan must **not** re-run `006`'s call-site sweep.
- **Idempotency**: `006` follows the `004` PRAGMA-check pattern (idempotent, race-safe per migration-idempotency-race memory note).

## i18n

New keys in both `messages/en.json` and `messages/vi.json` (flat underscore, Paraglide 1.11.8 pin — no dotted ids):
- `budgets_*` — the pool keys ride the screen's existing plural prefix (alongside `budgets_summary_income`, `budgets_over_allocated`, `budgets_rolled_in`, `budgets_available`, `budgets_remaining`, …) rather than a singular `budget` prefix: `budgets_to_budget`, `budgets_pool_income`, `budgets_pool_assigned`, `budgets_pool_overspent`, `budgets_overassigned`, plus conservation labels. The **per-bucket rollover toggle** adds `budgets_rollover_toggle` (label) and `budgets_rollover_toggle_help` (help text) — also `budgets_`-prefixed, no dotted ids.
- `schedules_*` — schedule name/frequency/post/reminder/due/empty-state, frequency option labels.

## Testing

Following project TDD discipline (red-green-refactor) and the "do not mock the DB / pure functions" conventions:

- **`schedule_next_due.test.ts`** (pure) — weekly/biweekly/monthly/yearly advancement; month-end clamping (Jan 31 → Feb 28, Dec → Jan next year); leap-year yearly; `from` unaffected (pure).
- **`schedules.test.ts`** (repo, DB-pattern) — CRUD; `postDueSchedules` posts one missed month vs many; catch-up safety cap (24) marks errored over cap; reminder-only advances date, writes no txn; `end_date` → `completed`; deleted-account schedule → errored not crash; each schedule isolated in its own transaction.
- **`budgets.test.ts`** (extend) — `getToBudget`: income from `kind`; `carried_forward` chains; `last_month_overspent` claws back only rollover-off buckets that have a prior-month `budgets` row, using their prior-month `available`; `assigned` sums allocations as a positive count; conservation invariant (Σ available + to_budget stable across an overspend). Asymmetry: rollover-off uses the **running floor** (`C ← max(0, C + L_m)`) — not a per-month sum and not a single cumulative `max(0, Σ …)`; both alternatives are refuted by the counterexample above, which should be included verbatim as a fixture (it is the case that distinguishes the rule). Rollover-on keeps negatives. Negative-pool carry: a month with `to_budget < 0` reduces the next month's pool. Forward fold: it iterates every intervening month, the earliest budget-row-or-income month starts it, and the chain terminates. Empty month → zeros.

  **Both sides are required — and the Rust harness already exists.** The parity fixture set is added to the **existing integration harness** `src-tauri/tests/domain_categories_budgets.rs` — **extended, not created** — which already provides `fresh_db` (`bootstrap_current(&path, FailurePoint::None)` + `Connection::open_with_flags`) plus `create_test_bucket` / `create_test_tag`, and is mirrored by the same fixture table in the browser repo test. `src-tauri/src/database/domains/budgets.rs` has **no `#[cfg(test)]` module**, and the pure-function modules at `civil_date.rs:46`, `reports.rs:582`, `export.rs:208` are the wrong precedent (they have no database): **do not create a second, in-crate harness in `budgets.rs`.** E2E drives only the browser adapter, so a green browser-only suite proves nothing about the native path — the Rust integration harness is what pins adapter parity.
- **Store test** — `postDueSchedules` runs once at boot, main window only (no duplicate across webviews).
- **E2E** — create a monthly schedule dated in the past → reopen → transaction posted; budget screen shows to-budget summary with correct clawback after an overspend.

## Open questions

One question is left open for the reviewer; everything else is pinned in the body.

- **Does the per-bucket toggle belong inside STORY-035, or in its own story?** The toggle is a user-facing capability that arguably carries its own need — "I can choose which buckets carry their balance over" — separate from "overspending claws back into a pool." Two readings: (a) keep it in **STORY-035**, because the toggle is the *mechanism that makes the clawback reachable* (without it the flag is inert — see "Per-bucket rollover toggle" above); (b) split it into its own story row, since a user can want the toggle without ever reasoning about a pool. **Not decided — the reviewer picks.**

Defaults pinned in the body: catch-up cap 24 posts/schedule; income from `kind='income'`; rollover-off drops negatives to the pool via a **running floor**, rollover-on unchanged; no money-movement primitives; reminder schedules informational only; the per-bucket rollover toggle UI is in Part 2 scope, its placement pinned for review. The implementation plan may revisit the cap value and whether deleting an account blocks on active schedules, but should treat the above as the baseline.

## Known gaps and follow-ups (Part 1 scope — out of scope for a Part 2 plan)

These are **Part 1** items, parked during `2026-10-03-scheduled-transactions` (Task 13); all still open and each names the file it would touch. They are recorded here for continuity, but they belong to the scheduled-transactions work — **a Part 2 (rollover pool) plan must not inherit or pick them up.**

1. **`schedules` is absent from the CSV table dump** — `src-tauri/src/database/domains/export.rs`'s `TABLE_SET` lists 7 tables and omits `schedules`, so the convenience CSV export skips schedule definitions. Backups are unaffected (the Online Backup API copies the whole DB). Needs a product decision: does a schedule *definition* belong in a ledger dump?
2. **`manifest.rs`'s per-version `TABLES_V*` lists are hand-copied** — `TABLES_V7` (`src-tauri/src/database/manifest.rs`) was the second hand-maintained copy and migration 8 will be the third; forgetting to add the table to the new list is a boot brick, which is exactly how this plan opens.
3. **`validate_manifest`'s CHECK gate is one-directional** — `src-tauri/src/database/manifest.rs` catches a manifest declaring a CHECK the DDL lacks, but not the reverse; the rejection tests are the real protection. Pre-existing, not introduced here.
4. **`NewSchedule.posts_transaction` is optional on the port** — `src/lib/db/client.ts` marks it `posts_transaction?`, so the browser `createSchedule` (`src/lib/db/browser/repos/schedules.ts`) defaults a missing value to `1` while Rust's `create_schedule` requires the field: the lenient-double-divergence class (browser accepting what Rust rejects). Unreachable while the form supplies it; tightening the port type ripples into `NativeScheduleOps`.
5. **The posting engine is not atomic across the port** — a `markPosted` failure after `create` wrote rows parks the schedule without advancing its date, so a later Resume re-posts those rows (duplicate financial posts). Touches `src/lib/db/browser/repos/schedules.ts` and `src-tauri/src/database/domains/schedules.rs`; the real fix is a design change (transaction support or `op_id` on the port).
6. **The boot posting pass never runs in the web/browser build** — `attachTransactionSavedListener` (`src/lib/stores/quick-refresh.ts`) rejects there (`@tauri-apps/api` `invoke` dereferences `window.__TAURI_INTERNALS__` unguarded), aborting the boot IIFE before the pass; the bare IIFE also has no `.catch`, so an initial-query failure silently never posts. Desktop is unaffected; `pnpm dev` and the 28 browser-fallback E2E specs are. Task 12 (`95c142d`) added a `plugin:event|listen` stub to the Tauri mock, which finally let the pass run in the mock specs (the same missing-handler abort was hiding it there too); that half is fixed, the browser-build half is not. Touches the boot pass in `src/routes/+layout.svelte`.
7. **Cross-window event delivery has no coverage anywhere** — the Tauri mock's event stub no-ops `emit`, so `emitTransactionsChanged`'s path (`src/lib/stores/quick-refresh.ts`) is untested. It masks nothing today (the layout refreshes its stores explicitly before emitting) but it is unproven.
8. **Resume clears the badge but nothing posts until the next boot** — `src/lib/stores/schedules.svelte.ts:84-96` resumes a parked schedule with `next_due_date: null` (which keeps the stored, still-due date), but the posting pass runs **only at boot** (`src/routes/+layout.svelte`) and nothing on the schedules page re-triggers it: the user clicks Resume, the badge clears, and no transaction appears until they restart the app. Consistent with the documented boot-only design (a spec non-goal), so nothing is lost — the gap is the silent wait. It interacts with gap 5, where a later pass re-posts rows the parking never advanced past; closing it is a product decision (button copy or a "run now" path), not this round's.
