# Scheduled Transactions + Rollover To-Budget Pool — Design

**Date:** 2026-07-06
**Status:** Design (pending implementation plan)
**Branch:** `feat/actual`

## Summary

Two coupled pieces of budgeting depth in one spec:

1. **Scheduled/recurring transactions** — a new greenfield feature: define recurring bills/income (weekly/biweekly/monthly/yearly), auto-posted on app open with catch-up for missed periods. Fills the conspicuous gap (rent, salary, subscriptions currently re-entered by hand).

2. **Rollover to-budget pool** — a behavior change to existing budgets: introduce the YNAB "to budget" pool and **asymmetric rollover** (the YNAB/Actual default Notchy currently lacks). Overspending in a default bucket claws back into the pool instead of persisting as in-category red; income becomes explicitly assignable. This is the single biggest semantic gap between Notchy-as-budgeting-app and Actual-as-budgeting-app.

Both compose: scheduled transactions feed budgets; the pool defines how allocations carry and how overspending is handled.

## Goals

- Define and auto-post recurring transactions on app open, catching up missed periods, without an OS-level scheduler.
- Introduce a correct "to budget" pool — income minus assigned minus clawed-back overspending — sourced from transaction `kind` (no `is_income` schema change).
- Fix rollover asymmetry: default buckets drop negatives to the pool; `rollover_enabled` buckets keep full pos+neg carryforward (escape hatch).
- Keep the conservation invariant: `(Σ bucket available) + toBudget` never creates or destroys money.
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

### The core formula — `getToBudget(db, month)` in `budgets.ts`

```typescript
export interface ToBudgetBreakdown {
    income: number;              // Σ kind='income' txns in month (on-budget accounts)
    carriedForward: number;      // prior month's leftover to-budget (chained)
    lastMonthOverspent: number;  // Σ clawed-back negatives from prior month (≤0)
    assigned: number;            // Σ allocations across buckets this month (negated)
    toBudget: number;            // income + carriedForward + lastMonthOverspent − assigned
    overassigned: number;        // max(0, −toBudget) — assigned more than available
}
```

