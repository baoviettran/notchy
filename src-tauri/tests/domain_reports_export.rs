//! Integration tests for the reports and export domain services.

use std::path::PathBuf;

use rusqlite::{Connection, OpenFlags, params};

use notchy_lib::database::domains::{categories, export, reports};
use notchy_lib::database::migrations::{bootstrap_current, FailurePoint};
use notchy_lib::database::types::OperationId;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn scratch_path(tag: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap()
        .as_nanos();
    let tid = std::thread::current().id();
    let dir = std::env::temp_dir().join(format!("notchy-reports-{}-{:?}-{}", tag, tid, nanos));
    std::fs::create_dir_all(&dir).unwrap();
    dir.join("db.sqlite")
}

fn fresh_db(tag: &str) -> Connection {
    let path = scratch_path(tag);
    bootstrap_current(&path, FailurePoint::None).unwrap();
    Connection::open_with_flags(&path, OpenFlags::SQLITE_OPEN_READ_WRITE).unwrap()
}

fn op() -> OperationId {
    OperationId::generate()
}

fn make_account(conn: &mut Connection, name: &str, kind: &str) -> String {
    let id = op().as_str().to_string();
    let now = "2026-01-01T00:00:00.000Z";
    conn.execute(
        "INSERT INTO accounts (id, name, type, currency, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'VND', ?4, ?4)",
        params![id, name, kind, now],
    )
    .unwrap();
    id
}

fn make_tx(
    conn: &mut Connection,
    kind: &str,
    amount: i64,
    date: &str,
    account_id: &str,
    tag_id: Option<&str>,
) -> String {
    let id = op().as_str().to_string();
    let now = "2026-01-01T00:00:00.000Z";
    conn.execute(
        "INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![id, kind, date, amount, account_id, tag_id, now],
    )
    .unwrap();
    id
}

/// Get the current year-month as "YYYY-MM".
fn current_month() -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    let days = now.as_secs() / 86_400;
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let yr = if m <= 2 { y + 1 } else { y };
    format!("{yr:04}-{m:02}")
}

/// Get month string N months before the current month.
fn months_ago(n: u32) -> String {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap();
    let days = now.as_secs() / 86_400;
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let yr = if m <= 2 { y + 1 } else { y };

    let mut cur_m = m as i32;
    let mut cur_y = yr;
    for _ in 0..n {
        cur_m -= 1;
        if cur_m == 0 {
            cur_m = 12;
            cur_y -= 1;
        }
    }
    format!("{cur_y:04}-{cur_m:02}")
}

/// Create a bucket and tag, returning (bucket_id, tag_id).
fn make_category(conn: &mut Connection, bucket_name: &str, tag_name: &str) -> (String, String) {
    let bucket_id = categories::create_bucket(conn, op(), bucket_name.to_string(), 1).unwrap();
    let tag_id = categories::create_tag(conn, op(), tag_name.to_string(), bucket_id.clone()).unwrap();
    (bucket_id, tag_id)
}

// ---------------------------------------------------------------------------
// Overview tests
// ---------------------------------------------------------------------------

#[test]
fn overview_with_income_and_expense() {
    let mut db = fresh_db("overview_basic");
    let acc = make_account(&mut db, "Main", "checking");
    let (_, tag) = make_category(&mut db, "Food", "Lunch");

    make_tx(&mut db, "income", 10_000_000, "2026-07-05", &acc, None);
    make_tx(&mut db, "expense", 3_000_000, "2026-07-10", &acc, Some(&tag));

    let report = reports::get_overview(&db, "2026-07", false).unwrap();
    assert_eq!(report.income, 10_000_000);
    assert_eq!(report.expense, 3_000_000);
    assert_eq!(report.net, 7_000_000);
    assert_eq!(report.spending_by_bucket.len(), 1);
    assert_eq!(report.spending_by_bucket[0].total, 3_000_000);
}

#[test]
fn overview_empty_month_returns_zeros() {
    let db = fresh_db("overview_empty");
    let report = reports::get_overview(&db, "2026-07", false).unwrap();
    assert_eq!(report.income, 0);
    assert_eq!(report.expense, 0);
    assert_eq!(report.net, 0);
    assert!(report.spending_by_bucket.is_empty());
}

