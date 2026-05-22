import { getDb } from '$lib/db';
import * as repo from '$lib/db/repos/goals';
import type { GoalWithProgress, NewGoal, GoalStatus } from '$lib/db/repos/goals';

class GoalsStore {
	items = $state<GoalWithProgress[]>([]);
	loading = $state(false);

	get active() { return this.items.filter((g) => g.status === 'active'); }
	get completed() { return this.items.filter((g) => g.status === 'completed'); }
	get dashboard() { return this.active.filter((g) => g.show_on_dashboard).slice(0, 3); }

	async load(): Promise<void> {
		this.loading = true;
		try {
			const db = await getDb();
			this.items = await repo.listGoals(db);
		} finally {
			this.loading = false;
		}
	}

	async create(input: NewGoal): Promise<string> {
		const db = await getDb();
		const id = await repo.createGoal(db, input);
		await this.load();
		return id;
	}

	async update(id: string, patch: Partial<NewGoal> & { status?: GoalStatus }): Promise<void> {
		const db = await getDb();
		await repo.updateGoal(db, id, patch);
		await this.load();
	}

	async delete(id: string): Promise<void> {
		const db = await getDb();
		await repo.deleteGoal(db, id);
		await this.load();
	}
}

export const goals = new GoalsStore();
