use tauri::Manager;
use std::sync::Arc;
use notchy_lib::database::{commands, types::{NewTransaction, TransactionKind, OperationId}, error::ErrorCode};
use notchy_lib::profiles::{coordinator::ProfileCoordinator, paths::ProfilePaths, types::{ProfileSession, OperationContext}};
struct TestApp { app: tauri::App<tauri::test::MockRuntime>, session: ProfileSession }
async fn fixture() -> (Arc<ProfileCoordinator>, TestApp) {
 let root=std::env::temp_dir().join(format!("notchy-command-replay-{}",OperationId::generate().as_str()));
 let coordinator=ProfileCoordinator::open(ProfilePaths::new(root.join("config"),root.join("data"))).unwrap();
 let context=OperationContext{operation_id:OperationId::generate().as_str().to_owned(),transition_token:None};
 let profile=coordinator.create("Replay",&context).await.unwrap();
 let session=coordinator.activate(&profile.id).await.unwrap();
 let app=tauri::test::mock_builder().manage(Arc::clone(&coordinator)).build(tauri::test::mock_context(tauri::test::noop_assets())).unwrap();
 (coordinator,TestApp{app,session})
}
#[tokio::test]
async fn lost_response_retry_through_command_returns_original_transaction() {
 let(manager,app)=fixture().await;
 manager.with_session(&app.session,|s| { s.connection()?.execute("INSERT INTO accounts (id,name,type,currency,archived,created_at,updated_at) VALUES ('a','A','cash','VND',0,'x','x')",[]).unwrap(); Ok(()) }).await.unwrap();
 let input=NewTransaction {kind:TransactionKind::Expense,date:"2026-01-01".into(),amount:50000,account_id:"a".into(),transfer_account_id:None,refund_of_id:None,tag_id:None,payee:None,description:None};
 let id=OperationId::generate();
 let first=commands::transaction_create(app.app.state(),app.session.clone(),input.clone(),id.clone()).await.unwrap();
 let retry=commands::transaction_create(app.app.state(),app.session.clone(),input.clone(),id.clone()).await.unwrap();
 assert_eq!(first,retry);
 let count=manager.with_session(&app.session,|s| Ok(s.connection()?.query_row("SELECT COUNT(*) FROM transactions",[],|r|r.get::<_,i64>(0)).unwrap())).await.unwrap();
 assert_eq!(count,1);
 let mut changed=input;changed.amount=60000;
 assert_eq!(commands::transaction_create(app.app.state(),app.session.clone(),changed,id).await.unwrap_err().code,ErrorCode::OperationIdConflict);
}

#[tokio::test]
async fn operation_id_cannot_be_reused_for_a_different_target() {
 use notchy_lib::database::types::{AccountPatch,Patch};
 let(manager,app)=fixture().await;
 manager.with_session(&app.session,|s| { s.connection()?.execute_batch("INSERT INTO accounts(id,name,type,currency,archived,created_at,updated_at) VALUES ('a','A','cash','VND',0,'x','x'),('b','B','cash','VND',0,'x','x');").unwrap();Ok(()) }).await.unwrap();
 let patch=AccountPatch{name:Some("Renamed".into()),account_type:None,counterparty:Patch::Omitted,archived:None};
 let id=OperationId::generate();
 commands::account_update(app.app.state(),app.session.clone(),"a".into(),patch.clone(),id.clone()).await.unwrap();
 assert_eq!(commands::account_update(app.app.state(),app.session.clone(),"b".into(),patch,id).await.unwrap_err().code,ErrorCode::OperationIdConflict);
}
#[tokio::test]
async fn budget_copy_retry_does_not_reapply_new_source_allocations() {
 let(manager,app)=fixture().await;
 manager.with_session(&app.session,|s| { s.connection()?.execute_batch("INSERT INTO budgets(id,type_id,month,allocated,created_at,updated_at) SELECT 'source',id,'2026-01',100,'x','x' FROM category_types WHERE budgetable=1 LIMIT 1;").unwrap();Ok(()) }).await.unwrap();
 let id=OperationId::generate();
 commands::budget_copy_from_previous_month(app.app.state(),app.session.clone(),"2026-02".into(),id.clone()).await.unwrap();
 manager.with_session(&app.session,|s| {s.connection()?.execute("UPDATE budgets SET allocated=200 WHERE month='2026-01'",[]).unwrap();Ok(())}).await.unwrap();
 commands::budget_copy_from_previous_month(app.app.state(),app.session.clone(),"2026-02".into(),id).await.unwrap();
 let amount=manager.with_session(&app.session,|s| Ok(s.connection()?.query_row("SELECT allocated FROM budgets WHERE month='2026-02'",[],|r|r.get::<_,i64>(0)).unwrap())).await.unwrap();
 assert_eq!(amount,100);
}

