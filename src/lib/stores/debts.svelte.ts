import { getDb } from '$lib/db';
import type { DebtAccount } from '$lib/db/client';

class DebtsStore {
	i_owe = $state<DebtAccount[]>([]);
	owed_to_me = $state<DebtAccount[]>([]);
	loading = $state(false);

	async load(): Promise<void> {
		this.loading = true;
		try {
			const db = getDb();
			const result = await db.debts.list();
			this.i_owe = result.i_owe;
			this.owed_to_me = result.owed_to_me;
		} finally {
			this.loading = false;
		}
	}

	async writeOff(accountId: string, amount: number, tagId?: string): Promise<void> {
		const db = getDb();
		await db.debts.writeOff(accountId, amount, tagId);
		await this.load();
	}
}

export const debts = new DebtsStore();
