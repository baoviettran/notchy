//! Schedule domain service — the native side of `src/lib/db/repos/schedules.ts`.
//!
//! Read-only operations query directly; mutations go through `run_idempotent`,
//! because the posting engine must be able to retry a boot without
//! double-advancing a schedule.

use rusqlite::{params, Connection, Row};

use crate::database::error::{map_sqlite_error, DbError, DbResult, ErrorCode};
use crate::database::migrations::now_iso_utc;
use crate::database::receipt::run_idempotent;
use crate::database::types::{
    NewSchedule, OperationId, Schedule, ScheduleFrequency, ScheduleKind, ScheduleUpdate,
};

/// Column list shared by every read, so `row_to_schedule`'s positional indexes
/// cannot drift between the two queries.
const SCHEDULE_COLUMNS: &str = "id, name, kind, amount, account_id, transfer_account_id, tag_id, \
     payee, description, frequency, start_date, end_date, posts_transaction, next_due_date, \
     last_posted_date, completed, enabled, errored_at, created_at, updated_at";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// The `kind` column is a CHECK-constrained discriminator, so an unknown value
/// is a corrupt row rather than a user error — `DatabaseCorrupt` matches what
/// `map_sqlite_error` would produce for the same damage elsewhere.
fn unknown_discriminator(column: usize) -> rusqlite::Error {
    rusqlite::Error::FromSqlConversionFailure(
        column,
        rusqlite::types::Type::Text,
        Box::new(ErrorCode::DatabaseCorrupt),
    )
}

/// Row mapper: positional columns from [`SCHEDULE_COLUMNS`].
fn row_to_schedule(row: &Row<'_>) -> rusqlite::Result<Schedule> {
    let kind_str: String = row.get(2)?;
    let kind = match kind_str.as_str() {
        "expense" => ScheduleKind::Expense,
        "income" => ScheduleKind::Income,
        "transfer" => ScheduleKind::Transfer,
        _ => return Err(unknown_discriminator(2)),
    };
    let frequency_str: String = row.get(9)?;
    let frequency = match frequency_str.as_str() {
        "weekly" => ScheduleFrequency::Weekly,
        "biweekly" => ScheduleFrequency::Biweekly,
        "monthly" => ScheduleFrequency::Monthly,
        "yearly" => ScheduleFrequency::Yearly,
        _ => return Err(unknown_discriminator(9)),
    };
    Ok(Schedule {
        id: row.get(0)?,
        name: row.get(1)?,
        kind,
        amount: row.get(3)?,
        account_id: row.get(4)?,
        transfer_account_id: row.get(5)?,
        tag_id: row.get(6)?,
        payee: row.get(7)?,
        description: row.get(8)?,
        frequency,
        start_date: row.get(10)?,
        end_date: row.get(11)?,
        posts_transaction: row.get(12)?,
        next_due_date: row.get(13)?,
        last_posted_date: row.get(14)?,
        completed: row.get(15)?,
        enabled: row.get(16)?,
        errored_at: row.get(17)?,
        created_at: row.get(18)?,
        updated_at: row.get(19)?,
    })
}

// ---------------------------------------------------------------------------
// Read-only queries
// ---------------------------------------------------------------------------

/// List every non-deleted schedule — active, completed, disabled and parked —
/// newest first. The due-date query below is deliberately not this function
/// with a `WHERE`: a schedule with a NULL `next_due_date` must stay visible to
/// the user even though the engine cannot post it.
pub fn list_schedules(conn: &Connection) -> DbResult<Vec<Schedule>> {
    let sql = format!(
        "SELECT {SCHEDULE_COLUMNS} FROM schedules WHERE deleted_at IS NULL \
         ORDER BY created_at DESC, id DESC"
    );
    let mut stmt = conn.prepare(&sql).map_err(map_sqlite_error)?;
    let rows = stmt
        .query_map([], row_to_schedule)
        .map_err(map_sqlite_error)?;

    let mut schedules = Vec::new();
    for row in rows {
        schedules.push(row.map_err(map_sqlite_error)?);
    }
    Ok(schedules)
}

/// List the schedules the posting engine should post for `today`.
///
/// The predicate mirrors `listDueSchedules` in the TypeScript adapter exactly,
/// so a schedule behaves the same on the desktop and web builds.
pub fn list_due_schedules(conn: &Connection, today: &str) -> DbResult<Vec<Schedule>> {
    let sql = format!(
        "SELECT {SCHEDULE_COLUMNS} FROM schedules
         WHERE enabled = 1 AND completed = 0 AND errored_at IS NULL
           AND deleted_at IS NULL
           AND next_due_date IS NOT NULL
           AND next_due_date <= ?1
         ORDER BY next_due_date, id"
    );
    let mut stmt = conn.prepare(&sql).map_err(map_sqlite_error)?;
    let rows = stmt
        .query_map(params![today], row_to_schedule)
        .map_err(map_sqlite_error)?;

    let mut schedules = Vec::new();
    for row in rows {
        schedules.push(row.map_err(map_sqlite_error)?);
    }
    Ok(schedules)
}

// ---------------------------------------------------------------------------
// Mutations (via `run_idempotent`)
// ---------------------------------------------------------------------------

#[derive(serde::Serialize, serde::Deserialize)]
struct ScheduleCreated {
    schedule_id: String,
}

