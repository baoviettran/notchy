import type { DatabaseService } from '../service';
import { ulid } from '../../utils/id';
import { getBalance } from './accounts';

export type GoalType = 'savings' | 'debt_payoff' | 'net_worth';
export type GoalStatus = 'active' | 'completed' | 'abandoned' | 'overdue';
export type VelocityStatus = 'insufficient_data' | 'behind' | 'on_track' | 'ahead' | 'overdue';

export interface Goal {
	id: string;
	name: string;
	type: GoalType;
	target_amount: number;
	target_date: string;
	linked_account_id: string | null;
	starting_amount: number;
	show_on_dashboard: number;
	status: GoalStatus;
	closed_at: string | null;
	created_at: string;
	updated_at: string;
}

export interface GoalWithProgress extends Goal {
	current_amount: number;
	progress_pct: number;
	velocity_status: VelocityStatus;
}

export interface NewGoal {
	name: string;
	type: GoalType;
	target_amount: number;
	target_date: string;
	linked_account_id?: string | null;
	starting_amount: number;
	show_on_dashboard?: number;
}

export async function listGoals(db: DatabaseService): Promise<GoalWithProgress[]> {
	const goals = await db.query<Goal>(
		`SELECT id, name, type, target_amount, target_date, linked_account_id, starting_amount,
		        show_on_dashboard, status, closed_at, created_at, updated_at
		 FROM goals WHERE deleted_at IS NULL ORDER BY target_date`
	);
	const result: GoalWithProgress[] = [];
	for (const g of goals) {
		result.push(await enrichGoal(db, g));
	}
	return result;
}

export async function getGoal(db: DatabaseService, id: string): Promise<GoalWithProgress | null> {
	const rows = await db.query<Goal>(
		`SELECT id, name, type, target_amount, target_date, linked_account_id, starting_amount,
		        show_on_dashboard, status, closed_at, created_at, updated_at
		 FROM goals WHERE id = ? AND deleted_at IS NULL`, [id]
	);
	if (rows.length === 0) return null;
	return enrichGoal(db, rows[0]);
}

export async function createGoal(db: DatabaseService, input: NewGoal): Promise<string> {
	const now = new Date().toISOString();
	const id = ulid();
	await db.execute(
		`INSERT INTO goals (id, name, type, target_amount, target_date, linked_account_id, starting_amount, show_on_dashboard, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[id, input.name, input.type, input.target_amount, input.target_date,
		 input.linked_account_id ?? null, input.starting_amount, input.show_on_dashboard ?? 1, now, now]
	);
	return id;
}

export async function updateGoal(db: DatabaseService, id: string, patch: Partial<NewGoal> & { status?: GoalStatus }): Promise<void> {
	const now = new Date().toISOString();
	const sets: string[] = ['updated_at = ?'];
	const params: unknown[] = [now];

	if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name); }
	if (patch.target_amount !== undefined) { sets.push('target_amount = ?'); params.push(patch.target_amount); }
	if (patch.target_date !== undefined) { sets.push('target_date = ?'); params.push(patch.target_date); }
	if (patch.show_on_dashboard !== undefined) { sets.push('show_on_dashboard = ?'); params.push(patch.show_on_dashboard); }
	if (patch.status !== undefined) {
		sets.push('status = ?'); params.push(patch.status);
		if (patch.status === 'completed' || patch.status === 'abandoned') {
			sets.push('closed_at = ?'); params.push(now);
		}
	}

	params.push(id);
	await db.execute(`UPDATE goals SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`, params);
}

export async function deleteGoal(db: DatabaseService, id: string): Promise<void> {
	const now = new Date().toISOString();
	await db.execute(`UPDATE goals SET deleted_at = ?, updated_at = ? WHERE id = ?`, [now, now, id]);
}

async function enrichGoal(db: DatabaseService, goal: Goal): Promise<GoalWithProgress> {
	let current_amount: number;

	if (goal.type === 'net_worth') {
		// Net worth = Σ(account balances). Liability balances (credit_card,
		// loan_from_person) are stored as negative magnitudes (money owed), so
		// summing every account's signed balance yields assets − liabilities.
		const accs = await db.query<{ id: string }>(
			`SELECT id FROM accounts WHERE deleted_at IS NULL`
		);
		let total = 0;
		for (const acc of accs) total += await getBalance(db, acc.id);
		current_amount = total;
	} else {
		current_amount = goal.linked_account_id ? await getBalance(db, goal.linked_account_id) : 0;
	}

	const progress = goal.target_amount > 0
		? Math.min(100, Math.round((current_amount / goal.target_amount) * 100))
		: 0;

	const velocity_status = computeVelocityStatus(goal, current_amount);

	return { ...goal, current_amount, progress_pct: progress, velocity_status };
}

function computeVelocityStatus(goal: Goal, current: number): VelocityStatus {
	const today = new Date();
	const targetDate = new Date(goal.target_date);

	if (targetDate < today && current < goal.target_amount) return 'overdue';

	const createdDate = new Date(goal.created_at);
	const monthsElapsed = (today.getFullYear() - createdDate.getFullYear()) * 12 + (today.getMonth() - createdDate.getMonth());

	if (monthsElapsed < 3) return 'insufficient_data';

	const progressMade = current - goal.starting_amount;
	const velocity = progressMade / monthsElapsed; // per month

	const monthsRemaining = (targetDate.getFullYear() - today.getFullYear()) * 12 + (targetDate.getMonth() - today.getMonth());
	if (monthsRemaining <= 0) return current >= goal.target_amount ? 'on_track' : 'overdue';

	const remaining = goal.target_amount - current;
	const requiredVelocity = remaining / monthsRemaining;

	if (velocity >= requiredVelocity * 1.2) return 'ahead';
	if (velocity >= requiredVelocity) return 'on_track';
	return 'behind';
}
