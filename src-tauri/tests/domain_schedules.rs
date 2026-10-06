//! Domain tests for scheduled transactions (Task 4).

use std::path::PathBuf;

use rusqlite::{Connection, OpenFlags};

use notchy_lib::database::domains::accounts;
use notchy_lib::database::domains::schedules::{
    create_schedule, delete_schedule, list_due_schedules, list_schedules, mark_schedule_errored,
    mark_schedule_posted, update_schedule,
};
use notchy_lib::database::migrations::{bootstrap_current, FailurePoint};
use notchy_lib::database::types::{
    AccountType, NewAccount, NewSchedule, OperationId, ScheduleFrequency, ScheduleKind,
    ScheduleUpdate,
};

// ---------------------------------------------------------------------------
// Helpers
//
// Copied verbatim from `domain_accounts_transactions.rs` — `scratch_path`,
// `fresh_db`, `op`, `default_account` — so this file shares one harness shape
// with its neighbours. `fresh_db` opens READ_WRITE: every test here inserts.
// ---------------------------------------------------------------------------

fn scratch_path(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let dir = std::env::temp_dir().join(format!("notchy-domain-test-{}", nanos));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join(format!("{}.sqlite", tag))
}

fn fresh_db(tag: &str) -> Connection {
    let path = scratch_path(tag);
    bootstrap_current(&path, FailurePoint::None).unwrap();
    Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap()
}

fn op() -> OperationId {
    OperationId::generate()
}

fn default_account(name: &str) -> NewAccount {
    NewAccount {
        name: name.to_string(),
        account_type: AccountType::Checking,
        counterparty: None,
        currency: "USD".to_string(),
        initial_balance: None,
        initial_balance_date: None,
    }
}

/// A migrated database opened **read-write**, with one account row already
/// inserted.
fn fixture_conn_with_account() -> (Connection, String) {
    let mut db = fresh_db("schedules");
    let account_id = accounts::create_account(&mut db, op(), default_account("Main")).unwrap();
    (db, account_id)
}

/// The monthly-expense baseline the tests vary.
fn schedule(name: &str, account_id: String) -> NewSchedule {
    NewSchedule {
        name: name.into(),
        kind: ScheduleKind::Expense,
        amount: 5_000_000,
        account_id,
        transfer_account_id: None,
        tag_id: None,
        payee: None,
        description: None,
        frequency: ScheduleFrequency::Monthly,
        start_date: "2026-01-31".into(),
        end_date: None,
        posts_transaction: 1,
    }
}

/// Read the stored row back and project it into the full `ScheduleUpdate` field
/// set, overriding only `enabled` and `next_due_date`. Mirrors the store's
/// `toUpdateFields`: every field is present, so no `Patch<T>` triples are needed.
fn update_of(
    conn: &Connection,
    id: &str,
    enabled: i64,
    next_due_date: Option<String>,
) -> ScheduleUpdate {
    let stored = list_schedules(conn)
        .unwrap()
        .into_iter()
        .find(|s| s.id == id)
        .expect("schedule exists");
    ScheduleUpdate {
        name: stored.name,
        kind: stored.kind,
        amount: stored.amount,
        account_id: stored.account_id,
        transfer_account_id: stored.transfer_account_id,
        tag_id: stored.tag_id,
        payee: stored.payee,
        description: stored.description,
        frequency: stored.frequency,
        start_date: stored.start_date,
        end_date: stored.end_date,
        posts_transaction: stored.posts_transaction,
        enabled,
        next_due_date,
    }
}

