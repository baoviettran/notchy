import { getDb } from '$lib/db';
import type { GoalWithProgress, NewGoal, GoalStatus } from '$lib/db/client';

class GoalsStore {
	items = $state<GoalWithProgress[]>([]);
	loading = $state(false);

	get active() { return this.items.filter((g) => g.status === 'active'); }
	get completed() { return this.items.filter((g) => g.status === 'completed'); }
	get dashboard() { return this.active.filter((g) => g.show_on_dashboard).slice(0, 3); }

	async load(): Promise<void> {
		this.loading = true;
		try {
			const db = getDb();
			this.items = await db.goals.list();
		} finally {
			this.loading = false;
		}
	}

	async create(input: NewGoal): Promise<string> {
		const db = getDb();
		const id = await db.goals.create(input);
		await this.load();
		return id;
	}

	async update(id: string, patch: Partial<NewGoal> & { status?: GoalStatus }): Promise<void> {
		const db = getDb();
		await db.goals.update(id, patch);
		await this.load();
	}

	async delete(id: string): Promise<void> {
		const db = getDb();
		await db.goals.delete(id);
		await this.load();
	}
}

export const goals = new GoalsStore();
