use notchy_lib::database::automatic_backup::{read_automatic_status, install_content_revision_triggers};
use notchy_lib::database::domains::meta;
use notchy_lib::database::{run_migrations, validate_manifest, FailurePoint, LATEST_SCHEMA_VERSION};
use rusqlite::Connection;

fn database(version: i64) -> Connection {
    let mut db = Connection::open_in_memory().unwrap();
    db.execute_batch("PRAGMA foreign_keys = ON").unwrap();
    run_migrations(&mut db, version, FailurePoint::None).unwrap();
    db
}
fn revision(db: &Connection) -> i64 {
    read_automatic_status(db).unwrap().content_revision
}
fn account(db: &Connection) {
    db.execute("INSERT INTO accounts (id,name,type,created_at,updated_at) VALUES ('a','Cash','cash','x','x')", []).unwrap();
}
fn expense(db: &Connection, id: &str) {
    db.execute("INSERT INTO transactions (id,kind,date,amount,account_id,created_at,updated_at) VALUES (?1,'expense','2026-10-26',100,'a','x','x')", [id]).unwrap();
}

#[test]
fn tracks_only_committed_content_changes() {
    let mut db = database(LATEST_SCHEMA_VERSION);
    account(&db);
    let revision_before = revision(&db);
    {
        let tx = db.transaction().unwrap();
        expense(&tx, "rolled-back");
        assert!(revision(&tx) > revision_before);
        tx.rollback().unwrap();
    }
    let revision_after_rollback = revision(&db);
    assert_eq!(revision_after_rollback, revision_before);
    expense(&db, "committed");
    let revision_after_expense = revision(&db);
    assert!(revision_after_expense > revision_before);
    db.execute("UPDATE transactions SET amount=amount, updated_at='later'", []).unwrap();
    assert_eq!(revision(&db), revision_after_expense);
    db.execute("UPDATE transactions SET amount=200", []).unwrap();
    assert!(revision(&db) > revision_after_expense);
    let before_delete = revision(&db);
    db.execute("DELETE FROM transactions", []).unwrap();
    assert!(revision(&db) > before_delete);
}

#[test]
fn metadata_allowlist_tracks_real_setter_changes_and_ignores_bookkeeping() {
    let db = database(LATEST_SCHEMA_VERSION);
    for key in ["currency", "first_run_complete", "onboarding_step"] {
        let before = revision(&db);
        meta::set_meta(&db, key, "1").unwrap();
        assert!(revision(&db) > before, "{key}");
        let after_insert = revision(&db);
        meta::set_meta(&db, key, "1").unwrap();
        assert_eq!(revision(&db), after_insert, "same-value {key}");
        db.execute("INSERT OR IGNORE INTO app_meta (key,value) VALUES (?1,'ignored')", [key]).unwrap();
        assert_eq!(revision(&db), after_insert, "ignored {key}");
        meta::set_meta(&db, key, "2").unwrap();
        assert!(revision(&db) > after_insert);
        let before_delete = revision(&db);
        meta::delete_meta(&db, key).unwrap();
        assert!(revision(&db) > before_delete);
    }
    let before = revision(&db);
    for key in ["locale", "theme", "last_opened_at", "last_backup_at", "receipt_id", "last_successful_app_version", "schema_version"] {
        meta::set_meta(&db, key, "x").unwrap();
    }
    db.execute("INSERT INTO operation_receipts VALUES ('op','set','hash','{}','x')", []).unwrap();
    db.execute("INSERT INTO change_log (table_name,row_id,operation,timestamp,device_id) VALUES ('accounts','x','insert','x','x')", []).unwrap();
    db.execute("UPDATE automatic_backup_state SET enabled=0,warning='retry',prune_warning='retry',last_success_at='x',last_success_date='2026-10-26'", []).unwrap();
    db.execute("INSERT INTO automatic_backup_copies (id,relative_filename,schema_version,captured_revision,local_date,local_week,created_at,publication_job_id,offset_minutes) VALUES ('copy','owned.sqlite',8,0,'2026-10-26','2026-W44','x','job',420)", []).unwrap();
    assert_eq!(revision(&db), before);
}

#[test]
fn fresh_scratch_profile_stays_clean_until_meaningful_content() {
    let db = database(LATEST_SCHEMA_VERSION);
    let status = read_automatic_status(&db).unwrap();
    assert!(status.enabled);
    assert_eq!(status.content_revision, 0);
    assert_eq!(status.backed_up_revision, 0);
    assert!(status.last_success_at.is_none());
    assert!(status.last_success_date.is_none());
    assert!(status.warning.is_none());
    assert!(status.prune_warning.is_none());
    meta::set_meta(&db, "first_run_complete", "1").unwrap();
    assert!(revision(&db) > status.backed_up_revision);
}