#[test]
fn overview_excludes_adjustments_by_default() {
    let mut db = fresh_db("overview_adj");
    let acc = make_account(&mut db, "Main", "checking");
    let (_, tag) = make_category(&mut db, "Food", "Lunch");

    make_tx(&mut db, "income", 5_000_000, "2026-07-01", &acc, None);
    make_tx(&mut db, "adjustment", 1_000_000, "2026-07-05", &acc, Some(&tag));

    let without = reports::get_overview(&db, "2026-07", false).unwrap();
    assert_eq!(without.income, 5_000_000);

    let with_adj = reports::get_overview(&db, "2026-07", true).unwrap();
    assert_eq!(with_adj.income, 6_000_000);
}

#[test]
fn overview_refund_reduces_expense() {
    let mut db = fresh_db("overview_refund");
    let acc = make_account(&mut db, "Main", "checking");
    let (_, tag) = make_category(&mut db, "Food", "Lunch");

    make_tx(&mut db, "expense", 3_000_000, "2026-07-05", &acc, Some(&tag));
    make_tx(&mut db, "refund", 1_000_000, "2026-07-10", &acc, Some(&tag));

    let report = reports::get_overview(&db, "2026-07", false).unwrap();
    assert_eq!(report.expense, 2_000_000);
}

// ---------------------------------------------------------------------------
// Trend tests
// ---------------------------------------------------------------------------

#[test]
fn trend_multiple_months() {
    let mut db = fresh_db("trend_multi");
    let acc = make_account(&mut db, "Main", "checking");

    let m2 = months_ago(2);
    let m1 = months_ago(1);

    make_tx(&mut db, "income", 5_000_000, &format!("{m2}-05"), &acc, None);
    make_tx(&mut db, "expense", 2_000_000, &format!("{m2}-10"), &acc, None);
    make_tx(&mut db, "income", 6_000_000, &format!("{m1}-05"), &acc, None);
    make_tx(&mut db, "expense", 3_000_000, &format!("{m1}-10"), &acc, None);

    let points = reports::get_trend(&db, 3, false).unwrap();
    assert_eq!(points.len(), 3);
    // Oldest month first
    assert_eq!(points[0].month, m2);
    assert_eq!(points[0].income, 5_000_000);
    assert_eq!(points[0].expense, 2_000_000);
    assert_eq!(points[1].month, m1);
    assert_eq!(points[1].income, 6_000_000);
}

#[test]
fn trend_empty_months_return_zeros() {
    let db = fresh_db("trend_empty");
    let points = reports::get_trend(&db, 2, false).unwrap();
    assert_eq!(points.len(), 2);
    assert!(points.iter().all(|p| p.income == 0 && p.expense == 0));
}

// ---------------------------------------------------------------------------
// Comparison tests
// ---------------------------------------------------------------------------

#[test]
fn comparison_two_months() {
    let mut db = fresh_db("comparison");
    let acc = make_account(&mut db, "Main", "checking");
    let (_, tag1) = make_category(&mut db, "Food", "Lunch");
    let (_, tag2) = make_category(&mut db, "Transport", "Bus");

    make_tx(&mut db, "expense", 2_000_000, "2026-06-05", &acc, Some(&tag1));
    make_tx(&mut db, "expense", 500_000, "2026-06-10", &acc, Some(&tag2));
    make_tx(&mut db, "expense", 2_500_000, "2026-07-05", &acc, Some(&tag1));

    let rows = reports::get_comparison(&db, "2026-06", "2026-07", false).unwrap();
    assert!(!rows.is_empty());
    let food = rows.iter().find(|r| r.category == "Lunch").unwrap();
    assert_eq!(food.month_a, 2_000_000);
    assert_eq!(food.month_b, 2_500_000);
    assert_eq!(food.delta, 500_000);
}