Formula (Actual's, adapted to source income from `kind` not category):
```
toBudget = income + carriedForward + lastMonthOverspent − assigned
```

- **`income`** — `Σ amount FROM transactions WHERE kind='income' AND date IN month AND account on-budget AND deleted_at IS NULL`. Sourced from `kind` (Notchy's model), *not* an income category → no `is_income` schema change. (Actual uses an income category group; Notchy already tracks income by kind.)
- **`carriedForward`** — prior month's `toBudget` (if positive) else 0. Chains month-to-month; recursion bottoms out at the first budgeted month.
- **`lastMonthOverspent`** — `Σ min(0, priorMonthBucketLeftover)` across **non-rollover** buckets. The clawback: last month's red balances reduce this month's pool. Rollover-enabled buckets are excluded (they keep negatives in-category).
- **`assigned`** — `Σ allocated FROM budgets WHERE month=this AND deleted_at IS NULL`, negated.

### The asymmetry fix — `getRolledOver` split

Today `getRolledOver` (`budgets.ts:85`) sums `allocated − spent` for all prior months, carrying negatives in-category (Actual's `carryover=true`, applied unconditionally). It becomes:

```typescript
function bucketRollover(typeId, month):
    if rollover_enabled[typeId]: return Σ (allocated − spent) for prior months   // full carry (unchanged)
    else: return Σ max(0, allocated − spent) for prior months                      // NEW: drop negatives
```

With the pool: **default buckets** drop negatives from the category (no persistent red), and those negatives resurface as `lastMonthOverspent` reducing the pool. **`rollover_enabled` buckets** keep full carryforward (escape hatch for savings). This is Actual's `leftover`/`leftover-pos` asymmetry without Actual's reactive spreadsheet engine — two query variants + a flag.

### Conservation invariant

`(Σ bucket available) + toBudget` is conserved — money is never created or destroyed. A dropped negative in one bucket appears as a reduced pool. This is the property that makes envelope budgeting trustworthy and that Notchy currently lacks. Test fixtures assert the conservation.

### No migration for the pool

`getToBudget` reads existing `transactions` (income) + `budgets` (assigned) + `budgets.rollover_enabled` (exists from migration 004). The asymmetry change is a *query-behavior* change to `getRolledOver`, not a schema change. (Migration `006` is for scheduled transactions only.)

### Behavior change for existing users

| | Before (current) | After (with pool) |
|---|---|---|
| Overspent bucket, rollover **off** | Negative carries in-category (persistent red) | Negative **drops** from category; reduces `toBudget` |
| Overspent bucket, rollover **on** | Full pos+neg carryforward | **Unchanged** — full pos+neg carryforward |
| Income | Tracked, not assignable | **Explicitly assignable** via the pool |
| "Available" check | Soft warning vs month income | **Accurate** — `toBudget` can't go negative without `overassigned` |

This changes displayed numbers for users with overspending + rollover-off buckets. Deliberate and correct (the YNAB behavior requested). It's a release-note item, not a migration — no data rewrite; numbers recompute live from transactions.

### UI — budget screen

- **"To Budget" summary card** at top of budget screen: `income` (in), `assigned` (out), `last month overspent` (clawback) → **`toBudget`** (big number). Negative → "Overassigned" (red).
- Per-bucket `available = allocated + rolled_over − spent` (rollover on) stays; for rollover-off buckets the new `bucketRollover` (drop-negatives) feeds it, so a bucket's `available` floors at 0 — the red moves to the pool.
- **No money-movement primitives** (deferred): user sets allocations manually; `toBudget` is a read-only accurate constraint + soft warning when `overassigned > 0`.

## Migration interplay (schema-version gotcha applies)

- **Migration `006` (scheduled transactions)** bumps the schema version → must update *all* `validateImport`/`importDatabase` version literals (UI, unit, E2E fixtures) per the schema-version-call-sites memory note.
- **The rollover change needs NO migration** — query-behavior change only. Both ship together; the call-site update covers `006`.
- **Idempotency**: `006` follows the `004` PRAGMA-check pattern (idempotent, race-safe per migration-idempotency-race memory note).

## i18n

New keys in both `messages/en.json` and `messages/vi.json` (flat underscore, Paraglide 1.11.8 pin):
- `budget_pool_*` — to budget, income, assigned, overspent, overassigned, conservation labels.
- `schedules_*` — schedule name/frequency/post/reminder/due/empty-state, frequency option labels.

## Testing

Following project TDD discipline (red-green-refactor) and the "do not mock the DB / pure functions" conventions:

- **`schedule_next_due.test.ts`** (pure) — weekly/biweekly/monthly/yearly advancement; month-end clamping (Jan 31 → Feb 28, Dec → Jan next year); leap-year yearly; `from` unaffected (pure).
- **`schedules.test.ts`** (repo, DB-pattern) — CRUD; `postDueSchedules` posts one missed month vs many; catch-up safety cap (24) marks errored over cap; reminder-only advances date, writes no txn; `end_date` → `completed`; deleted-account schedule → errored not crash; each schedule isolated in its own transaction.
- **`budgets.test.ts`** (extend) — `getToBudget`: income from `kind`; `carriedForward` chains; `lastMonthOverspent` claws back only non-rollover negatives; `assigned` sums allocations; conservation invariant (Σ available + toBudget stable across an overspend). `bucketRollover` asymmetry: rollover-off drops negatives, rollover-on keeps them. Empty month → zeros.
- **Store test** — `postDueSchedules` runs once at boot, main window only (no duplicate across webviews).
- **E2E** — create a monthly schedule dated in the past → reopen → transaction posted; budget screen shows to-budget summary with correct clawback after an overspend.

## Open questions

None at design time. Defaults pinned in the body: catch-up cap 24 posts/schedule; income from `kind='income'`; rollover-off drops negatives to pool, rollover-on unchanged; no money-movement primitives; reminder schedules informational only. The implementation plan may revisit the cap value and whether deleting an account blocks on active schedules, but should treat the above as the baseline.
