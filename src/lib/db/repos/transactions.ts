import type { DatabaseService } from '../service';
import { ulid } from '../../utils/id';

export type TransactionKind = 'expense' | 'income' | 'transfer' | 'refund' | 'adjustment';

export interface Transaction {
	id: string;
	kind: TransactionKind;
	date: string;
	amount: number;
	account_id: string;
	transfer_account_id: string | null;
	transfer_pair_id: string | null;
	refund_of_id: string | null;
	tag_id: string | null;
	payee: string | null;
	description: string | null;
	created_at: string;
	updated_at: string;
}

export interface NewTransaction {
	kind: TransactionKind;
	date: string;
	amount: number;
	account_id: string;
	transfer_account_id?: string;
	refund_of_id?: string;
	tag_id?: string | null;
	payee?: string | null;
	description?: string | null;
}

export interface TransactionFilter {
	account_id?: string;
	kind?: TransactionKind;
	tag_id?: string;
	payee?: string;
	date_from?: string;
	date_to?: string;
	query?: string;
	limit?: number;
	offset?: number;
}

export async function listTransactions(db: DatabaseService, filter: TransactionFilter = {}): Promise<Transaction[]> {
	const conditions = ['t.deleted_at IS NULL'];
	const params: unknown[] = [];

	if (filter.account_id) { conditions.push('t.account_id = ?'); params.push(filter.account_id); }
	if (filter.kind) { conditions.push('t.kind = ?'); params.push(filter.kind); }
	if (filter.tag_id) { conditions.push('t.tag_id = ?'); params.push(filter.tag_id); }
	if (filter.date_from) { conditions.push('t.date >= ?'); params.push(filter.date_from); }
	if (filter.date_to) { conditions.push('t.date <= ?'); params.push(filter.date_to); }
	if (filter.payee) {
		conditions.push('t.payee LIKE ?');
		params.push(`%${escapeLike(filter.payee)}%`);
	}
	if (filter.query) {
		conditions.push('(t.payee LIKE ? OR t.description LIKE ?)');
		const q = `%${escapeLike(filter.query)}%`;
		params.push(q, q);
	}

	const limit = filter.limit ?? 50;
	const offset = filter.offset ?? 0;

	return db.query<Transaction>(
		`SELECT id, kind, date, amount, account_id, transfer_account_id, transfer_pair_id,
		        refund_of_id, tag_id, payee, description, created_at, updated_at
		 FROM transactions t WHERE ${conditions.join(' AND ')}
		 ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?`,
		[...params, limit, offset]
	);
}

export async function getTransaction(db: DatabaseService, id: string): Promise<Transaction | null> {
	const rows = await db.query<Transaction>(
		`SELECT id, kind, date, amount, account_id, transfer_account_id, transfer_pair_id,
		        refund_of_id, tag_id, payee, description, created_at, updated_at
		 FROM transactions WHERE id = ? AND deleted_at IS NULL`,
		[id]
	);
	return rows[0] ?? null;
}

export async function createTransaction(db: DatabaseService, input: NewTransaction): Promise<string> {
	const now = new Date().toISOString();

	if (input.kind === 'transfer') {
		if (!input.transfer_account_id) throw new Error('Transfer requires a destination account');
		return createTransferPair(db, input, now);
	}

	const id = ulid();
	await db.execute(
		`INSERT INTO transactions (id, kind, date, amount, account_id, refund_of_id, tag_id, payee, description, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
		[id, input.kind, input.date, input.amount, input.account_id,
		 input.refund_of_id ?? null, input.tag_id ?? null,
		 input.payee ?? null, input.description ?? null, now, now]
	);
	return id;
}

async function createTransferPair(db: DatabaseService, input: NewTransaction, now: string): Promise<string> {
	const pairId = ulid();
	const txId = ulid();

	// Single-row model: one row represents the transfer.
	// account_id = source, transfer_account_id = destination.
	// Balance queries handle direction by checking which field matches the queried account.
	await db.execute(
		`INSERT INTO transactions (id, kind, date, amount, account_id, transfer_account_id, transfer_pair_id, created_at, updated_at)
		 VALUES (?, 'transfer', ?, ?, ?, ?, ?, ?, ?)`,
		[txId, input.date, input.amount, input.account_id, input.transfer_account_id, pairId, now, now]
	);
	return txId;
}

export async function updateTransaction(db: DatabaseService, id: string, patch: Partial<NewTransaction>): Promise<void> {
	const existing = await getTransaction(db, id);
	if (!existing) throw new Error('Transaction not found');

	const now = new Date().toISOString();
	await applyPatch(db, id, patch, now);
}

async function applyPatch(db: DatabaseService, id: string, patch: Partial<NewTransaction>, now: string): Promise<void> {
	const sets: string[] = ['updated_at = ?'];
	const params: unknown[] = [now];

	if (patch.date !== undefined) { sets.push('date = ?'); params.push(patch.date); }
	if (patch.amount !== undefined) { sets.push('amount = ?'); params.push(patch.amount); }
	if (patch.tag_id !== undefined) { sets.push('tag_id = ?'); params.push(patch.tag_id); }
	if (patch.payee !== undefined) { sets.push('payee = ?'); params.push(patch.payee); }
	if (patch.description !== undefined) { sets.push('description = ?'); params.push(patch.description); }

	if (sets.length === 1) return; // only updated_at
	params.push(id);
	await db.execute(`UPDATE transactions SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteTransaction(db: DatabaseService, id: string): Promise<void> {
	const existing = await getTransaction(db, id);
	if (!existing) return;

	const now = new Date().toISOString();
	await db.execute(
		`UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ?`,
		[now, now, id]
	);
}

export async function restoreTransaction(db: DatabaseService, id: string): Promise<void> {
	const existing = await db.query<{ id: string }>(
		`SELECT id FROM transactions WHERE id = ? AND deleted_at IS NOT NULL`,
		[id]
	);
	if (existing.length === 0) throw new Error('Transaction not found or not deleted');

	const now = new Date().toISOString();
	await db.execute(
		`UPDATE transactions SET deleted_at = NULL, updated_at = ? WHERE id = ?`,
		[now, id]
	);
}

export async function duplicateTransaction(db: DatabaseService, id: string): Promise<string> {
	const existing = await getTransaction(db, id);
	if (!existing) throw new Error('Transaction not found');

	return createTransaction(db, {
		kind: existing.kind,
		date: new Date().toISOString().split('T')[0],
		amount: existing.amount,
		account_id: existing.account_id,
		transfer_account_id: existing.transfer_account_id ?? undefined,
		tag_id: existing.tag_id,
		payee: existing.payee,
		description: existing.description
	});
}

function escapeLike(input: string): string {
	return input.normalize('NFC').replace(/[%_\\]/g, '\\$&');
}
