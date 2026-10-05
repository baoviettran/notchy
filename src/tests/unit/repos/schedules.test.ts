import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as scheduleRepo from '$lib/db/repos/schedules';
import type { DatabaseService } from '$lib/db';
import type { ScheduleUpdate } from '$lib/db/client';

let db: DatabaseService;

beforeEach(async () => {
	db = createTestDb();
	await runMigrations(db, migrations);
	// Both production adapters enable this (browser/pragmas.ts, connection.rs);
	// test-db does not, and the deleted-account case depends on it.
	await db.execute('PRAGMA foreign_keys = ON');
	await db.execute(
		`INSERT INTO accounts (id, name, type, currency, archived, created_at, updated_at)
		 VALUES ('acct1', 'Cash', 'cash', 'VND', 0, 'x', 'x')`
	);
});

describe('createSchedule', () => {
	it('initializes next_due_date from start_date', async () => {
		const id = await scheduleRepo.createSchedule(db, {
			name: 'Rent', kind: 'expense', amount: 5_000_000, account_id: 'acct1',
			frequency: 'monthly', start_date: '2026-01-31',
		});
		const [row] = (await scheduleRepo.listSchedules(db)).filter((s) => s.id === id);
		expect(row.next_due_date).toBe('2026-01-31');
		expect(row.completed).toBe(0);
		expect(row.errored_at).toBeNull();
	});

	it('rejects a transfer without a destination account', async () => {
		await expect(
			scheduleRepo.createSchedule(db, {
				name: 'Savings', kind: 'transfer', amount: 1_000_000, account_id: 'acct1',
				frequency: 'monthly', start_date: '2026-01-01',
			})
		).rejects.toThrow();
	});
});

describe('listSchedules', () => {
	it('lists newest first and keeps a NULL next_due_date visible', async () => {
		// created_at comes from the clock on insert, so two rows can land on the
		// same millisecond. Pin distinct values (and one NULL due date) so the
		// ordering assertion is deterministic.
		const make = (name: string) =>
			scheduleRepo.createSchedule(db, {
				name, kind: 'expense', amount: 1, account_id: 'acct1',
				frequency: 'monthly', start_date: '2026-01-01',
			});
		const oldest = await make('Oldest');
		const nullDue = await make('NullDue');
		const newest = await make('Newest');
		await db.execute(`UPDATE schedules SET created_at = '2026-01-01T00:00:00Z' WHERE id = ?`, [oldest]);
		await db.execute(
			`UPDATE schedules SET created_at = '2026-01-02T00:00:00Z', next_due_date = NULL WHERE id = ?`,
			[nullDue]
		);
		await db.execute(`UPDATE schedules SET created_at = '2026-01-03T00:00:00Z' WHERE id = ?`, [newest]);

		const rows = await scheduleRepo.listSchedules(db);

		expect(rows.map((s) => s.id)).toEqual([newest, nullDue, oldest]);
		// The whole reason listSchedules is not listDueSchedules: a NULL due date
		// must stay visible to the user even though the engine cannot post it.
		expect(rows.some((s) => s.id === nullDue && s.next_due_date === null)).toBe(true);
	});
});

describe('listDueSchedules', () => {
	it('excludes a NULL next_due_date, a disabled, a completed, an errored, and a future schedule', async () => {
		const make = (name: string, start: string) =>
			scheduleRepo.createSchedule(db, {
				name, kind: 'expense', amount: 1, account_id: 'acct1',
				frequency: 'weekly', start_date: start,
			});
		const due = await make('Due', '2026-01-01');
		const nullDate = await make('Null', '2026-01-01');
		const disabled = await make('Disabled', '2026-01-01');
		const completed = await make('Completed', '2026-01-01');
		const errored = await make('Errored', '2026-01-01');
		const future = await make('Future', '2027-01-01');
		await db.execute(`UPDATE schedules SET next_due_date = NULL WHERE id = ?`, [nullDate]);
		await db.execute(`UPDATE schedules SET enabled = 0 WHERE id = ?`, [disabled]);
		await db.execute(`UPDATE schedules SET completed = 1 WHERE id = ?`, [completed]);
		await db.execute(`UPDATE schedules SET errored_at = '2026-01-02T00:00:00Z' WHERE id = ?`, [errored]);
		const rows = await scheduleRepo.listDueSchedules(db, '2026-01-10');
		expect(rows.map((s) => s.id)).toEqual([due]);
	});
});

