import type { DatabaseService } from '../service';

export interface OverviewReport {
	total_income: number;
	total_expense: number;
	net_cash_flow: number;
	spending_by_bucket: { type_id: string; name: string; total: number }[];
	top_categories: { tag_id: string; name: string; total: number }[];
	top_transactions: { id: string; payee: string | null; amount: number; date: string }[];
}

export interface TrendPoint {
	month: string;
	income: number;
	expense: number;
	net: number;
}

export interface CompareRow {
	tag_id: string | null;
	name: string;
	month_a: number;
	month_b: number;
	change: number;
	change_pct: number | null;
}

export async function getOverview(db: DatabaseService, month: string, includeAdjustments = false): Promise<OverviewReport> {
	const kindFilter = includeAdjustments
		? `t.kind IN ('expense', 'income', 'refund', 'adjustment')`
		: `t.kind IN ('expense', 'income', 'refund')`;

	// Exclude transactions tagged in the Adjustments bucket (e.g. Reconciliation expenses)
	// from main report aggregates unless includeAdjustments is true.
	const adjustmentTagFilter = includeAdjustments
		? ''
		: `AND (t.tag_id IS NULL OR t.tag_id NOT IN (
			SELECT id FROM category_tags WHERE type_id = 'bucket_adjustments'
		))`;

	const monthStart = `${month}-01`;
	const monthEnd = nextMonthStart(month);

	const totals = await db.query<{ kind: string; total: number | null }>(`
		SELECT kind, SUM(amount) AS total FROM transactions t
		WHERE ${kindFilter} AND t.date >= ? AND t.date < ? AND t.deleted_at IS NULL
		${adjustmentTagFilter}
		GROUP BY kind`, [monthStart, monthEnd]);

	let total_income = 0, total_expense = 0;
	for (const r of totals) {
		if (r.kind === 'income') total_income = r.total ?? 0;
		if (r.kind === 'expense') total_expense = r.total ?? 0;
		if (r.kind === 'refund') total_expense -= (r.total ?? 0);
		if (r.kind === 'adjustment' && includeAdjustments) total_income += (r.total ?? 0);
	}

	const spending_by_bucket = await db.query<{ type_id: string; name: string; total: number }>(`
		SELECT ct.type_id, cty.name, SUM(t.amount) AS total
		FROM transactions t
		JOIN category_tags ct ON t.tag_id = ct.id
		JOIN category_types cty ON ct.type_id = cty.id
		WHERE t.kind = 'expense' AND t.date >= ? AND t.date < ? AND t.deleted_at IS NULL
		GROUP BY ct.type_id ORDER BY total DESC`, [monthStart, monthEnd]);

	const top_categories = await db.query<{ tag_id: string; name: string; total: number }>(`
		SELECT t.tag_id, ct.name, SUM(t.amount) AS total
		FROM transactions t
		JOIN category_tags ct ON t.tag_id = ct.id
		WHERE t.kind = 'expense' AND t.date >= ? AND t.date < ? AND t.deleted_at IS NULL
		GROUP BY t.tag_id ORDER BY total DESC LIMIT 5`, [monthStart, monthEnd]);

	const top_transactions = await db.query<{ id: string; payee: string | null; amount: number; date: string }>(`
		SELECT id, payee, amount, date FROM transactions
		WHERE kind = 'expense' AND date >= ? AND date < ? AND deleted_at IS NULL
		ORDER BY amount DESC LIMIT 5`, [monthStart, monthEnd]);

	return {
		total_income, total_expense,
		net_cash_flow: total_income - total_expense,
		spending_by_bucket, top_categories, top_transactions
	};
}

export async function getTrend(db: DatabaseService, months: number, includeAdjustments = false, bucketId?: string): Promise<TrendPoint[]> {
	const points: TrendPoint[] = [];
	const now = new Date();

	for (let i = months - 1; i >= 0; i--) {
		const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
		const month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
		const monthStart = `${month}-01`;
		const monthEnd = nextMonthStart(month);

		let bucketJoin = '';
		let bucketWhere = '';
		const params: unknown[] = [monthStart, monthEnd];

		if (bucketId) {
			bucketJoin = 'JOIN category_tags ct ON t.tag_id = ct.id';
			bucketWhere = 'AND ct.type_id = ?';
			params.push(bucketId);
		}

		const kindFilter = includeAdjustments
			? `t.kind IN ('expense', 'income', 'refund', 'adjustment')`
			: `t.kind IN ('expense', 'income', 'refund')`;

		const rows = await db.query<{ kind: string; total: number | null }>(`
			SELECT t.kind, SUM(t.amount) AS total FROM transactions t
			${bucketJoin}
			WHERE ${kindFilter} AND t.date >= ? AND t.date < ? AND t.deleted_at IS NULL ${bucketWhere}
			GROUP BY t.kind`, params);

		let income = 0, expense = 0;
		for (const r of rows) {
			if (r.kind === 'income') income = r.total ?? 0;
			if (r.kind === 'expense') expense = r.total ?? 0;
			if (r.kind === 'refund') expense -= (r.total ?? 0);
		}
		points.push({ month, income, expense, net: income - expense });
	}
	return points;
}

export async function getComparison(db: DatabaseService, monthA: string, monthB: string, includeAdjustments = false): Promise<CompareRow[]> {
	const kindFilter = includeAdjustments
		? `t.kind IN ('expense', 'income', 'refund', 'adjustment')`
		: `t.kind IN ('expense', 'income', 'refund')`;

	const startA = `${monthA}-01`, endA = nextMonthStart(monthA);
	const startB = `${monthB}-01`, endB = nextMonthStart(monthB);

	const dataA = await db.query<{ tag_id: string | null; name: string; total: number }>(`
		SELECT t.tag_id, COALESCE(ct.name, 'Uncategorised') AS name, SUM(t.amount) AS total
		FROM transactions t LEFT JOIN category_tags ct ON t.tag_id = ct.id
		WHERE ${kindFilter} AND t.kind = 'expense' AND t.date >= ? AND t.date < ? AND t.deleted_at IS NULL
		GROUP BY t.tag_id`, [startA, endA]);

	const dataB = await db.query<{ tag_id: string | null; name: string; total: number }>(`
		SELECT t.tag_id, COALESCE(ct.name, 'Uncategorised') AS name, SUM(t.amount) AS total
		FROM transactions t LEFT JOIN category_tags ct ON t.tag_id = ct.id
		WHERE ${kindFilter} AND t.kind = 'expense' AND t.date >= ? AND t.date < ? AND t.deleted_at IS NULL
		GROUP BY t.tag_id`, [startB, endB]);

	const mapA = new Map(dataA.map((r) => [r.tag_id, r]));
	const mapB = new Map(dataB.map((r) => [r.tag_id, r]));
	const allKeys = new Set([...mapA.keys(), ...mapB.keys()]);

	const rows: CompareRow[] = [];
	for (const key of allKeys) {
		const a = mapA.get(key);
		const b = mapB.get(key);
		const month_a = a?.total ?? 0;
		const month_b = b?.total ?? 0;
		const change = month_b - month_a;
		const change_pct = month_a > 0 ? (change / month_a) * 100 : null;
		rows.push({ tag_id: key ?? null, name: a?.name ?? b?.name ?? 'Uncategorised', month_a, month_b, change, change_pct });
	}
	return rows.sort((a, b) => b.month_b - a.month_b);
}

function nextMonthStart(month: string): string {
	const [y, m] = month.split('-').map(Number);
	if (m === 12) return `${y + 1}-01-01`;
	return `${y}-${String(m + 1).padStart(2, '0')}-01`;
}
