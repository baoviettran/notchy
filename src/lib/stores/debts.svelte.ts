import { getDb } from '$lib/db';
import * as repo from '$lib/db/repos/debts';
import type { DebtAccount } from '$lib/db/repos/debts';

class DebtsStore {
	i_owe = $state<DebtAccount[]>([]);
	owed_to_me = $state<DebtAccount[]>([]);
	loading = $state(false);

	async load(): Promise<void> {
		this.loading = true;
		try {
			const db = await getDb();
			const result = await repo.listDebts(db);
			this.i_owe = result.i_owe;
			this.owed_to_me = result.owed_to_me;
		} finally {
			this.loading = false;
		}
	}

	async writeOff(accountId: string, amount: number, tagId?: string): Promise<void> {
		const db = await getDb();
		await repo.writeOff(db, accountId, amount, tagId);
		await this.load();
	}
}

export const debts = new DebtsStore();
