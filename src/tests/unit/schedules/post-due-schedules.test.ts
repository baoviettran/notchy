import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import type { DatabaseService } from '$lib/db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import { BrowserDatabaseClient } from '$lib/db/browser/client';
import type { AppDatabase, NewSchedule } from '$lib/db/client';
import * as scheduleRepo from '$lib/db/repos/schedules';
import {
	postDueSchedules,
	postDueSchedulesOnce,
	bootSummaryMessage,
	CATCH_UP_CAP,
	type PostDueSummary,
} from '$lib/logic/post-due-schedules';
import * as m from '$lib/paraglide/messages';

let raw: DatabaseService;
let db: AppDatabase;

beforeEach(async () => {
	raw = createTestDb();
	await runMigrations(raw, migrations);
	// Both production adapters enable this; test-db does not. The absent-account
	// backstop depends on it.
	await raw.execute('PRAGMA foreign_keys = ON');
	for (const id of ['acct1', 'acct2']) {
		await raw.execute(
			`INSERT INTO accounts (id, name, type, currency, archived, created_at, updated_at)
			 VALUES (?, ?, 'cash', 'VND', 0, 'x', 'x')`,
			[id, id]
		);
	}
	db = new BrowserDatabaseClient(raw);
});

/** Seed through the repo the browser adapter delegates to — the same code path
 *  `db.schedules.create` takes, without a second copy of the INSERT. */
function seed(overrides: Partial<NewSchedule> = {}): Promise<string> {
	return scheduleRepo.createSchedule(raw, {
		name: 'Rent',
		kind: 'expense',
		amount: 5_000_000,
		account_id: 'acct1',
		frequency: 'monthly',
		start_date: '2026-01-31',
		...overrides,
	});
}

async function txDates(): Promise<string[]> {
	const rows = await raw.query<{ date: string }>(
		'SELECT date FROM transactions WHERE deleted_at IS NULL ORDER BY date'
	);
	return rows.map((row) => row.date);
}

async function reload(id: string) {
	return (await scheduleRepo.listSchedules(raw)).find((s) => s.id === id)!;
}

/** Emulate the Resume action: enable the schedule and keep its stored date. */
async function resumeKeepingDate(id: string) {
	const row = await reload(id);
	await scheduleRepo.updateSchedule(raw, id, {
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
		enabled: 1,
		next_due_date: null,
	});
}

