import type { DatabaseService } from '../service';
import { ulid } from '../../../utils/id';
import { AppError } from '../../../errors';

export interface Budget {
	id: string;
	type_id: string;
	month: string;
	allocated: number;
	created_at: string;
	updated_at: string;
}

export interface BudgetSummary {
	type_id: string;
	month: string;
	allocated: number;
	spent: number;
	remaining: number;   // allocated - spent (back-compat)
	rolled_over: number; // cumulative prior surplus/deficit before this month
	available: number;   // allocated + rolled_over - spent
}

export async function getBudgetsForMonth(db: DatabaseService, month: string): Promise<BudgetSummary[]> {
	const budgets = await db.query<Budget>(
		`SELECT id, type_id, month, allocated, created_at, updated_at
		 FROM budgets WHERE month = ? AND deleted_at IS NULL`,
		[month]
	);

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
}

export async function getSpentForBucket(db: DatabaseService, typeId: string, month: string): Promise<number> {
	const rows = await db.query<{ total: number | null }>(`
		SELECT SUM(
			CASE WHEN t.kind = 'expense' THEN t.amount
			     WHEN t.kind = 'refund' THEN -t.amount
			     ELSE 0 END
		) AS total
		FROM transactions t
		JOIN category_tags ct ON t.tag_id = ct.id
		WHERE ct.type_id = ?
		  AND t.date >= ? || '-01'
		  AND t.date < ? || '-01'
		  AND t.kind IN ('expense', 'refund')
		  AND t.deleted_at IS NULL`,
		[typeId, month, nextMonth(month)]
	);
	return rows[0]?.total ?? 0;
}

/**
 * A per-fold memo of `getSpentForBucket(typeId, month)`. Mirrors the Rust
 * `SpentCache` (`domains/budgets.rs`): `lastMonthOverspent` runs once per fold
 * step and, for each rollover-OFF bucket, walks that bucket's whole prior-month
 * history through `getRolledOver` — every step a full `getSpentForBucket` scan.
 * Without a cache a single `getToBudget` (which runs on every month switch,
 * allocation save and toggle) is O(months² × buckets) scans. The memo is scoped
 * to one `getToBudget` call and keyed by `(typeId, month)`; `spent` is a pure
 * read of a DB nothing mutates mid-fold, so a hit equals a recompute and no
 * arithmetic changes.
 */
interface SpentCache {
	db: DatabaseService;
	spent: Map<string, number>;
}

function newSpentCache(db: DatabaseService): SpentCache {
	return { db, spent: new Map() };
}

/** `getSpentForBucket`, memoized on `(typeId, month)`. */
async function cachedSpent(cache: SpentCache, typeId: string, month: string): Promise<number> {
	const key = `${typeId}\u0000${month}`;
	const hit = cache.spent.get(key);
	if (hit !== undefined) return hit;
	const total = await getSpentForBucket(cache.db, typeId, month);
	cache.spent.set(key, total);
	return total;
}

/**
 * Cumulative rollover for a category before `month`, reading `spent` through the
 * fold-scoped cache. Same arithmetic as the public `getRolledOver`, which wraps
 * this with a throwaway cache.
 */
async function getRolledOverCached(cache: SpentCache, typeId: string, month: string): Promise<number> {
	const flag = await cache.db.query<{ rollover_enabled: number }>(
		`SELECT rollover_enabled FROM category_types WHERE id = ?`,
		[typeId]
	);
	const enabled = (flag[0]?.rollover_enabled ?? 1) === 1;

	const months = await cache.db.query<{ month: string; allocated: number }>(
		`SELECT month, allocated FROM budgets
		 WHERE type_id = ? AND month < ? AND deleted_at IS NULL
		 ORDER BY month`,
		[typeId, month]
	);

	let rolled = 0;
	for (const m of months) {
		const spent = await cachedSpent(cache, typeId, m.month);
		rolled += m.allocated - spent;
		if (!enabled) rolled = Math.max(0, rolled);
	}
	return rolled;
}

/**
 * Cumulative rollover for a category before `month`.
 *
 * Rollover ON: sum of (allocated − spent) over every prior budgeted month,
 * negatives included. Rollover OFF: a running floor in chronological order
 * (`C ← max(0, C + L)`), so the carry never goes negative. Spending in months
 * with no budget row is ignored (budget-row gating, YNAB-style).
 */
export async function getRolledOver(db: DatabaseService, typeId: string, month: string): Promise<number> {
	return getRolledOverCached(newSpentCache(db), typeId, month);
}

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
 * in `M−1`. Rollover-ON buckets keep their negatives in-category. `spent` and
 * the per-bucket carry read through the fold-scoped cache.
 */