describe('updateSchedule', () => {
	it('clears errored_at when the schedule is re-enabled', async () => {
		const id = await scheduleRepo.createSchedule(db, {
			name: 'Rent', kind: 'expense', amount: 1, account_id: 'acct1',
			frequency: 'monthly', start_date: '2026-01-01',
		});
		await scheduleRepo.markScheduleErrored(db, id);
		expect((await scheduleRepo.listSchedules(db)).find((s) => s.id === id)!.errored_at).not.toBeNull();
		const row = (await scheduleRepo.listSchedules(db)).find((s) => s.id === id)!;
		await scheduleRepo.updateSchedule(db, id, {
			name: row.name, kind: row.kind, amount: row.amount, account_id: row.account_id,
			transfer_account_id: null, tag_id: null, payee: null, description: null,
			frequency: row.frequency, start_date: row.start_date, end_date: null,
			posts_transaction: 1, enabled: 1, next_due_date: null,
		});
		expect((await scheduleRepo.listSchedules(db)).find((s) => s.id === id)!.errored_at).toBeNull();
	});

	it('re-anchors the due date when the caller supplies one, and keeps it when it does not', async () => {
		// The disabled → re-enabled path supplies a re-anchored date; a parked
		// schedule's Resume passes null. Both go through the same statement.
		const id = await scheduleRepo.createSchedule(db, {
			name: 'Rent', kind: 'expense', amount: 1, account_id: 'acct1',
			frequency: 'monthly', start_date: '2026-01-01',
		});
		const row = (await scheduleRepo.listSchedules(db)).find((s) => s.id === id)!;
		const base = {
			name: row.name, kind: row.kind, amount: row.amount, account_id: row.account_id,
			transfer_account_id: null, tag_id: null, payee: null, description: null,
			frequency: row.frequency, start_date: row.start_date, end_date: null,
			posts_transaction: 1, enabled: 0,
		};

		await scheduleRepo.updateSchedule(db, id, { ...base, next_due_date: '2026-06-28' });
		expect((await scheduleRepo.listSchedules(db)).find((s) => s.id === id)!.next_due_date).toBe('2026-06-28');

		await scheduleRepo.updateSchedule(db, id, { ...base, next_due_date: null });
		expect((await scheduleRepo.listSchedules(db)).find((s) => s.id === id)!.next_due_date).toBe('2026-06-28');
	});

	it('rejects an id that matches no row', async () => {
		const fields: ScheduleUpdate = {
			name: 'Rent', kind: 'expense', amount: 1, account_id: 'acct1',
			transfer_account_id: null, tag_id: null, payee: null, description: null,
			frequency: 'monthly', start_date: '2026-01-01', end_date: null,
			posts_transaction: 1, enabled: 1, next_due_date: null,
		};
		await expect(scheduleRepo.updateSchedule(db, 'does-not-exist', fields)).rejects.toMatchObject({
			code: 'invalid_input',
		});
	});

	it('rejects a soft-deleted schedule', async () => {
		// A schedule deleted while the form was open must not be resurrected by a
		// late save.
		const id = await scheduleRepo.createSchedule(db, {
			name: 'Rent', kind: 'expense', amount: 1, account_id: 'acct1',
			frequency: 'monthly', start_date: '2026-01-01',
		});
		const row = (await scheduleRepo.listSchedules(db)).find((s) => s.id === id)!;
		await scheduleRepo.deleteSchedule(db, id);

		await expect(
			scheduleRepo.updateSchedule(db, id, {
				name: row.name, kind: row.kind, amount: row.amount, account_id: row.account_id,
				transfer_account_id: null, tag_id: null, payee: null, description: null,
				frequency: row.frequency, start_date: row.start_date, end_date: null,
				posts_transaction: 1, enabled: 1, next_due_date: null,
			})
		).rejects.toMatchObject({ code: 'invalid_input' });
	});
});

