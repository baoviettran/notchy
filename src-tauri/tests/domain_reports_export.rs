//! Integration tests for the reports and export domain services.

use std::path::{Path, PathBuf};

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
    assert_eq!(report.total_income, 10_000_000);
    assert_eq!(report.total_expense, 3_000_000);
    assert_eq!(report.net_cash_flow, 7_000_000);
    assert_eq!(report.spending_by_bucket.len(), 1);
    assert_eq!(report.spending_by_bucket[0].total, 3_000_000);
}

#[test]
fn overview_empty_month_returns_zeros() {
    let db = fresh_db("overview_empty");
    let report = reports::get_overview(&db, "2026-07", false).unwrap();
    assert_eq!(report.total_income, 0);
    assert_eq!(report.total_expense, 0);
    assert_eq!(report.net_cash_flow, 0);
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
    assert_eq!(without.total_income, 5_000_000);

    let with_adj = reports::get_overview(&db, "2026-07", true).unwrap();
    assert_eq!(with_adj.total_income, 6_000_000);
}

#[test]
fn overview_refund_reduces_expense() {
    let mut db = fresh_db("overview_refund");
    let acc = make_account(&mut db, "Main", "checking");
    let (_, tag) = make_category(&mut db, "Food", "Lunch");

    make_tx(&mut db, "expense", 3_000_000, "2026-07-05", &acc, Some(&tag));
    make_tx(&mut db, "refund", 1_000_000, "2026-07-10", &acc, Some(&tag));

    let report = reports::get_overview(&db, "2026-07", false).unwrap();
    assert_eq!(report.total_expense, 2_000_000);
}

#[test]
fn overview_excludes_adjustments_bucket_tags() {
    let mut db = fresh_db("overview_adj_bucket");
    let acc = make_account(&mut db, "Main", "checking");

    // A real expense tagged with a catalog tag from the Adjustments bucket
    // (tag_reconciliation ships with that bucket in the migrations).
    make_tx(&mut db, "expense", 400_000, "2026-07-05", &acc, Some("tag_reconciliation"));
    make_tx(&mut db, "expense", 1_000_000, "2026-07-06", &acc, None);

    let without = reports::get_overview(&db, "2026-07", false).unwrap();
    assert_eq!(without.total_expense, 1_000_000);

    let with_adj = reports::get_overview(&db, "2026-07", true).unwrap();
    assert_eq!(with_adj.total_expense, 1_400_000);
}

#[test]
fn overview_top_categories_and_transactions() {
    let mut db = fresh_db("overview_top");
    let acc = make_account(&mut db, "Main", "checking");
    let (_, tag) = make_category(&mut db, "Food", "Lunch");

    make_tx(&mut db, "expense", 700_000, "2026-07-05", &acc, None);
    make_tx(&mut db, "expense", 2_500_000, "2026-07-06", &acc, Some(&tag));
    make_tx(&mut db, "expense", 1_000_000, "2026-07-07", &acc, Some(&tag));
    make_tx(&mut db, "income", 9_000_000, "2026-07-08", &acc, None); // never a top expense

    let report = reports::get_overview(&db, "2026-07", false).unwrap();
    assert_eq!(report.top_categories.len(), 1);
    assert_eq!(report.top_categories[0].tag_id, tag);
    assert_eq!(report.top_categories[0].name, "Lunch");
    assert_eq!(report.top_categories[0].total, 3_500_000);

    assert_eq!(report.top_transactions.len(), 3);
    assert_eq!(report.top_transactions[0].amount, 2_500_000);
    assert_eq!(report.top_transactions[0].payee, None);
    assert_eq!(report.top_transactions[0].date, "2026-07-06");
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

    let points = reports::get_trend(&db, 3, false, None).unwrap();
    assert_eq!(points.len(), 3);
    // Oldest month first
    assert_eq!(points[0].month, m2);
    assert_eq!(points[0].income, 5_000_000);
    assert_eq!(points[0].expense, 2_000_000);
    assert_eq!(points[1].month, m1);
    assert_eq!(points[1].income, 6_000_000);
}

#[test]
fn trend_includes_adjustments_when_requested() {
    let mut db = fresh_db("trend_adj");
    let acc = make_account(&mut db, "Main", "checking");
    let m0 = current_month();

    make_tx(&mut db, "income", 5_000_000, &format!("{m0}-05"), &acc, None);
    make_tx(&mut db, "adjustment", 1_000_000, &format!("{m0}-06"), &acc, None);

    // Pins the flag end-to-end: the kind clause in the SQL *and* the aggregate
    // that has to count an adjustment as income. A hardcoded `false`, an
    // inverted `!`, and substituting `spending_kind_filter` all fail here.
    let without = reports::get_trend(&db, 1, false, None).unwrap();
    assert_eq!(without[0].income, 5_000_000);
    let with_adj = reports::get_trend(&db, 1, true, None).unwrap();
    assert_eq!(with_adj[0].income, 6_000_000);
}