fn row_of(conn: &Connection, id: &str) -> notchy_lib::database::types::Schedule {
    list_schedules(conn)
        .unwrap()
        .into_iter()
        .find(|s| s.id == id)
        .expect("schedule exists")
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

#[test]
fn create_initializes_next_due_date_from_start_date() {
    let (mut conn, account_id) = fixture_conn_with_account();
    let input = NewSchedule {
        name: "Rent".into(),
        kind: ScheduleKind::Expense,
        amount: 5_000_000,
        account_id,
        transfer_account_id: None,
        tag_id: None,
        payee: Some("Landlord".into()),
        description: None,
        frequency: ScheduleFrequency::Monthly,
        start_date: "2026-01-31".into(),
        end_date: None,
        posts_transaction: 1,
    };
    let id = create_schedule(&mut conn, OperationId::generate(), input).unwrap();
    let row = row_of(&conn, &id);
    // Review Focus 1: a NULL next_due_date would be skipped forever.
    assert_eq!(row.next_due_date.as_deref(), Some("2026-01-31"));
    assert_eq!(row.completed, 0);
    assert_eq!(row.errored_at, None);
    assert_eq!(row.enabled, 1);
    assert_eq!(row.last_posted_date, None);
}

#[test]
fn creating_the_same_request_twice_returns_the_same_schedule() {
    // run_idempotent: one OperationId, one row, no duplicate on retry.
    let (mut conn, account_id) = fixture_conn_with_account();
    let op_id = OperationId::generate();
    let input = NewSchedule {
        name: "Rent".into(),
        kind: ScheduleKind::Expense,
        amount: 5_000_000,
        account_id,
        transfer_account_id: None,
        tag_id: None,
        payee: None,
        description: None,
        frequency: ScheduleFrequency::Monthly,
        start_date: "2026-01-31".into(),
        end_date: None,
        posts_transaction: 1,
    };

    let first = create_schedule(&mut conn, op_id.clone(), input.clone()).unwrap();
    let second = create_schedule(&mut conn, op_id.clone(), input).unwrap();

    assert_eq!(first, second);
    assert_eq!(list_schedules(&conn).unwrap().len(), 1);
}

#[test]
fn a_different_op_id_creates_a_second_schedule() {
    // The other half of idempotency: the same *request* under a new op_id is a
    // genuinely new user intent and must insert a second row. Without this,
    // "idempotent" could be satisfied by a create that silently no-ops.
    let (mut conn, account_id) = fixture_conn_with_account();
    let input = schedule("Rent", account_id);

    let first = create_schedule(&mut conn, OperationId::generate(), input.clone()).unwrap();
    let second = create_schedule(&mut conn, OperationId::generate(), input).unwrap();

    assert_ne!(
        first, second,
        "a new op_id must not replay the first receipt"
    );
    assert_eq!(list_schedules(&conn).unwrap().len(), 2);
}

#[test]
fn list_due_excludes_null_disabled_completed_errored_and_future() {
    // Review Focus 1: the NULL case is named in the title on purpose. A schedule
    // with no due date must be invisible to this query but still present in
    // list_schedules — the engine re-anchors it rather than the query hiding it
    // from the user forever.
    let (mut conn, account_id) = fixture_conn_with_account();
    // One row per exclusion reason; `start` also drives the due date, since
    // create_schedule initializes next_due_date from it.
    let mut make = |name: &str, start: &str| -> String {
        let mut input = schedule(name, account_id.clone());
        input.start_date = start.to_string();
        create_schedule(&mut conn, OperationId::generate(), input).unwrap()
    };
    let due = make("Due", "2026-01-01");
    let null_date = make("Null", "2026-01-01");
    let disabled = make("Disabled", "2026-01-01");
    let completed = make("Completed", "2026-01-01");
    let errored = make("Errored", "2026-01-01");
    let future = make("Future", "2027-01-01");

    conn.execute(
        "UPDATE schedules SET next_due_date = NULL WHERE id = ?1",
        [&null_date],
    )
    .unwrap();
    conn.execute(
        "UPDATE schedules SET enabled = 0 WHERE id = ?1",
        [&disabled],
    )
    .unwrap();
    conn.execute(
        "UPDATE schedules SET completed = 1 WHERE id = ?1",
        [&completed],
    )
    .unwrap();
    conn.execute(
        "UPDATE schedules SET errored_at = '2026-01-02T00:00:00Z' WHERE id = ?1",
        [&errored],
    )
    .unwrap();

    let returned: Vec<String> = list_due_schedules(&conn, "2026-01-10")
        .unwrap()
        .into_iter()
        .map(|s| s.id)
        .collect();

    assert_eq!(returned, vec![due]);
    // The NULL row is only skipped by this query, never hidden from the user.
    assert!(list_schedules(&conn)
        .unwrap()
        .iter()
        .any(|s| s.id == null_date));
    assert!(!returned.contains(&future));
}

#[test]
fn list_due_orders_by_due_date_then_id() {
    let (mut conn, account_id) = fixture_conn_with_account();
    let later = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("B", account_id.clone()),
    )
    .unwrap();
    let sooner = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("A", account_id.clone()),
    )
    .unwrap();
    conn.execute(
        "UPDATE schedules SET next_due_date = '2026-01-09' WHERE id = ?1",
        [&later],
    )
    .unwrap();
    conn.execute(
        "UPDATE schedules SET next_due_date = '2026-01-02' WHERE id = ?1",
        [&sooner],
    )
    .unwrap();

    let ids: Vec<String> = list_due_schedules(&conn, "2026-01-10")
        .unwrap()
        .into_iter()
        .map(|s| s.id)
        .collect();
    assert_eq!(ids, vec![sooner, later]);
}