#[test]
fn migrates_existing_populated_ledgers_dirty_and_preserves_prior_manifests() {
    for version in 3..=7 {
        let mut db = database(version);
        validate_manifest(&db, version).unwrap();
        account(&db);
        expense(&db, "existing");
        run_migrations(&mut db, LATEST_SCHEMA_VERSION, FailurePoint::None).unwrap();
        validate_manifest(&db, LATEST_SCHEMA_VERSION).unwrap();
        let status = read_automatic_status(&db).unwrap();
        assert_eq!(status.content_revision, 1);
        assert_eq!(status.backed_up_revision, 0);
        assert_eq!(db.query_row("SELECT amount FROM transactions WHERE id='existing'", [], |r| r.get::<_, i64>(0)).unwrap(), 100);
    }
}

#[test]
fn migrated_seed_only_is_clean_but_customized_seed_and_profile_metadata_are_dirty() {
    for customization in [None, Some("UPDATE category_types SET name='Custom' WHERE id='bucket_essentials'"), Some("INSERT INTO app_meta VALUES ('currency','USD')")] {
        let mut db = database(7);
        if let Some(sql) = customization {
            db.execute(sql, []).unwrap();
        }
        run_migrations(&mut db, LATEST_SCHEMA_VERSION, FailurePoint::None).unwrap();
        assert_eq!(revision(&db), if customization.is_some() { 1 } else { 0 });
    }
}

#[test]
fn tracks_all_current_financial_domains_and_durable_schedule_progress() {
    let db = database(LATEST_SCHEMA_VERSION);
    account(&db);
    let writes = [
        "UPDATE accounts SET name='Wallet'",
        "UPDATE category_types SET rollover_enabled=0 WHERE id='bucket_essentials'",
        "UPDATE category_tags SET name='Changed' WHERE id='tag_gift'",
        "INSERT INTO budgets (id,type_id,month,allocated,created_at,updated_at) VALUES ('b','bucket_essentials','2026-10',100,'x','x')",
        "INSERT INTO goals (id,name,type,target_amount,target_date,starting_amount,created_at,updated_at) VALUES ('g','Goal','savings',100,'2027-01-01',0,'x','x')",
        "INSERT INTO reconciliations (id,account_id,date,expected_balance,actual_balance,created_at,updated_at) VALUES ('r','a','2026-10-26',100,100,'x','x')",
        "INSERT INTO categorize_rules (id,payee_term,match_mode,tag_id,created_at,updated_at) VALUES ('rule','Shop','is','tag_gift','x','x')",
        "INSERT INTO schedules (id,name,kind,amount,account_id,frequency,start_date,created_at,updated_at) VALUES ('s','Rent','expense',100,'a','monthly','2026-10-26','x','x')",
        "UPDATE schedules SET next_due_date='2026-11-26',last_posted_date='2026-10-26',completed=1,errored_at='x'",
    ];
    for sql in writes {
        let before = revision(&db);
        db.execute(sql, []).unwrap();
        assert!(revision(&db) > before, "{sql}");
    }
}

#[test]
fn later_content_tables_can_install_revision_triggers_transactionally() {
    let mut db = database(LATEST_SCHEMA_VERSION);
    let before = revision(&db);
    let tx = db.transaction().unwrap();
    tx.execute("CREATE TABLE future_content (id TEXT PRIMARY KEY, amount INTEGER, updated_at TEXT)", []).unwrap();
    install_content_revision_triggers(&tx, &["future_content"]).unwrap();
    tx.commit().unwrap();
    db.execute("INSERT INTO future_content VALUES ('f',42,'x')", []).unwrap();
    assert!(revision(&db) > before);
    let before = revision(&db);
    db.execute("UPDATE future_content SET updated_at='later'", []).unwrap();
    assert_eq!(revision(&db), before);
    db.execute("UPDATE future_content SET amount=43", []).unwrap();
    assert!(revision(&db) > before);
}

#[test]
fn schema_validation_requires_revision_triggers_and_bounded_revisions() {
    let db = database(LATEST_SCHEMA_VERSION);
    assert!(db.execute("UPDATE automatic_backup_state SET content_revision=9007199254740992", []).is_err());
    assert!(db.execute("UPDATE automatic_backup_state SET content_revision=-1", []).is_err());
    assert!(db.execute("INSERT INTO automatic_backup_state (id) VALUES (2)", []).is_err());
    db.execute("DROP TRIGGER trg_content_transactions_update", []).unwrap();
    assert!(validate_manifest(&db, LATEST_SCHEMA_VERSION).is_err());
}

#[test]
fn rejects_unsafe_persisted_revisions_at_the_status_boundary() {
    let db = database(LATEST_SCHEMA_VERSION);
    db.execute_batch("PRAGMA ignore_check_constraints=ON; UPDATE automatic_backup_state SET content_revision=9007199254740992").unwrap();
    assert!(read_automatic_status(&db).is_err());
}

