import type { DatabaseService } from '../service';
import { ulid } from '../../utils/id';
import { getBalance } from './accounts';

export interface Reconciliation {
	id: string;
	account_id: string;
	date: string;
	expected_balance: number;
	actual_balance: number;
	adjustment_transaction_id: string | null;
	notes: string | null;
	created_at: string;
	updated_at: string;
}

export interface ReconcileResult {
	discrepancy: number;
	reconciliation_id: string;
	adjustment_transaction_id: string | null;
}

export async function getReconciliationHistory(db: DatabaseService, accountId: string): Promise<Reconciliation[]> {
	return db.query<Reconciliation>(
		`SELECT id, account_id, date, expected_balance, actual_balance, adjustment_transaction_id, notes, created_at, updated_at
		 FROM reconciliations WHERE account_id = ? AND deleted_at IS NULL ORDER BY date DESC`,
		[accountId]
	);
}

export async function reconcile(
	db: DatabaseService,
	accountId: string,
	actualBalance: number,
	createAdjustment: boolean,
	notes?: string
): Promise<ReconcileResult> {
	const expectedBalance = await getBalance(db, accountId);
	const discrepancy = actualBalance - expectedBalance;
	const now = new Date().toISOString();
	const today = now.split('T')[0];

	let adjustment_transaction_id: string | null = null;

	if (createAdjustment && discrepancy !== 0) {
		adjustment_transaction_id = ulid();
		const kind = discrepancy > 0 ? 'adjustment' : 'adjustment';
		const amount = Math.abs(discrepancy);

		// Positive discrepancy = we have more than expected (income-like adjustment)
		// Negative discrepancy = we have less than expected (expense-like adjustment)
		// Both stored as 'adjustment' kind with positive amount; sign handled by balance calc
		// For adjustments, amount adds to balance, so negative discrepancy needs special handling
		if (discrepancy > 0) {
			await db.execute(
				`INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, created_at, updated_at)
				 VALUES (?, 'adjustment', ?, ?, ?, 'tag_reconciliation', ?, ?)`,
				[adjustment_transaction_id, today, amount, accountId, now, now]
			);
		} else {
			// Negative: create expense to reduce balance
			await db.execute(
				`INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, created_at, updated_at)
				 VALUES (?, 'expense', ?, ?, ?, 'tag_reconciliation', ?, ?)`,
				[adjustment_transaction_id, today, amount, accountId, now, now]
			);
		}
	}

	const reconciliation_id = ulid();
	await db.execute(
		`INSERT INTO reconciliations (id, account_id, date, expected_balance, actual_balance, adjustment_transaction_id, notes, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[reconciliation_id, accountId, today, expectedBalance, actualBalance, adjustment_transaction_id, notes ?? null, now, now]
	);

	return { discrepancy, reconciliation_id, adjustment_transaction_id };
}

export const LARGE_DISCREPANCY_THRESHOLD = 1_000_000;

export function isLargeDiscrepancy(discrepancy: number): boolean {
	return Math.abs(discrepancy) > LARGE_DISCREPANCY_THRESHOLD;
}
