import { getDb } from '$lib/db';
import type { BudgetSummary, ToBudgetBreakdown } from '$lib/db/client';
import { mapError } from '$lib/utils/errors';
import { monthKey } from '$lib/logic/budget-calc';

class BudgetsStore {
	items = $state<BudgetSummary[]>([]);
	toBudget = $state<ToBudgetBreakdown | null>(null);
	month = $state(monthKey(new Date()));
	loading = $state(false);
	error = $state<string | null>(null);
	hasAllocations = $state(false);
	// Monotonic token for the in-flight load. Each `load()` bumps it and only the
	// newest pass may write results, so a month switch mid-fold (getToBudget is a
	// slow multi-query fold) can't have the superseded month land last and
	// overwrite the current month's figures.
	#loadToken = 0;

	async load(month?: string): Promise<void> {
		const target = month ?? this.month;
		const token = ++this.#loadToken;
		this.month = target;
		this.loading = true;
		this.error = null;
		try {
			const db = getDb();
			// Read every field against the captured month, then commit atomically:
			// a pass that has been superseded writes nothing (not even partially).
			const items = await db.budgets.getForMonth(target);
			const toBudget = await db.budgets.getToBudget(target);
			const hasAllocations = await db.budgets.hasAllocations(target);
			if (token !== this.#loadToken) return;
			this.items = items;
			this.toBudget = toBudget;
			this.hasAllocations = hasAllocations;
		} catch (e) {
			if (token === this.#loadToken) this.error = mapError(e);
		} finally {
			if (token === this.#loadToken) this.loading = false;
		}
	}

	async setAllocation(typeId: string, allocated: number): Promise<void> {
		const db = getDb();
		await db.budgets.setAllocation(typeId, this.month, allocated);
		await this.load();
	}

	async copyFromPrevious(): Promise<void> {
		const db = getDb();
		await db.budgets.copyFromPreviousMonth(this.month);
		await this.load();
	}
}

export const budgets = new BudgetsStore();