#[test]
fn financial_metadata_rollback_restores_the_content_revision() {
    let mut db = database(LATEST_SCHEMA_VERSION);
    let before = revision(&db);
    let tx = db.transaction().unwrap();
    meta::set_meta(&tx,"currency","USD").unwrap();
    assert!(revision(&tx) > before);
    tx.rollback().unwrap();
    assert_eq!(revision(&db), before);
}

#[test]
fn clock_offsets_survive_reopen_and_transaction_rollback_without_marking_content() {
    let path = std::env::temp_dir().join(format!("notchy-auto-offset-{}.sqlite",notchy_lib::database::OperationId::generate().as_str()));
    let mut db = Connection::open(&path).unwrap();
    run_migrations(&mut db,LATEST_SCHEMA_VERSION,FailurePoint::None).unwrap();
    db.execute("UPDATE automatic_backup_state SET last_success_offset_minutes=420,pending_offset_minutes=420",[]).unwrap();
    db.execute("INSERT INTO automatic_backup_copies (id,relative_filename,schema_version,captured_revision,local_date,local_week,created_at,publication_job_id,offset_minutes) VALUES ('copy','owned.sqlite',8,0,'2026-10-26','2026-W44','2026-10-26T10:00:00Z','job',420)",[]).unwrap();
    drop(db);
    let mut db = Connection::open(&path).unwrap();
    let tx = db.transaction().unwrap();
    tx.execute("UPDATE automatic_backup_state SET last_success_offset_minutes=-300,pending_offset_minutes=-300",[]).unwrap();
    tx.execute("UPDATE automatic_backup_copies SET offset_minutes=-300",[]).unwrap();
    tx.rollback().unwrap();
    assert_eq!(db.query_row("SELECT last_success_offset_minutes,pending_offset_minutes FROM automatic_backup_state",[],|row|Ok((row.get::<_,i64>(0)?,row.get::<_,i64>(1)?))).unwrap(),(420,420));
    assert_eq!(db.query_row("SELECT offset_minutes FROM automatic_backup_copies",[],|row|row.get::<_,i64>(0)).unwrap(),420);
    assert_eq!(revision(&db), 0);
    drop(db);
    std::fs::remove_file(path).unwrap();
}


fn registry_without_unique_column(column: &str) -> Connection {
    let db = database(LATEST_SCHEMA_VERSION);
    let schema: String = db.query_row(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='automatic_backup_copies'",
        [], |row| row.get(0),
    ).unwrap();
    let schema = schema.replace(
        &format!("{column} TEXT NOT NULL UNIQUE"),
        &format!("{column} TEXT NOT NULL"),
    );
    db.execute_batch("DROP TABLE automatic_backup_copies").unwrap();
    db.execute_batch(&schema).unwrap();
    db
}

#[test]
fn rejects_registry_without_unique_relative_filename() {
    let db = registry_without_unique_column("relative_filename");
    db.execute_batch(
        "INSERT INTO automatic_backup_copies
         (id,relative_filename,schema_version,captured_revision,local_date,local_week,created_at,publication_job_id,offset_minutes)
         VALUES ('a','same.sqlite',8,0,'2026-10-26','2026-W44','x','job-a',420),
                ('b','same.sqlite',8,0,'2026-10-26','2026-W44','x','job-b',420)"
    ).unwrap();
    assert_eq!(validate_manifest(&db, 8).unwrap_err().code, notchy_lib::database::ErrorCode::DatabaseInvalid);
}

#[test]
fn rejects_registry_without_unique_publication_job_id() {
    let db = registry_without_unique_column("publication_job_id");
    db.execute_batch(
        "INSERT INTO automatic_backup_copies
         (id,relative_filename,schema_version,captured_revision,local_date,local_week,created_at,publication_job_id,offset_minutes)
         VALUES ('a','a.sqlite',8,0,'2026-10-26','2026-W44','x','same-job',420),
                ('b','b.sqlite',8,0,'2026-10-26','2026-W44','x','same-job',420)"
    ).unwrap();
    assert_eq!(validate_manifest(&db, 8).unwrap_err().code, notchy_lib::database::ErrorCode::DatabaseInvalid);
}