#[test]
fn trend_empty_months_return_zeros() {
    let db = fresh_db("trend_empty");
    let points = reports::get_trend(&db, 2, false, None).unwrap();
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
    let food = rows.iter().find(|r| r.name == "Lunch").unwrap();
    assert_eq!(food.month_a, 2_000_000);
    assert_eq!(food.month_b, 2_500_000);
    assert_eq!(food.change, 500_000);
    assert_eq!(food.change_pct, Some(25.0));
    assert_eq!(food.tag_id, Some(tag1.clone()));
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
    assert_eq!(points[0].spent, 1_000_000);
    assert_eq!(points[1].month, m0);
    assert_eq!(points[1].spent, 2_000_000);
}

#[test]
fn category_trend_includes_adjustments_when_requested() {
    let mut db = fresh_db("cat_trend_adj");
    let acc = make_account(&mut db, "Main", "checking");
    let (_, tag) = make_category(&mut db, "Food", "Lunch");
    let m0 = current_month();

    make_tx(&mut db, "expense", 1_000_000, &format!("{m0}-05"), &acc, Some(&tag));
    make_tx(&mut db, "adjustment", 500_000, &format!("{m0}-06"), &acc, Some(&tag));

    // Pins `spending_kind_filter(include_adjustments)` at this call site: an
    // inverted `!` or a hardcoded `false` hides the adjustment row.
    let without = reports::get_category_trend(&db, 1, &tag, false).unwrap();
    assert_eq!(without[0].spent, 1_000_000);
    let with_adj = reports::get_category_trend(&db, 1, &tag, true).unwrap();
    assert_eq!(with_adj[0].spent, 1_500_000);
}

#[test]
fn category_trend_empty_returns_zeros() {
    let db = fresh_db("cat_trend_empty");
    let points = reports::get_category_trend(&db, 2, "nonexistent", false).unwrap();
    assert_eq!(points.len(), 2);
    assert!(points.iter().all(|p| p.spent == 0));
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
    assert_eq!(points[0].tags.len(), 2);
    let lunch = points[0].tags.iter().find(|t| t.tag_id == Some(tag1.clone())).unwrap();
    assert_eq!(lunch.name, "Lunch");
    assert_eq!(lunch.total, 1_000_000);
}

#[test]
fn stacked_category_series_includes_adjustments_when_requested() {
    let mut db = fresh_db("stacked_adj");
    let acc = make_account(&mut db, "Main", "checking");
    let (_, tag) = make_category(&mut db, "Food", "Lunch");
    let m0 = current_month();

    make_tx(&mut db, "expense", 1_000_000, &format!("{m0}-05"), &acc, Some(&tag));
    make_tx(&mut db, "adjustment", 500_000, &format!("{m0}-06"), &acc, Some(&tag));

    // Second `spending_kind_filter` call site, same wiring risk as
    // `get_category_trend` above.
    let without = reports::get_stacked_category_series(&db, 1, false).unwrap();
    let lunch = without[0].tags.iter().find(|t| t.tag_id == Some(tag.clone())).unwrap();
    assert_eq!(lunch.total, 1_000_000);

    let with_adj = reports::get_stacked_category_series(&db, 1, true).unwrap();
    let lunch_adj = with_adj[0].tags.iter().find(|t| t.tag_id == Some(tag.clone())).unwrap();
    assert_eq!(lunch_adj.total, 1_500_000);
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

    let points = reports::get_year_over_year(&db, 2025, 2026, false).unwrap();
    assert_eq!(points.len(), 12);
    let jun = &points[5]; // index 5 = June
    assert_eq!(jun.month, "06");
    assert_eq!(jun.year_a_income, 5_000_000);
    assert_eq!(jun.year_a_expense, 2_000_000);
    assert_eq!(jun.year_b_income, 6_000_000);
    assert_eq!(jun.year_b_expense, 3_000_000);
}

#[test]
fn year_over_year_includes_adjustments_when_requested() {
    let mut db = fresh_db("yoy_adj");
    let acc = make_account(&mut db, "Main", "checking");

    make_tx(&mut db, "income", 5_000_000, "2025-06-05", &acc, None);
    make_tx(&mut db, "income", 6_000_000, "2026-06-05", &acc, None);
    make_tx(&mut db, "adjustment", 1_000_000, "2026-06-06", &acc, None);

    // Third `kind_filter(include_adjustments)` call site. Year A is asserted
    // too, so a flag applied to the wrong year's query is caught.
    let without = reports::get_year_over_year(&db, 2025, 2026, false).unwrap();
    assert_eq!(without[5].year_b_income, 6_000_000);

    let with_adj = reports::get_year_over_year(&db, 2025, 2026, true).unwrap();
    assert_eq!(with_adj[5].year_b_income, 7_000_000);
    assert_eq!(with_adj[5].year_a_income, 5_000_000);
}

