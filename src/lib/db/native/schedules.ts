/**
 * Native `ScheduleOps` — the production Tauri adapter.
 *
 * Bare `invoke()` bridges, no `isTauri()` guard, for the reason `NativeBackupOps`
 * documents: the client is only constructed under Tauri, and a guard would put
 * `db/index -> native/client -> native/schedules -> db/index` on the runtime
 * graph.
 */
import { invoke } from '@tauri-apps/api/core';
import type { ScheduleOps, Schedule, NewSchedule, ScheduleUpdate } from '../client';

export class NativeScheduleOps implements ScheduleOps {
	list(): Promise<Schedule[]> {
		return invoke<Schedule[]>('schedule_list');
	}

	create(input: NewSchedule): Promise<string> {
		return invoke<string>('schedule_create', { input });
	}

	update(id: string, input: ScheduleUpdate): Promise<void> {
		return invoke<void>('schedule_update', { id, input });
	}

	remove(id: string): Promise<void> {
		return invoke<void>('schedule_delete', { id });
	}

	listDue(today: string): Promise<Schedule[]> {
		return invoke<Schedule[]>('schedule_list_due', { today });
	}

	markPosted(id: string, lastPostedDate: string | null, nextDueDate: string | null, completed: number): Promise<void> {
		return invoke<void>('schedule_mark_posted', { id, lastPostedDate, nextDueDate, completed });
	}

	markErrored(id: string): Promise<void> {
		return invoke<void>('schedule_mark_errored', { id });
	}
}
