import { getDb } from '$lib/db';
import { mapError } from '$lib/utils/errors';
import type { GoalWithProgress, NewGoal, GoalStatus } from '$lib/db/client';
import { toast } from '$lib/stores/toast.svelte';
import * as m from '$lib/paraglide/messages';

class GoalsStore {
	items = $state<GoalWithProgress[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);

	get active() { return this.items.filter((g) => g.status === 'active'); }
	get completed() { return this.items.filter((g) => g.status === 'completed'); }
	get abandoned() { return this.items.filter((g) => g.status === 'abandoned'); }
	get dashboard() { return this.active.filter((g) => g.show_on_dashboard).slice(0, 3); }

	async load(): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			const db = getDb();
			this.items = await db.goals.list();
		} catch (e) {
			this.error = mapError(e);
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
		// Capture for undo
		const g = await db.goals.get(id);
		await db.goals.delete(id);
		await this.load();

		if (g) {
			toast.show(m.goals_deleted_toast(), {
				action: m.common_undo(),
				duration: 5000,
				onaction: async () => {
					const db2 = getDb();
					await db2.goals.restore(id);
					await this.load();
					toast.show(m.goals_restored_toast());
				}
			});
		}
	}
}

export const goals = new GoalsStore();