/// Create a schedule. `next_due_date` is initialized to `start_date` — a NULL
/// there would make the schedule invisible to `list_due_schedules` forever.
pub fn create_schedule(
    conn: &mut Connection,
    op_id: OperationId,
    input: NewSchedule,
) -> DbResult<String> {
    run_idempotent(conn, op_id, "schedule_create", &input, |tx| {
        let now = now_iso_utc();
        let id = OperationId::generate().as_str().to_string();

        tx.execute(
            "INSERT INTO schedules
                (id, name, kind, amount, account_id, transfer_account_id, tag_id, payee,
                 description, frequency, start_date, end_date, posts_transaction,
                 next_due_date, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?11, ?14, ?14)",
            params![
                id,
                input.name,
                input.kind.as_str(),
                input.amount,
                input.account_id,
                input.transfer_account_id,
                input.tag_id,
                input.payee,
                input.description,
                input.frequency.as_str(),
                input.start_date,
                input.end_date,
                input.posts_transaction,
                now,
            ],
        )
        .map_err(map_sqlite_error)?;

        Ok(ScheduleCreated { schedule_id: id })
    })
    .map(|r| r.schedule_id)
}

/// Update a schedule. Two resume cases are served by one statement:
/// `enabled = 1` clears `errored_at`, and `next_due_date` is only overwritten
/// when the caller supplies one — a re-anchored date skips a disabled period,
/// `None` leaves a parked backlog to drain.
pub fn update_schedule(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
    input: ScheduleUpdate,
) -> DbResult<()> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    run_idempotent(conn, op_id, "schedule_update", &input, |tx| {
        let now = now_iso_utc();
        let updated = tx
            .execute(
                "UPDATE schedules
                    SET name = ?1, kind = ?2, amount = ?3, account_id = ?4,
                        transfer_account_id = ?5, tag_id = ?6, payee = ?7, description = ?8,
                        frequency = ?9, start_date = ?10, end_date = ?11,
                        posts_transaction = ?12, enabled = ?13,
                        errored_at = CASE WHEN ?13 = 1 THEN NULL ELSE errored_at END,
                        next_due_date = COALESCE(?14, next_due_date),
                        updated_at = ?15
                  WHERE id = ?16 AND deleted_at IS NULL",
                params![
                    input.name,
                    input.kind.as_str(),
                    input.amount,
                    input.account_id,
                    input.transfer_account_id,
                    input.tag_id,
                    input.payee,
                    input.description,
                    input.frequency.as_str(),
                    input.start_date,
                    input.end_date,
                    input.posts_transaction,
                    input.enabled,
                    input.next_due_date,
                    now,
                    id,
                ],
            )
            .map_err(map_sqlite_error)?;
        if updated == 0 {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }
        Ok(Void {})
    })
    .map(|_| ())
}

/// Soft-delete a schedule.
pub fn delete_schedule(conn: &mut Connection, op_id: OperationId, id: &str) -> DbResult<()> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    run_idempotent(conn, op_id, "schedule_delete", &id.to_string(), |tx| {
        let now = now_iso_utc();
        let updated = tx
            .execute(
                "UPDATE schedules SET deleted_at = ?1, updated_at = ?2 \
                 WHERE id = ?3 AND deleted_at IS NULL",
                params![now, now, id],
            )
            .map_err(map_sqlite_error)?;
        if updated == 0 {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }
        Ok(Void {})
    })
    .map(|_| ())
}

/// Record that a schedule posted: advance the bookkeeping the engine computed.
///
/// `next_due_date` is passed in rather than recomputed here — date arithmetic
/// lives in one place (the engine, mirroring `schedule_next_due.ts`), so this
/// layer never has to know what "monthly" means. An id that matched no row is a
/// no-op: a schedule deleted mid-pass must not fail the whole boot.
pub fn mark_schedule_posted(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
    last_posted_date: Option<String>,
    next_due_date: Option<String>,
    completed: i64,
) -> DbResult<()> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    // The receipt hashes the whole request, not just the id: the same op_id
    // replayed with different dates is a different intent and must conflict
    // rather than silently return the first result.
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Posted {
        id: String,
        last_posted_date: Option<String>,
        next_due_date: Option<String>,
        completed: i64,
    }
    let request = Posted {
        id: id.to_string(),
        last_posted_date: last_posted_date.clone(),
        next_due_date: next_due_date.clone(),
        completed,
    };

    run_idempotent(conn, op_id, "schedule_mark_posted", &request, |tx| {
        let now = now_iso_utc();
        tx.execute(
            "UPDATE schedules
                SET last_posted_date = ?1, next_due_date = ?2, completed = ?3, updated_at = ?4
              WHERE id = ?5 AND deleted_at IS NULL",
            params![last_posted_date, next_due_date, completed, now, id],
        )
        .map_err(map_sqlite_error)?;
        Ok(Void {})
    })
    .map(|_| ())
}

/// Park a schedule: stamp `errored_at` so `list_due_schedules` skips it until
/// the user re-enables it. Without this it would retry on every boot.
pub fn mark_schedule_errored(conn: &mut Connection, op_id: OperationId, id: &str) -> DbResult<()> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    run_idempotent(
        conn,
        op_id,
        "schedule_mark_errored",
        &id.to_string(),
        |tx| {
            let now = now_iso_utc();
            tx.execute(
                "UPDATE schedules SET errored_at = ?1, updated_at = ?2 \
             WHERE id = ?3 AND deleted_at IS NULL",
                params![now, now, id],
            )
            .map_err(map_sqlite_error)?;
            Ok(Void {})
        },
    )
    .map(|_| ())
}
