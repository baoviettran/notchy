import { getDb } from '$lib/db';
import type { BudgetSummary } from '$lib/db/client';
import { mapError } from '$lib/utils/errors';

class BudgetsStore {
	items = $state<BudgetSummary[]>([]);
	month = $state(currentMonth());
	loading = $state(false);
	error = $state<string | null>(null);
	hasAllocations = $state(false);

	async load(month?: string): Promise<void> {
		if (month) this.month = month;
		this.loading = true;
		this.error = null;
		try {
			const db = getDb();
			this.items = await db.budgets.getForMonth(this.month);
			this.hasAllocations = await db.budgets.hasAllocations(this.month);
		} catch (e) {
			this.error = mapError(e);
		} finally {
			this.loading = false;
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

function currentMonth(): string {
	const d = new Date();
	return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export const budgets = new BudgetsStore();
