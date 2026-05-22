import { getDb } from '$lib/db';
import * as repo from '$lib/db/repos/transactions';
import type { Transaction, NewTransaction, TransactionFilter } from '$lib/db/repos/transactions';
import { toast } from '$lib/stores/toast.svelte';

class TransactionsStore {
	items = $state<Transaction[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);

	async load(filter: TransactionFilter = {}): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			const db = await getDb();
			this.items = await repo.listTransactions(db, filter);
		} catch (e) {
			this.error = String(e);
		} finally {
			this.loading = false;
		}
	}

	async create(input: NewTransaction): Promise<string> {
		const db = await getDb();
		const id = await repo.createTransaction(db, input);
		await this.load();
		return id;
	}

	async update(id: string, patch: Partial<NewTransaction>): Promise<void> {
		const db = await getDb();
		await repo.updateTransaction(db, id, patch);
		await this.load();
	}

	async delete(id: string): Promise<void> {
		const db = await getDb();
		// Capture for undo
		const tx = await repo.getTransaction(db, id);
		await repo.deleteTransaction(db, id);
		await this.load();

		if (tx) {
			toast.show('Transaction deleted.', {
				action: 'UNDO',
				duration: 5000,
				onaction: async () => {
					const db2 = await getDb();
					// Restore by clearing deleted_at
					await db2.execute(`UPDATE transactions SET deleted_at = NULL, updated_at = ? WHERE id = ?`, [new Date().toISOString(), id]);
					if (tx.transfer_pair_id) {
						await db2.execute(`UPDATE transactions SET deleted_at = NULL, updated_at = ? WHERE transfer_pair_id = ?`, [new Date().toISOString(), tx.transfer_pair_id]);
					}
					await this.load();
					toast.show('Transaction restored.');
				}
			});
		}
	}

	async duplicate(id: string): Promise<string> {
		const db = await getDb();
		const newId = await repo.duplicateTransaction(db, id);
		await this.load();
		return newId;
	}
}

export const transactions = new TransactionsStore();
