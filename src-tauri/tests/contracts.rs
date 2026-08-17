//! Contract tests for the native database boundary (Task 1).
//!
//! These prove the stable error envelope, safe money validation, the common
//! DTO types, and that the committed TypeScript bindings are current.

use std::path::PathBuf;

use notchy_lib::database::error::{validate_money, DbError, ErrorCode};
use notchy_lib::database::generate_bindings;
use notchy_lib::database::types::{
    validate_bounded_list, validate_bounded_text, IsoDate, LifecycleState, OperationId, Page,
    Patch, StartupStage,
};

/// Path of the committed, generated TypeScript bindings, anchored to the
/// crate manifest so the test works regardless of the invoking cwd.
const COMMITTED_BINDINGS: &str =
    concat!(env!("CARGO_MANIFEST_DIR"), "/../src/lib/native/contracts.generated.ts");

#[test]
fn error_envelope_serializes_only_code_and_safe_meta() {
    let error = DbError::new(ErrorCode::DatabaseBusy)
        .with_meta("stage", "migrating");
    let json = serde_json::to_value(error).unwrap();
    assert_eq!(json, serde_json::json!({
        "code": "database_busy",
        "meta": { "stage": "migrating" }
    }));
    assert!(!json.to_string().contains("sqlite"));
}

#[test]
fn unsafe_amounts_are_rejected() {
    assert_eq!(validate_money(9_007_199_254_740_992), Err(ErrorCode::AmountOutOfRange));
    assert_eq!(validate_money(i64::MIN), Err(ErrorCode::AmountOutOfRange));
}

#[test]
fn safe_amounts_are_accepted() {
    assert_eq!(validate_money(0), Ok(0));
    assert_eq!(validate_money(9_007_199_254_740_991), Ok(9_007_199_254_740_991));
    assert_eq!(validate_money(-9_007_199_254_740_991), Ok(-9_007_199_254_740_991));
}

#[test]
#[should_panic(expected = "unknown metadata key")]
fn error_meta_rejects_arbitrary_keys() {
    let _ = DbError::new(ErrorCode::DatabaseBusy).with_meta("not_an_allowlisted_key", "x");
}

#[test]
fn error_meta_allowlists_schema_version_and_retryable() {
    let error = DbError::new(ErrorCode::SchemaTooOld)
        .with_meta("schema_version", "3")
        .with_meta("retryable", "false");
    let json = serde_json::to_value(error).unwrap();
    assert_eq!(json, serde_json::json!({
        "code": "schema_too_old",
        "meta": { "schema_version": "3", "retryable": "false" }
    }));
}

#[test]
fn error_code_serializes_snake_case() {
    assert_eq!(
        serde_json::to_value(ErrorCode::DatabaseUpdateRequired).unwrap(),
        "database_update_required"
    );
    assert_eq!(
        serde_json::to_value(ErrorCode::UnauthorizedCaller).unwrap(),
        "unauthorized_caller"
    );
}

#[test]
fn iso_date_accepts_valid_dates_and_rejects_malformed() {
    for valid in [
        "2026-01-01",
        "2024-02-29",
        "2023-02-28",
        "2026-12-31",
        "1900-01-01",
    ] {
        assert!(IsoDate::parse(valid).is_ok(), "expected {valid} to be valid");
    }
    for invalid in [
        "",
        "2026-13-01",
        "2026-00-10",
        "2026-01-00",
        "2023-02-29",
        "2026-1-01",
        "2026-01-1",
        "2026/01/01",
        "20260101",
        "not-a-date",
        "2026-01-01-extra",
    ] {
        assert_eq!(
            IsoDate::parse(invalid),
            Err(ErrorCode::InvalidDate),
            "expected {invalid} to be invalid"
        );
    }
}

#[test]
fn iso_date_round_trips() {
    let date = IsoDate::parse("2026-08-17").unwrap();
    assert_eq!(date.as_str(), "2026-08-17");
    let value = serde_json::to_value(&date).unwrap();
    assert_eq!(value, serde_json::json!("2026-08-17"));
    let back: IsoDate = serde_json::from_value(value).unwrap();
    assert_eq!(back, date);
}

