import type { AppDatabase, Schedule } from '$lib/db/client';
import { nextDueDate } from '$lib/utils/schedule_next_due';
import { AppError } from '$lib/errors';
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

interface PostedOne {
	posted: number;
	reminderDue: boolean;
	capped: boolean;
}

/**
 * Whether every account this schedule would touch is still live.
 *
 * The database cannot answer this: `deleteAccount` soft-deletes, so a schedule
 * still holds a valid foreign key to an account the user removed, and
 * `createTransaction` has no deleted-account guard — it would post silently to
 * that account. Asking is the only way to get the spec's stated behaviour
 * ("schedule errored + toast, not a crash") on the real code path.
 */
function accountsAreLive(schedule: Schedule, liveAccountIds: ReadonlySet<string>): boolean {
	const needed = [schedule.account_id, schedule.transfer_account_id].filter(
		(id): id is string => id !== null
	);
	return needed.every((id) => liveAccountIds.has(id));
}

async function postOne(
	db: AppDatabase,
	schedule: Schedule,
	today: string,
	liveAccountIds: ReadonlySet<string>
): Promise<PostedOne> {
	// `listDue` excludes a NULL date, but a schedule the user cannot see is worse
	// than one that errors — re-anchor instead of returning early (Review Focus 1).
	let next = schedule.next_due_date ?? schedule.start_date;
	let lastPosted = schedule.last_posted_date;
	let posted = 0;
	let reminderDue = false;
	let completed = 0;

	if (!accountsAreLive(schedule, liveAccountIds)) {
		throw new AppError('schedule_account_missing', { scheduleId: schedule.id });
	}

	while (next <= today) {
		if (schedule.end_date !== null && next > schedule.end_date) {
			completed = 1;
			break;
		}
		if (posted >= CATCH_UP_CAP) {
			// Over the cap: record what was actually written, then park it. The 24
			// rows exist, so leaving the bookkeeping at the old date would make the
			// schedule lie about its own history — and the next Resume picks up
			// from here, draining the rest a chunk at a time (nothing is lost).
			await db.schedules.markPosted(schedule.id, lastPosted, next, completed);
			await db.schedules.markErrored(schedule.id);
			return { posted, reminderDue, capped: true };
		}
		if (schedule.posts_transaction === 1) {
			// Posted rows go through the port's own create, so they inherit every
			// existing constraint — kind/tag/account checks, transfer pairing,
			// refund validation. The engine adds no second copy of those rules.
			await db.transactions.create({
				kind: schedule.kind,
				date: next,
				amount: schedule.amount,
				account_id: schedule.account_id,
				transfer_account_id: schedule.kind === 'transfer' ? schedule.transfer_account_id ?? undefined : undefined,
				tag_id: schedule.kind === 'transfer' ? undefined : schedule.tag_id ?? undefined,
				payee: schedule.payee ?? undefined,
				description: schedule.description ?? undefined,
			});
			posted += 1;
			lastPosted = next;
		} else {
			// One notice per schedule, not one per missed occurrence (Review Focus 5).
			reminderDue = true;
		}
		next = nextDueDate(next, schedule.frequency);
	}

	await db.schedules.markPosted(schedule.id, lastPosted, next, completed);
	return { posted, reminderDue, capped: false };
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
	const [dueList, all, liveAccounts] = await Promise.all([
		db.schedules.listDue(today),
		db.schedules.list(),
		db.accounts.list(),
	]);
	const due = [...dueList, ...all.filter((s) => s.next_due_date === null && isActive(s))];
	summary.due = due.length;
	// One lookup per pass, not per occurrence: `accounts.list()` is a single query
	// and the account set cannot change mid-pass (the pass is the only writer).
	const liveAccountIds = new Set(liveAccounts.map((account) => account.id));

	for (const schedule of due) {
		let result: PostedOne | null = null;
		try {
			result = await postOne(db, schedule, today, liveAccountIds);
		} catch {
			result = null;
		}

		if (result === null) {
			// The port exposes no transaction, so per-schedule isolation comes from
			// here: one damaged schedule is caught, parked, and the loop continues —
			// which is what the spec's "its own db.transaction" was protecting.
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
		if (result.reminderDue) summary.notices.push(schedule.name);
		if (result.capped) summary.capped.push(schedule.id);
		else summary.advanced += 1;
	}

	return summary;
}

let once: Promise<PostDueSummary> | null = null;

export function postDueSchedulesOnce(db: AppDatabase, today: string): Promise<PostDueSummary> {
	once ??= postDueSchedules(db, today);
	return once;
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