#[test]
fn list_schedules_orders_newest_first() {
    // `create_schedule` stamps created_at from `now_iso_utc()` (one-second
    // resolution), so two inserts in the same second would tie. Pin distinct
    // values to make the ordering assertion deterministic.
    let (mut conn, account_id) = fixture_conn_with_account();
    let older = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("Older", account_id.clone()),
    )
    .unwrap();
    let newer = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("Newer", account_id),
    )
    .unwrap();
    conn.execute(
        "UPDATE schedules SET created_at = '2026-01-01T00:00:00Z' WHERE id = ?1",
        [&older],
    )
    .unwrap();
    conn.execute(
        "UPDATE schedules SET created_at = '2026-01-02T00:00:00Z' WHERE id = ?1",
        [&newer],
    )
    .unwrap();

    let ids: Vec<String> = list_schedules(&conn)
        .unwrap()
        .into_iter()
        .map(|s| s.id)
        .collect();
    assert_eq!(ids, vec![newer, older], "newest first");
}

#[test]
fn list_schedules_breaks_a_created_at_tie_by_id_desc() {
    // `now_iso_utc()` has one-second resolution, so two schedules created in the
    // same second genuinely tie on `created_at`. Without the `, id DESC`
    // tiebreaker SQLite falls back to ascending rowid — oldest-first, not
    // newest-first. Pin both ids explicitly so the assertion does not depend on
    // ULID generation order, and give both rows the identical timestamp.
    let (mut conn, account_id) = fixture_conn_with_account();
    let first = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("Tie A", account_id.clone()),
    )
    .unwrap();
    let second = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("Tie B", account_id),
    )
    .unwrap();
    let lower_id = "01J8Z9Q0K5N6P7R8S9T0V1W2X3";
    let higher_id = "01J8Z9Q0K5N6P7R8S9T0V1W2X4";
    conn.execute(
        "UPDATE schedules SET id = ?1, created_at = '2026-02-01T00:00:00Z' WHERE id = ?2",
        rusqlite::params![lower_id, first],
    )
    .unwrap();
    conn.execute(
        "UPDATE schedules SET id = ?1, created_at = '2026-02-01T00:00:00Z' WHERE id = ?2",
        rusqlite::params![higher_id, second],
    )
    .unwrap();

    let ids: Vec<String> = list_schedules(&conn)
        .unwrap()
        .into_iter()
        .map(|s| s.id)
        .collect();
    assert_eq!(
        ids,
        vec![higher_id.to_string(), lower_id.to_string()],
        "a created_at tie must break by id DESC"
    );
}

#[test]
fn mark_posted_advances_the_dates_and_can_complete() {
    let (mut conn, account_id) = fixture_conn_with_account();
    let id = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("Rent", account_id),
    )
    .unwrap();

    mark_schedule_posted(
        &mut conn,
        OperationId::generate(),
        &id,
        Some("2026-01-31".into()),
        Some("2026-02-28".into()),
        1,
    )
    .unwrap();

    let row = row_of(&conn, &id);
    assert_eq!(row.last_posted_date.as_deref(), Some("2026-01-31"));
    assert_eq!(row.next_due_date.as_deref(), Some("2026-02-28"));
    assert_eq!(row.completed, 1);
}

