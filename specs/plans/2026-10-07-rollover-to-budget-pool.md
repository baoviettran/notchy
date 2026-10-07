# Rollover To-Budget Pool Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Serves:** STORY-035, STORY-036
**Spec:** `specs/2026-07-06-scheduled-transactions-and-rollover-pool-design.md` (§Part 2 — read `## Part 2 — Rollover To-Budget Pool` through `## Testing` as the authority; Part 1 is shipped and out of scope)
**Goal:** Replace the budget screen's ad-hoc income approximation with a real, conserved "To Budget" pool, computed by a forward fold in the Rust domain and mirrored exactly in the browser adapter.
**Architecture:** `budgets.getToBudget(month)` joins the existing `BudgetOps` port. Rust (`domains::budgets::get_to_budget`, command `budget_get_to_budget`) is canonical; the browser repo is a byte-for-byte mirror driving Vitest and Playwright. A rollover-OFF bucket's carry becomes a stateful running floor (`C ← max(0, C + L_m)`) computed in chronological month order in both adapters, and `get_rolled_over` becomes flag-aware; `get_budgets_for_month` drops its `enabled ? … : 0` gate so `available = allocated + rolled_over − spent` for every bucket. The page reads the pool through `BudgetsStore`, and a new per-bucket rollover toggle makes the flag reachable.
**Tech Stack:** Rust (rusqlite, tauri commands, ts-rs bindings), TypeScript (Svelte 5 runes, Paraglide 1.11.8), Vitest, Playwright.

## Global Constraints

- Amounts are always integers in the smallest currency unit — no floats anywhere.
- IDs are ULIDs (custom implementation in `src/lib/utils/id.ts`; `OperationId::generate()` on the Rust side).
- Paraglide is pinned at **1.11.8**: flat underscore keys only (e.g. `budgets_rollover_toggle`), no dotted ids.
- The browser adapter is what E2E drives, so a Rust/browser divergence is invisible to E2E — Rust is canonical and the browser must mirror it exactly.
- No migration and no schema-version sweep in Part 2: the pool is a query-behavior change over existing tables (`transactions`, `budgets`, `category_types`). Do not re-run migration `006`'s `validateImport`/`importDatabase` literal sweep.
- Every step below is `- [ ]`; the final step of every task is a heredoc commit whose subject line is the plain `type(scope): text` the roadmap matcher extracts.
- Keep the commit form exactly `git commit -m "$(cat <<'EOF' … EOF )"`. `scripts/roadmap.mjs`'s `extractCommitSubject` recognizes that form and bare `git commit -m "…"` — it does **not** recognize `git commit -F -`, which yields a `null` directive and leaves the task permanently unmatched (verified by running `parseTasks`/`extractCommitSubject` from `scripts/roadmap.mjs` over this file).
- The Rust budgets test harness already exists (see Task 1) — extend it, do not create a `#[cfg(test)]` module in `src-tauri/src/database/domains/budgets.rs`.

## Review Focus

The five input classes most likely to bite a user, most likely first. Each names the condition, the behavior a reasonable person expects, and the test that pins it (the task that owns the code is named).

1. **An overassigned month (`to_budget` < 0).** A user assigns more than they have; expect the card to show a red "Overassigned" figure rather than a silently negative available, and the debt to carry into the next month instead of resetting to 0. Pinned by the Rust `to_budget_negative_pool_carries_without_a_clamp` and its browser twin (Tasks 3/4), plus the card's red state (Task 6).
2. **A surplus month followed by an overspending month.** The ordering where the wrong (per-month) rule invents money; expect `Σ available + to_budget` to be conserved. Pinned by `to_budget_fold_conserves_on_the_counterexample` (Tasks 2/3/4).
3. **Spending in a month that has no `budgets` row.** Today the carry ignores it entirely; expect it to keep being ignored, because if the new fold starts counting it every existing user's numbers shift silently. Pinned by `unbudgeted_month_spending_is_ignored`, added to Task 3 (Step 1).
4. **A rollover-ON bucket holding a negative.** Expect it to stay in-category and **not** also be clawed back into the pool — double-counting would destroy money. Pinned by `rollover_on_carry_keeps_the_negative` (Task 2) and `to_budget_claws_back_only_rollover_off_buckets` (Task 3).
5. **Income dated earlier than the first `budgets` row.** Expect the fold to start at that income month, so the pool includes it rather than starting at the first budgeted month. Pinned by `pool_start_month_includes_earlier_income`, added to Task 3 (Step 1).

## Notes for the implementer

Not part of the five lines above — process notes kept from the authoring brief. (The harness-location and snake_case points are now corrected in the spec itself, so they are dropped.)

- **Toggle placement.** Pinned by the spec to the budget-screen bucket row. A settings-screen home is a plausible alternative — noted, not re-litigated here. The toggle now serves **STORY-036**, its own story, rather than riding in STORY-035.
- **The tauri-mock `budget_get_to_budget` handler returns a constant.** It exists to satisfy the four-sides boundary rule; the flip-behaviour E2E runs on the browser-adapter fixture, not the mock, so it is not the thing proving the fold.
- **Task 5 is one large task on purpose.** The four sides of a new command (registration, `NativeBudgetOps`, tauri-mock, native-boundary row) plus the port declaration and the browser client must land together or the boundary suite leaves nothing red.

---

### Task 1: Extend the Rust budgets integration harness

Add shared seeding helpers and a characterization test that pins **today's** carry behaviour, so Task 2 has a green baseline to invert.

**Files:**
- Modify/Test: `src-tauri/tests/domain_categories_budgets.rs`

**Interfaces:**
- Consumes: `notchy_lib::database::domains::{accounts, categories, budgets, transactions}`, `notchy_lib::database::types::{AccountType, NewAccount, NewTransaction, TransactionKind, OperationId}`, `notchy_lib::database::migrations::{bootstrap_current, FailurePoint}`.
- Produces (test-local helpers, used by Tasks 2 and 3):
  - `fn fresh_account(conn: &mut Connection) -> String`
  - `fn seed_expense(conn: &mut Connection, account_id: &str, tag_id: &str, amount: i64, date: &str)`
  - `fn seed_income(conn: &mut Connection, account_id: &str, amount: i64, date: &str)`

- [x] **Step 1: Write the failing test — append the counterexample baseline to the harness.**

Append to the end of `src-tauri/tests/domain_categories_budgets.rs`:

```rust
// ---------------------------------------------------------------------------
// Rollover pool fixtures
// ---------------------------------------------------------------------------

/// A checking account for seeding transactions against.
fn fresh_account(conn: &mut Connection) -> String {
    use notchy_lib::database::domains::accounts;
    accounts::create_account(
        conn,
        op(),
        notchy_lib::database::types::NewAccount {
            name: "A".to_string(),
            account_type: notchy_lib::database::types::AccountType::Checking,
            counterparty: None,
            currency: "USD".to_string(),
            initial_balance: None,
            initial_balance_date: None,
        },
    )
    .unwrap()
}

/// Seed an expense tagged into a bucket.
fn seed_expense(conn: &mut Connection, account_id: &str, tag_id: &str, amount: i64, date: &str) {
    use notchy_lib::database::domains::transactions;
    use notchy_lib::database::types::{NewTransaction, TransactionKind};
    transactions::create_transaction(
        conn,
        op(),
        NewTransaction {
            kind: TransactionKind::Expense,
            date: date.to_string(),
            amount,
            account_id: account_id.to_string(),
            transfer_account_id: None,
            refund_of_id: None,
            tag_id: Some(tag_id.to_string()),
            payee: None,
            description: None,
        },
    )
    .unwrap();
}

/// Seed an income transaction (kind = 'income', no tag).
fn seed_income(conn: &mut Connection, account_id: &str, amount: i64, date: &str) {
    use notchy_lib::database::domains::transactions;
    use notchy_lib::database::types::{NewTransaction, TransactionKind};
    transactions::create_transaction(
        conn,
        op(),
        NewTransaction {
            kind: TransactionKind::Income,
            date: date.to_string(),
            amount,
            account_id: account_id.to_string(),
            transfer_account_id: None,
            refund_of_id: None,
            tag_id: None,
            payee: None,
            description: None,
        },
    )
    .unwrap();
}

/// Baseline (today's) carry rule, before the running floor lands: a rollover
/// bucket carries the full cumulative `allocated - spent` of every prior
/// budgeted month, negatives included. The counterexample fixture
/// (M1 = 2026-01, M2 = 2026-02, M3 = 2026-03):
///
///   |     | income | allocated | spent | carry | available | lmo | toBudget | Σ   |
///   |-----|--------|-----------|-------|-------|-----------|-----|----------|-----|
///   | M1  | 100    | 100       | 0     | 0     | 100       | 0   | 0        | 100 |
///   | M2  | 150    | 0         | 150   | 100   | -50       | 0   | 150      | 100 |
///   | M3  | 0      | 0         | 0     | 0 / 100 | 0 / 100 | -50 | 100      | 100 |
///
/// (M3's carry is `0` under the running floor and `100` under the wrong
/// per-month sum; this test pins the pre-change full-carry reading, which
/// Task 2 then inverts.)
#[test]
fn baseline_full_carry_over_budgeted_months() {
    let mut db = fresh_db("pool_baseline");
    let bucket = create_test_bucket(&mut db, "Food");
    let tag = create_test_tag(&mut db, "Groceries", &bucket);

    budgets::set_allocation(&mut db, op(), &bucket, "2026-01", 100).unwrap();
    budgets::set_allocation(&mut db, op(), &bucket, "2026-02", 0).unwrap();
    seed_expense(&mut db, &fresh_account(&mut db), &tag, 150, "2026-02-10");
    budgets::set_allocation(&mut db, op(), &bucket, "2026-03", 0).unwrap();

    // Today: full cumulative carry, negative included.
    assert_eq!(budgets::get_rolled_over(&db, &bucket, "2026-02").unwrap(), 100);
    assert_eq!(budgets::get_rolled_over(&db, &bucket, "2026-03").unwrap(), -50);
}
```