#[test]
fn rejects_nonunique_partial_or_composite_registry_indexes() {
    for column in ["relative_filename", "publication_job_id"] {
        for index_definition in [
            format!("CREATE INDEX misleading_unique ON automatic_backup_copies ({column})"),
            format!("CREATE UNIQUE INDEX misleading_unique ON automatic_backup_copies ({column}) WHERE id='protected'"),
            format!("CREATE UNIQUE INDEX misleading_unique ON automatic_backup_copies ({column},id)"),
        ] {
            let db = registry_without_unique_column(column);
            db.execute_batch(&index_definition).unwrap();
            let (filename_a, filename_b, job_a, job_b) = if column == "relative_filename" {
                ("same.sqlite", "same.sqlite", "job-a", "job-b")
            } else {
                ("a.sqlite", "b.sqlite", "same-job", "same-job")
            };
            for (id, filename, job) in [("a", filename_a, job_a), ("b", filename_b, job_b)] {
                db.execute(
                    "INSERT INTO automatic_backup_copies
                     (id,relative_filename,schema_version,captured_revision,local_date,local_week,created_at,publication_job_id,offset_minutes)
                     VALUES (?1,?2,8,0,'2026-10-26','2026-W44','x',?3,420)",
                    rusqlite::params![id, filename, job],
                ).unwrap();
            }
            assert_eq!(
                validate_manifest(&db, 8).unwrap_err().code,
                notchy_lib::database::ErrorCode::DatabaseInvalid,
                "{column}: {index_definition}",
            );
        }
    }
}


use notchy_lib::database::automatic_backup::{automatic_backup_due, automatic_retention_ids, automatic_prune_clock_trusted, AutomaticBackupStatus, AutomaticCopy};
use notchy_lib::database::clock::{BackupClock, local_backup_clock};
fn policy_fixture() -> serde_json::Value {
    serde_json::from_str(include_str!("../../src/tests/fixtures/automatic-backup-policy.json")).unwrap()
}
#[test]
fn applies_daily_changed_content_eligibility() {
    for case in policy_fixture()["eligibility"].as_array().unwrap() {
        let status: AutomaticBackupStatus = serde_json::from_value(case["status"].clone()).unwrap();
        let clock: BackupClock = serde_json::from_value(case["clock"].clone()).unwrap();
        assert_eq!(automatic_backup_due(&status, &clock), case["due"].as_bool().unwrap(), "{}", case["name"]);
    }
}
#[test]
fn defers_pruning_for_clock_label_changes_until_stable_again() {
    for case in policy_fixture()["clocks"].as_array().unwrap() {
        let previous = serde_json::from_value(case["previous"].clone()).unwrap();
        let current = serde_json::from_value(case["current"].clone()).unwrap();
        assert_eq!(automatic_prune_clock_trusted(&previous, &current), case["trusted"].as_bool().unwrap(), "{}", case["name"]);
    }
}
#[test]
fn retains_union_of_daily_weekly_and_schema_copies() {
    let fixture = policy_fixture();
    let case = &fixture["retention"];
    let copies: Vec<AutomaticCopy> = serde_json::from_value(case["copies"].clone()).unwrap();
    let protected: Vec<String> = serde_json::from_value(case["protected"].clone()).unwrap();
    let mut deletions = automatic_retention_ids(&copies, case["protectedId"].as_str().unwrap());
    assert!(deletions.iter().all(|id| !protected.contains(id)));
    let mut expected: Vec<String> = serde_json::from_value(case["deletions"].clone()).unwrap();
    deletions.sort(); expected.sort();
    assert_eq!(deletions, expected);
}
#[test]
fn observes_consistent_native_local_clock_labels() {
    let clock = local_backup_clock();
    assert!(automatic_prune_clock_trusted(&clock, &clock));
}

