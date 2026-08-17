//! Reports domain service — ported from `src/lib/db/repos/reports.ts`.
//!
//! Pure read-only functions taking `&Connection`. No mutations.

use rusqlite::{Connection, params};

use crate::database::error::{DbResult, map_sqlite_error};
use crate::database::types::{
    BucketSpending, CategoryTrendPoint, CompareRow, NetWorthPoint, OverviewReport,
    StackedCategoryPoint, TrendPoint, TypeTotal, YearOverYearPoint,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Compute the month start `YYYY-MM-01`.
fn month_start(month: &str) -> String {
    format!("{month}-01")
}

/// Compute the start of the next month `YYYY-MM+1-01`.
fn next_month_start(month: &str) -> String {
    let parts: Vec<&str> = month.split('-').collect();
    let year: i32 = parts[0].parse().unwrap_or(2000);
    let m: i32 = parts[1].parse().unwrap_or(1);
    if m == 12 {
        format!("{}-01-01", year + 1)
    } else {
        format!("{}-{:02}-01", year, m + 1)
    }
}

/// Compute the last day of the month as `YYYY-MM-DD`.
fn month_end(month: &str) -> String {
    let parts: Vec<&str> = month.split('-').collect();
    let year: i32 = parts[0].parse().unwrap_or(2000);
    let m: i32 = parts[1].parse().unwrap_or(1);
    let max_day = match m {
        1 | 3 | 5 | 7 | 8 | 10 | 12 => 31,
        4 | 6 | 9 | 11 => 30,
        2 => {
            let leap = (year % 4 == 0 && year % 100 != 0) || year % 400 == 0;
            if leap { 29 } else { 28 }
        }
        _ => 30,
    };
    format!("{year}-{m:02}-{max_day:02}")
}

/// Build the kind filter clause based on whether adjustments are included.
fn kind_filter(include_adjustments: bool) -> &'static str {
    if include_adjustments {
        "t.kind IN ('expense', 'income', 'refund', 'adjustment')"
    } else {
        "t.kind IN ('expense', 'income', 'refund')"
    }
}

