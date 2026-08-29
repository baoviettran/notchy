import { getDb } from '$lib/db';
import type { Transaction, NewTransaction, TransactionFilter } from '$lib/db/client';
import { toast } from '$lib/stores/toast.svelte';
import { mapError } from '$lib/utils/errors';
import { monthDateRange, flowSum } from '$lib/logic/tx-transform';
import * as m from '$lib/paraglide/messages';

class TransactionsStore {
	items = $state<Transaction[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);
	// null means "unknown" — a failed load must never print as ▲ 0, the
	// dashboard's most trusted instrument cannot tell a confident lie.
	monthFlow = $state<number | null>(null);
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
		const { dateFrom, dateTo } = monthDateRange(new Date());

		try {
			const db = getDb();
			const items = await db.transactions.list({ date_from: dateFrom, date_to: dateTo, limit: 500 });
			this.monthFlow = flowSum(items);
		} catch {
			this.monthFlow = null;
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

	async deleteMany(ids: string[]): Promise<void> {
		if (ids.length === 0) return;
		const db = getDb();
		await db.transactions.deleteMany(ids);
		await this.load();
	}

	async setTagMany(ids: string[], tagId: string | null): Promise<void> {
		if (ids.length === 0) return;
		const db = getDb();
		await db.transactions.setTagMany(ids, tagId);
		await this.load();
	}

	async setAccountMany(ids: string[], accountId: string): Promise<void> {
		if (ids.length === 0) return;
		const db = getDb();
		await db.transactions.setAccountMany(ids, accountId);
		await this.load();
	}
}

export const transactions = new TransactionsStore();