use notchy_lib::profiles::{coordinator::ProfileCoordinator, paths::ProfilePaths, types::{OperationContext, ProfileSession}};
use notchy_lib::profiles::automatic_backup::AutomaticBackupFailurePoint as AutoFail;
use notchy_lib::database::{OperationId, ErrorCode};
use std::sync::Arc;
fn auto_context() -> OperationContext { OperationContext { operation_id: OperationId::generate().as_str().into(), transition_token: None } }
fn day(n: u32) -> BackupClock {
    use chrono::NaiveDate;
    let date = NaiveDate::from_ymd_opt(2026, 10, n).unwrap();
    BackupClock { now_iso: format!("{date}T10:00:00Z"), local_date: date.to_string(), iso_week: date.format("%G-W%V").to_string(), offset_minutes: 0 }
}
async fn auto_fixture() -> (ProfilePaths, Arc<ProfileCoordinator>, ProfileSession) {
    let root = std::env::temp_dir().join(format!("notchy-auto-run-{}", OperationId::generate().as_str()));
    let paths = ProfilePaths::new(root.join("config"), root.join("data"));
    let coordinator = ProfileCoordinator::open(paths.clone()).unwrap();
    let profile = coordinator.create("Automatic", &auto_context()).await.unwrap();
    let session = coordinator.activate(&profile.id).await.unwrap();
    dirty(&coordinator, &session, "USD").await;
    (paths, coordinator, session)
}
async fn dirty(c: &ProfileCoordinator, s: &ProfileSession, value: &str) {
    let value = value.to_owned();
    c.with_session(s, move |state| notchy_lib::database::domains::meta::set_meta(state.connection()?, "currency", &value)).await.unwrap();
}
async fn registered(c: &ProfileCoordinator, s: &ProfileSession) -> Vec<(String, String, i64)> {
    c.with_session(s, |state| {
        Ok(state.connection()?.prepare("SELECT id,relative_filename,captured_revision FROM automatic_backup_copies ORDER BY created_at").unwrap().query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().collect::<rusqlite::Result<_>>().unwrap())
    }).await.unwrap()
}
#[tokio::test]
async fn concurrent_checks_publish_one_copy_and_preserve_later_dirty_revision() {
    let (_, c, s) = auto_fixture().await;
    let clock = day(1);
    let (a,b) = tokio::join!(c.check_automatic_backup_at(&s, &clock, AutoFail::None), c.check_automatic_backup_at(&s, &clock, AutoFail::None));
    assert_eq!(a.unwrap().backed_up_revision, 1); assert_eq!(b.unwrap().backed_up_revision, 1);
    assert_eq!(registered(&c,&s).await.len(), 1);
    dirty(&c,&s,"VND").await;
    let status = c.check_automatic_backup_at(&s,&clock,AutoFail::None).await.unwrap();
    assert_eq!((status.content_revision,status.backed_up_revision), (2,1));
    assert_eq!(status.next_eligible_date.as_deref(),Some("2026-10-02"));
}
#[tokio::test]
async fn reconciles_published_job_after_reopen() {
    let (paths, c, s) = auto_fixture().await;
    let status = c.check_automatic_backup_at(&s,&day(1),AutoFail::AfterPublication).await.unwrap();
    assert!(status.warning.is_some()); assert_eq!(status.backed_up_revision, 0);
    let before = c.backups(&s.profile_id).await.unwrap(); assert_eq!(before.len(),1);
    dirty(&c,&s,"VND").await;
    drop(c);
    let c = ProfileCoordinator::open(paths.clone()).unwrap();
    let s = c.activate(&s.profile_id).await.unwrap();
    let status = c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap();
    let verified_automatic_copy_count = registered(&c,&s).await.len();
    assert_eq!(verified_automatic_copy_count, 1);
    assert_eq!(registered(&c,&s).await[0].0,before[0].id);
    assert_eq!((status.content_revision,status.backed_up_revision), (2,1));
    assert!(status.warning.is_none());
}
#[tokio::test]
async fn retries_unpublished_job_without_deleting_prior_copies() {
    let (paths,c,s)=auto_fixture().await;
    c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap();
    let prior=c.backups(&s.profile_id).await.unwrap();
    dirty(&c,&s,"VND").await;
    let failed=c.check_automatic_backup_at(&s,&day(2),AutoFail::BeforePublication).await.unwrap();
    assert_eq!(failed.backed_up_revision,1); assert!(failed.warning.is_some());
    let job=c.with_session(&s,|st|Ok(st.connection()?.query_row("SELECT pending_job_id FROM automatic_backup_state",[],|r|r.get::<_,String>(0)).unwrap())).await.unwrap();
    assert_eq!(c.backups(&s.profile_id).await.unwrap(),prior);
    drop(c);
    let c=ProfileCoordinator::open(paths).unwrap(); let s=c.activate(&s.profile_id).await.unwrap();
    c.check_automatic_backup_at(&s,&day(2),AutoFail::None).await.unwrap();
    assert!(registered(&c,&s).await.iter().any(|r|r.0==job));
    assert_eq!(registered(&c,&s).await.len(),2);
}
#[tokio::test]
async fn setting_is_receipt_backed_and_stale_sessions_cannot_publish() {
    let (_,c,s)=auto_fixture().await; let op=OperationId::generate();
    c.set_automatic_backup_enabled(&s,false,op.clone()).await.unwrap();
    c.set_automatic_backup_enabled(&s,false,op.clone()).await.unwrap();
    assert_eq!(c.set_automatic_backup_enabled(&s,true,op).await.unwrap_err().code,ErrorCode::OperationIdConflict);
    assert!(!c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap().enabled);
    assert!(registered(&c,&s).await.is_empty());
    let fresh=c.activate(&s.profile_id).await.unwrap();
    assert_eq!(c.automatic_backup_status(&s).await.unwrap_err().code,ErrorCode::ProfileSessionExpired);
    assert_eq!(c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap_err().code,ErrorCode::ProfileSessionExpired);
    assert!(!c.automatic_backup_status(&fresh).await.unwrap().enabled);
}
#[tokio::test]
async fn invalid_or_backwards_clocks_warn_without_publication() {
    let (_,c,s)=auto_fixture().await;
    c.check_automatic_backup_at(&s,&day(2),AutoFail::None).await.unwrap(); dirty(&c,&s,"VND").await;
    for clock in [day(1),BackupClock { now_iso:"bad".into(), ..day(3) }] {
        let status=c.check_automatic_backup_at(&s,&clock,AutoFail::None).await.unwrap();
        assert_eq!(status.warning.as_deref(),Some("backup_automatic_clock_warning"));
        assert_eq!(registered(&c,&s).await.len(),1);
    }
}
#[tokio::test]
async fn pruning_failure_preserves_success_and_retries_without_another_copy() {
    let (_,c,s)=auto_fixture().await;
    for n in 1..=9 { dirty(&c,&s,&n.to_string()).await; c.check_automatic_backup_at(&s,&day(n),AutoFail::Prune).await.unwrap(); }
    let status=c.automatic_backup_status(&s).await.unwrap();
    assert!(status.prune_warning.is_some()); assert!(status.warning.is_none());
    assert_eq!(registered(&c,&s).await.len(),9);
    let before=status.backed_up_revision;
    let status=c.check_automatic_backup_at(&s,&day(9),AutoFail::None).await.unwrap();
    assert_eq!(status.backed_up_revision,before); assert!(status.prune_warning.is_none());
    assert!(registered(&c,&s).await.len()<9);
}
#[tokio::test]
async fn offset_change_defers_pruning_using_prepublication_clock() {
    let (_,c,s)=auto_fixture().await;
    for n in 1..=9 { dirty(&c,&s,&n.to_string()).await; c.check_automatic_backup_at(&s,&day(n),AutoFail::Prune).await.unwrap(); }
    dirty(&c,&s,"10").await;
    let clock=BackupClock { offset_minutes:60, ..day(10) };
    let status=c.check_automatic_backup_at(&s,&clock,AutoFail::None).await.unwrap();
    assert_eq!(registered(&c,&s).await.len(),10);
    assert!(status.prune_warning.is_some());
}
#[tokio::test]
async fn restore_rebinds_ownership_without_changing_source_registry_or_files() {
    let (paths,c,s)=auto_fixture().await;
    c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap();
    c.set_automatic_backup_enabled(&s,false,OperationId::generate()).await.unwrap();
    let manual=c.backup_for_session(&s).await.unwrap();
    let rows=registered(&c,&s).await; let files=c.backups(&s.profile_id).await.unwrap();
    let preview=c.inspect_restore(manual.path()).await.unwrap();
    let restored=c.restore(&preview.token,"Restored",&auto_context()).await.unwrap();
    assert_eq!(registered(&c,&s).await,rows); assert_eq!(c.backups(&s.profile_id).await.unwrap(),files);
    let rs=c.activate(&restored.id).await.unwrap();
    let status=c.automatic_backup_status(&rs).await.unwrap();
    assert!(!status.enabled); assert_eq!(status.backed_up_revision,0); assert!(status.last_success_at.is_none());
    assert!(registered(&c,&rs).await.is_empty());
    c.set_automatic_backup_enabled(&rs,true,OperationId::generate()).await.unwrap();
    c.check_automatic_backup_at(&rs,&day(1),AutoFail::None).await.unwrap();
    assert_eq!(registered(&c,&rs).await.len(),1);
    for row in rows { assert!(paths.profile_dir(&s.profile_id).unwrap().join("backups").join(row.1).exists()); }
}