#[test]
fn replaying_mark_posted_with_the_same_op_id_does_not_advance_twice() {
    let (mut conn, account_id) = fixture_conn_with_account();
    let id = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("Rent", account_id),
    )
    .unwrap();

    let op_id = OperationId::generate();
    mark_schedule_posted(
        &mut conn,
        op_id.clone(),
        &id,
        Some("2026-01-31".into()),
        Some("2026-02-28".into()),
        0,
    )
    .unwrap();
    // A retried boot replays the identical intent: the receipt must be returned
    // instead of advancing the date a second time.
    mark_schedule_posted(
        &mut conn,
        op_id.clone(),
        &id,
        Some("2026-01-31".into()),
        Some("2026-02-28".into()),
        0,
    )
    .unwrap();

    let row = row_of(&conn, &id);
    assert_eq!(row.last_posted_date.as_deref(), Some("2026-01-31"));
    assert_eq!(row.next_due_date.as_deref(), Some("2026-02-28"));
}

#[test]
fn a_replayed_op_id_does_not_run_the_write_a_second_time() {
    // The receipt path and a bypassed receipt path are indistinguishable by
    // *values* here: `mark_schedule_posted`'s request is the whole DTO, so a
    // re-run writes exactly the same dates back, and `now_iso_utc()` has
    // one-second resolution, so even `updated_at` comes out identical within the
    // same second. "The row still says 2026-02-28" therefore passes whether or
    // not the receipt was honoured.
    //
    // Park a sentinel the request can never produce instead, then replay. Only a
    // genuine receipt replay leaves it standing; a fresh op_id re-runs the
    // closure and overwrites it.
    let (mut conn, account_id) = fixture_conn_with_account();
    let id = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("Rent", account_id),
    )
    .unwrap();

    let op_id = OperationId::generate();
    mark_schedule_posted(
        &mut conn,
        op_id.clone(),
        &id,
        Some("2026-01-31".into()),
        Some("2026-02-28".into()),
        0,
    )
    .unwrap();
    // The first call really wrote — otherwise the sentinel below proves nothing.
    assert_eq!(
        row_of(&conn, &id).next_due_date.as_deref(),
        Some("2026-02-28")
    );

    conn.execute(
        "UPDATE schedules
            SET next_due_date = '1999-12-31', last_posted_date = '1999-12-30',
                completed = 1, updated_at = '1999-01-01T00:00:00Z'
          WHERE id = ?1",
        [&id],
    )
    .unwrap();

    // Identical op_id, identical request: this must be served from the receipt.
    mark_schedule_posted(
        &mut conn,
        op_id,
        &id,
        Some("2026-01-31".into()),
        Some("2026-02-28".into()),
        0,
    )
    .unwrap();

    let row = row_of(&conn, &id);
    assert_eq!(
        row.next_due_date.as_deref(),
        Some("1999-12-31"),
        "a replayed op_id must not re-run the write"
    );
    assert_eq!(row.last_posted_date.as_deref(), Some("1999-12-30"));
    assert_eq!(row.completed, 1);
    assert_eq!(
        row.updated_at, "1999-01-01T00:00:00Z",
        "even the timestamp must be untouched by a replay"
    );
}

#[test]
fn a_different_op_id_marks_posted_again() {
    // Same schedule, new intent: the second mark really runs.
    let (mut conn, account_id) = fixture_conn_with_account();
    let id = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("Rent", account_id),
    )
    .unwrap();

    mark_schedule_posted(
        &mut conn,
        OperationId::generate(),
        &id,
        Some("2026-01-31".into()),
        Some("2026-02-28".into()),
        0,
    )
    .unwrap();
    mark_schedule_posted(
        &mut conn,
        OperationId::generate(),
        &id,
        Some("2026-02-28".into()),
        Some("2026-03-31".into()),
        1,
    )
    .unwrap();

    let row = row_of(&conn, &id);
    assert_eq!(row.last_posted_date.as_deref(), Some("2026-02-28"));
    assert_eq!(row.next_due_date.as_deref(), Some("2026-03-31"));
    assert_eq!(row.completed, 1);
}

#[test]
fn mark_posted_is_a_no_op_for_an_unknown_id() {
    // A schedule deleted mid-pass must not fail the boot of every other one.
    let (mut conn, _) = fixture_conn_with_account();
    mark_schedule_posted(&mut conn, OperationId::generate(), "missing", None, None, 0).unwrap();
}

