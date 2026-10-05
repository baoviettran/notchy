import type { DatabaseService } from '../service';
import { ulid } from '../../../utils/id';
import type {
	Schedule,
	NewSchedule,
	ScheduleUpdate,
} from '../../client';

/**
 * Column list shared by every read, mirroring the Rust `SCHEDULE_COLUMNS`, so
 * the mapper cannot drift between the two queries.
 */
const SCHEDULE_COLUMNS = `id, name, kind, amount, account_id, transfer_account_id, tag_id,
	payee, description, frequency, start_date, end_date, posts_transaction, next_due_date,
	last_posted_date, completed, enabled, errored_at, created_at, updated_at`;

/**
 * Row mapper. The stored columns are the domain shape verbatim — SQLite returns
 * `kind`/`frequency` as their string literals and the integer columns as numbers
 * — so no per-column translation is needed. Named and central to mirror the Rust
 * `row_to_schedule`.
 */
function row_to_schedule(row: Schedule): Schedule {
	return row;
}

/**
 * The input-owned columns an insert or update writes. Shared so create and update
 * cannot disagree on how an omitted optional field defaults — `null` for the
 * nullable text/FK columns, `1` for `posts_transaction` (the schema default).
 */
function mutableColumnsFrom(input: NewSchedule | ScheduleUpdate) {
	return {
		name: input.name,
		kind: input.kind,
		amount: input.amount,
		account_id: input.account_id,
		transfer_account_id: input.transfer_account_id ?? null,
		tag_id: input.tag_id ?? null,
		payee: input.payee ?? null,
		description: input.description ?? null,
		frequency: input.frequency,
		start_date: input.start_date,
		end_date: input.end_date ?? null,
		posts_transaction: input.posts_transaction ?? 1,
	};
}

/**
 * Create a schedule. `next_due_date` is initialized to `start_date`: a NULL there
 * would make the schedule invisible to `listDueSchedules` forever. Wrapped in a
 * transaction so the insert cannot land as a half-row.
 */
export async function createSchedule(db: DatabaseService, input: NewSchedule): Promise<string> {
	const now = new Date().toISOString();
	const id = ulid();
	const c = mutableColumnsFrom(input);

	await db.transaction(async (tx) => {
		await tx.execute(
			`INSERT INTO schedules
				(id, name, kind, amount, account_id, transfer_account_id, tag_id, payee,
				 description, frequency, start_date, end_date, posts_transaction,
				 next_due_date, last_posted_date, completed, enabled, errored_at,
				 created_at, updated_at)
			 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, 1, NULL, ?, ?)`,
			[
				id, c.name, c.kind, c.amount, c.account_id, c.transfer_account_id, c.tag_id,
				c.payee, c.description, c.frequency, c.start_date, c.end_date,
				c.posts_transaction, input.start_date, now, now,
			]
		);
	});

	return id;
}

/**
 * List every non-deleted schedule — active, completed, disabled and parked.
 * A schedule with a NULL `next_due_date` stays visible here even though the
 * engine cannot post it.
 */
export async function listSchedules(db: DatabaseService): Promise<Schedule[]> {
	const rows = await db.query<Schedule>(
		`SELECT ${SCHEDULE_COLUMNS} FROM schedules
		 WHERE deleted_at IS NULL
		 ORDER BY next_due_date IS NULL, next_due_date, created_at`
	);
	return rows.map(row_to_schedule);
}

/**
 * List the schedules the posting engine should post for `today`. The predicate
 * mirrors the Rust `list_due_schedules` exactly, so a schedule behaves the same
 * on the desktop and web builds.
 */
export async function listDueSchedules(db: DatabaseService, today: string): Promise<Schedule[]> {
	const rows = await db.query<Schedule>(
		`SELECT ${SCHEDULE_COLUMNS} FROM schedules
		 WHERE enabled = 1 AND completed = 0 AND errored_at IS NULL
		   AND deleted_at IS NULL
		   AND next_due_date IS NOT NULL
		   AND next_due_date <= ?
		 ORDER BY next_due_date, id`,
		[today]
	);
	return rows.map(row_to_schedule);
}

/**
 * Update a schedule. Two resume cases are served by one statement:
 * `enabled = 1` clears `errored_at`, and `next_due_date` is only overwritten
 * when the caller supplies one — a re-anchored date skips a disabled period,
 * `null` leaves a parked backlog to drain.
 */
export async function updateSchedule(
	db: DatabaseService,
	id: string,
	input: ScheduleUpdate
): Promise<void> {
	const now = new Date().toISOString();
	const c = mutableColumnsFrom(input);
	await db.execute(
		`UPDATE schedules
			SET name = ?, kind = ?, amount = ?, account_id = ?,
				transfer_account_id = ?, tag_id = ?, payee = ?, description = ?,
				frequency = ?, start_date = ?, end_date = ?, posts_transaction = ?,
				enabled = ?,
				errored_at = CASE WHEN ? = 1 THEN NULL ELSE errored_at END,
				next_due_date = COALESCE(?, next_due_date),
				updated_at = ?
		  WHERE id = ? AND deleted_at IS NULL`,
		[
			c.name, c.kind, c.amount, c.account_id, c.transfer_account_id, c.tag_id,
			c.payee, c.description, c.frequency, c.start_date, c.end_date,
			c.posts_transaction, input.enabled, input.enabled, input.next_due_date,
			now, id,
		]
	);
}

/**
 * Record that a schedule posted: advance the bookkeeping the engine computed.
 * An id that matched no row is a no-op — a schedule deleted mid-pass must not
 * fail the whole boot.
 */
export async function markSchedulePosted(
	db: DatabaseService,
	id: string,
	lastPostedDate: string | null,
	nextDueDate: string | null,
	completed: number
): Promise<void> {
	const now = new Date().toISOString();
	await db.execute(
		`UPDATE schedules
			SET last_posted_date = ?, next_due_date = ?, completed = ?, updated_at = ?
		  WHERE id = ? AND deleted_at IS NULL`,
		[lastPostedDate, nextDueDate, completed, now, id]
	);
}

/**
 * Park a schedule: stamp `errored_at` so `listDueSchedules` skips it until the
 * user re-enables it.
 */
export async function markScheduleErrored(db: DatabaseService, id: string): Promise<void> {
	const now = new Date().toISOString();
	await db.execute(
		`UPDATE schedules SET errored_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
		[now, now, id]
	);
}

/** Soft-delete a schedule — the row survives so posted history keeps its parent. */
export async function deleteSchedule(db: DatabaseService, id: string): Promise<void> {
	const now = new Date().toISOString();
	await db.execute(
		`UPDATE schedules SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL`,
		[now, now, id]
	);
}