#[tokio::test]
async fn registry_commit_failure_preserves_publication_for_reopen_retry() {
    let (paths,c,s)=auto_fixture().await;
    c.with_session(&s,|st| { st.connection()?.execute_batch("CREATE TRIGGER fail_auto_register BEFORE INSERT ON automatic_backup_copies BEGIN SELECT RAISE(ABORT,'injected registry failure'); END").unwrap(); Ok(()) }).await.unwrap();
    let failed=c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap();
    assert!(failed.warning.is_some()); assert!(failed.last_success_at.is_none());
    assert_eq!(c.backups(&s.profile_id).await.unwrap().len(),1);
    assert!(registered(&c,&s).await.is_empty());
    c.with_session(&s,|st| {st.connection()?.execute_batch("DROP TRIGGER fail_auto_register").unwrap();Ok(())}).await.unwrap();
    drop(c);
    let c=ProfileCoordinator::open(paths).unwrap(); let s=c.activate(&s.profile_id).await.unwrap();
    assert!(c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap().warning.is_none());
    assert_eq!(registered(&c,&s).await.len(),1);
    assert_eq!(c.backups(&s.profile_id).await.unwrap().len(),1);
}
#[tokio::test]
async fn corrupt_pending_target_is_not_overwritten_or_registered() {
    let (paths,c,s)=auto_fixture().await;
    c.check_automatic_backup_at(&s,&day(1),AutoFail::AfterPublication).await.unwrap();
    let target=c.backups(&s.profile_id).await.unwrap()[0].path.clone();
    std::fs::write(&target,b"corrupt pending snapshot").unwrap();
    drop(c);
    let c=ProfileCoordinator::open(paths).unwrap(); let s=c.activate(&s.profile_id).await.unwrap();
    let status=c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap();
    assert_eq!(status.backed_up_revision,0); assert!(status.warning.is_some());
    assert!(registered(&c,&s).await.is_empty());
    assert_eq!(std::fs::read(target).unwrap(),b"corrupt pending snapshot");
}
#[tokio::test]
async fn pruning_preserves_manual_unregistered_reset_and_upgrade_files() {
    let (paths,c,s)=auto_fixture().await;
    let manual=c.backup_for_session(&s).await.unwrap();
    let dir=paths.profile_dir(&s.profile_id).unwrap().join("backups");
    let unknown=dir.join("unregistered.sqlite"); std::fs::copy(manual.path(),&unknown).unwrap();
    for folder in ["resets","upgrades"] {
        std::fs::create_dir_all(dir.join(folder)).unwrap();
        std::fs::copy(manual.path(),dir.join(folder).join("protected.sqlite")).unwrap();
    }
    let manual_bytes=std::fs::read(manual.path()).unwrap();
    for n in 1..=12 {dirty(&c,&s,&n.to_string()).await;c.check_automatic_backup_at(&s,&day(n),AutoFail::None).await.unwrap();}
    assert!(registered(&c,&s).await.len()<12);
    for path in [manual.path().to_owned(),unknown,dir.join("resets/protected.sqlite"),dir.join("upgrades/protected.sqlite")] {
        assert_eq!(std::fs::read(path).unwrap(),manual_bytes);
    }
}
#[cfg(unix)]
#[tokio::test]
async fn symlinked_backup_directory_cannot_publish_outside_profile() {
    let (paths,c,s)=auto_fixture().await;
    let outside=paths.data_dir.parent().unwrap().join("outside");std::fs::create_dir(&outside).unwrap();
    std::os::unix::fs::symlink(&outside,paths.profile_dir(&s.profile_id).unwrap().join("backups")).unwrap();
    let status=c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap();
    assert!(status.warning.is_some()); assert!(registered(&c,&s).await.is_empty());
    assert_eq!(std::fs::read_dir(outside).unwrap().count(),0);
}
#[tokio::test]
async fn pending_publication_from_a_future_clock_reports_clock_warning() {
    let (_,c,s)=auto_fixture().await;
    c.check_automatic_backup_at(&s,&day(2),AutoFail::AfterPublication).await.unwrap();
    let status=c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap();
    assert_eq!(status.warning.as_deref(),Some("backup_automatic_clock_warning"));
}
#[tokio::test]
async fn reset_preserves_disabled_preference_and_rebinds_clean_scheduler() {
    let (_,c,s)=auto_fixture().await;
    c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap();
    c.set_automatic_backup_enabled(&s,false,OperationId::generate()).await.unwrap();
    let context=OperationContext {transition_token:Some(c.issue_transition_token()),..auto_context()};
    c.reset(&s.profile_id,&context).await.unwrap();
    let fresh=c.load().active.unwrap();
    let status=c.automatic_backup_status(&fresh).await.unwrap();
    assert!(!status.enabled); assert_eq!(status.backed_up_revision,0); assert!(status.last_success_at.is_none());
    assert!(registered(&c,&fresh).await.is_empty());
    assert_eq!(c.backups(&fresh.profile_id).await.unwrap().len(),2);
    c.set_automatic_backup_enabled(&fresh,true,OperationId::generate()).await.unwrap();
    dirty(&c,&fresh,"USD").await;
    assert_eq!(c.check_automatic_backup_at(&fresh,&day(1),AutoFail::None).await.unwrap().backed_up_revision,1);
}

