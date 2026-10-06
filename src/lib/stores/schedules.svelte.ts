import { getDb } from '$lib/db';
import { firstDueOnOrAfter } from '$lib/utils/schedule_next_due';
import { mapError } from '$lib/utils/errors';
import { toast } from '$lib/stores/toast.svelte';
import type { Schedule, NewSchedule, ScheduleUpdate } from '$lib/db/client';

/**
 * Project a stored `Schedule` down to the exactly-14-field `ScheduleUpdate` the
 * port accepts. Both `resume` and the edit form build their argument from this
 * one function: a partial projection would silently blank `frequency`,
 * `start_date`, or `next_due_date` on every save, so there is a single home for
 * it rather than a copy per call site.
 *
 * `next_due_date` is carried through verbatim — for a parked row that means the
 * stored date survives the COALESCE on both adapters, which is what lets the
 * backlog keep draining rather than jumping to `today`.
 */
export function toUpdateFields(row: Schedule): ScheduleUpdate {
	return {
		name: row.name,
		kind: row.kind,
		amount: row.amount,
		account_id: row.account_id,
		transfer_account_id: row.transfer_account_id,
		tag_id: row.tag_id,
		payee: row.payee,
		description: row.description,
		frequency: row.frequency,
		start_date: row.start_date,
		end_date: row.end_date,
		posts_transaction: row.posts_transaction,
		enabled: row.enabled,
		next_due_date: row.next_due_date,
	};
}

export class SchedulesStore {
	items = $state<Schedule[]>([]);
	loading = $state(false);
	error = $state<string | null>(null);

	async load(): Promise<void> {
		this.loading = true;
		this.error = null;
		try {
			const db = getDb();
			this.items = await db.schedules.list();
		} catch (e) {
			this.error = mapError(e);
		} finally {
			this.loading = false;
		}
	}

	async create(input: NewSchedule): Promise<string> {
		const db = getDb();
		const id = await db.schedules.create(input);
		await this.load();
		return id;
	}

	async update(id: string, patch: ScheduleUpdate): Promise<void> {
		const db = getDb();
		await db.schedules.update(id, patch);
		await this.load();
	}

	async remove(id: string): Promise<void> {
		const db = getDb();
		await db.schedules.remove(id);
		await this.load();
	}

	/**
	 * Turn a disabled or parked schedule back on. `today` is passed in by the
	 * caller so the store stays testable without freezing the clock.
	 *
	 * A parked row (`errored_at !== null`) passes `next_due_date: null`, which the
	 * port documents as *keep the stored date* — the backlog then drains in
	 * chunks. A merely disabled row jumps forward to the first occurrence on or
	 * after today, so a long pause is skipped rather than replayed. Enabling is
	 * what clears `errored_at`; that is why both cases route through here.
	 */
	async resume(id: string, today: string): Promise<void> {
		const row = this.items.find((s) => s.id === id);
		if (!row) return;
		try {
			const next =
				row.errored_at === null
					? firstDueOnOrAfter(row.next_due_date ?? row.start_date, row.frequency, today)
					: null;
			await this.update(id, { ...toUpdateFields(row), enabled: 1, next_due_date: next });
		} catch (e) {
			toast.show(mapError(e));
		}
	}
}

export const schedules = new SchedulesStore();