describe('markSchedulePosted', () => {
	it('advances the dates and records completion', async () => {
		const id = await scheduleRepo.createSchedule(db, {
			name: 'Rent', kind: 'expense', amount: 1, account_id: 'acct1',
			frequency: 'monthly', start_date: '2026-01-31',
		});

		await scheduleRepo.markSchedulePosted(db, id, '2026-01-31', '2026-02-28', 1);

		const row = (await scheduleRepo.listSchedules(db)).find((s) => s.id === id)!;
		expect(row.last_posted_date).toBe('2026-01-31');
		expect(row.next_due_date).toBe('2026-02-28');
		expect(row.completed).toBe(1);
	});

	it('is a no-op for an unknown id rather than throwing', async () => {
		// The engine may mark a schedule the user deleted mid-pass; that must not
		// turn into a boot error for every other schedule in the queue.
		await expect(
			scheduleRepo.markSchedulePosted(db, 'does-not-exist', null, null, 0)
		).resolves.toBeUndefined();
	});

	it('does not touch a soft-deleted schedule', async () => {
		// The row survives physically, so only the `deleted_at IS NULL` predicate
		// stops the engine writing to a schedule the user has removed.
		const id = await scheduleRepo.createSchedule(db, {
			name: 'Rent', kind: 'expense', amount: 1, account_id: 'acct1',
			frequency: 'monthly', start_date: '2026-01-01',
		});
		await scheduleRepo.deleteSchedule(db, id);

		await scheduleRepo.markSchedulePosted(db, id, '2026-01-31', '2026-02-28', 1);

		const [row] = await db.query<{ last_posted_date: string | null; next_due_date: string | null; completed: number }>(
			'SELECT last_posted_date, next_due_date, completed FROM schedules WHERE id = ?',
			[id]
		);
		expect(row).toEqual({ last_posted_date: null, next_due_date: '2026-01-01', completed: 0 });
	});
});

describe('markScheduleErrored', () => {
	it('does not touch a soft-deleted schedule', async () => {
		const id = await scheduleRepo.createSchedule(db, {
			name: 'Rent', kind: 'expense', amount: 1, account_id: 'acct1',
			frequency: 'monthly', start_date: '2026-01-01',
		});
		await scheduleRepo.deleteSchedule(db, id);

		await scheduleRepo.markScheduleErrored(db, id);

		const [row] = await db.query<{ errored_at: string | null }>(
			'SELECT errored_at FROM schedules WHERE id = ?',
			[id]
		);
		expect(row.errored_at).toBeNull();
	});
});

describe('deleteSchedule', () => {
	it('soft-deletes so the row disappears from list but not from the table', async () => {
		const id = await scheduleRepo.createSchedule(db, {
			name: 'Rent', kind: 'expense', amount: 1, account_id: 'acct1',
			frequency: 'monthly', start_date: '2026-01-01',
		});

		await scheduleRepo.deleteSchedule(db, id);

		expect((await scheduleRepo.listSchedules(db)).map((s) => s.id)).not.toContain(id);
		// Soft, not hard: a posted history keeps its parent row, and the deletion
		// survives a backup/restore round-trip like every other table's.
		const rows = await db.query<{ deleted_at: string | null }>(
			'SELECT deleted_at FROM schedules WHERE id = ?',
			[id]
		);
		expect(rows[0].deleted_at).not.toBeNull();
	});

	it('rejects an id that matches no row', async () => {
		await expect(scheduleRepo.deleteSchedule(db, 'does-not-exist')).rejects.toMatchObject({
			code: 'invalid_input',
		});
	});

	it('rejects a soft-deleted schedule', async () => {
		const id = await scheduleRepo.createSchedule(db, {
			name: 'Rent', kind: 'expense', amount: 1, account_id: 'acct1',
			frequency: 'monthly', start_date: '2026-01-01',
		});
		await scheduleRepo.deleteSchedule(db, id);

		await expect(scheduleRepo.deleteSchedule(db, id)).rejects.toMatchObject({
			code: 'invalid_input',
		});
	});
});