describe('postDueSchedules', () => {
	it('posts one missed occurrence and advances the schedule', async () => {
		const id = await seed({ frequency: 'weekly', start_date: '2026-01-01' });

		const summary = await postDueSchedules(db, '2026-01-07');

		expect(summary.due).toBe(1);
		expect(summary.posted).toBe(1);
		expect(summary.errors).toEqual([]);
		expect(await txDates()).toEqual(['2026-01-01']);
		const row = await reload(id);
		expect(row.next_due_date).toBe('2026-01-08');
		expect(row.last_posted_date).toBe('2026-01-01');
	});

	it('posts each missed occurrence for a long-closed app', async () => {
		// Monthly from Jan 31, reopened Apr 30: Jan 31 → Feb 28 (clamped) →
		// Mar 28 (drifted) → Apr 28, each posted separately — the user owed rent
		// four times.
		const id = await seed();

		const summary = await postDueSchedules(db, '2026-04-30');

		expect(summary.posted).toBe(4);
		expect(await txDates()).toEqual(['2026-01-31', '2026-02-28', '2026-03-28', '2026-04-28']);
		const row = await reload(id);
		expect(row.next_due_date).toBe('2026-05-28');
		expect(row.last_posted_date).toBe('2026-04-28');
		expect(row.errored_at).toBeNull();
	});

	it('parks a schedule that exceeds the catch-up cap instead of flooding', async () => {
		// Weekly from 2020-01-01 to 2026-01-01 is ~313 occurrences — far past the cap.
		const id = await seed({ frequency: 'weekly', start_date: '2020-01-01' });

		const first = await postDueSchedules(db, '2026-01-01');

		expect(first.posted).toBe(CATCH_UP_CAP);
		expect(first.capped).toEqual([id]);
		const parked = await reload(id);
		// The 24 rows exist, so the bookkeeping records them: parking must not
		// leave the schedule lying about what it already posted.
		expect(parked.last_posted_date).toBe('2020-06-10');
		expect(parked.next_due_date).toBe('2020-06-17');
		expect(parked.errored_at).not.toBeNull();

		// Parked means parked: a second boot posts nothing more.
		const second = await postDueSchedules(db, '2026-01-01');
		expect(second.due).toBe(0);
		expect(second.posted).toBe(0);
		expect(await txDates()).toHaveLength(CATCH_UP_CAP);
	});

	it('drains a parked backlog a cap-sized chunk at a time once re-enabled', async () => {
		const id = await seed({ frequency: 'weekly', start_date: '2020-01-01' });
		await postDueSchedules(db, '2026-01-01');
		await resumeKeepingDate(id);

		const second = await postDueSchedules(db, '2026-01-01');

		expect(second.posted).toBe(CATCH_UP_CAP);
		expect(second.capped).toEqual([id]);
		expect((await reload(id)).errored_at).not.toBeNull();
		// 48 rows: the backlog advanced by exactly one chunk, nothing lost.
		expect(await txDates()).toHaveLength(CATCH_UP_CAP * 2);
	});

	it('posts nothing when the start date is in the future', async () => {
		await seed({ start_date: '2027-01-01' });

		const summary = await postDueSchedules(db, '2026-10-03');

		expect(summary.due).toBe(0);
		expect(summary.posted).toBe(0);
		expect(await txDates()).toEqual([]);
	});

	it('marks a schedule completed at its end_date and posts no further', async () => {
		const id = await seed({ start_date: '2026-01-01', end_date: '2026-02-15' });

		const summary = await postDueSchedules(db, '2026-06-01');

		expect(summary.posted).toBe(2);
		expect(await txDates()).toEqual(['2026-01-01', '2026-02-01']);
		const row = await reload(id);
		expect(row.completed).toBe(1);
		expect(row.errored_at).toBeNull();

		// Completed schedules are out of the due set for good.
		expect((await postDueSchedules(db, '2026-06-01')).due).toBe(0);
	});

	it('parks a schedule whose account is gone and still posts the others', async () => {
		// Review Focus 4. Two schedules are due; one names an account that no
		// longer exists. The failure is injected at the port boundary so the test
		// pins the engine's isolation, not whichever error the account path
		// happens to raise today (see this task's note on soft deletes).
		const broken = await seed({ account_id: 'acct2', name: 'Gym' });
		const healthy = await seed({ account_id: 'acct1', name: 'Rent' });
		const failing: AppDatabase = {
			...db,
			transactions: {
				...db.transactions,
				create: async (input) => {
					if (input.account_id === 'acct2') throw new Error('account is gone');
					return db.transactions.create(input);
				},
			},
		};

		const summary = await postDueSchedules(failing, '2026-04-30');

		expect(summary.errors).toEqual([{ id: broken, name: 'Gym' }]);
		expect(summary.capped).toEqual([]);
		expect((await reload(broken)).errored_at).not.toBeNull();
		// The healthy schedule must have posted all four of its occurrences.
		const healthyRow = await reload(healthy);
		expect(healthyRow.last_posted_date).toBe('2026-04-28');
		expect(healthyRow.errored_at).toBeNull();
		expect(await txDates()).toHaveLength(4);
	});

	it('parks a schedule whose account was soft-deleted rather than posting to it', async () => {
		// The case the spec assumed the FK would catch. It does not — the row is
		// still there — so the engine's live-account check is what prevents this
		// transaction from landing on an account the user removed.
		await seed({ account_id: 'acct2' });
		await raw.execute(`UPDATE accounts SET deleted_at = '2026-04-01T00:00:00Z' WHERE id = 'acct2'`);

		const summary = await postDueSchedules(db, '2026-04-30');

		expect(summary.posted).toBe(0);
		expect(summary.errors).toHaveLength(1);
		expect(await txDates()).toEqual([]);
	});

	it('advances a reminder-only schedule with one notice and no transaction', async () => {
		// Review Focus 5: three missed months, so the naive implementation emits
		// three notices and/or three phantom rows. Neither is acceptable.
		const id = await seed({ posts_transaction: 0 });

		const summary = await postDueSchedules(db, '2026-04-30');

		expect(summary.notices).toEqual(['Rent']);
		expect(summary.posted).toBe(0);
		expect(await txDates()).toEqual([]);
		const row = await reload(id);
		expect(row.next_due_date).toBe('2026-05-28');
		// Reminder-only is not an error state: the bill is still live.
		expect(row.errored_at).toBeNull();
		expect(row.completed).toBe(0);

		// And it does not announce itself again on the next boot.
		expect((await postDueSchedules(db, '2026-04-30')).notices).toEqual([]);
	});

	it('re-anchors a schedule whose next_due_date is NULL rather than skipping it', async () => {
		// Review Focus 1: a NULL due date means the schedule would never post.
		// The column is nullable, so a create path that forgot to seed it — or a
		// row written by any future code path — must still be recoverable.
		const id = await seed({ start_date: '2026-01-31' });
		await raw.execute('UPDATE schedules SET next_due_date = NULL WHERE id = ?', [id]);

		const summary = await postDueSchedules(db, '2026-04-30');

		expect(summary.posted).toBe(4);
		expect((await reload(id)).next_due_date).toBe('2026-05-28');
	});
});

