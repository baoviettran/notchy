import { getDb } from '$lib/db';
import type { Transaction, NewTransaction, TransactionFilter } from '$lib/db/client';
import { toast } from '$lib/stores/toast.svelte';
import { mapError } from '$lib/utils/errors';
import { monthDateRange, flowSum } from '$lib/logic/tx-transform';
import * as m from '$lib/paraglide/messages';

// Field-wise equality for two DB row objects — same keys, same values.
// Used by TransactionsStore.mergeLoaded to detect rows that list() re-hydrated
// unchanged, so their previous object (and therefore their Svelte reactivity
// footprint) is preserved.
function sameTxFields(a: Transaction, b: Transaction): boolean {
	const ra = a as unknown as Record<string, unknown>;
	const rb = b as unknown as Record<string, unknown>;
	for (const key in ra) {
		if (rb[key] !== ra[key]) return false;
	}
	return true;
}

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
			this.mergeLoaded(await db.transactions.list(this.lastFilter));
		} catch (e) {
			this.error = mapError(e);
		} finally {
			this.loading = false;
		}
	}

	// A mutation re-runs list(), which hydrates fresh row objects for every
	// transaction — so a single save re-invalidated every row in the ledger
	// (keyed each blocks re-evaluated per changed object identity). Reusing
	// the previous object for unchanged rows keeps reactivity scoped to rows
	// that actually changed. (Row-level splicing was rejected: one mutation
	// can change a row's filter membership or sort position, which only
	// list() can decide correctly.)
	private mergeLoaded(rows: Transaction[]): void {
		if (this.items.length === 0) {
			this.items = rows;
			return;
		}
		const prevById = new Map(this.items.map((t) => [t.id, t]));
		this.items = rows.map((t) => {
			const prev = prevById.get(t.id);
			return prev && sameTxFields(prev, t) ? prev : t;
		});
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
