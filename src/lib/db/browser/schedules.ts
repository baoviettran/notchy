/**
 * Browser `ScheduleOps` — the adapter Vitest and Playwright E2E drive.
 *
 * Delegates to `browser/repos/schedules.ts`; that module owns the SQL semantics,
 * which mirror the Rust domain (Task 4) so a schedule behaves the same on the
 * desktop and web builds.
 */
import type { DatabaseService } from './service';
import type { ScheduleOps, Schedule, NewSchedule, ScheduleUpdate } from '../client';
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
	constructor(private db: DatabaseService) {}

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
