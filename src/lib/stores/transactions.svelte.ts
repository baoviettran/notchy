import { getDb } from '$lib/db';
import * as repo from '$lib/db/repos/transactions';
import type { Transaction, NewTransaction, TransactionFilter } from '$lib/db/repos/transactions';
import { toast } from '$lib/stores/toast.svelte';
import { mapError } from '$lib/utils/errors';

class TransactionsStore {
	items = $state<Transaction[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);
	private lastFilter: TransactionFilter = {};

	async load(filter?: TransactionFilter): Promise<void> {
		if (filter !== undefined) this.lastFilter = filter;
		this.loading = true;
		this.error = null;
		try {
			const db = await getDb();
			this.items = await repo.listTransactions(db, this.lastFilter);
		} catch (e) {
			this.error = mapError(e);
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
					await repo.restoreTransaction(db2, id);
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
