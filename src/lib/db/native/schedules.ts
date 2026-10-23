import type { MutationOptions } from '$lib/native/mutation-intent';
/**
 * Native `ScheduleOps` — the production Tauri adapter.
 *
 * Bare `invoke()` bridges, no `isTauri()` guard, for the reason `NativeBackupOps`
 * documents: the client is only constructed under Tauri, and a guard would put
 * `db/index -> native/client -> native/schedules -> db/index` on the runtime
 * graph.
 */
import { invoke } from '$lib/native/invoke';
import type { SessionInvoker } from '$lib/profiles/session';
import type { SchedulePostResult, ScheduleOps, Schedule, NewSchedule, ScheduleUpdate } from '../client';

export class NativeScheduleOps implements ScheduleOps {
	constructor(private readonly invoker: SessionInvoker = invoke) {}
	postDue(id: string, today: string, options?: MutationOptions): Promise<SchedulePostResult> {
		return this.invoker<SchedulePostResult>('schedule_post_due', { id, today }, options);
	}

	list(): Promise<Schedule[]> {
		return this.invoker<Schedule[]>('schedule_list');
	}

	create(input: NewSchedule, options?: MutationOptions): Promise<string> {
		return this.invoker<string>('schedule_create', { input }, options);
	}

	update(id: string, input: ScheduleUpdate, options?: MutationOptions): Promise<void> {
		return this.invoker<void>('schedule_update', { id, input }, options);
	}

	remove(id: string, options?: MutationOptions): Promise<void> {
		return this.invoker<void>('schedule_delete', { id }, options);
	}

	listDue(today: string): Promise<Schedule[]> {
		return this.invoker<Schedule[]>('schedule_list_due', { today });
	}

	markPosted(id: string, lastPostedDate: string | null, nextDueDate: string | null, completed: number, options?: MutationOptions): Promise<void> {
		return this.invoker<void>('schedule_mark_posted', { id, lastPostedDate, nextDueDate, completed }, options);
	}

	markErrored(id: string, options?: MutationOptions): Promise<void> {
		return this.invoker<void>('schedule_mark_errored', { id }, options);
	}
}