#[test]
fn comparison_empty_months() {
    let db = fresh_db("comparison_empty");
    let rows = reports::get_comparison(&db, "2026-06", "2026-07", false).unwrap();
    assert!(rows.is_empty());
}

// ---------------------------------------------------------------------------
// Category trend tests
// ---------------------------------------------------------------------------

#[test]
fn category_trend_for_tag() {
    let mut db = fresh_db("cat_trend");
    let acc = make_account(&mut db, "Main", "checking");
    let (_, tag) = make_category(&mut db, "Food", "Lunch");

    let m1 = months_ago(1);
    let m0 = current_month();

    make_tx(&mut db, "expense", 1_000_000, &format!("{m1}-05"), &acc, Some(&tag));
    make_tx(&mut db, "expense", 2_000_000, &format!("{m0}-05"), &acc, Some(&tag));

    let points = reports::get_category_trend(&db, 2, &tag, false).unwrap();
    assert_eq!(points.len(), 2);
    assert_eq!(points[0].month, m1);
    assert_eq!(points[0].total, 1_000_000);
    assert_eq!(points[1].month, m0);
    assert_eq!(points[1].total, 2_000_000);
}

#[test]
fn category_trend_empty_returns_zeros() {
    let db = fresh_db("cat_trend_empty");
    let points = reports::get_category_trend(&db, 2, "nonexistent", false).unwrap();
    assert_eq!(points.len(), 2);
    assert!(points.iter().all(|p| p.total == 0));
}

// ---------------------------------------------------------------------------
// Stacked category series tests
// ---------------------------------------------------------------------------

#[test]
fn stacked_category_series() {
    let mut db = fresh_db("stacked");
    let acc = make_account(&mut db, "Main", "checking");
    let (_bucket1, tag1) = make_category(&mut db, "Food", "Lunch");
    let (_bucket2, tag2) = make_category(&mut db, "Transport", "Bus");

    let m0 = current_month();

    make_tx(&mut db, "expense", 1_000_000, &format!("{m0}-05"), &acc, Some(&tag1));
    make_tx(&mut db, "expense", 500_000, &format!("{m0}-10"), &acc, Some(&tag2));

    let points = reports::get_stacked_category_series(&db, 1, false).unwrap();
    assert_eq!(points.len(), 1);
    assert_eq!(points[0].month, m0);
    assert_eq!(points[0].categories.len(), 2);
}

// ---------------------------------------------------------------------------
// Year-over-year tests
// ---------------------------------------------------------------------------

#[test]
fn year_over_year() {
    let mut db = fresh_db("yoy");
    let acc = make_account(&mut db, "Main", "checking");

    make_tx(&mut db, "income", 5_000_000, "2025-06-05", &acc, None);
    make_tx(&mut db, "expense", 2_000_000, "2025-06-10", &acc, None);
    make_tx(&mut db, "income", 6_000_000, "2026-06-05", &acc, None);
    make_tx(&mut db, "expense", 3_000_000, "2026-06-10", &acc, None);

    let points = reports::get_year_over_year(&db, 2025, false).unwrap();
    assert_eq!(points.len(), 12);
    let jun = &points[5]; // index 5 = June
    assert_eq!(jun.month, "06");
    assert_eq!(jun.income, 5_000_000);
    assert_eq!(jun.expense, 2_000_000);
}

#[test]
fn year_over_year_empty_year() {
    let db = fresh_db("yoy_empty");
    let points = reports::get_year_over_year(&db, 2030, false).unwrap();
    assert_eq!(points.len(), 12);
    assert!(points.iter().all(|p| p.income == 0 && p.expense == 0));
}

// ---------------------------------------------------------------------------
// Net worth tests
// ---------------------------------------------------------------------------

#[test]
fn net_worth_series() {
    let mut db = fresh_db("networth");
    let acc = make_account(&mut db, "Main", "checking");

    let m1 = months_ago(1);
    let m0 = current_month();

    make_tx(&mut db, "income", 10_000_000, &format!("{m1}-05"), &acc, None);
    make_tx(&mut db, "expense", 3_000_000, &format!("{m0}-05"), &acc, None);

    let points = reports::get_net_worth_series(&db, 2, false).unwrap();
    assert_eq!(points.len(), 2);
    // Month-1: 10M income
    assert_eq!(points[0].month, m1);
    assert_eq!(points[0].net_worth, 10_000_000);
    // Current month: 10M - 3M = 7M
    assert_eq!(points[1].month, m0);
    assert_eq!(points[1].net_worth, 7_000_000);
}