#[test]
fn year_over_year_empty_year() {
    let db = fresh_db("yoy_empty");
    let points = reports::get_year_over_year(&db, 2030, 2031, false).unwrap();
    assert_eq!(points.len(), 12);
    assert!(points
        .iter()
        .all(|p| p.year_a_income == 0
            && p.year_a_expense == 0
            && p.year_b_income == 0
            && p.year_b_expense == 0));
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

// ---------------------------------------------------------------------------
// export_table_set_csv (Task 3)
// ---------------------------------------------------------------------------

/// A migrated database plus a scratch directory to export into.
fn fresh_db_and_dir(tag: &str) -> (Connection, PathBuf) {
    let dir = scratch_path(tag).parent().unwrap().join("export");
    (fresh_db(tag), dir)
}

fn read_export(dir: &Path, table: &str) -> String {
    std::fs::read_to_string(dir.join(format!("{table}.csv"))).unwrap()
}

#[test]
fn table_set_export_writes_seven_files_in_order() {
    let (conn, dir) = fresh_db_and_dir("csv-set");
    let written = export::export_table_set_csv(&conn, &dir).unwrap();

    let names: Vec<String> = written
        .iter()
        .map(|path| {
            Path::new(path)
                .file_name()
                .unwrap()
                .to_string_lossy()
                .into_owned()
        })
        .collect();
    assert_eq!(
        names,
        vec![
            "accounts.csv",
            "category_types.csv",
            "category_tags.csv",
            "transactions.csv",
            "budgets.csv",
            "goals.csv",
            "reconciliations.csv",
        ]
    );
    for path in &written {
        assert!(Path::new(path).exists(), "missing: {path}");
    }
}

#[test]
fn table_set_export_writes_headers_even_for_an_empty_table() {
    let (conn, dir) = fresh_db_and_dir("csv-empty");
    export::export_table_set_csv(&conn, &dir).unwrap();

    // A fresh ledger has no goals; the file must still exist and describe them,
    // so "I exported 7 tables" is true.
    let goals = read_export(&dir, "goals");
    let header = goals.lines().next().unwrap_or_default();
    assert!(header.starts_with("id,"), "header-only file expected, got {header:?}");
    assert_eq!(goals.lines().count(), 1, "no data rows expected");
}

#[test]
fn table_set_export_writes_raw_integer_amounts() {
    let (mut conn, dir) = fresh_db_and_dir("csv-amounts");
    let account = make_account(&mut conn, "Cash", "checking");
    make_tx(&mut conn, "expense", 123_456, "2026-02-01", &account, None);

    export::export_table_set_csv(&conn, &dir).unwrap();

    let transactions = read_export(&dir, "transactions");
    // The stored integer, not the formatted "1234.56" that the flat
    // transactions report writes.
    assert!(transactions.contains("123456"), "expected raw integer: {transactions}");
    assert!(!transactions.contains("1234.56"), "amount must not be reformatted");
}

#[test]
fn table_set_export_omits_soft_deleted_rows() {
    let (mut conn, dir) = fresh_db_and_dir("csv-soft-delete");
    let account = make_account(&mut conn, "Doomed", "checking");
    conn.execute(
        "UPDATE accounts SET deleted_at = '2026-01-01T00:00:00.000Z' WHERE id = ?1",
        params![account],
    )
    .unwrap();

    export::export_table_set_csv(&conn, &dir).unwrap();

    let accounts = read_export(&dir, "accounts");
    assert!(!accounts.contains("Doomed"), "soft-deleted row leaked: {accounts}");
}

#[test]
fn table_set_export_neutralizes_formula_cells_and_escapes_delimiters() {
    let (mut conn, dir) = fresh_db_and_dir("csv-injection");
    let account = make_account(&mut conn, "Escapes", "checking");
    let formula = make_tx(&mut conn, "expense", 1, "2026-02-01", &account, None);
    let delimited = make_tx(&mut conn, "expense", 2, "2026-02-02", &account, None);
    conn.execute(
        "UPDATE transactions SET payee = ?1 WHERE id = ?2",
        params!["=cmd|'/c calc'!A1", formula],
    )
    .unwrap();
    conn.execute(
        "UPDATE transactions SET payee = ?1 WHERE id = ?2",
        params!["Smith, \"Bob\"\nJr", delimited],
    )
    .unwrap();

    export::export_table_set_csv(&conn, &dir).unwrap();

    let transactions = read_export(&dir, "transactions");
    assert!(transactions.contains("'=cmd"), "formula not neutralized: {transactions}");
    assert!(
        transactions.contains("\"Smith, \"\"Bob\"\"\nJr\""),
        "RFC 4180 escaping missing: {transactions}"
    );
}