#[test]
fn mark_posted_does_not_touch_a_deleted_schedule() {
    // The row is still physically present, so `WHERE id = ?` alone would write
    // to it. mark_schedule_posted must skip it like every other read.
    let (mut conn, account_id) = fixture_conn_with_account();
    let id = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("Rent", account_id),
    )
    .unwrap();
    delete_schedule(&mut conn, OperationId::generate(), &id).unwrap();

    mark_schedule_posted(
        &mut conn,
        OperationId::generate(),
        &id,
        Some("2026-01-31".into()),
        Some("2026-02-28".into()),
        1,
    )
    .unwrap();

    let row: (Option<String>, Option<String>, i64) = conn
        .query_row(
            "SELECT last_posted_date, next_due_date, completed FROM schedules WHERE id = ?1",
            [&id],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
        )
        .unwrap();
    assert_eq!(row, (None, Some("2026-01-31".to_string()), 0));
}

#[test]
fn mark_errored_does_not_touch_a_deleted_schedule() {
    // Same reasoning as the posted mark: the row survives physically, so the
    // `deleted_at IS NULL` predicate is the only thing protecting it.
    let (mut conn, account_id) = fixture_conn_with_account();
    let id = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("Rent", account_id),
    )
    .unwrap();
    delete_schedule(&mut conn, OperationId::generate(), &id).unwrap();

    mark_schedule_errored(&mut conn, OperationId::generate(), &id).unwrap();

    let errored_at: Option<String> = conn
        .query_row(
            "SELECT errored_at FROM schedules WHERE id = ?1",
            [&id],
            |r| r.get(0),
        )
        .unwrap();
    assert_eq!(errored_at, None, "a deleted schedule must not be parked");
}

#[test]
fn mark_errored_parks_a_schedule_and_re_enabling_resumes_it() {
    // errored_at is set; list_due skips it; update_schedule enabling it again
    // clears errored_at so the schedule becomes due again. Passes
    // next_due_date: None, so the stored date is untouched — a parked backlog
    // must survive Resume.
    let (mut conn, account_id) = fixture_conn_with_account();
    let id = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("Rent", account_id),
    )
    .unwrap();

    mark_schedule_errored(&mut conn, OperationId::generate(), &id).unwrap();
    let parked = row_of(&conn, &id);
    assert!(
        parked.errored_at.is_some(),
        "mark_errored must stamp errored_at"
    );
    assert!(
        list_due_schedules(&conn, "2026-06-01").unwrap().is_empty(),
        "a parked schedule must not be picked up again"
    );

    let input = update_of(&conn, &id, 1, None);
    update_schedule(&mut conn, OperationId::generate(), &id, input).unwrap();

    let row = row_of(&conn, &id);
    assert_eq!(row.errored_at, None);
    assert_eq!(row.next_due_date.as_deref(), Some("2026-01-31"));
    assert_eq!(list_due_schedules(&conn, "2026-06-01").unwrap().len(), 1);
}

#[test]
fn update_sets_next_due_date_when_the_caller_supplies_one() {
    // This is the one field where None means "unchanged" rather than "clear", so
    // it gets its own test in both directions.
    let (mut conn, account_id) = fixture_conn_with_account();
    let id = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("Rent", account_id),
    )
    .unwrap();

    let input = update_of(&conn, &id, 0, Some("2026-06-28".into()));
    update_schedule(&mut conn, OperationId::generate(), &id, input).unwrap();
    let row = row_of(&conn, &id);
    assert_eq!(row.next_due_date.as_deref(), Some("2026-06-28"));

    let input = update_of(&conn, &id, 0, None);
    update_schedule(&mut conn, OperationId::generate(), &id, input).unwrap();
    let row = row_of(&conn, &id);
    assert_eq!(
        row.next_due_date.as_deref(),
        Some("2026-06-28"),
        "None must not clear the date"
    );
}

#[test]
fn update_while_disabled_keeps_the_parked_error() {
    // The clear is conditional on enabled = 1. An edit that leaves the schedule
    // paused must not silently resume it.
    let (mut conn, account_id) = fixture_conn_with_account();
    let id = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("Rent", account_id),
    )
    .unwrap();
    mark_schedule_errored(&mut conn, OperationId::generate(), &id).unwrap();

    let input = update_of(&conn, &id, 0, None);
    update_schedule(&mut conn, OperationId::generate(), &id, input).unwrap();

    assert!(row_of(&conn, &id).errored_at.is_some());
}

