import { getDb } from '$lib/db';
import * as repo from '$lib/db/repos/budgets';
import type { BudgetSummary } from '$lib/db/repos/budgets';

class BudgetsStore {
	items = $state<BudgetSummary[]>([]);
	month = $state(currentMonth());
	loading = $state(false);
	hasAllocations = $state(false);

	async load(month?: string): Promise<void> {
		if (month) this.month = month;
		this.loading = true;
		try {
			const db = await getDb();
			this.items = await repo.getBudgetsForMonth(db, this.month);
			this.hasAllocations = await repo.hasAllocations(db, this.month);
		} finally {
			this.loading = false;
		}
	}

	async setAllocation(typeId: string, allocated: number): Promise<void> {
		const db = await getDb();
		await repo.setAllocation(db, typeId, this.month, allocated);
		await this.load();
	}

	async copyFromPrevious(): Promise<void> {
		const db = await getDb();
		await repo.copyFromPreviousMonth(db, this.month);
		await this.load();
	}
}

function currentMonth(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const budgets = new BudgetsStore();