async fn funded_app() -> (Arc<ProfileCoordinator>, TestApp) {
 let(manager,app)=fixture().await;
 manager.with_session(&app.session,|s| {s.connection()?.execute_batch("INSERT INTO accounts(id,name,type,currency,archived,created_at,updated_at) VALUES ('a','A','cash','VND',0,'x','x');").unwrap();Ok(())}).await.unwrap();
 (manager,app)
}
#[tokio::test]
async fn duplicate_retry_uses_original_request_even_when_source_changes() {
 let(manager,app)=funded_app().await;
 let input=NewTransaction{kind:TransactionKind::Expense,date:"2026-01-01".into(),amount:50000,account_id:"a".into(),transfer_account_id:None,refund_of_id:None,tag_id:None,payee:None,description:None};
 let source=commands::transaction_create(app.app.state(),app.session.clone(),input,OperationId::generate()).await.unwrap();
 let op=OperationId::generate();
 let first=commands::transaction_duplicate(app.app.state(),app.session.clone(),source.clone(),op.clone()).await.unwrap();
 manager.with_session(&app.session,move |s|{s.connection()?.execute("UPDATE transactions SET amount=60000 WHERE id=?1",[source]).unwrap();Ok(())}).await.unwrap();
 let source_id=manager.with_session(&app.session,|s|Ok(s.connection()?.query_row("SELECT id FROM transactions WHERE date='2026-01-01'",[],|r|r.get::<_,String>(0)).unwrap())).await.unwrap();
 assert_eq!(commands::transaction_duplicate(app.app.state(),app.session.clone(),source_id,op).await.unwrap(),first);
}
#[tokio::test]
async fn learned_upsert_retry_does_not_switch_receipt_command() {
 let(_manager,app)=funded_app().await;let op=OperationId::generate();
 let first=commands::rule_upsert_learned(app.app.state(),app.session.clone(),"Coffee".into(),"tag_loss".into(),op.clone()).await.unwrap();
 let retry=commands::rule_upsert_learned(app.app.state(),app.session.clone(),"Coffee".into(),"tag_loss".into(),op).await.unwrap();
 assert_eq!(first.id,retry.id);
}
#[tokio::test]
async fn reconciliation_retry_returns_original_discrepancy_and_hashes_notes() {
 let(_manager,app)=funded_app().await;let op=OperationId::generate();
 let first=commands::reconciliation_reconcile(app.app.state(),app.session.clone(),"a".into(),100,true,Some("first".into()),op.clone()).await.unwrap();
 let retry=commands::reconciliation_reconcile(app.app.state(),app.session.clone(),"a".into(),100,true,Some("first".into()),op.clone()).await.unwrap();
 assert_eq!(first.discrepancy,retry.discrepancy);
 assert_eq!(commands::reconciliation_reconcile(app.app.state(),app.session.clone(),"a".into(),100,true,Some("changed".into()),op).await.unwrap_err().code,ErrorCode::OperationIdConflict);
}
#[tokio::test]
async fn batch_retry_returns_receipt_after_account_is_soft_deleted() {
 let(manager,app)=funded_app().await;
 let input=NewTransaction{kind:TransactionKind::Expense,date:"2026-01-01".into(),amount:50000,account_id:"a".into(),transfer_account_id:None,refund_of_id:None,tag_id:None,payee:None,description:None};
 let op=OperationId::generate();
 let first=commands::transaction_create_batch(app.app.state(),app.session.clone(),vec![input.clone()],op.clone()).await.unwrap();
 manager.with_session(&app.session,|s|{s.connection()?.execute("UPDATE accounts SET deleted_at='x' WHERE id='a'",[]).unwrap();Ok(())}).await.unwrap();
 assert_eq!(commands::transaction_create_batch(app.app.state(),app.session.clone(),vec![input],op).await.unwrap(),first);
}
#[tokio::test]
async fn concurrent_schedule_jobs_read_authoritative_state_before_posting() {
 use notchy_lib::database::types::{NewSchedule,ScheduleKind,ScheduleFrequency,IsoDate};
 let(manager,app)=funded_app().await;
 let id=commands::schedule_create(app.app.state(),app.session.clone(),NewSchedule{name:"Queued".into(),kind:ScheduleKind::Expense,amount:50000,account_id:"a".into(),transfer_account_id:None,tag_id:None,payee:None,description:None,frequency:ScheduleFrequency::Monthly,start_date:"2026-01-01".into(),end_date:None,posts_transaction:1},OperationId::generate()).await.unwrap();
 let day=IsoDate::parse("2026-01-01").unwrap();
 let (left,right)=tokio::join!(commands::schedule_post_due(app.app.state(),app.session.clone(),id.clone(),day.clone(),OperationId::generate()),commands::schedule_post_due(app.app.state(),app.session.clone(),id,day,OperationId::generate()));
 assert_eq!(left.unwrap().posted+right.unwrap().posted,1);
 let count=manager.with_session(&app.session,|s|Ok(s.connection()?.query_row("SELECT COUNT(*) FROM transactions",[],|r|r.get::<_,i64>(0)).unwrap())).await.unwrap();
 assert_eq!(count,1);
}