#[tokio::test]
async fn unpublished_retry_recaptures_new_revision_under_the_same_job() {
    let (_,c,s)=auto_fixture().await;
    c.check_automatic_backup_at(&s,&day(1),AutoFail::BeforePublication).await.unwrap();
    let job=c.with_session(&s,|st|Ok(st.connection()?.query_row("SELECT pending_job_id FROM automatic_backup_state",[],|r|r.get::<_,String>(0)).unwrap())).await.unwrap();
    dirty(&c,&s,"VND").await;
    let result=c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap();
    assert_eq!((result.content_revision,result.backed_up_revision),(2,2));
    let rows=registered(&c,&s).await;assert_eq!(rows.len(),1);assert_eq!(rows[0].0,job);assert_eq!(rows[0].2,2);
}
#[tokio::test]
async fn restored_pending_snapshot_cannot_reconcile_source_job() {
    let (_,c,s)=auto_fixture().await;
    c.check_automatic_backup_at(&s,&day(1),AutoFail::AfterPublication).await.unwrap();
    let source=c.backups(&s.profile_id).await.unwrap()[0].clone();
    let preview=c.inspect_restore(std::path::Path::new(&source.path)).await.unwrap();
    let restored=c.restore(&preview.token,"Recovered",&auto_context()).await.unwrap();
    let rs=c.activate(&restored.id).await.unwrap();
    c.check_automatic_backup_at(&rs,&day(1),AutoFail::None).await.unwrap();
    assert_ne!(registered(&c,&rs).await[0].0,source.id);
    assert_eq!(c.backups(&s.profile_id).await.unwrap(),vec![source]);
}
#[tokio::test]
async fn later_stable_publication_resolves_offset_prune_deferral() {
    let (_,c,s)=auto_fixture().await;
    for n in 1..=9 {dirty(&c,&s,&n.to_string()).await;c.check_automatic_backup_at(&s,&day(n),AutoFail::Prune).await.unwrap();}
    for n in 10..=11 {
        dirty(&c,&s,&n.to_string()).await;
        let clock=BackupClock {offset_minutes:60,..day(n)};
        let result=c.check_automatic_backup_at(&s,&clock,AutoFail::None).await.unwrap();
        if n==10 { assert_eq!(registered(&c,&s).await.len(),10);assert!(result.prune_warning.is_some()); }
        else { assert!(registered(&c,&s).await.len()<11);assert!(result.prune_warning.is_none()); }
    }
}
#[tokio::test]
async fn corrupt_registered_copy_defers_pruning_without_cancelling_new_success() {
    let (paths,c,s)=auto_fixture().await;
    c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap();
    let first=registered(&c,&s).await[0].clone();
    let path=paths.profile_dir(&s.profile_id).unwrap().join("backups").join(first.1);
    std::fs::write(&path,b"corrupt").unwrap();
    dirty(&c,&s,"VND").await;
    let result=c.check_automatic_backup_at(&s,&day(2),AutoFail::None).await.unwrap();
    assert_eq!(result.backed_up_revision,2);assert!(result.warning.is_none());assert!(result.prune_warning.is_some());
    assert_eq!(registered(&c,&s).await.len(),2);assert_eq!(std::fs::read(path).unwrap(),b"corrupt");
}
#[tokio::test]
async fn automatic_operations_are_send_and_reject_switched_sessions() {
    let (_,c,s)=auto_fixture().await;
    let other=c.create("Other",&auto_context()).await.unwrap();
    c.activate(&other.id).await.unwrap();
    let result=tokio::spawn(async move {c.check_automatic_backup(&s).await}).await.unwrap();
    assert_eq!(result.unwrap_err().code,ErrorCode::ProfileSessionExpired);
}