#[test]
fn operation_id_validates_ulid_format() {
    let valid = "01ARZ3NDEKTSV4RRFFQ69G5FAV";
    assert!(OperationId::parse(valid).is_ok());
    assert_eq!(OperationId::parse("not-a-ulid"), Err(ErrorCode::InvalidUlid));
    assert_eq!(OperationId::parse(""), Err(ErrorCode::InvalidUlid));
    assert_eq!(OperationId::parse(valid).unwrap().as_str(), valid);
}

#[test]
fn operation_id_generates_valid_ulid() {
    let id = OperationId::generate();
    assert!(OperationId::parse(id.as_str()).is_ok());
}

#[test]
fn bounded_validators_reject_oversized_input() {
    assert_eq!(validate_bounded_text("hello", 5), Ok(()));
    assert_eq!(validate_bounded_text("hello", 4), Err(ErrorCode::InvalidInput));
    assert_eq!(validate_bounded_list(3, 3), Ok(()));
    assert_eq!(validate_bounded_list(4, 3), Err(ErrorCode::InvalidInput));
}

#[test]
fn patch_enum_distinguishes_omitted_null_and_replacement() {
    assert_eq!(
        serde_json::to_value(Patch::<i64>::Omitted).unwrap(),
        serde_json::json!({ "kind": "omitted" })
    );
    assert_eq!(
        serde_json::to_value(Patch::<i64>::ExplicitNull).unwrap(),
        serde_json::json!({ "kind": "explicit_null" })
    );
    assert_eq!(
        serde_json::to_value(Patch::<i64>::Replace { value: 123 }).unwrap(),
        serde_json::json!({ "kind": "replace", "value": 123 })
    );
}

#[test]
fn patch_enum_round_trips() {
    let parsed: Patch<i64> = serde_json::from_value(serde_json::json!({ "kind": "omitted" })).unwrap();
    assert_eq!(parsed, Patch::Omitted);
    let parsed: Patch<i64> = serde_json::from_value(serde_json::json!({ "kind": "explicit_null" })).unwrap();
    assert_eq!(parsed, Patch::ExplicitNull);
    let parsed: Patch<i64> =
        serde_json::from_value(serde_json::json!({ "kind": "replace", "value": 42 })).unwrap();
    assert_eq!(parsed, Patch::Replace { value: 42 });
}

#[test]
fn lifecycle_state_serializes_snake_case() {
    assert_eq!(
        serde_json::to_value(LifecycleState::RecoveryRequired).unwrap(),
        "recovery_required"
    );
    assert_eq!(
        serde_json::to_value(LifecycleState::Uninitialized).unwrap(),
        "uninitialized"
    );
    assert_eq!(
        serde_json::to_value(StartupStage::BackingUp).unwrap(),
        "backing_up"
    );
}

#[test]
fn page_dto_round_trips() {
    let page = Page {
        items: vec![1, 2, 3],
        total: 3,
        offset: 0,
        limit: 3,
    };
    let value = serde_json::to_value(&page).unwrap();
    assert_eq!(value["items"], serde_json::json!([1, 2, 3]));
    assert_eq!(value["total"], 3);
    let back: Page<i64> = serde_json::from_value(value).unwrap();
    assert_eq!(back, page);
}

#[test]
fn generated_typescript_matches_committed_bindings() {
    let generated = generate_bindings();
    let path = PathBuf::from(COMMITTED_BINDINGS);
    let committed = std::fs::read_to_string(&path)
        .unwrap_or_else(|e| panic!("committed bindings missing at {}: {e}", path.display()));
    assert_eq!(generated, committed);
}

#[test]
fn generated_typescript_exposes_contract_types() {
    let generated = generate_bindings();
    assert!(generated.contains("ErrorCode"));
    assert!(generated.contains("database_busy"));
    assert!(generated.contains("DbError"));
    assert!(generated.contains("OperationId"));
    assert!(generated.contains("LifecycleState"));
    assert!(generated.contains("StartupStage"));
    assert!(generated.contains("RecoveryContext"));
    assert!(generated.contains("Patch"));
    assert!(generated.contains("omitted"));
    assert!(generated.contains("explicit_null"));
    assert!(generated.contains("replace"));
}