#[tokio::test]
async fn automatic_backup_toggle_replays_once_and_checks_do_not_create_financial_receipts() {
    let (manager, app) = funded_app().await;
    let operation = OperationId::generate();
    commands::backup_automatic_set_enabled(app.app.state(), app.session.clone(), false, operation.clone()).await.unwrap();
    commands::backup_automatic_set_enabled(app.app.state(), app.session.clone(), false, operation.clone()).await.unwrap();
    assert_eq!(commands::backup_automatic_set_enabled(app.app.state(), app.session.clone(), true, operation).await.unwrap_err().code, ErrorCode::OperationIdConflict);
    let disabled = commands::backup_automatic_status(app.app.state(), app.session.clone()).await.unwrap();
    assert!(!disabled.enabled);
    commands::backup_automatic_set_enabled(app.app.state(), app.session.clone(), true, OperationId::generate()).await.unwrap();
    let count_receipts = || manager.with_session(&app.session, |s| Ok(s.connection()?.query_row("SELECT COUNT(*) FROM operation_receipts", [], |r| r.get::<_, i64>(0)).unwrap()));
    let before = count_receipts().await.unwrap();
    let (main, quick) = tokio::join!(commands::backup_automatic_check(app.app.state(), app.session.clone()), commands::backup_automatic_check(app.app.state(), app.session.clone()));
    let main = main.unwrap(); let quick = quick.unwrap();
    assert_eq!(main, quick); assert!(main.last_success_at.is_some());
    assert_eq!(count_receipts().await.unwrap(), before);
    let copies = manager.with_session(&app.session, |s| Ok(s.connection()?.query_row("SELECT COUNT(*) FROM automatic_backup_copies", [], |r| r.get::<_, i64>(0)).unwrap())).await.unwrap();
    assert_eq!(copies, 1);
}