describe('bootSummaryMessage', () => {
	const empty: PostDueSummary = {
		due: 0, posted: 0, advanced: 0, notices: [], errors: [], capped: [],
	};

	it('returns null when there is nothing to report', () => {
		expect(bootSummaryMessage(empty)).toBeNull();
	});

	it('reports posted alone when nothing else happened', () => {
		const msg = bootSummaryMessage({ ...empty, posted: 2 });
		expect(msg).toContain(m.schedules_toast_posted({ count: 2 }));
		expect(msg).not.toContain(m.schedules_toast_due({ count: 1 }));
		expect(msg).not.toContain(m.schedules_toast_errored({ count: 1 }));
	});

	it('reports posted and due together', () => {
		const msg = bootSummaryMessage({ ...empty, posted: 1, notices: ['Rent'] });
		expect(msg).toContain(m.schedules_toast_posted({ count: 1 }));
		expect(msg).toContain(m.schedules_toast_due({ count: 1 }));
	});

	it('contains all three counts when posted, due, and errored all occur', () => {
		// The assertion that would have caught the original bug: three consecutive
		// toast.show calls in one tick meant only the last survived, so a message
		// carrying all three counts is the only shape that proves the aggregation.
		const msg = bootSummaryMessage({
			...empty,
			posted: 3,
			notices: ['Rent', 'Gym'],
			errors: [{ id: 'a', name: 'Gym' }],
			capped: ['b'],
		});
		expect(msg).toContain(m.schedules_toast_posted({ count: 3 }));
		expect(msg).toContain(m.schedules_toast_due({ count: 2 }));
		// errors + capped — both are "could not be posted".
		expect(msg).toContain(m.schedules_toast_errored({ count: 2 }));
	});
});

describe('postDueSchedulesOnce', () => {
	it('runs the pass at most once per process', async () => {
		// The layout's $effect re-runs on every stage transition; a second pass
		// could double-post anything the first one advanced to exactly `today`.
		await seed({ frequency: 'weekly', start_date: '2026-01-01' });

		const [first, second] = await Promise.all([
			postDueSchedulesOnce(db, '2026-01-07'),
			postDueSchedulesOnce(db, '2026-01-07'),
		]);

		expect(first).toBe(second); // one promise, not two identical results
		expect(await txDates()).toEqual(['2026-01-01']);
	});
});