#[tokio::test]
async fn clock_recovery_does_not_clear_disabled_pending_publication_failure() {
    let (paths,c,s)=auto_fixture().await;
    c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap();
    dirty(&c,&s,"VND").await;
    let failed=c.check_automatic_backup_at(&s,&day(2),AutoFail::BeforePublication).await.unwrap();
    assert_eq!(failed.warning.as_deref(),Some("backup_automatic_failed"));
    c.set_automatic_backup_enabled(&s,false,OperationId::generate()).await.unwrap();
    let backwards=c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap();
    assert_eq!(backwards.warning.as_deref(),Some("backup_automatic_clock_warning"));
    drop(c);
    let c=ProfileCoordinator::open(paths).unwrap();
    let s=c.activate(&s.profile_id).await.unwrap();
    let recovered=c.check_automatic_backup_at(&s,&day(2),AutoFail::None).await.unwrap();
    assert_eq!(recovered.warning.as_deref(),Some("backup_automatic_failed"));
    assert_eq!(recovered.backed_up_revision,1);
    assert_eq!(registered(&c,&s).await.len(),1);
    c.set_automatic_backup_enabled(&s,true,OperationId::generate()).await.unwrap();
    let successful=c.check_automatic_backup_at(&s,&day(2),AutoFail::None).await.unwrap();
    assert_eq!(successful.backed_up_revision,2);
    assert!(successful.warning.is_none());
}

#[tokio::test]
async fn clock_recovery_preserves_publication_failure_before_a_job_was_created() {
    let (paths,c,s)=auto_fixture().await;
    let directory=paths.profile_dir(&s.profile_id).unwrap().join("backups");
    std::fs::write(&directory,b"directory unavailable").unwrap();
    assert_eq!(c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap().warning.as_deref(),Some("backup_automatic_failed"));
    c.set_automatic_backup_enabled(&s,false,OperationId::generate()).await.unwrap();
    let invalid=BackupClock {now_iso:"invalid".into(),..day(1)};
    assert_eq!(c.check_automatic_backup_at(&s,&invalid,AutoFail::None).await.unwrap().warning.as_deref(),Some("backup_automatic_clock_warning"));
    let recovered=c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap();
    assert_eq!(recovered.warning.as_deref(),Some("backup_automatic_failed"));
    assert!(registered(&c,&s).await.is_empty());
    std::fs::remove_file(directory).unwrap();
    c.set_automatic_backup_enabled(&s,true,OperationId::generate()).await.unwrap();
    assert!(c.check_automatic_backup_at(&s,&day(1),AutoFail::None).await.unwrap().warning.is_none());
}
