import type { AppDatabase, Schedule } from '$lib/db/client';
import * as m from '$lib/paraglide/messages';

/** Beyond this many posts in one pass a schedule is parked instead of drained. */
export const CATCH_UP_CAP = 24;

export interface PostDueSummary {
	/** How many schedules were due when the pass started. */
	due: number;
	/** How many transactions were written. */
	posted: number;
	/** How many schedules advanced their dates (capped ones did not). */
	advanced: number;
	/** Names of reminder-only schedules that were due — one entry per schedule. */
	notices: string[];
	/** Schedules that could not post and are now parked. */
	errors: { id: string; name: string }[];
	/** Schedules parked for hitting the catch-up cap. */
	capped: string[];
}

/** Active and unparked — the same predicate `listDue` applies, minus its date
 *  bound. Used to rescue a row whose `next_due_date` is NULL (Review Focus 1). */
function isActive(schedule: Schedule): boolean {
	return schedule.enabled === 1 && schedule.completed === 0 && schedule.errored_at === null;
}

export async function postDueSchedules(db: AppDatabase, today: string): Promise<PostDueSummary> {
	const summary: PostDueSummary = { due: 0, posted: 0, advanced: 0, notices: [], errors: [], capped: [] };
	// `listDue` is the contract's due query, but it excludes a NULL `next_due_date`
	// by design (Task 7). A row whose date was never seeded would therefore never
	// post — so fold in the active NULL-due rows from `list()` and let `postOne`
	// re-anchor them to `start_date`. The two sets cannot overlap: `listDue`
	// requires a non-NULL date.
	const [dueList, all] = await Promise.all([
		db.schedules.listDue(today),
		db.schedules.list(),
	]);
	const due = [...dueList, ...all.filter((s) => s.next_due_date === null && isActive(s))];
	summary.due = due.length;

	for (const schedule of due) {
		let result: import('$lib/db/client').SchedulePostResult | null = null;
		try {
			result = await db.schedules.postDue(schedule.id, today);
		} catch {
			result = null;
		}

		if (result === null) {
			// The domain operation rolled back the whole pass before parking.
			// A failure while parking it must not abort the remaining schedules, so
			// that write is swallowed — the error is still reported to the user.
			try {
				await db.schedules.markErrored(schedule.id);
			} catch {
				/* reported below regardless */
			}
			summary.errors.push({ id: schedule.id, name: schedule.name });
			continue;
		}

		summary.posted += result.posted;
		if (result.reminder_due) summary.notices.push(schedule.name);
		if (result.capped) summary.capped.push(schedule.id);
		else if (result.advanced) summary.advanced += 1;
	}

	return summary;
}

const passes = new Map<string, Promise<PostDueSummary>>();

export function postDueSchedulesOnce(db: AppDatabase, today: string, activationKey = 'legacy'): Promise<PostDueSummary> {
	let pass = passes.get(activationKey);
	if (!pass) {
		pass = postDueSchedules(db, today);
		passes.set(activationKey, pass);
	}
	return pass;
}

/**
 * The boot pass's one user-facing message, or `null` when it has nothing to say.
 *
 * A boot summary is a single event, but `ToastBus` keeps only one informational
 * toast at a time — three consecutive `show` calls in the same tick leave only
 * the last visible. So the pass joins its notices into one message rather than
 * firing three; the parts are joined with " · " and reuse the three existing
 * toast keys, so no new translations are needed and the message is one string
 * to read. Pure and locale-aware, so it is unit-testable without a browser.
 */
export function bootSummaryMessage(summary: PostDueSummary): string | null {
	const parts: string[] = [];
	if (summary.posted > 0) parts.push(m.schedules_toast_posted({ count: summary.posted }));
	if (summary.notices.length > 0) parts.push(m.schedules_toast_due({ count: summary.notices.length }));
	const errored = summary.errors.length + summary.capped.length;
	if (errored > 0) parts.push(m.schedules_toast_errored({ count: errored }));
	return parts.length > 0 ? parts.join(' · ') : null;
}
