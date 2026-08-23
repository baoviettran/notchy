import { getDb } from '$lib/db';
import type { Transaction, NewTransaction, TransactionFilter } from '$lib/db/client';
import { toast } from '$lib/stores/toast.svelte';
import { mapError } from '$lib/utils/errors';
import * as m from '$lib/paraglide/messages';

class TransactionsStore {
	items = $state<Transaction[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);
	monthFlow = $state(0);
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

	async loadMonthFlow(): Promise<void> {
		const now = new Date();
		const year = now.getUTCFullYear();
		const month = now.getUTCMonth();
		const dateFrom = `${year}-${String(month + 1).padStart(2, '0')}-01`;
		const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
		const dateTo = `${year}-${String(month + 1).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;

		try {
			const db = getDb();
			const items = await db.transactions.list({ date_from: dateFrom, date_to: dateTo, limit: 500 });
			this.monthFlow = items
				.filter((t) => t.kind === 'income' || t.kind === 'expense')
				.reduce((s, t) => s + (t.kind === 'income' ? t.amount : -t.amount), 0);
		} catch {
			this.monthFlow = 0;
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
			toast.show(m.transactions_deleted_toast(), {
				action: m.transactions_undo(),
				duration: 5000,
				onaction: async () => {
					const db2 = getDb();
					await db2.transactions.restore(id);
					await this.load();
					toast.show(m.transactions_restored_toast());
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
