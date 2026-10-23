import { nextDueDate } from '$lib/utils/schedule_next_due';
import { createTransaction } from './repos/transactions';
import { AppError } from '$lib/errors';
/**
 * Browser `ScheduleOps` — the adapter Vitest and Playwright E2E drive.
 *
 * Delegates to `browser/repos/schedules.ts`; that module owns the SQL semantics,
 * which mirror the Rust domain (Task 4) so a schedule behaves the same on the
 * desktop and web builds.
 */
import type { DatabaseService } from './service';
import type { SchedulePostResult, ScheduleOps, Schedule, NewSchedule, ScheduleUpdate } from '../client';
import {
	createSchedule,
	deleteSchedule,
	listDueSchedules,
	listSchedules,
	markScheduleErrored,
	markSchedulePosted,
	updateSchedule,
} from './repos/schedules';

export class BrowserScheduleOps implements ScheduleOps {
	constructor(private db: DatabaseService) { }

	async postDue(id: string, today: string): Promise<SchedulePostResult> {
		return this.db.transaction(async tx => {
			const result: SchedulePostResult = { posted: 0, reminder_due: false, capped: false, advanced: false };
			const s = (await listSchedules(tx)).find(s => s.id === id);
			if (!s || s.enabled !== 1 || s.completed !== 0 || s.errored_at !== null) return result;
			let next = s.next_due_date ?? s.start_date;
			let last = s.last_posted_date;
			let completed = 0;
			const needed = [s.account_id, s.transfer_account_id].filter((v): v is string => v !== null);
			for (const account of needed) {
				const rows = await tx.query('SELECT id FROM accounts WHERE id=? AND deleted_at IS NULL', [account]);
				if (!rows.length) throw new AppError('schedule_account_missing');
			}
			while (next <= today) {
				if (s.end_date !== null && next > s.end_date) { completed = 1; break; }
				if (result.posted >= 24) { result.capped = true; break; }
				if (s.posts_transaction === 1) {
					await createTransaction(tx, { kind: s.kind, date: next, amount: s.amount, account_id: s.account_id, transfer_account_id: s.transfer_account_id ?? undefined, tag_id: s.tag_id ?? undefined, payee: s.payee ?? undefined, description: s.description ?? undefined });
					result.posted++; last = next;
				} else result.reminder_due = true;
				next = nextDueDate(next, s.frequency);
			}
			await markSchedulePosted(tx, id, last, next, completed);
			if (result.capped) await markScheduleErrored(tx, id);
			result.advanced = !result.capped;
			return result;
		});
	}


	list(): Promise<Schedule[]> {
		return listSchedules(this.db);
	}

	create(input: NewSchedule): Promise<string> {
		return createSchedule(this.db, input);
	}

	update(id: string, input: ScheduleUpdate): Promise<void> {
		return updateSchedule(this.db, id, input);
	}

	remove(id: string): Promise<void> {
		return deleteSchedule(this.db, id);
	}

	listDue(today: string): Promise<Schedule[]> {
		return listDueSchedules(this.db, today);
	}

	markPosted(id: string, lastPostedDate: string | null, nextDueDate: string | null, completed: number): Promise<void> {
		return markSchedulePosted(this.db, id, lastPostedDate, nextDueDate, completed);
	}

	markErrored(id: string): Promise<void> {
		return markScheduleErrored(this.db, id);
	}
}
