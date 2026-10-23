use notchy_lib::database::{domains::schedules::{create_schedule,post_due_schedule},migrations::{bootstrap_current,FailurePoint},types::{NewSchedule,ScheduleKind,ScheduleFrequency,OperationId,IsoDate}};
use rusqlite::Connection;
fn setup(kind:ScheduleKind) -> (Connection,String) {
 let root=std::env::temp_dir().join(format!("notchy-post-{}",OperationId::generate().as_str()));
 std::fs::create_dir_all(&root).unwrap();
 let path=root.join("notchy.sqlite");
 bootstrap_current(&path,FailurePoint::None).unwrap();
 let mut db=Connection::open(path).unwrap();
 db.execute_batch("PRAGMA foreign_keys=ON; INSERT INTO accounts(id,name,type,currency,archived,created_at,updated_at) VALUES ('a','A','cash','VND',0,'x','x'),('b','B','cash','VND',0,'x','x');").unwrap();
 let id=create_schedule(&mut db,OperationId::generate(),NewSchedule {name:"Rent".into(),kind,amount:50000,account_id:"a".into(),transfer_account_id:if kind==ScheduleKind::Transfer {Some("b".into())} else {None},tag_id:None,payee:None,description:None,frequency:ScheduleFrequency::Monthly,start_date:"2026-01-01".into(),end_date:None,posts_transaction:1}).unwrap();
 (db,id)
}
#[test]
fn failed_advancement_rolls_back_financial_rows_then_resume_posts_once() {
 for kind in [ScheduleKind::Expense,ScheduleKind::Income,ScheduleKind::Transfer] {
 let (mut db,id)=setup(kind);
 db.execute_batch("CREATE TRIGGER fail_advance BEFORE UPDATE OF next_due_date ON schedules BEGIN SELECT RAISE(ABORT,'fail advance'); END;").unwrap();
 assert!(post_due_schedule(&mut db,OperationId::generate(),&id,IsoDate::parse("2026-02-01").unwrap()).is_err());
 assert_eq!(db.query_row("SELECT COUNT(*) FROM transactions",[],|r|r.get::<_,i64>(0)).unwrap(),0);
 db.execute_batch("DROP TRIGGER fail_advance").unwrap();
 let op=OperationId::generate();
 assert_eq!(post_due_schedule(&mut db,op.clone(),&id,IsoDate::parse("2026-02-01").unwrap()).unwrap().posted,2);
 assert_eq!(post_due_schedule(&mut db,op,&id,IsoDate::parse("2026-02-01").unwrap()).unwrap().posted,2);
 assert_eq!(post_due_schedule(&mut db,OperationId::generate(),&id,IsoDate::parse("2026-02-01").unwrap()).unwrap().posted,0);
 assert_eq!(db.query_row("SELECT COUNT(*) FROM transactions",[],|r|r.get::<_,i64>(0)).unwrap(),2);
 }
}
#[test]
fn later_occurrence_failure_rolls_back_whole_pass() {
 let(mut db,id)=setup(ScheduleKind::Expense);
 db.execute_batch("CREATE TRIGGER fail_second BEFORE INSERT ON transactions WHEN NEW.date='2026-02-01' BEGIN SELECT RAISE(ABORT,'second'); END;").unwrap();
 assert!(post_due_schedule(&mut db,OperationId::generate(),&id,IsoDate::parse("2026-02-01").unwrap()).is_err());
 assert_eq!(db.query_row("SELECT COUNT(*) FROM transactions",[],|r|r.get::<_,i64>(0)).unwrap(),0);
}
#[test]
fn recurrence_matches_shared_browser_corpus() {
 let cases:serde_json::Value=serde_json::from_str(include_str!("fixtures/recurrence-cases.json")).unwrap();
 for case in cases.as_array().unwrap() {
 let date=IsoDate::parse(case["date"].as_str().unwrap()).unwrap();
 let frequency:ScheduleFrequency=serde_json::from_value(case["frequency"].clone()).unwrap();
 assert_eq!(notchy_lib::database::domains::civil_date::next_due_date(&date,&frequency).unwrap().as_str(),case["next"].as_str().unwrap());
 }
 assert!(notchy_lib::database::domains::civil_date::next_due_date(&IsoDate::parse("9999-12-31").unwrap(),&ScheduleFrequency::Monthly).is_err());
}
#[test]
fn capped_pass_resumes_from_committed_next_date_without_duplicates() {
 let(mut db,id)=setup(ScheduleKind::Expense);
 db.execute("UPDATE schedules SET start_date='2020-01-01',next_due_date='2020-01-01' WHERE id=?1",[&id]).unwrap();
 let today=IsoDate::parse("2026-01-01").unwrap();
 let first=post_due_schedule(&mut db,OperationId::generate(),&id,today.clone()).unwrap();
 assert_eq!(first.posted,24);assert!(first.capped);
 db.execute("UPDATE schedules SET errored_at=NULL WHERE id=?1",[&id]).unwrap();
 let second=post_due_schedule(&mut db,OperationId::generate(),&id,today).unwrap();
 assert_eq!(second.posted,24);assert!(second.capped);
 let (rows,dates)=db.query_row("SELECT COUNT(*),COUNT(DISTINCT date) FROM transactions",[],|r|Ok((r.get::<_,i64>(0)?,r.get::<_,i64>(1)?))).unwrap();
 assert_eq!((rows,dates),(48,48));
}
#[test]
fn reminder_pass_advances_without_financial_effect_and_deleted_account_is_rejected() {
 let(mut db,id)=setup(ScheduleKind::Expense);
 db.execute("UPDATE schedules SET posts_transaction=0 WHERE id=?1",[&id]).unwrap();
 let result=post_due_schedule(&mut db,OperationId::generate(),&id,IsoDate::parse("2026-02-01").unwrap()).unwrap();
 assert_eq!(result.posted,0);assert!(result.reminder_due);assert!(result.advanced);
 db.execute("UPDATE accounts SET deleted_at='x' WHERE id='a'",[]).unwrap();
 assert!(post_due_schedule(&mut db,OperationId::generate(),&id,IsoDate::parse("2026-03-01").unwrap()).is_err());
 assert_eq!(db.query_row("SELECT COUNT(*) FROM transactions",[],|r|r.get::<_,i64>(0)).unwrap(),0);
}