- [x] **Step 2: Run it and confirm it fails.**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test domain_categories_budgets baseline_full_carry
```

Expected failure (the helpers the test calls do not exist yet):

```
error[E0425]: cannot find function `seed_expense` in this scope
error[E0425]: cannot find function `fresh_account` in this scope
```

- [x] **Step 3: Minimal implementation.**

The implementation *is* the three helpers added in Step 1; move them above the test if the compiler is happy but the file reads better with helpers first (it does — keep helpers under the `Rollover pool fixtures` banner, tests below). No production code changes.

- [x] **Step 4: Run and confirm pass.**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test domain_categories_budgets
```

Expected: `baseline_full_carry_over_budgeted_months` passes, and the pre-existing tests in the file stay green.

- [x] **Step 5: Commit.**

```bash
git add src-tauri/tests/domain_categories_budgets.rs
git commit -m "$(cat <<'EOF'
test(budgets): extend the Rust budgets integration harness

Add fresh_account / seed_expense / seed_income helpers and pin today's
full-carry get_rolled_over behaviour on the spec's counterexample months,
so Task 2 has a green baseline to invert.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 2: Running-floor carry and the flag-aware gate drop (both adapters)

One semantic rule, both adapters, same fixture table, in the same task. Invert the two existing browser tests.

**Files:**
- Modify: `src-tauri/src/database/domains/budgets.rs`
- Modify: `src/lib/db/browser/repos/budgets.ts`
- Test: `src-tauri/tests/domain_categories_budgets.rs`
- Test: `src/tests/unit/budgets.test.ts`

**Interfaces:**
- Consumes: `category_types.rollover_enabled` (`INTEGER NOT NULL DEFAULT 1`, migration 004).
- Produces: `get_rolled_over` / `getRolledOver` now read the flag; `get_budgets_for_month` / `getBudgetsForMonth` no longer gate.

- [x] **Step 1: Write the failing tests — the running floor in both adapters.**

Append to `src-tauri/tests/domain_categories_budgets.rs`:

```rust
/// A rollover-OFF bucket's carry is a running floor in chronological month
/// order: `C_m = max(0, C_{m-1} + L_{m-1})`, `L_m = allocated_m - spent_m`.
/// Same counterexample fixture as the browser test, same numbers:
///
///   |     | income | allocated | spent | carry | available | lmo | toBudget | Σ   |
///   |-----|--------|-----------|-------|-------|-----------|-----|----------|-----|
///   | M1  | 100    | 100       | 0     | 0     | 100       | 0   | 0        | 100 |
///   | M2  | 150    | 0         | 150   | 100   | -50       | 0   | 150      | 100 |
///   | M3  | 0      | 0         | 0     | 0     | 0         | -50 | 100      | 100 |
///
/// A per-month sum would carry 100 into M3 and report Σ = 200 — it creates
/// money. The floor makes Σ = 100 in every month.
#[test]
fn rollover_off_carry_is_a_running_floor() {
    let mut db = fresh_db("pool_floor");
    let bucket = create_test_bucket(&mut db, "Food");
    let tag = create_test_tag(&mut db, "Groceries", &bucket);
    categories::set_rollover_enabled(&mut db, op(), &bucket, false).unwrap();

    budgets::set_allocation(&mut db, op(), &bucket, "2026-01", 100).unwrap();
    budgets::set_allocation(&mut db, op(), &bucket, "2026-02", 0).unwrap();
    seed_expense(&mut db, &fresh_account(&mut db), &tag, 150, "2026-02-10");
    budgets::set_allocation(&mut db, op(), &bucket, "2026-03", 0).unwrap();

    assert_eq!(budgets::get_rolled_over(&db, &bucket, "2026-01").unwrap(), 0);
    assert_eq!(budgets::get_rolled_over(&db, &bucket, "2026-02").unwrap(), 100);
    // Floor: max(0, max(0, 0 + 100) - 150) = 0, not the per-month sum -50.
    assert_eq!(budgets::get_rolled_over(&db, &bucket, "2026-03").unwrap(), 0);
}

/// Rollover ON keeps the full carry, negative included.
#[test]
fn rollover_on_carry_keeps_the_negative() {
    let mut db = fresh_db("pool_on");
    let bucket = create_test_bucket(&mut db, "Food");
    let tag = create_test_tag(&mut db, "Groceries", &bucket);

    budgets::set_allocation(&mut db, op(), &bucket, "2026-01", 100).unwrap();
    budgets::set_allocation(&mut db, op(), &bucket, "2026-02", 0).unwrap();
    seed_expense(&mut db, &fresh_account(&mut db), &tag, 150, "2026-02-10");

    assert_eq!(budgets::get_rolled_over(&db, &bucket, "2026-03").unwrap(), -50);
}

/// The gate is gone: `available` has one formula for every bucket.
#[test]
fn get_budgets_for_month_drops_the_enabled_gate() {
    let mut db = fresh_db("pool_gate");
    let bucket = create_test_bucket(&mut db, "Food");
    let tag = create_test_tag(&mut db, "Groceries", &bucket);
    categories::set_rollover_enabled(&mut db, op(), &bucket, false).unwrap();

    budgets::set_allocation(&mut db, op(), &bucket, "2026-01", 100).unwrap();
    budgets::set_allocation(&mut db, op(), &bucket, "2026-02", 100).unwrap();
    seed_expense(&mut db, &fresh_account(&mut db), &tag, 60, "2026-02-10");

    let summaries = budgets::get_budgets_for_month(&db, "2026-02").unwrap();
    let s = summaries.iter().find(|s| s.type_id == bucket).unwrap();
    // rolled_over carries the rollover-OFF floor (100 - 0 = 100), and
    // available = allocated + rolled_over - spent.
    assert_eq!(s.rolled_over, 100);
    assert_eq!(s.available, 140);
}
```

Replace the two browser tests in `src/tests/unit/budgets.test.ts` at `:127-146` and `:156-171`.

Replace the whole `it('available = allocated - spent (month-only) when rollover disabled', ...)` block with:

```typescript
	it('available = allocated + rolled_over - spent when rollover disabled', async () => {
		// Prior month surplus that a rollover-OFF bucket now carries as a floor.
		await repo.setAllocation(db, 'bucket_essentials', '2026-03', 1000000);
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await seedExpense(tagId, 400000, '2026-03-10'); // surplus 600,000

		await db.execute(
			`UPDATE category_types SET rollover_enabled = 0 WHERE id = 'bucket_essentials'`
		);

		// This month: allocated 1,000,000, spent 300,000.
		await repo.setAllocation(db, 'bucket_essentials', '2026-04', 1000000);
		await seedExpense(tagId, 300000, '2026-04-10');

		const budgets = await repo.getBudgetsForMonth(db, '2026-04');
		const b = budgets.find((x) => x.type_id === 'bucket_essentials')!;
		expect(b.rolled_over).toBe(600000); // the floor carries a positive surplus
		expect(b.available).toBe(1300000); // 1,000,000 + 600,000 - 300,000
	});
```

Replace the whole `it('ignores the rollover_enabled toggle ...', ...)` block with:

```typescript
	it('carries a running floor (not a per-month sum) when rollover is disabled', async () => {
		// Counterexample fixture — same numbers as the Rust
		// rollover_off_carry_is_a_running_floor test:
		//   M1 2026-01: income 100, allocated 100, spent 0    -> carry 0
		//   M2 2026-02: income 150, allocated 0,   spent 150  -> carry 100
		//   M3 2026-03: income 0,   allocated 0,   spent 0    -> carry 0 (floor)
		await repo.setAllocation(db, 'bucket_essentials', '2026-01', 100000);
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await repo.setAllocation(db, 'bucket_essentials', '2026-02', 0);
		await seedExpense(tagId, 150000, '2026-02-10');
		await repo.setAllocation(db, 'bucket_essentials', '2026-03', 0);

		await db.execute(
			`UPDATE category_types SET rollover_enabled = 0 WHERE id = 'bucket_essentials'`
		);

		expect(await repo.getRolledOver(db, 'bucket_essentials', '2026-01')).toBe(0);
		expect(await repo.getRolledOver(db, 'bucket_essentials', '2026-02')).toBe(100000);
		// Running floor: max(0, max(0, 0 + 100,000) - 150,000) = 0.
		// A per-month sum would return 100,000 - 150,000 = -50,000.
		expect(await repo.getRolledOver(db, 'bucket_essentials', '2026-03')).toBe(0);
	});

	it('keeps the full carry (negative included) when rollover is enabled', async () => {
		await repo.setAllocation(db, 'bucket_essentials', '2026-01', 100000);
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await repo.setAllocation(db, 'bucket_essentials', '2026-02', 0);
		await seedExpense(tagId, 150000, '2026-02-10');

		// Flag left at the default 1.
		expect(await repo.getRolledOver(db, 'bucket_essentials', '2026-03')).toBe(-50000);
	});