/// Compute income/expense from a set of kind+total rows.
fn aggregate_kind_totals(rows: &[(String, i64)], include_adjustments: bool) -> (i64, i64) {
    let mut income: i64 = 0;
    let mut expense: i64 = 0;
    for (kind, total) in rows {
        match kind.as_str() {
            "income" => income += total,
            "expense" => expense += total,
            "refund" => expense -= total,
            "adjustment" if include_adjustments => income += total,
            _ => {}
        }
    }
    (income, expense)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Overview report for a single month.
pub fn get_overview(
    conn: &Connection,
    month: &str,
    include_adjustments: bool,
) -> DbResult<OverviewReport> {
    let start = month_start(month);
    let end = next_month_start(month);
    let kind = kind_filter(include_adjustments);

    // Aggregate income/expense by kind
    let sql = format!(
        "SELECT t.kind, SUM(t.amount) AS total FROM transactions t
         WHERE {kind} AND t.date >= ?1 AND t.date < ?2 AND t.deleted_at IS NULL
         GROUP BY t.kind"
    );
    let mut stmt = conn.prepare(&sql).map_err(map_sqlite_error)?;
    let rows: Vec<(String, i64)> = stmt
        .query_map(params![start, end], |row| {
            Ok((row.get(0)?, row.get(1)?))
        })
        .map_err(map_sqlite_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)?;

    let (income, expense) = aggregate_kind_totals(&rows, include_adjustments);
    let net = income - expense;

    // Spending by bucket
    let bucket_sql =
        "SELECT ct.type_id, cty.name, SUM(t.amount) AS total
         FROM transactions t
         JOIN category_tags ct ON t.tag_id = ct.id
         JOIN category_types cty ON ct.type_id = cty.id
         WHERE t.kind = 'expense' AND t.date >= ?1 AND t.date < ?2 AND t.deleted_at IS NULL
         GROUP BY ct.type_id ORDER BY total DESC";
    let mut stmt = conn.prepare(bucket_sql).map_err(map_sqlite_error)?;
    let buckets: Vec<BucketSpending> = stmt
        .query_map(params![start, end], |row| {
            Ok(BucketSpending {
                type_id: row.get(0)?,
                name: row.get(1)?,
                total: row.get(2)?,
            })
        })
        .map_err(map_sqlite_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)?;

    Ok(OverviewReport {
        income,
        expense,
        net,
        spending_by_bucket: buckets,
    })
}

/// Trend series: income/expense/net for each of the last N months.
pub fn get_trend(
    conn: &Connection,
    months: u32,
    include_adjustments: bool,
) -> DbResult<Vec<TrendPoint>> {
    let kind = kind_filter(include_adjustments);
    let mut points = Vec::with_capacity(months as usize);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let days = now.as_secs() / 86_400;
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let _d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let yr = if m <= 2 { y + 1 } else { y };

    let mut cur_month_i = m as i32;
    let mut cur_year = yr;

    for _ in 0..months {
        let month_str = format!("{:04}-{:02}", cur_year, cur_month_i);
        let start = month_start(&month_str);
        let end = next_month_start(&month_str);

        let sql = format!(
            "SELECT t.kind, SUM(t.amount) AS total FROM transactions t
             WHERE {kind} AND t.date >= ?1 AND t.date < ?2 AND t.deleted_at IS NULL
             GROUP BY t.kind"
        );
        let mut stmt = conn.prepare(&sql).map_err(map_sqlite_error)?;
        let rows: Vec<(String, i64)> = stmt
            .query_map(params![start, end], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(map_sqlite_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(map_sqlite_error)?;

        let (income, expense) = aggregate_kind_totals(&rows, include_adjustments);
        points.push(TrendPoint {
            month: month_str,
            income,
            expense,
            net: income - expense,
        });

        // Go to previous month
        cur_month_i -= 1;
        if cur_month_i == 0 {
            cur_month_i = 12;
            cur_year -= 1;
        }
    }

    points.reverse();
    Ok(points)
}

/// Comparison between two months at the category level.
pub fn get_comparison(
    conn: &Connection,
    month_a: &str,
    month_b: &str,
    include_adjustments: bool,
) -> DbResult<Vec<CompareRow>> {
    let kind = kind_filter(include_adjustments);
    let start_a = month_start(month_a);
    let end_a = next_month_start(month_a);
    let start_b = month_start(month_b);
    let end_b = next_month_start(month_b);

    let sql = format!(
        "SELECT t.tag_id, COALESCE(ct.name, 'Uncategorised') AS name, SUM(t.amount) AS total
         FROM transactions t
         LEFT JOIN category_tags ct ON t.tag_id = ct.id
         WHERE {kind} AND t.kind = 'expense' AND t.date >= ?1 AND t.date < ?2 AND t.deleted_at IS NULL
         GROUP BY t.tag_id"
    );

    let mut stmt = conn.prepare(&sql).map_err(map_sqlite_error)?;
    let rows_a: Vec<(Option<String>, String, i64)> = stmt
        .query_map(params![start_a, end_a], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(map_sqlite_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)?;

    let rows_b: Vec<(Option<String>, String, i64)> = stmt
        .query_map(params![start_b, end_b], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })
        .map_err(map_sqlite_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)?;

    let mut map_a = std::collections::HashMap::new();
    for (tag_id, name, total) in &rows_a {
        map_a.insert(tag_id.clone(), (name.clone(), *total));
    }
    let mut map_b = std::collections::HashMap::new();
    for (tag_id, name, total) in &rows_b {
        map_b.insert(tag_id.clone(), (name.clone(), *total));
    }

    let mut all_keys: Vec<Option<String>> = map_a
        .keys()
        .chain(map_b.keys())
        .cloned()
        .collect::<std::collections::HashSet<_>>()
        .into_iter()
        .collect();
    all_keys.sort();

    let mut rows = Vec::new();
    for key in all_keys {
        let month_a_val = map_a.get(&key).map(|(_, t)| *t).unwrap_or(0);
        let month_b_val = map_b.get(&key).map(|(_, t)| *t).unwrap_or(0);
        let name = map_a
            .get(&key)
            .or_else(|| map_b.get(&key))
            .map(|(n, _)| n.clone())
            .unwrap_or_else(|| "Uncategorised".to_string());
        rows.push(CompareRow {
            category: name,
            month_a: month_a_val,
            month_b: month_b_val,
            delta: month_b_val - month_a_val,
        });
    }

    // Sort by month_b descending
    rows.sort_by(|a, b| b.month_b.cmp(&a.month_b));
    Ok(rows)
}

/// Category trend: spending for a specific tag over N months.
pub fn get_category_trend(
    conn: &Connection,
    months: u32,
    tag_id: &str,
    include_adjustments: bool,
) -> DbResult<Vec<CategoryTrendPoint>> {
    let kind = if include_adjustments {
        "t.kind IN ('expense', 'refund', 'adjustment')"
    } else {
        "t.kind IN ('expense', 'refund')"
    };

    let mut points = Vec::with_capacity(months as usize);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let days = now.as_secs() / 86_400;
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let _d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let yr = if m <= 2 { y + 1 } else { y };

    let mut cur_month_i = m as i32;
    let mut cur_year = yr;

    let sql = format!(
        "SELECT t.kind, SUM(t.amount) AS total FROM transactions t
         WHERE {kind} AND t.tag_id = ?1 AND t.date >= ?2 AND t.date < ?3 AND t.deleted_at IS NULL
         GROUP BY t.kind"
    );

    for _ in 0..months {
        let month_str = format!("{:04}-{:02}", cur_year, cur_month_i);
        let start = month_start(&month_str);
        let end = next_month_start(&month_str);

        let mut stmt = conn.prepare(&sql).map_err(map_sqlite_error)?;
        let rows: Vec<(String, i64)> = stmt
            .query_map(params![tag_id, start, end], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(map_sqlite_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(map_sqlite_error)?;

        let mut total: i64 = 0;
        for (kind, amount) in &rows {
            match kind.as_str() {
                "expense" => total += amount,
                "refund" => total -= amount,
                "adjustment" if include_adjustments => total += amount,
                _ => {}
            }
        }

        points.push(CategoryTrendPoint {
            month: month_str,
            total,
        });

        cur_month_i -= 1;
        if cur_month_i == 0 {
            cur_month_i = 12;
            cur_year -= 1;
        }
    }

    points.reverse();
    Ok(points)
}

/// Stacked category series: per-month per-bucket breakdown for N months.
pub fn get_stacked_category_series(
    conn: &Connection,
    months: u32,
    include_adjustments: bool,
) -> DbResult<Vec<StackedCategoryPoint>> {
    let kind = if include_adjustments {
        "t.kind IN ('expense', 'refund', 'adjustment')"
    } else {
        "t.kind IN ('expense', 'refund')"
    };

    let mut points = Vec::with_capacity(months as usize);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let days = now.as_secs() / 86_400;
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let _d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let yr = if m <= 2 { y + 1 } else { y };

    let mut cur_month_i = m as i32;
    let mut cur_year = yr;

    let sql = format!(
        "SELECT ct.type_id, t.kind, SUM(t.amount) AS total
         FROM transactions t
         JOIN category_tags ct ON t.tag_id = ct.id
         WHERE {kind} AND t.date >= ?1 AND t.date < ?2 AND t.deleted_at IS NULL
         GROUP BY ct.type_id, t.kind"
    );

    for _ in 0..months {
        let month_str = format!("{:04}-{:02}", cur_year, cur_month_i);
        let start = month_start(&month_str);
        let end = next_month_start(&month_str);

        let mut stmt = conn.prepare(&sql).map_err(map_sqlite_error)?;
        let rows: Vec<(String, String, i64)> = stmt
            .query_map(params![start, end], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .map_err(map_sqlite_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(map_sqlite_error)?;

        let mut bucket_map = std::collections::HashMap::new();
        for (type_id, kind, total) in &rows {
            let entry = bucket_map.entry(type_id.clone()).or_insert(0i64);
            match kind.as_str() {
                "expense" => *entry += total,
                "refund" => *entry -= total,
                "adjustment" if include_adjustments => *entry += total,
                _ => {}
            }
        }

        let mut categories: Vec<TypeTotal> = bucket_map
            .into_iter()
            .map(|(type_id, total)| TypeTotal { type_id, total })
            .collect();
        categories.sort_by(|a, b| b.total.cmp(&a.total));

        points.push(StackedCategoryPoint {
            month: month_str,
            categories,
        });

        cur_month_i -= 1;
        if cur_month_i == 0 {
            cur_month_i = 12;
            cur_year -= 1;
        }
    }

    points.reverse();
    Ok(points)
}

/// Year-over-year: 12-month income/expense for a given year.
pub fn get_year_over_year(
    conn: &Connection,
    year: i32,
    include_adjustments: bool,
) -> DbResult<Vec<YearOverYearPoint>> {
    let kind = kind_filter(include_adjustments);
    let mut points = Vec::with_capacity(12);

    for m in 1..=12 {
        let month_str = format!("{:04}-{:02}", year, m);
        let start = month_start(&month_str);
        let end = next_month_start(&month_str);

        let sql = format!(
            "SELECT t.kind, SUM(t.amount) AS total FROM transactions t
             WHERE {kind} AND t.date >= ?1 AND t.date < ?2 AND t.deleted_at IS NULL
             GROUP BY t.kind"
        );
        let mut stmt = conn.prepare(&sql).map_err(map_sqlite_error)?;
        let rows: Vec<(String, i64)> = stmt
            .query_map(params![start, end], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(map_sqlite_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(map_sqlite_error)?;

        let (income, expense) = aggregate_kind_totals(&rows, include_adjustments);

        points.push(YearOverYearPoint {
            month: format!("{:02}", m),
            income,
            expense,
        });
    }

    Ok(points)
}

/// Net-worth series: sum of all account balances at end of each month.
pub fn get_net_worth_series(
    conn: &Connection,
    months: u32,
    _include_adjustments: bool,
) -> DbResult<Vec<NetWorthPoint>> {
    // Collect all account IDs
    let mut stmt = conn
        .prepare("SELECT id FROM accounts WHERE deleted_at IS NULL")
        .map_err(map_sqlite_error)?;
    let account_ids: Vec<String> = stmt
        .query_map([], |row| row.get(0))
        .map_err(map_sqlite_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)?;
    drop(stmt);

    let mut points = Vec::with_capacity(months as usize);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    let days = now.as_secs() / 86_400;
    let z = days as i64 + 719_468;
    let era = if z >= 0 { z } else { z - 146_097 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let _d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let yr = if m <= 2 { y + 1 } else { y };

    let mut cur_month_i = m as i32;
    let mut cur_year = yr;

    for _ in 0..months {
        let month_str = format!("{:04}-{:02}", cur_year, cur_month_i);
        let end_date = month_end(&month_str);

        let mut net_worth: i64 = 0;
        for acc_id in &account_ids {
            let balance: i64 = conn
                .query_row(
                    "SELECT COALESCE(SUM(CASE
                        WHEN kind = 'income' THEN amount
                        WHEN kind = 'adjustment' THEN amount
                        WHEN kind = 'refund' THEN amount
                        WHEN kind = 'expense' THEN -amount
                        WHEN kind = 'transfer' AND account_id = ?1 THEN -amount
                        WHEN kind = 'transfer' AND transfer_account_id = ?1 THEN amount
                        ELSE 0
                    END), 0)
                    FROM transactions
                    WHERE (account_id = ?1 OR (kind = 'transfer' AND transfer_account_id = ?1))
                      AND deleted_at IS NULL
                      AND date <= ?2",
                    params![acc_id, end_date],
                    |row| row.get(0),
                )
                .map_err(map_sqlite_error)?;
            net_worth += balance;
        }

        points.push(NetWorthPoint {
            month: month_str,
            net_worth,
        });

        cur_month_i -= 1;
        if cur_month_i == 0 {
            cur_month_i = 12;
            cur_year -= 1;
        }
    }

    points.reverse();
    Ok(points)
}
