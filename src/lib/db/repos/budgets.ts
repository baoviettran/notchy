import type { DatabaseService } from '../service';
import { ulid } from '../../utils/id';

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
	remaining: number;
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
		result.push({
			type_id: b.type_id,
			month: b.month,
			allocated: b.allocated,
			spent,
			remaining: b.allocated - spent
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
