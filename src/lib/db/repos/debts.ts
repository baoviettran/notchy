import type { DatabaseService } from '../service';
import { ulid } from '../../utils/id';
import { getBalance } from './accounts';

export interface DebtAccount {
	id: string;
	name: string;
	type: 'loan_to_person' | 'loan_from_person';
	counterparty: string;
	balance: number;
	last_activity: string | null;
}

export async function listDebts(db: DatabaseService): Promise<{ i_owe: DebtAccount[]; owed_to_me: DebtAccount[] }> {
	const accounts = await db.query<{ id: string; name: string; type: string; counterparty: string }>(
		`SELECT id, name, type, counterparty FROM accounts
		 WHERE type IN ('loan_to_person', 'loan_from_person') AND deleted_at IS NULL AND archived = 0`
	);

	const i_owe: DebtAccount[] = [];
	const owed_to_me: DebtAccount[] = [];

	for (const acc of accounts) {
		const balance = await getBalance(db, acc.id);
		const lastTx = await db.query<{ date: string }>(
			`SELECT date FROM transactions WHERE account_id = ? AND deleted_at IS NULL ORDER BY date DESC LIMIT 1`,
			[acc.id]
		);

		const debt: DebtAccount = {
			id: acc.id,
			name: acc.name,
			type: acc.type as 'loan_to_person' | 'loan_from_person',
			counterparty: acc.counterparty,
			balance,
			last_activity: lastTx[0]?.date ?? null
		};

		if (acc.type === 'loan_from_person') i_owe.push(debt);
		else owed_to_me.push(debt);
	}

	// Sort by recent activity
	const byActivity = (a: DebtAccount, b: DebtAccount) =>
		(b.last_activity ?? '').localeCompare(a.last_activity ?? '');
	i_owe.sort(byActivity);
	owed_to_me.sort(byActivity);

	return { i_owe, owed_to_me };
}

export async function writeOff(
	db: DatabaseService,
	accountId: string,
	amount: number,
	tagId = 'tag_loss'
): Promise<string> {
	const acc = await db.query<{ type: string }>(
		`SELECT type FROM accounts WHERE id = ? AND deleted_at IS NULL`, [accountId]
	);
	if (acc.length === 0) throw new Error('Account not found');

	const now = new Date().toISOString();
	const today = now.split('T')[0];
	const id = ulid();

	// loan_to_person write-off = expense (we lose money)
	// loan_from_person write-off = income (debt forgiven to us)
	const kind = acc[0].type === 'loan_to_person' ? 'expense' : 'income';

	await db.execute(
		`INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, created_at, updated_at)
		 VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
		[id, kind, today, amount, accountId, tagId, now, now]
	);
	return id;
}