async function lastMonthOverspentCached(cache: SpentCache, month: string): Promise<number> {
	const prev = previousMonth(month);
	const rows = await cache.db.query<{ type_id: string; allocated: number }>(
		`SELECT b.type_id AS type_id, b.allocated AS allocated FROM budgets b
		 JOIN category_types ct ON ct.id = b.type_id
		 WHERE b.month = ? AND b.deleted_at IS NULL AND ct.rollover_enabled = 0`,
		[prev]
	);
	let total = 0;
	for (const b of rows) {
		const carry = await getRolledOverCached(cache, b.type_id, prev);
		const spent = await cachedSpent(cache, b.type_id, prev);
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
	assertValidMonth(month);
	const zero: ToBudgetBreakdown = {
		income: 0, carried_forward: 0, last_month_overspent: 0,
		assigned: 0, to_budget: 0, overassigned: 0
	};
	const start = await poolStartMonth(db);
	if (start === null || start > month) return zero;

	// One memo for the whole fold so each (bucket, month) pair's spend is
	// scanned at most once (see SpentCache); the arithmetic below is unchanged.
	const cache = newSpentCache(db);

	let carried = 0;
	let result = zero;
	let cur = start;
	for (;;) {
		const income = await monthIncome(db, cur);
		const assigned = await monthAssigned(db, cur);
		const lmo = await lastMonthOverspentCached(cache, cur);
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

export async function setAllocation(db: DatabaseService, typeId: string, month: string, allocated: number): Promise<void> {
	const now = new Date().toISOString();
	const existing = await db.query<{ id: string }>(
		`SELECT id FROM budgets WHERE type_id = ? AND month = ? AND deleted_at IS NULL`,
		[typeId, month]
	);

	if (existing.length > 0) {
		await db.execute(
			`UPDATE budgets SET allocated = ?, updated_at = ? WHERE id = ?`,
			[allocated, now, existing[0].id]
		);
	} else {
		await db.execute(
			`INSERT INTO budgets (id, type_id, month, allocated, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
			[ulid(), typeId, month, allocated, now, now]
		);
	}
}

export async function copyFromPreviousMonth(db: DatabaseService, targetMonth: string): Promise<void> {
	const prev = previousMonth(targetMonth);
	const budgets = await db.query<{ type_id: string; allocated: number }>(
		`SELECT type_id, allocated FROM budgets WHERE month = ? AND deleted_at IS NULL`,
		[prev]
	);
	for (const b of budgets) {
		await setAllocation(db, b.type_id, targetMonth, b.allocated);
	}
}

export async function hasAllocations(db: DatabaseService, month: string): Promise<boolean> {
	const rows = await db.query<{ c: number }>(
		`SELECT COUNT(*) AS c FROM budgets WHERE month = ? AND deleted_at IS NULL`, [month]
	);
	return rows[0].c > 0;
}

/**
 * Reject anything the schema would not accept, exactly as Rust's `parse_month`
 * (`src-tauri/src/database/domains/budgets.rs:22-35`) does: split on `-`,
 * require two parts, a 4-digit year, a 2-digit month, and a month in `1..=12`.
 *
 * `getToBudget` below folds month-by-month until it reaches the requested
 * month (`cur === month`). `nextMonth` only ever emits well-formed `YYYY-MM`,
 * so an unvalidated bad month can never be matched and the fold loops forever,
 * freezing the webview. Rust cannot hang here — `get_to_budget` calls
 * `parse_month(month)?` first and returns `InvalidInput`.
 */
function assertValidMonth(month: string): void {
	const invalid = (): never => {
		throw new AppError('invalid_input');
	};
	const parts = month.split('-');
	if (parts.length !== 2 || parts[0].length !== 4 || parts[1].length !== 2) invalid();
	if (!/^\d{4}$/.test(parts[0]) || !/^\d{2}$/.test(parts[1])) invalid();
	const monthNumber = Number(parts[1]);
	if (monthNumber < 1 || monthNumber > 12) invalid();
}

function nextMonth(month: string): string {
	const [y, m] = month.split('-').map(Number);
	if (m === 12) return `${y + 1}-01`;
	return `${y}-${String(m + 1).padStart(2, '0')}`;
}

function previousMonth(month: string): string {
	const [y, m] = month.split('-').map(Number);
	if (m === 1) return `${y - 1}-12`;
	return `${y}-${String(m - 1).padStart(2, '0')}`;
}
