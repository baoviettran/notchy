import type { DatabaseService } from '../service';
import { ulid } from '../../utils/id';

export type AccountType = 'checking' | 'savings' | 'cash' | 'credit_card' | 'loan_to_person' | 'loan_from_person';

const ASSET_TYPES: AccountType[] = ['checking', 'savings', 'cash', 'loan_to_person'];
const LIABILITY_TYPES: AccountType[] = ['credit_card', 'loan_from_person'];
const LOAN_TYPES: AccountType[] = ['loan_to_person', 'loan_from_person'];

export interface Account {
	id: string;
	name: string;
	type: AccountType;
	counterparty: string | null;
	currency: string;
	archived: number;
	created_at: string;
	updated_at: string;
}

export interface NewAccount {
	name: string;
	type: AccountType;
	counterparty?: string | null;
	currency: string;
	initial_balance?: number;
	initial_balance_date?: string;
}

export interface AccountWithBalance extends Account {
	balance: number;
}

export function isAssetType(type: AccountType): boolean {
	return ASSET_TYPES.includes(type);
}

export function isLoanType(type: AccountType): boolean {
	return LOAN_TYPES.includes(type);
}

export async function listAccounts(db: DatabaseService): Promise<AccountWithBalance[]> {
	const accounts = await db.query<Account>(
		`SELECT id, name, type, counterparty, currency, archived, created_at, updated_at
		 FROM accounts WHERE deleted_at IS NULL ORDER BY archived, created_at`
	);
	const result: AccountWithBalance[] = [];
	for (const acc of accounts) {
		const balance = await getBalance(db, acc.id);
		result.push({ ...acc, balance });
	}
	return result;
}

export async function getAccount(db: DatabaseService, id: string): Promise<AccountWithBalance | null> {
	const rows = await db.query<Account>(
		`SELECT id, name, type, counterparty, currency, archived, created_at, updated_at
		 FROM accounts WHERE id = ? AND deleted_at IS NULL`,
		[id]
	);
	if (rows.length === 0) return null;
	const balance = await getBalance(db, id);
	return { ...rows[0], balance };
}

export async function getBalance(db: DatabaseService, accountId: string): Promise<number> {
	const today = new Date().toISOString().split('T')[0];
	const rows = await db.query<{ total: number | null }>(
		`SELECT
			COALESCE(SUM(CASE
				WHEN kind = 'income' THEN amount
				WHEN kind = 'adjustment' THEN amount
				WHEN kind = 'refund' THEN amount
				WHEN kind = 'expense' THEN -amount
				WHEN kind = 'transfer' AND account_id = ? THEN -amount
				WHEN kind = 'transfer' AND transfer_account_id = ? THEN amount
				ELSE 0
			END), 0) AS total
		 FROM transactions
		 WHERE (account_id = ? OR (kind = 'transfer' AND transfer_account_id = ?))
		   AND deleted_at IS NULL
		   AND date <= ?`,
		[accountId, accountId, accountId, accountId, today]
	);
	return rows[0]?.total ?? 0;
}

export async function createAccount(db: DatabaseService, input: NewAccount): Promise<string> {
	// Validate counterparty required for loan types
	if (LOAN_TYPES.includes(input.type) && !input.counterparty) {
		throw new Error('Counterparty is required for loan accounts');
	}

	// Single-currency rule: check existing accounts
	await enforceSingleCurrency(db, input.currency);

	const now = new Date().toISOString();
	const id = ulid();

	await db.transaction(async (tx) => {
		await tx.execute(
			`INSERT INTO accounts (id, name, type, counterparty, currency, created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?)`,
			[id, input.name, input.type, input.counterparty ?? null, input.currency, now, now]
		);

		// Create initial balance adjustment if provided
		if (input.initial_balance && input.initial_balance !== 0) {
			const txId = ulid();
			const date = input.initial_balance_date ?? now.split('T')[0];
			await tx.execute(
				`INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, created_at, updated_at)
				 VALUES (?, 'adjustment', ?, ?, ?, 'tag_initial_balance', ?, ?)`,
				[txId, date, Math.abs(input.initial_balance), id, now, now]
			);
		}
	});

	return id;
}

export async function updateAccount(
	db: DatabaseService,
	id: string,
	patch: { name?: string; type?: AccountType; counterparty?: string | null; archived?: number }
): Promise<void> {
	const existing = await getAccount(db, id);
	if (!existing) throw new Error('Account not found');

	// Validate type change rules
	if (patch.type && patch.type !== existing.type) {
		validateTypeChange(existing.type, patch.type);
	}

	// Validate counterparty for loan types
	const newType = patch.type ?? existing.type;
	if (LOAN_TYPES.includes(newType)) {
		const newCounterparty = patch.counterparty !== undefined ? patch.counterparty : existing.counterparty;
		if (!newCounterparty) throw new Error('Counterparty is required for loan accounts');
	}

	const now = new Date().toISOString();
	const sets: string[] = ['updated_at = ?'];
	const params: unknown[] = [now];

	if (patch.name !== undefined) { sets.push('name = ?'); params.push(patch.name); }
	if (patch.type !== undefined) { sets.push('type = ?'); params.push(patch.type); }
	if (patch.counterparty !== undefined) { sets.push('counterparty = ?'); params.push(patch.counterparty); }
	if (patch.archived !== undefined) { sets.push('archived = ?'); params.push(patch.archived); }

	params.push(id);
	await db.execute(`UPDATE accounts SET ${sets.join(', ')} WHERE id = ?`, params);
}

export async function deleteAccount(db: DatabaseService, id: string): Promise<void> {
	// Cascade check: block if any active goal links to this account
	const activeGoals = await db.query<{ name: string }>(
		`SELECT name FROM goals WHERE linked_account_id = ? AND deleted_at IS NULL AND status = 'active'`,
		[id]
	);
	if (activeGoals.length > 0) {
		throw new Error(
			`Cannot delete account: it is linked to ${activeGoals.length} active goal(s): ${activeGoals.map((g) => g.name).join(', ')}. Delete or unlink the goal first.`
		);
	}

	const now = new Date().toISOString();
	await db.execute(`UPDATE accounts SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`, [now, now, id]);
}

function validateTypeChange(from: AccountType, to: AccountType): void {
	const fromIsAsset = ASSET_TYPES.includes(from);
	const toIsAsset = ASSET_TYPES.includes(to);
	const fromIsLoan = LOAN_TYPES.includes(from);
	const toIsLoan = LOAN_TYPES.includes(to);

	// Cannot change between asset and liability
	if (fromIsAsset !== toIsAsset) throw new Error('Cannot change between asset and liability types');
	// Cannot change to/from loan types
	if (fromIsLoan || toIsLoan) throw new Error('Cannot change to or from loan account types');
}

async function enforceSingleCurrency(db: DatabaseService, currency: string): Promise<void> {
	const rows = await db.query<{ currency: string }>(
		`SELECT DISTINCT currency FROM accounts WHERE deleted_at IS NULL LIMIT 1`
	);
	if (rows.length > 0 && rows[0].currency !== currency) {
		throw new Error(`All accounts must use the same currency. Existing accounts use ${rows[0].currency}`);
	}
}
