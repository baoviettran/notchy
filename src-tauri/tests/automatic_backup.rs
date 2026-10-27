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