```

- [x] **Step 2: Run both and confirm they fail.**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test domain_categories_budgets rollover
pnpm vitest run src/tests/unit/budgets.test.ts
```

Expected failures:
- Rust: `rollover_off_carry_is_a_running_floor` fails with `assertion `left == right` failed` — `left: -50, right: 0` at the `"2026-03"` assertion (today sums without a floor).
- Rust: `get_budgets_for_month_drops_the_enabled_gate` fails — `left: 0, right: 100` for `s.rolled_over` (today's `enabled ? … : 0` gate).
- Vitest: the running-floor test fails with `expected -50000 to be 0`; the enabled test fails with `expected -50000 to be -50000`-style mismatch only if the flag branch is untouched (it currently returns full carry either way, so the disabled-path assertion is the one that goes red with `expected -50000 to be 0`).

- [x] **Step 3: Implement the Rust side.**

In `src-tauri/src/database/domains/budgets.rs`, replace `get_rolled_over` (`:82-103`) with:

```rust
/// Cumulative rollover for a bucket before `month`.
///
/// Rollover ON: sum of `allocated - spent` over every prior budgeted month,
/// negatives included. Rollover OFF: a running floor in chronological order,
/// `C_m = max(0, C_{m-1} + L_{m-1})`, so the carry never goes negative. Only
/// prior months with a budget row contribute (budget-row gating).
pub fn get_rolled_over(conn: &Connection, type_id: &str, month: &str) -> DbResult<i64> {
    let enabled: i32 = conn
        .query_row(
            "SELECT rollover_enabled FROM category_types WHERE id = ?1",
            params![type_id],
            |r| r.get(0),
        )
        .optional()
        .map_err(map_sqlite_error)?
        .unwrap_or(1);

    let mut stmt = conn
        .prepare(
            "SELECT month, allocated FROM budgets
             WHERE type_id = ?1 AND month < ?2 AND deleted_at IS NULL
             ORDER BY month",
        )
        .map_err(map_sqlite_error)?;
    let months: Vec<(String, i64)> = stmt
        .query_map(params![type_id, month], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(map_sqlite_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)?;

    let mut rolled = 0i64;
    for (m, allocated) in months {
        let spent = get_spent_for_bucket(conn, type_id, &m)?;
        rolled += allocated - spent;
        if enabled == 0 {
            rolled = rolled.max(0);
        }
    }
    Ok(rolled)
}
```

Then in `get_budgets_for_month`, delete the bulk flag-loading block (`:139-159`) and replace the per-bucket loop (`:161-185`) with:

```rust
    let mut result = Vec::new();
    for b in &budgets {
        let spent = get_spent_for_bucket(conn, &b.type_id, month)?;
        let rolled_over = get_rolled_over(conn, &b.type_id, month)?;
        let available = b.allocated + rolled_over - spent;
        result.push(BudgetSummary {
            type_id: b.type_id.clone(),
            month: b.month.clone(),
            allocated: b.allocated,
            spent,
            remaining: b.allocated - spent,
            rolled_over,
            available,
        });
    }
    Ok(result)
```

- [x] **Step 4: Implement the browser mirror.**

In `src/lib/db/browser/repos/budgets.ts`, replace `getRolledOver` (`:85-99`) with:

```typescript
/**
 * Cumulative rollover for a category before `month`.
 *
 * Rollover ON: sum of (allocated − spent) over every prior budgeted month,
 * negatives included. Rollover OFF: a running floor in chronological order
 * (`C ← max(0, C + L)`), so the carry never goes negative. Spending in months
 * with no budget row is ignored (budget-row gating, YNAB-style).
 */
export async function getRolledOver(db: DatabaseService, typeId: string, month: string): Promise<number> {
	const flag = await db.query<{ rollover_enabled: number }>(
		`SELECT rollover_enabled FROM category_types WHERE id = ?`,
		[typeId]
	);
	const enabled = (flag[0]?.rollover_enabled ?? 1) === 1;

	const months = await db.query<{ month: string; allocated: number }>(
		`SELECT month, allocated FROM budgets
		 WHERE type_id = ? AND month < ? AND deleted_at IS NULL
		 ORDER BY month`,
		[typeId, month]
	);

	let rolled = 0;
	for (const m of months) {
		const spent = await getSpentForBucket(db, typeId, m.month);
		rolled += m.allocated - spent;
		if (!enabled) rolled = Math.max(0, rolled);
	}
	return rolled;
}
```

Then in `getBudgetsForMonth`, delete the flag-resolution block (`:30-40`) and the `enabled` branch, replacing the loop body (`:42-56`) with:

```typescript
	const result: BudgetSummary[] = [];
	for (const b of budgets) {
		const spent = await getSpentForBucket(db, b.type_id, month);
		const rolled_over = await getRolledOver(db, b.type_id, month);
		result.push({
			type_id: b.type_id,
			month: b.month,
			allocated: b.allocated,
			spent,
			remaining: b.allocated - spent,
			rolled_over,
			available: b.allocated + rolled_over - spent
		});
	}
	return result;
```

Update the `BudgetSummary` doc comments at `:19-20` to drop “0 if rollover disabled” / the two-formula note.

- [x] **Step 5: Run and confirm pass.**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test domain_categories_budgets
pnpm vitest run src/tests/unit/budgets.test.ts
```

Expected: all green, including `baseline_full_carry_over_budgeted_months` — it must now be **inverted** by the reader's eye only (the rollover-ON default means it still reads −50; do not delete it — it is the ON-branch guard).

- [x] **Step 6: Commit.**

```bash
git add src-tauri/src/database/domains/budgets.rs src-tauri/tests/domain_categories_budgets.rs src/lib/db/browser/repos/budgets.ts src/tests/unit/budgets.test.ts
git commit -m "$(cat <<'EOF'
feat(budgets): running-floor carry and the flag-aware gate drop

get_rolled_over now reads category_types.rollover_enabled: rollover ON
keeps the full cumulative carry, rollover OFF folds a running floor
(C <- max(0, C + L)) in chronological month order. get_budgets_for_month
drops the enabled ? ... : 0 gate so available = allocated + rolled_over
- spent for every bucket. Both adapters change together on the spec's
counterexample fixture.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 3: `get_to_budget` in the Rust domain

The pool itself: a forward fold over consecutive calendar months. Rust only; the browser mirror is Task 4 with the identical fixture.

**Files:**
- Modify: `src-tauri/src/database/types.rs`
- Modify: `src-tauri/src/database/domains/budgets.rs`
- Test: `src-tauri/tests/domain_categories_budgets.rs`

**Interfaces:**
- Consumes: `get_rolled_over`, `get_spent_for_bucket`, `next_month`, `previous_month` (all in `budgets.rs`), `category_types.rollover_enabled`.
- Produces:
  - `pub struct ToBudgetBreakdown { income, carried_forward, last_month_overspent, assigned, to_budget, overassigned: i64 }` in `types.rs`.
  - `pub fn get_to_budget(conn: &Connection, month: &str) -> DbResult<ToBudgetBreakdown>` in `budgets.rs`.
  - Private helpers `month_income`, `month_assigned`, `last_month_overspent`, `pool_start_month`.

- [x] **Step 1: Write the failing tests.**

Append to `src-tauri/tests/domain_categories_budgets.rs`:

```rust
/// The pool formula, on the spec's counterexample fixture (rollover OFF):
///   toBudget = income + carried_forward + last_month_overspent - assigned.
///   |     | income | allocated | spent | carry | available | lmo | toBudget | Σ   |
///   |-----|--------|-----------|-------|-------|-----------|-----|----------|-----|
///   | M1  | 100    | 100       | 0     | 0     | 100       | 0   | 0        | 100 |
///   | M2  | 150    | 0         | 150   | 100   | -50       | 0   | 150      | 100 |
///   | M3  | 0      | 0         | 0     | 0     | 0         | -50 | 100      | 100 |
#[test]
fn to_budget_fold_conserves_on_the_counterexample() {
    let mut db = fresh_db("pool_fold");
    let account = fresh_account(&mut db);
    let bucket = create_test_bucket(&mut db, "Food");
    let tag = create_test_tag(&mut db, "Groceries", &bucket);
    categories::set_rollover_enabled(&mut db, op(), &bucket, false).unwrap();

    seed_income(&mut db, &account, 100, "2026-01-05");
    budgets::set_allocation(&mut db, op(), &bucket, "2026-01", 100).unwrap();
    seed_income(&mut db, &account, 150, "2026-02-05");
    budgets::set_allocation(&mut db, op(), &bucket, "2026-02", 0).unwrap();
    seed_expense(&mut db, &account, &tag, 150, "2026-02-10");
    budgets::set_allocation(&mut db, op(), &bucket, "2026-03", 0).unwrap();

    let m1 = budgets::get_to_budget(&db, "2026-01").unwrap();
    assert_eq!(m1.income, 100);
    assert_eq!(m1.assigned, 100);
    assert_eq!(m1.to_budget, 0);

    let m2 = budgets::get_to_budget(&db, "2026-02").unwrap();
    assert_eq!(m2.income, 150);
    assert_eq!(m2.carried_forward, 0);
    assert_eq!(m2.last_month_overspent, 0);
    assert_eq!(m2.to_budget, 150);

    let m3 = budgets::get_to_budget(&db, "2026-03").unwrap();
    assert_eq!(m3.income, 0);
    assert_eq!(m3.carried_forward, 150);
    assert_eq!(m3.last_month_overspent, -50);
    assert_eq!(m3.assigned, 0);
    assert_eq!(m3.to_budget, 100);
    assert_eq!(m3.overassigned, 0);

    // Σ bucket available + toBudget is 100 in every month.
    for (month, expected_available) in [("2026-01", 100), ("2026-02", -50), ("2026-03", 0)] {
        let s = budgets::get_budgets_for_month(&db, month).unwrap();
        let avail = s.iter().find(|s| s.type_id == bucket).unwrap().available;
        assert_eq!(avail, expected_available, "available {month}");
        let pool = budgets::get_to_budget(&db, month).unwrap();
        assert_eq!(avail + pool.to_budget, 100, "conservation {month}");
    }
}

/// An overassigned month reduces the NEXT month's pool; carried_forward is not
/// clamped to 0.
#[test]
fn to_budget_negative_pool_carries_without_a_clamp() {
    let mut db = fresh_db("pool_negative");
    let bucket = create_test_bucket(&mut db, "Food");

    // 2026-01: allocated 100, no income -> toBudget -100, overassigned 100.
    budgets::set_allocation(&mut db, op(), &bucket, "2026-01", 100).unwrap();
    let m1 = budgets::get_to_budget(&db, "2026-01").unwrap();
    assert_eq!(m1.to_budget, -100);
    assert_eq!(m1.overassigned, 100);

    // 2026-02: nothing new -> carries the -100, still overassigned.
    let m2 = budgets::get_to_budget(&db, "2026-02").unwrap();
    assert_eq!(m2.carried_forward, -100);
    assert_eq!(m2.to_budget, -100);
    assert_eq!(m2.overassigned, 100);
}

/// last_month_overspent counts only rollover-OFF buckets that have a prior-month
/// budgets row, using their prior-month `available`.
#[test]
fn to_budget_claws_back_only_rollover_off_buckets() {
    let mut db = fresh_db("pool_lmo");
    let account = fresh_account(&mut db);

    let off = create_test_bucket(&mut db, "Off");
    let off_tag = create_test_tag(&mut db, "OffTag", &off);
    categories::set_rollover_enabled(&mut db, op(), &off, false).unwrap();
    budgets::set_allocation(&mut db, op(), &off, "2026-01", 100).unwrap();
    seed_expense(&mut db, &account, &off_tag, 300, "2026-01-15"); // available -200

    let on = create_test_bucket(&mut db, "On");
    let on_tag = create_test_tag(&mut db, "OnTag", &on);
    budgets::set_allocation(&mut db, op(), &on, "2026-01", 100).unwrap();
    seed_expense(&mut db, &account, &on_tag, 300, "2026-01-15"); // available -200

    // Only the rollover-OFF bucket's -200 is clawed back, not -400.
    let m2 = budgets::get_to_budget(&db, "2026-02").unwrap();
    assert_eq!(m2.last_month_overspent, -200);
}

/// No data -> all zeros.
#[test]
fn to_budget_empty_month_is_zero() {
    let db = fresh_db("pool_empty");
    let b = budgets::get_to_budget(&db, "2026-05").unwrap();
    assert_eq!(b.income, 0);
    assert_eq!(b.carried_forward, 0);
    assert_eq!(b.last_month_overspent, 0);
    assert_eq!(b.assigned, 0);
    assert_eq!(b.to_budget, 0);
    assert_eq!(b.overassigned, 0);
}

/// Spending in a month that has no `budgets` row is ignored — the carry gate
/// is the budget row, and the new fold must not start counting unbudgeted
/// activity (doing so would shift every existing user's numbers silently).
#[test]
fn unbudgeted_month_spending_is_ignored() {
    let mut db = fresh_db("pool_unbudgeted");
    let account = fresh_account(&mut db);
    let bucket = create_test_bucket(&mut db, "Food");
    let tag = create_test_tag(&mut db, "Groceries", &bucket);
    categories::set_rollover_enabled(&mut db, op(), &bucket, false).unwrap();

    // 2026-01 funds the bucket; the 150 spent in 2026-02 has no budget row.
    seed_income(&mut db, &account, 100, "2026-01-05");
    budgets::set_allocation(&mut db, op(), &bucket, "2026-01", 100).unwrap();
    seed_expense(&mut db, &account, &tag, 150, "2026-02-10");

    // The carry into 2026-03 is the January surplus (100), untouched by the
    // unbudgeted February spend; nothing is clawed back.
    assert_eq!(budgets::get_rolled_over(&db, &bucket, "2026-03").unwrap(), 100);

    let m3 = budgets::get_to_budget(&db, "2026-03").unwrap();
    assert_eq!(m3.last_month_overspent, 0);
    assert_eq!(m3.carried_forward, 0);
    assert_eq!(m3.to_budget, 0);
}

/// The pool starts at the earliest of (first `budgets` row, first income month):
/// income dated before the first budget row still funds the pool.
#[test]
fn pool_start_month_includes_earlier_income() {
    let mut db = fresh_db("pool_start");
    let account = fresh_account(&mut db);
    let bucket = create_test_bucket(&mut db, "Food");

    // Income in 2025-12, first budget row in 2026-01, requested 2026-01.
    seed_income(&mut db, &account, 100, "2025-12-05");
    budgets::set_allocation(&mut db, op(), &bucket, "2026-01", 40).unwrap();

    let m = budgets::get_to_budget(&db, "2026-01").unwrap();
    assert_eq!(m.income, 0); // no income *in* January
    assert_eq!(m.carried_forward, 100); // December's income carried forward
    assert_eq!(m.assigned, 40);
    assert_eq!(m.to_budget, 60);
}
```

- [x] **Step 2: Run and confirm they fail.**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test domain_categories_budgets to_budget
```

Expected failure:

```
error[E0425]: cannot find function `get_to_budget` in module `budgets`
error[E0433]: failed to resolve: could not find `ToBudgetBreakdown` in `types`
```

- [x] **Step 3: Add the DTO.**

In `src-tauri/src/database/types.rs`, after `BudgetSummary` (`:434`), add:

```rust
/// The month's To Budget pool, as a breakdown the UI can itemise.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, TS)]
pub struct ToBudgetBreakdown {
    /// Σ income transactions in the month (`kind = 'income'`, no account filter).
    pub income: i64,
    /// The prior month's `to_budget`, sign preserved (no `max(0, …)` clamp).
    pub carried_forward: i64,
    /// Σ min(0, prior-month available) over rollover-OFF budgeted buckets (≤ 0).
    pub last_month_overspent: i64,
    /// The month's allocations, as a positive count.
    pub assigned: i64,
    /// income + carried_forward + last_month_overspent − assigned.
    pub to_budget: i64,
    /// max(0, −to_budget).
    pub overassigned: i64,
}
```

In `src-tauri/src/database/domains/budgets.rs`, extend the `types` import:

```rust
use crate::database::types::{Budget, BudgetSummary, OperationId, ToBudgetBreakdown};
```

- [x] **Step 4: Add the domain function and its helpers.**

In `src-tauri/src/database/domains/budgets.rs`, add after `get_budgets_for_month`:

```rust
// ---------------------------------------------------------------------------
// To Budget pool
// ---------------------------------------------------------------------------

/// Σ `kind = 'income'` transactions in `month`. No account predicate: Notchy
/// has no per-account budgeting classification, so every account's income counts.
fn month_income(conn: &Connection, month: &str) -> DbResult<i64> {
    let next = next_month(month)?;
    conn.query_row(
        "SELECT COALESCE(SUM(amount), 0) FROM transactions
         WHERE kind = 'income'
           AND date >= ?1 || '-01' AND date < ?2 || '-01'
           AND deleted_at IS NULL",
        params![month, next],
        |r| r.get(0),
    )
    .map_err(map_sqlite_error)
}

/// Σ allocations across every bucket in `month`, as a positive count.
fn month_assigned(conn: &Connection, month: &str) -> DbResult<i64> {
    conn.query_row(
        "SELECT COALESCE(SUM(allocated), 0) FROM budgets
         WHERE month = ?1 AND deleted_at IS NULL",
        params![month],
        |r| r.get(0),
    )
    .map_err(map_sqlite_error)
}

/// `Σ min(0, available_{M-1})` over rollover-OFF buckets that have a budgets
/// row in `M-1`. "Leftover" is the bucket's prior-month `available`
/// (`allocated + carry − spent`), not its activity. Rollover-ON buckets are
/// excluded: they keep their negatives in-category.
fn last_month_overspent(conn: &Connection, month: &str) -> DbResult<i64> {
    let prev = previous_month(month)?;
    let mut stmt = conn
        .prepare(
            "SELECT b.type_id, b.allocated FROM budgets b
             JOIN category_types ct ON ct.id = b.type_id
             WHERE b.month = ?1 AND b.deleted_at IS NULL AND ct.rollover_enabled = 0",
        )
        .map_err(map_sqlite_error)?;
    let rows: Vec<(String, i64)> = stmt
        .query_map(params![prev], |row| Ok((row.get(0)?, row.get(1)?)))
        .map_err(map_sqlite_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)?;

    let mut total = 0i64;
    for (type_id, allocated) in rows {
        let carry = get_rolled_over(conn, &type_id, &prev)?;
        let spent = get_spent_for_bucket(conn, &type_id, &prev)?;
        total += (allocated + carry - spent).min(0);
    }
    Ok(total)
}

/// The earliest month with a budgets row or an income transaction, or `None`.
fn pool_start_month(conn: &Connection) -> DbResult<Option<String>> {
    let min_budget: Option<String> = conn
        .query_row(
            "SELECT MIN(month) FROM budgets WHERE deleted_at IS NULL",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(map_sqlite_error)?
        .flatten();
    let min_income: Option<String> = conn
        .query_row(
            "SELECT MIN(substr(date, 1, 7)) FROM transactions
             WHERE kind = 'income' AND deleted_at IS NULL",
            [],
            |r| r.get(0),
        )
        .optional()
        .map_err(map_sqlite_error)?
        .flatten();
    Ok(match (min_budget, min_income) {
        (Some(a), Some(b)) => Some(a.min(b)),
        (Some(a), None) => Some(a),
        (None, Some(b)) => Some(b),
        (None, None) => None,
    })
}

/// Compute the month's To Budget pool.
///
/// A forward fold: start at the earliest budgeted-or-income month and walk
/// every intervening calendar month up to `month`, so a month with no row
/// still applies a rollover-off bucket's clawback and advances the carry.
/// Bounded start + fixed target ⇒ it terminates.
pub fn get_to_budget(conn: &Connection, month: &str) -> DbResult<ToBudgetBreakdown> {
    parse_month(month)?;

    let zero = ToBudgetBreakdown {
        income: 0,
        carried_forward: 0,
        last_month_overspent: 0,
        assigned: 0,
        to_budget: 0,
        overassigned: 0,
    };

    let start = match pool_start_month(conn)? {
        Some(start) if start.as_str() <= month => start,
        _ => return Ok(zero),
    };

    let mut carried = 0i64;
    let mut result = zero;
    let mut cur = start;
    loop {
        let income = month_income(conn, &cur)?;
        let assigned = month_assigned(conn, &cur)?;
        let lmo = last_month_overspent(conn, &cur)?;
        let to_budget = income + carried + lmo - assigned;
        result = ToBudgetBreakdown {
            income,
            carried_forward: carried,
            last_month_overspent: lmo,
            assigned,
            to_budget,
            overassigned: (-to_budget).max(0),
        };
        carried = to_budget;
        if cur == month {
            break;
        }
        cur = next_month(&cur)?;
    }
    Ok(result)
}
```

Note: `query_row(...).optional()` yields `Option<Option<String>>` — the extra `.flatten()` collapses “no row” and “row with NULL” to `None`.

- [x] **Step 5: Run and confirm pass.**

```bash
cargo test --manifest-path src-tauri/Cargo.toml --test domain_categories_budgets
```

Expected: all green.

- [x] **Step 6: Commit.**

```bash
git add src-tauri/src/database/types.rs src-tauri/src/database/domains/budgets.rs src-tauri/tests/domain_categories_budgets.rs
git commit -m "$(cat <<'EOF'
feat(budgets): add the Rust get_to_budget pool fold

ToBudgetBreakdown DTO and domains::budgets::get_to_budget: a forward
fold from the earliest budgeted-or-income month over every intervening
calendar month, with an unclamped carried_forward and a rollover-off
last_month_overspent clawback. Covered by the counterexample conservation
test, the negative-pool carry test, the lmo bucket-set test, the
unbudgeted-month gate test and the pool start-month test.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 4: Mirror `getToBudget` in the browser adapter

The same fixture table, the same numbers, in TypeScript.

**Files:**
- Modify: `src/lib/db/browser/repos/budgets.ts`
- Modify: `src/lib/db/repos/budgets.ts`
- Test: `src/tests/unit/budgets.test.ts`

**Interfaces:**
- Consumes: `getRolledOver`, `getSpentForBucket`, `nextMonth`, `previousMonth` (already in the same file).
- Produces:
  - `export interface ToBudgetBreakdown { income, carried_forward, last_month_overspent, assigned, to_budget, overassigned: number }`
  - `export async function getToBudget(db: DatabaseService, month: string): Promise<ToBudgetBreakdown>`
  - Both re-exported from `src/lib/db/repos/budgets.ts`.

- [x] **Step 1: Write the failing tests.**

Append to `src/tests/unit/budgets.test.ts`:

```typescript
describe('getToBudget', () => {
	it('conserves on the counterexample fixture (rollover off)', async () => {
		// Same table as the Rust to_budget_fold_conserves_on_the_counterexample:
		//   M1 2026-01: income 100, allocated 100, spent 0    toBudget 0
		//   M2 2026-02: income 150, allocated 0,   spent 150  toBudget 150
		//   M3 2026-03: income 0,   allocated 0,   spent 0    toBudget 100
		const tagId = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await db.execute(
			`UPDATE category_types SET rollover_enabled = 0 WHERE id = 'bucket_essentials'`
		);
		await seedIncome(100000, '2026-01-05');
		await repo.setAllocation(db, 'bucket_essentials', '2026-01', 100000);
		await seedIncome(150000, '2026-02-05');
		await repo.setAllocation(db, 'bucket_essentials', '2026-02', 0);
		await seedExpense(tagId, 150000, '2026-02-10');
		await repo.setAllocation(db, 'bucket_essentials', '2026-03', 0);

		const m1 = await repo.getToBudget(db, '2026-01');
		expect(m1).toEqual({
			income: 100000, carried_forward: 0, last_month_overspent: 0,
			assigned: 100000, to_budget: 0, overassigned: 0
		});

		const m2 = await repo.getToBudget(db, '2026-02');
		expect(m2.income).toBe(150000);
		expect(m2.carried_forward).toBe(0);
		expect(m2.last_month_overspent).toBe(0);
		expect(m2.to_budget).toBe(150000);

		const m3 = await repo.getToBudget(db, '2026-03');
		expect(m3.income).toBe(0);
		expect(m3.carried_forward).toBe(150000);
		expect(m3.last_month_overspent).toBe(-50000);
		expect(m3.assigned).toBe(0);
		expect(m3.to_budget).toBe(100000);
		expect(m3.overassigned).toBe(0);

		// Σ available + toBudget is 100,000 in every month.
		for (const [month, expectedAvailable] of [
			['2026-01', 100000], ['2026-02', -50000], ['2026-03', 0]
		] as const) {
			const b = (await repo.getBudgetsForMonth(db, month))
				.find((x) => x.type_id === 'bucket_essentials')!;
			expect(b.available).toBe(expectedAvailable);
			expect(b.available + (await repo.getToBudget(db, month)).to_budget).toBe(100000);
		}
	});

	it('carries a negative pool into the next month without clamping', async () => {
		await repo.setAllocation(db, 'bucket_essentials', '2026-01', 100000);
		const m1 = await repo.getToBudget(db, '2026-01');
		expect(m1.to_budget).toBe(-100000);
		expect(m1.overassigned).toBe(100000);

		const m2 = await repo.getToBudget(db, '2026-02');
		expect(m2.carried_forward).toBe(-100000);
		expect(m2.to_budget).toBe(-100000);
		expect(m2.overassigned).toBe(100000);
	});

	it('claws back only rollover-off buckets with a prior-month row', async () => {
		// bucket_essentials: rollover OFF, overspent by 200,000 in 2026-01.
		const aTag = await catRepo.createTag(db, 'Food', 'bucket_essentials');
		await db.execute(
			`UPDATE category_types SET rollover_enabled = 0 WHERE id = 'bucket_essentials'`
		);
		await repo.setAllocation(db, 'bucket_essentials', '2026-01', 100000);
		await seedExpense(aTag, 300000, '2026-01-15');

		// bucket_learning: rollover ON (default), overspent by 200,000 in 2026-01.
		const bTag = await catRepo.createTag(db, 'Books', 'bucket_learning');
		await repo.setAllocation(db, 'bucket_learning', '2026-01', 100000);
		await seedExpense(bTag, 300000, '2026-01-15');

		const m2 = await repo.getToBudget(db, '2026-02');
		expect(m2.last_month_overspent).toBe(-200000);
	});

	it('returns zeros for an empty ledger', async () => {
		expect(await repo.getToBudget(db, '2026-05')).toEqual({
			income: 0, carried_forward: 0, last_month_overspent: 0,
			assigned: 0, to_budget: 0, overassigned: 0
		});
	});
});
```

Add a `seedIncome` helper next to `seedExpense` at the top of the same file:

```typescript
async function seedIncome(amount: number, date: string) {
	const { ulid } = await import('$lib/utils/id');
	await db.execute(
		`INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, created_at, updated_at)
		 VALUES (?, 'income', ?, ?, 'acc1', NULL, ?, ?)`,
		[ulid(), date, amount, NOW, NOW]
	);
}
```

- [x] **Step 2: Run and confirm they fail.**

```bash
pnpm vitest run src/tests/unit/budgets.test.ts
```

Expected failure:

```
TypeError: repo.getToBudget is not a function
```

- [x] **Step 3: Implement the browser mirror.**

In `src/lib/db/browser/repos/budgets.ts`, after `getRolledOver`, add:

```typescript
export interface ToBudgetBreakdown {
	income: number;
	carried_forward: number;
	last_month_overspent: number;
	assigned: number;
	to_budget: number;
	overassigned: number;
}

/** Σ `kind = 'income'` transactions in `month` (no account predicate). */
async function monthIncome(db: DatabaseService, month: string): Promise<number> {
	const rows = await db.query<{ total: number | null }>(
		`SELECT COALESCE(SUM(amount), 0) AS total FROM transactions
		 WHERE kind = 'income' AND date >= ? || '-01' AND date < ? || '-01'
		   AND deleted_at IS NULL`,
		[month, nextMonth(month)]
	);
	return rows[0]?.total ?? 0;
}

/** Σ allocations across every bucket in `month`, as a positive count. */
async function monthAssigned(db: DatabaseService, month: string): Promise<number> {
	const rows = await db.query<{ total: number | null }>(
		`SELECT COALESCE(SUM(allocated), 0) AS total FROM budgets
		 WHERE month = ? AND deleted_at IS NULL`,
		[month]
	);
	return rows[0]?.total ?? 0;
}

/**
 * Σ min(0, available_{M−1}) over rollover-OFF buckets that have a budgets row
 * in `M−1`. Rollover-ON buckets keep their negatives in-category.
 */
async function lastMonthOverspent(db: DatabaseService, month: string): Promise<number> {
	const prev = previousMonth(month);
	const rows = await db.query<{ type_id: string; allocated: number }>(
		`SELECT b.type_id AS type_id, b.allocated AS allocated FROM budgets b
		 JOIN category_types ct ON ct.id = b.type_id
		 WHERE b.month = ? AND b.deleted_at IS NULL AND ct.rollover_enabled = 0`,
		[prev]
	);
	let total = 0;
	for (const b of rows) {
		const carry = await getRolledOver(db, b.type_id, prev);
		const spent = await getSpentForBucket(db, b.type_id, prev);
		total += Math.min(0, b.allocated + carry - spent);
	}
	return total;
}

/** The earliest month with a budgets row or an income transaction. */
async function poolStartMonth(db: DatabaseService): Promise<string | null> {
	const rows = await db.query<{ m: string | null }>(
		`SELECT MIN(m) AS m FROM (
		   SELECT MIN(month) AS m FROM budgets WHERE deleted_at IS NULL
		   UNION ALL
		   SELECT MIN(substr(date, 1, 7)) AS m FROM transactions
		     WHERE kind = 'income' AND deleted_at IS NULL
		 )`
	);
	return rows[0]?.m ?? null;
}

/**
 * The month's To Budget pool: a forward fold from the earliest
 * budgeted-or-income month over every intervening calendar month.
 */
export async function getToBudget(db: DatabaseService, month: string): Promise<ToBudgetBreakdown> {
	const zero: ToBudgetBreakdown = {
		income: 0, carried_forward: 0, last_month_overspent: 0,
		assigned: 0, to_budget: 0, overassigned: 0
	};
	const start = await poolStartMonth(db);
	if (start === null || start > month) return zero;

	let carried = 0;
	let result = zero;
	let cur = start;
	for (;;) {
		const income = await monthIncome(db, cur);
		const assigned = await monthAssigned(db, cur);
		const lmo = await lastMonthOverspent(db, cur);
		const to_budget = income + carried + lmo - assigned;
		result = {
			income, carried_forward: carried, last_month_overspent: lmo,
			assigned, to_budget, overassigned: Math.max(0, -to_budget)
		};
		carried = to_budget;
		if (cur === month) break;
		cur = nextMonth(cur);
	}
	return result;
}
```

In `src/lib/db/repos/budgets.ts`, add the new names to the re-export list:

```typescript
export {
	type Budget,
	type BudgetSummary,
	type ToBudgetBreakdown,
	getBudgetsForMonth,
	getSpentForBucket,
	getRolledOver,
	getToBudget,
	setAllocation,
	copyFromPreviousMonth,
	hasAllocations
} from '../browser/repos/budgets';
```

- [x] **Step 4: Run and confirm pass.**

```bash
pnpm vitest run src/tests/unit/budgets.test.ts
```

Expected: all green.

- [x] **Step 5: Commit.**

```bash
git add src/lib/db/browser/repos/budgets.ts src/lib/db/repos/budgets.ts src/tests/unit/budgets.test.ts
git commit -m "$(cat <<'EOF'
feat(budgets): mirror get_to_budget in the browser adapter

getToBudget implements the same forward fold and the same counterexample
fixture as the Rust domain: monthIncome, monthAssigned,
lastMonthOverspent and poolStartMonth helpers plus the chained
to_budget = income + carried_forward + lmo - assigned.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 5: Wire `budget_get_to_budget` across the port

One task, all four sides plus the port declaration and the browser client — otherwise the native-boundary suite leaves nothing red.

**Files:**
- Modify: `src/lib/db/client.ts`
- Modify: `src/lib/db/browser/client.ts`
- Modify: `src/lib/db/native/client.ts`
- Modify: `src-tauri/src/database/commands.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/native/contracts.generated.ts` (regenerated, not hand-edited)
- Modify: `src/tests/e2e/fixtures/tauri-mock.ts`
- Test: `src/tests/unit/native-boundary.test.ts`

**Interfaces:**
- Consumes: `getToBudget` (browser repo, Task 4), `ToBudgetBreakdown` (Task 3/4), `budgetsRepo` / `invoke`.
- Produces:
  - `BudgetOps.getToBudget(month: string): Promise<ToBudgetBreakdown>` in `src/lib/db/client.ts`, with `ToBudgetBreakdown` re-exported.
  - `BrowserBudgetOps.getToBudget` delegating to `budgetsRepo.getToBudget`.
  - `NativeBudgetOps.getToBudget(month)` → `invoke('budget_get_to_budget', { month })`.
  - Rust command `budget_get_to_budget`, registered in `generate_handler!`.

- [x] **Step 1: Write the failing test.**

In `src/tests/unit/native-boundary.test.ts`, add a FIXTURES entry beside `budget_get_rolled_over` (`:95`):

```typescript
		budget_get_to_budget: { income: 0, carried_forward: 0, last_month_overspent: 0,
			assigned: 0, to_budget: 0, overassigned: 0 },
```

and a sweep row beside `budgets.getRolledOver` (`:473`):

```typescript
		{ label: 'budgets.getToBudget', run: () => client.budgets.getToBudget('2026-01'), command: 'budget_get_to_budget' },
```

- [x] **Step 2: Run and confirm it fails.**

```bash
pnpm vitest run src/tests/unit/native-boundary.test.ts
```

Expected failure (the sweep row calls a method that does not exist on the port yet):

```
TypeError: client.budgets.getToBudget is not a function
```

- [x] **Step 3: Declare the port method and re-export the type.**

In `src/lib/db/client.ts`, change the budget type import/export (`:26`, `:59`) to include the new type:

```typescript
import type { BudgetSummary, ToBudgetBreakdown } from './browser/repos/budgets';
```
```typescript
export type { BudgetSummary, ToBudgetBreakdown } from './browser/repos/budgets';
```

and add the method to `BudgetOps` (`:160-167`):

```typescript
export interface BudgetOps {
	getForMonth(month: string): Promise<BudgetSummary[]>;
	getSpentForBucket(typeId: string, month: string): Promise<number>;
	getRolledOver(typeId: string, month: string): Promise<number>;
	getToBudget(month: string): Promise<ToBudgetBreakdown>;
	setAllocation(typeId: string, month: string, allocated: number): Promise<void>;
	copyFromPreviousMonth(targetMonth: string): Promise<void>;
	hasAllocations(month: string): Promise<boolean>;
}
```

- [x] **Step 4: Implement the browser and native adapters.**

In `src/lib/db/browser/client.ts`, add `ToBudgetBreakdown` to the budgets type import (line 26) so it reads:

```typescript
import type { BudgetSummary, ToBudgetBreakdown } from './repos/budgets';
```

then add the method to `BrowserBudgetOps` (`:198-224`), after `getRolledOver` (`:209-211`):

```typescript
	getToBudget(month: string): Promise<ToBudgetBreakdown> {
		return budgetsRepo.getToBudget(this.db, month);
	}
```

In `src/lib/db/native/client.ts`, add `ToBudgetBreakdown` to the `../client` type import (`:28`) and add to `NativeBudgetOps` (`:239-263`), after `getRolledOver`:

```typescript
	getToBudget(month: string): Promise<ToBudgetBreakdown> {
		return invoke<ToBudgetBreakdown>('budget_get_to_budget', { month });
	}
```

- [x] **Step 5: Add the Rust command and register it.**

In `src-tauri/src/database/commands.rs`, after `budget_get_rolled_over` (`:477`), add:

```rust
#[tauri::command]
pub async fn budget_get_to_budget(
    manager: State<'_, Arc<DatabaseManager>>,
    month: String,
) -> Result<ToBudgetBreakdown, DbError> {
    manager.data_job(move |state| {
        domains::budgets::get_to_budget(state.connection()?, &month)
    }).await
}
```

In `budget_get_rolled_over`'s neighbourhood, add to `generate_bindings()` after `BudgetSummary` (`:1127`):

```rust
    push_decl(&mut out, ToBudgetBreakdown::decl(&cfg));
```

In `src-tauri/src/lib.rs`, add the command to `generate_handler!` after `budget_get_rolled_over` (`:94`):

```rust
            budget_get_to_budget,
```

Regenerate the committed bindings:

```bash
pnpm generate:db-contracts
```

- [x] **Step 6: Add the tauri-mock handler.**

In `src/tests/e2e/fixtures/tauri-mock.ts`, after the `budget_get_rolled_over` handler (`:850-852`), add:

```typescript
		if (cmd === 'budget_get_to_budget') {
			// Test double: the pool's behaviour is proven by the browser-adapter
			// E2E and the unit/Rust fixtures, not by this stub.
			return { income: 0, carried_forward: 0, last_month_overspent: 0, assigned: 0, to_budget: 0, overassigned: 0 };
		}
```

- [x] **Step 7: Run and confirm pass.**

```bash
pnpm vitest run src/tests/unit/native-boundary.test.ts src/tests/unit/rust-command-surface.test.ts
pnpm check:db-contracts
```

Expected: green, and `bindings are current`.

- [x] **Step 8: Commit.**

```bash
git add src/lib/db/client.ts src/lib/db/browser/client.ts src/lib/db/native/client.ts src-tauri/src/database/commands.rs src-tauri/src/lib.rs src/lib/native/contracts.generated.ts src/tests/e2e/fixtures/tauri-mock.ts src/tests/unit/native-boundary.test.ts
git commit -m "$(cat <<'EOF'
feat(budgets): wire budget_get_to_budget across the port

All four native-boundary sides land together: BudgetOps.getToBudget and
the ToBudgetBreakdown re-export, BrowserBudgetOps and NativeBudgetOps
implementations, the Rust budget_get_to_budget command registered in
generate_handler!, the regenerated ts-rs bindings, the tauri-mock
handler and the native-boundary sweep row.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 6: Show the To Budget pool card

Retire the `loadMonthIncome()` approximation; read the pool through `BudgetsStore`; drive the over-allocation warning from `overassigned`.

**Files:**
- Modify: `src/lib/stores/budgets.svelte.ts`
- Modify: `src/routes/budgets/+page.svelte`
- Modify: `messages/en.json`
- Modify: `messages/vi.json`
- Test: `src/tests/unit/budgets-store.test.ts` (create)

**Interfaces:**
- Consumes: `db.budgets.getToBudget` (Task 5), `ToBudgetBreakdown` from `$lib/db/client`.
- Produces: `BudgetsStore.toBudget: ToBudgetBreakdown | null` (a `$state` field set in `load()`).

- [x] **Step 1: Write the failing test — create `src/tests/unit/budgets-store.test.ts`.**

```typescript
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('$lib/db', () => ({ getDb: vi.fn() }));
vi.mock('$lib/utils/errors', () => ({ mapError: vi.fn(() => 'Something went wrong') }));

import { getDb } from '$lib/db';
import { budgets } from '$lib/stores/budgets.svelte';

const POOL = {
	income: 500000, carried_forward: 0, last_month_overspent: -200000,
	assigned: 100000, to_budget: 200000, overassigned: 0
};

describe('BudgetsStore.load', () => {
	beforeEach(() => vi.clearAllMocks());

	it('populates toBudget from db.budgets.getToBudget alongside items', async () => {
		const db = {
			budgets: {
				getForMonth: vi.fn().mockResolvedValue([]),
				getToBudget: vi.fn().mockResolvedValue(POOL),
				hasAllocations: vi.fn().mockResolvedValue(false)
			}
		};
		(getDb as ReturnType<typeof vi.fn>).mockReturnValue(db);

		await budgets.load('2026-08');

		expect(db.budgets.getToBudget).toHaveBeenCalledWith('2026-08');
		expect(budgets.toBudget).toEqual(POOL);
	});
});
```

- [x] **Step 2: Run and confirm it fails.**

```bash
pnpm vitest run src/tests/unit/budgets-store.test.ts
```

Expected failure:

```
AssertionError: expected undefined to deeply equal { income: 500000, ... }
```

- [x] **Step 3: Implement the store field.**

In `src/lib/stores/budgets.svelte.ts`:

```typescript
import type { BudgetSummary, ToBudgetBreakdown } from '$lib/db/client';
```
```typescript
class BudgetsStore {
	items = $state<BudgetSummary[]>([]);
	toBudget = $state<ToBudgetBreakdown | null>(null);
	month = $state(monthKey(new Date()));
	loading = $state(false);
	error = $state<string | null>(null);
	hasAllocations = $state(false);

	async load(month?: string): Promise<void> {
		if (month) this.month = month;
		this.loading = true;
		this.error = null;
		try {
			const db = getDb();
			this.items = await db.budgets.getForMonth(this.month);
			this.toBudget = await db.budgets.getToBudget(this.month);
			this.hasAllocations = await db.budgets.hasAllocations(this.month);
		} catch (e) {
			this.error = mapError(e);
		} finally {
			this.loading = false;
		}
	}
```

(Keep `setAllocation` and `copyFromPrevious` unchanged; both already re-`load()`.)

- [x] **Step 4: Implement the card and the warning in the page.**

In `src/routes/budgets/+page.svelte`:

1. Delete the `monthIncome` state (`:22`) and the whole `loadMonthIncome` function (`:26-40`); drop the `await loadMonthIncome();` line in `onMount` (`:45`) and the stale comment above the `$effect` (`:48-51` reword: it now only re-checks previous-month allocations).
2. Replace the derived block (`:54-60`) with:

```typescript
	let totalAllocated = $derived(budgets.items.reduce((s, b) => s + b.allocated, 0));
	let totalSpent = $derived(budgets.items.reduce((s, b) => s + b.spent, 0));
	let totalAvailable = $derived(budgets.items.reduce((s, b) => s + (b.available ?? b.allocated - b.spent), 0));
	let pool = $derived(budgets.toBudget);
	let remainingToAllocate = $derived(Math.max(0, pool?.to_budget ?? 0));
```

3. Replace the `overAmount > 0` warning block (`:223-231`) with an `overassigned`-driven one:

```svelte
	{#if pool && pool.overassigned > 0}
		<div class="bg-debit/10 border border-debit/30 rounded-lg p-3">
			<p class="text-sm text-debit">{m.budgets_over_allocated({ amount: formatCurrency(pool.overassigned, settings.currency, settings.locale) })}</p>
		</div>
	{/if}
```

4. In the summary surface, use `pool?.income` for the income figure (`:244`) and `pool` for the remaining/available footer guard (`:255`):

```svelte
					<p class="figures-glow text-lg text-ledger">{formatCurrency(pool?.income ?? 0, settings.currency, settings.locale)}</p>
```
```svelte
			{#if pool}
```

5. Insert the To Budget card immediately after the summary surface's closing `</div>` (`:261`):

```svelte
		<div class="surface rounded-lg p-4" data-testid="to-budget">
			<div class="flex items-center justify-between">
				<p class="plate">{m.budgets_to_budget()}</p>
				<p class="figures-glow text-lg {(pool?.to_budget ?? 0) < 0 ? 'text-debit' : 'text-ledger'}">{formatCurrency(pool?.to_budget ?? 0, settings.currency, settings.locale)}</p>
			</div>
			<div class="mt-2 pt-2 border-t border-line flex flex-wrap gap-x-4 justify-between text-xs text-dim">
				<span>{m.budgets_pool_income()}: <span class="figures">{formatCurrency(pool?.income ?? 0, settings.currency, settings.locale)}</span></span>
				<span>{m.budgets_pool_assigned()}: <span class="figures">{formatCurrency(pool?.assigned ?? 0, settings.currency, settings.locale)}</span></span>
				<span>{m.budgets_pool_overspent()}: <span class="figures">{formatCurrency(pool?.last_month_overspent ?? 0, settings.currency, settings.locale)}</span></span>
			</div>
			{#if pool && pool.overassigned > 0}
				<p class="mt-1 text-xs text-debit">{m.budgets_overassigned({ amount: formatCurrency(pool.overassigned, settings.currency, settings.locale) })}</p>
			{/if}
		</div>
```

The `data-testid="to-budget"` hook exists because the card's four figures are localised and share their labels with the summary surface — a role/text locator would be ambiguous. Playwright's default `testIdAttribute` is `data-testid` (no `playwright.config` override), and `ContextMenu.svelte:57` already ships one.

- [x] **Step 5: Add the i18n keys to both locales.**

Append to `messages/en.json` (alongside the other `budgets_*` keys near `:50-63`):

```json
  "budgets_to_budget": "To Budget",
  "budgets_pool_income": "Income",
  "budgets_pool_assigned": "Assigned",
  "budgets_pool_overspent": "Overspent",
  "budgets_overassigned": "Overassigned by {amount}",
```

Append to `messages/vi.json` (same keys; translated):

```json
  "budgets_to_budget": "Cần phân bổ",
  "budgets_pool_income": "Thu nhập",
  "budgets_pool_assigned": "Đã phân bổ",
  "budgets_pool_overspent": "Chi vượt",
  "budgets_overassigned": "Phân bổ vượt {amount}",
```

Then regenerate Paraglide:

```bash
pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide
```

- [x] **Step 6: Run and confirm pass.**

```bash
pnpm vitest run src/tests/unit/budgets-store.test.ts src/tests/unit/i18n-messages.test.ts
pnpm check
```

Expected: green (the i18n test asserts en/vi key parity).

- [x] **Step 7: Commit.**

```bash
git add src/lib/stores/budgets.svelte.ts src/routes/budgets/+page.svelte messages/en.json messages/vi.json src/tests/unit/budgets-store.test.ts
git commit -m "$(cat <<'EOF'
feat(budgets): show the To Budget pool card

BudgetsStore gains a toBudget field populated in load(), the budget page
renders a To Budget card (income / assigned / overspent / toBudget) and
drives the over-allocation warning from overassigned, retiring the local
loadMonthIncome approximation.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```

---

### Task 7: Per-bucket rollover toggle

The control that makes the flag reachable; an E2E that flips it and watches the numbers move.

**Files:**
- Modify: `src/lib/stores/categories.svelte.ts`
- Modify: `src/routes/budgets/+page.svelte`
- Modify: `messages/en.json`
- Modify: `messages/vi.json`
- Test: `src/tests/e2e/budgets-rollover.spec.ts` (create)

**Interfaces:**
- Serves: **STORY-036** (the per-bucket rollover toggle is its own story, not STORY-035).
- Consumes: `db.categories.setRolloverEnabled(id, enabled)` (port + both repos already exist), `Bucket.rollover_enabled`, `budgets.load()`.
- Produces: `CategoriesStore.setRolloverEnabled(id: string, enabled: boolean): Promise<void>`; a `role="checkbox"` toggle per bucket row.

- [x] **Step 1: Write the failing test — create `src/tests/e2e/budgets-rollover.spec.ts`.**

```typescript
import { test, expect } from './fixtures/onboarded';
import { addTransaction } from './helpers/ui';
import type { Page } from '@playwright/test';

// Reuses the setup pattern from budgets-extended.spec.ts: the first budgetable
// bucket is Essentials; no tags are seeded into it, so live spend needs a tag.

async function createTagInFirstBucket(page: Page, tagName: string) {
	await page.getByRole('link', { name: 'Settings', exact: true }).click();
	await page.getByRole('link', { name: /Categories/ }).first().click();
	await page.getByRole('button', { name: '+ Add tag' }).click();
	const modal = page.getByRole('dialog');
	await modal.getByLabel('Name').fill(tagName);
	await modal.getByRole('button', { name: 'Create' }).click();
	await expect(page.getByText(tagName)).toBeVisible();
}

async function allocateFirstBucket(page: Page, amount: string) {
	await page.locator('main button.figures').first().click();
	const input = page.locator('main input[placeholder="0"]').first();
	await input.fill(amount);
	await input.press('Enter');
	await expect(page.getByText('Budget updated.')).toBeVisible();
}

test.describe('budgets — rollover toggle', () => {
	test('flipping rollover off claws an overspent bucket into the pool', async ({ onboardedPage: page }) => {
		// Current month: allocate 100k to Essentials, then overspend by 200k.
		await page.getByRole('link', { name: 'Budgets', exact: true }).click();
		await allocateFirstBucket(page, '100000');
		await createTagInFirstBucket(page, 'Groceries');
		await page.getByRole('link', { name: 'Dashboard', exact: true }).click();
		await addTransaction(page, { kind: 'expense', amount: '300000', tag: 'Groceries' });

		// Next month: give the bucket a row (allocated 0) so the carry renders.
		await page.getByRole('link', { name: 'Budgets', exact: true }).click();
		await page.getByRole('button', { name: 'Next month' }).click();
		await allocateFirstBucket(page, '0');

		const pool = page.getByTestId('to-budget');
		const firstBucket = page.locator('main .surface.rounded-lg.space-y-2').first();
		const toggle = firstBucket.getByRole('checkbox');
		await expect(toggle).toBeVisible();
		await expect(toggle).toBeChecked(); // defaults to ON (migration 004)

		const bucketText = async () => (await firstBucket.textContent()) ?? '';
		const poolText = async () => (await pool.textContent()) ?? '';
		// Onboarding defaults to en/VND, so formatCurrency(-200000, 'VND', 'en')
		// is "-₫200,000". Rollover ON: the bucket carries -200,000 and the pool
		// reads -100,000 (this month's 100,000 allocation, unfunded).
		const bucketOn = await bucketText();
		const poolOn = await poolText();
		expect(bucketOn).toContain('-₫200,000');
		expect(poolOn).toContain('-₫100,000');

		// Flip OFF: the bucket's negative carry floors at 0, and the pool moves
		// to -300,000 (the current month's shortfall is clawed back).
		await toggle.uncheck();
		await expect.poll(bucketText).not.toBe(bucketOn);
		await expect.poll(poolText).not.toBe(poolOn);
		expect(await bucketText()).not.toContain('-₫200,000');
		expect(await poolText()).toContain('-₫300,000');

		// Flip back ON: the carry is restored.
		await toggle.check();
		await expect.poll(bucketText).toBe(bucketOn);
		await expect.poll(poolText).toBe(poolOn);
	});
});
```

- [x] **Step 2: Run and confirm it fails.**

```bash
pnpm exec playwright test src/tests/e2e/budgets-rollover.spec.ts
```

Expected failure: `expect(toggle).toBeVisible()` times out — no element matches `getByRole('checkbox', { name: /rollover/i })` (the toggle does not exist yet).

- [x] **Step 3: Expose the store method.**

In `src/lib/stores/categories.svelte.ts`, after `renameBucket` (`:57-60`), add:

```typescript
	async setRolloverEnabled(id: string, enabled: boolean): Promise<void> {
		const db = getDb();
		await db.categories.setRolloverEnabled(id, enabled);
		await this.load();
	}
```

- [x] **Step 4: Add the toggle to the page and reload the pool on flip.**

In `src/routes/budgets/+page.svelte`, add a handler near `startEdit` (`:85`):

```typescript
	async function toggleRollover(id: string, enabled: boolean) {
		await categories.setRolloverEnabled(id, enabled);
		await budgets.load();
	}
```

Inside the bucket row surface, after the available row (`:313-318`) and before the surface's closing `</div>` (`:319`), add the toggle:

```svelte
				<label class="flex items-center gap-2 text-xs text-dim" title={m.budgets_rollover_toggle_help()}>
					<input
						type="checkbox"
						checked={bucket.rollover_enabled === 1}
						onchange={(e) => void toggleRollover(bucket.id, e.currentTarget.checked)}
						aria-label="{m.budgets_rollover_toggle()} — {bucket.name}"
						class="min-w-5 min-h-5 accent-phosphor"
					/>
					<span>{m.budgets_rollover_toggle()}</span>
				</label>
```

`bucket` here is the loop variable of `{#each budgetableBuckets as bucket}` (`:262`), which iterates `categories.buckets` — and `Bucket` carries `rollover_enabled: number` (`src/lib/db/browser/repos/categories.ts:10`, selected by `listBuckets` at `:35`). No new query is needed.

- [x] **Step 5: Add the i18n keys to both locales.**

Append to `messages/en.json`:

```json
  "budgets_rollover_toggle": "Roll over",
  "budgets_rollover_toggle_help": "Carry this bucket's leftover (or overspend) into next month.",
```

Append to `messages/vi.json`:

```json
  "budgets_rollover_toggle": "Kết chuyển",
  "budgets_rollover_toggle_help": "Chuyển số dư (hoặc chi vượt) của mục này sang tháng sau.",
```

Then regenerate Paraglide:

```bash
pnpm exec paraglide-js compile --project ./project.inlang --outdir ./src/lib/paraglide
```

- [x] **Step 6: Run and confirm pass.**

```bash
pnpm exec playwright test src/tests/e2e/budgets-rollover.spec.ts src/tests/e2e/budgets.spec.ts src/tests/e2e/budgets-extended.spec.ts
```

Expected: green. The budgets specs' `/Over budget by/` assertions still pass — that warning is now `overassigned`-driven, and an allocated-but-unfunded bucket makes `overassigned > 0`.

- [x] **Step 7: Commit.**

```bash
git add src/lib/stores/categories.svelte.ts src/routes/budgets/+page.svelte messages/en.json messages/vi.json src/tests/e2e/budgets-rollover.spec.ts
git commit -m "$(cat <<'EOF'
feat(budgets): add the per-bucket rollover toggle

CategoriesStore.setRolloverEnabled wraps the existing port method, the
budget screen renders a per-bucket rollover checkbox that reloads the
buckets and the pool in one pass, and an E2E flips it and asserts both
the bucket's available and the To Budget figure move.

Co-Authored-By: Claude Code <noreply@anthropic.com>
EOF
)"
```