#[test]
fn net_worth_empty_database() {
    let db = fresh_db("networth_empty");
    let points = reports::get_net_worth_series(&db, 1, false).unwrap();
    assert_eq!(points.len(), 1);
    assert_eq!(points[0].net_worth, 0);
}

#[test]
fn net_worth_includes_liability_negative() {
    let mut db = fresh_db("networth_liability");
    let asset = make_account(&mut db, "Savings", "savings");
    let liability = make_account(&mut db, "Credit Card", "credit_card");

    make_tx(&mut db, "income", 10_000_000, "2026-07-01", &asset, None);
    // Credit card expense: -amount means positive balance on liability
    make_tx(&mut db, "expense", 3_000_000, "2026-07-05", &liability, None);

    let points = reports::get_net_worth_series(&db, 1, false).unwrap();
    // Asset: +10M, Liability: -3M (expense on liability = negative balance)
    assert_eq!(points[0].net_worth, 7_000_000);
}

// ---------------------------------------------------------------------------
// CSV export tests
// ---------------------------------------------------------------------------

#[test]
fn csv_export_basic() {
    let mut db = fresh_db("csv_basic");
    let acc = make_account(&mut db, "Main", "checking");
    let (_, tag) = make_category(&mut db, "Food", "Lunch");
    let m0 = current_month();

    make_tx(&mut db, "expense", 3_000_000, &format!("{m0}-05"), &acc, Some(&tag));

    let csv = export::export_transactions_csv(&db, None, None).unwrap();
    let lines: Vec<&str> = csv.lines().collect();
    assert_eq!(lines[0], "Date,Kind,Amount,Payee,Description,Account,Category");
    assert_eq!(lines.len(), 2); // header + 1 row
    assert!(lines[1].contains(&format!("{m0}-05")));
    assert!(lines[1].contains("expense"));
    assert!(lines[1].contains("30000.00"));
}

#[test]
fn csv_formula_injection_neutralized() {
    let mut db = fresh_db("csv_injection");
    let acc = make_account(&mut db, "Main", "checking");

    // Payee starting with =
    let id = op().as_str().to_string();
    let now = "2026-01-01T00:00:00.000Z";
    db.execute(
        "INSERT INTO transactions (id, kind, date, amount, account_id, payee, created_at, updated_at)
         VALUES (?1, 'expense', '2026-07-05', 1000, ?2, '=SUM(A1)', ?3, ?3)",
        params![id, acc, now],
    )
    .unwrap();

    let csv = export::export_transactions_csv(&db, None, None).unwrap();
    assert!(csv.contains("'=SUM(A1)"));
}

#[test]
fn csv_date_filter() {
    let mut db = fresh_db("csv_filter");
    let acc = make_account(&mut db, "Main", "checking");

    make_tx(&mut db, "expense", 1_000_000, "2026-06-05", &acc, None);
    make_tx(&mut db, "expense", 2_000_000, "2026-07-05", &acc, None);

    let csv = export::export_transactions_csv(&db, Some("2026-07-01"), Some("2026-07-31")).unwrap();
    let lines: Vec<&str> = csv.lines().collect();
    assert_eq!(lines.len(), 2); // header + 1 row
    assert!(lines[1].contains("2026-07-05"));
}

#[test]
fn sanitize_cell_various_prefixes() {
    assert_eq!(export::sanitize_csv_cell("=1"), "'=1");
    assert_eq!(export::sanitize_csv_cell("+1"), "'+1");
    assert_eq!(export::sanitize_csv_cell("-1"), "'-1");
    assert_eq!(export::sanitize_csv_cell("@1"), "'@1");
    assert_eq!(export::sanitize_csv_cell("normal"), "normal");
}