#[test]
fn update_rewrites_every_field_it_owns() {
    let (mut conn, account_id) = fixture_conn_with_account();
    let id = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("Rent", account_id),
    )
    .unwrap();

    let mut input = update_of(&conn, &id, 1, None);
    input.name = "Rent (raise)".into();
    input.amount = 5_250_000;
    input.frequency = ScheduleFrequency::Biweekly;
    input.payee = Some("Landlord LLC".into());
    input.description = Some("monthly".into());
    update_schedule(&mut conn, OperationId::generate(), &id, input).unwrap();

    let row = row_of(&conn, &id);
    assert_eq!(row.name, "Rent (raise)");
    assert_eq!(row.amount, 5_250_000);
    assert_eq!(row.frequency, ScheduleFrequency::Biweekly);
    assert_eq!(row.payee.as_deref(), Some("Landlord LLC"));
    assert_eq!(row.description.as_deref(), Some("monthly"));
}

#[test]
fn update_rejects_an_unknown_id() {
    let (mut conn, _) = fixture_conn_with_account();
    let result = update_schedule(
        &mut conn,
        OperationId::generate(),
        "missing",
        ScheduleUpdate {
            name: "Rent".into(),
            kind: ScheduleKind::Expense,
            amount: 100,
            account_id: "whatever".into(),
            transfer_account_id: None,
            tag_id: None,
            payee: None,
            description: None,
            frequency: ScheduleFrequency::Monthly,
            start_date: "2026-01-31".into(),
            end_date: None,
            posts_transaction: 1,
            enabled: 1,
            next_due_date: None,
        },
    );
    assert!(
        result.is_err(),
        "an id that matched no row must not succeed"
    );
}

#[test]
fn delete_soft_deletes_and_hides_from_list() {
    let (mut conn, account_id) = fixture_conn_with_account();
    let id = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("Rent", account_id),
    )
    .unwrap();

    delete_schedule(&mut conn, OperationId::generate(), &id).unwrap();

    assert!(list_schedules(&conn).unwrap().is_empty());
    assert!(list_due_schedules(&conn, "2026-06-01").unwrap().is_empty());
    let deleted_at: Option<String> = conn
        .query_row(
            "SELECT deleted_at FROM schedules WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .unwrap();
    assert!(deleted_at.is_some(), "soft delete, not a hard DELETE");
}

#[test]
fn update_does_not_touch_a_deleted_schedule() {
    // A schedule deleted while the form was open must not be resurrected by a
    // late save.
    let (mut conn, account_id) = fixture_conn_with_account();
    let id = create_schedule(
        &mut conn,
        OperationId::generate(),
        schedule("Rent", account_id),
    )
    .unwrap();
    // Read the row back *before* deleting: `update_of` goes through
    // `list_schedules`, which by design hides deleted rows.
    let mut input = update_of(&conn, &id, 1, None);
    input.name = "Resurrected".into();
    delete_schedule(&mut conn, OperationId::generate(), &id).unwrap();

    let result = update_schedule(&mut conn, OperationId::generate(), &id, input);

    assert!(
        result.is_err(),
        "an update to a deleted row must be rejected"
    );
    let name: String = conn
        .query_row("SELECT name FROM schedules WHERE id = ?1", [&id], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(name, "Rent");
}

#[test]
fn delete_rejects_an_unknown_id() {
    let (mut conn, _) = fixture_conn_with_account();
    assert!(delete_schedule(&mut conn, OperationId::generate(), "missing").is_err());
}

#[test]
fn create_rejects_a_transfer_without_a_destination() {
    // The DB CHECK is the authority; the domain must not paper over it.
    let (mut conn, account_id) = fixture_conn_with_account();
    let result = create_schedule(
        &mut conn,
        OperationId::generate(),
        NewSchedule {
            name: "Savings".into(),
            kind: ScheduleKind::Transfer,
            amount: 1_000_000,
            account_id,
            transfer_account_id: None,
            tag_id: None,
            payee: None,
            description: None,
            frequency: ScheduleFrequency::Monthly,
            start_date: "2026-01-01".into(),
            end_date: None,
            posts_transaction: 1,
        },
    );
    assert!(result.is_err());
    assert!(
        list_schedules(&conn).unwrap().is_empty(),
        "the rejected insert must not leave a row behind"
    );
}
