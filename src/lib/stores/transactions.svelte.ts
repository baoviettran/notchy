import { getDb } from '$lib/db';
import type { Transaction, NewTransaction, TransactionFilter } from '$lib/db/client';
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
			const db = getDb();
			this.items = await db.transactions.list(this.lastFilter);
		} catch (e) {
			this.error = mapError(e);
		} finally {
			this.loading = false;
		}
	}

	async create(input: NewTransaction): Promise<string> {
		const db = getDb();
		const id = await db.transactions.create(input);
		await this.load();
		return id;
	}

	async update(id: string, patch: Partial<NewTransaction>): Promise<void> {
		const db = getDb();
		await db.transactions.update(id, patch);
		await this.load();
	}

	async delete(id: string): Promise<void> {
		const db = getDb();
		// Capture for undo
		const tx = await db.transactions.get(id);
		await db.transactions.delete(id);
		await this.load();

		if (tx) {
			toast.show('Transaction deleted.', {
				action: 'UNDO',
				duration: 5000,
				onaction: async () => {
					const db2 = getDb();
					await db2.transactions.restore(id);
					await this.load();
					toast.show('Transaction restored.');
				}
			});
		}
	}

	async duplicate(id: string): Promise<string> {
		const db = getDb();
		const newId = await db.transactions.duplicate(id);
		await this.load();
		return newId;
	}
}

export const transactions = new TransactionsStore();
