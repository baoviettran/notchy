import { describe, it, expect, beforeEach } from 'vitest';
import { createTestDb } from '../helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import * as scheduleRepo from '$lib/db/repos/schedules';
import type { DatabaseService } from '$lib/db';

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
});
