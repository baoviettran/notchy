//! Reports domain service — ported from `src/lib/db/repos/reports.ts`.
//!
//! Pure read-only functions taking `&Connection`. No mutations.

use rusqlite::{Connection, params};

use crate::database::error::{DbResult, map_sqlite_error};
use crate::database::types::{
    BucketSpending, CategoryTrendPoint, CompareRow, NetWorthPoint, OverviewReport,
    StackedCategoryPoint, StackedTag, TagSpending, TopTransaction, TrendPoint, YearOverYearPoint,
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

    // Exclude transactions tagged in the Adjustments bucket (e.g. reconciliation
    // expenses) from the aggregates unless adjustments are explicitly included.
    // Mirrors the browser repo's adjustmentTagFilter.
    let adjustment_tag_filter = if include_adjustments {
        String::new()
    } else {
        "AND (t.tag_id IS NULL OR t.tag_id NOT IN (
            SELECT id FROM category_tags WHERE type_id = 'bucket_adjustments'
        ))"
        .to_string()
    };

    // Aggregate income/expense by kind
    let sql = format!(
        "SELECT t.kind, SUM(t.amount) AS total FROM transactions t
         WHERE {kind} AND t.date >= ?1 AND t.date < ?2 AND t.deleted_at IS NULL
         {adjustment_tag_filter}
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

    // Top spending tags (categorized expenses only, mirroring the browser repo)
    let top_cat_sql =
        "SELECT t.tag_id, ct.name, SUM(t.amount) AS total
         FROM transactions t
         JOIN category_tags ct ON t.tag_id = ct.id
         WHERE t.kind = 'expense' AND t.date >= ?1 AND t.date < ?2 AND t.deleted_at IS NULL
         GROUP BY t.tag_id ORDER BY total DESC LIMIT 5";
    let mut stmt = conn.prepare(top_cat_sql).map_err(map_sqlite_error)?;
    let top_categories: Vec<TagSpending> = stmt
        .query_map(params![start, end], |row| {
            Ok(TagSpending {
                tag_id: row.get(0)?,
                name: row.get(1)?,
                total: row.get(2)?,
            })
        })
        .map_err(map_sqlite_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)?;

    // Top expense transactions
    let top_tx_sql =
        "SELECT id, payee, amount, date FROM transactions
         WHERE kind = 'expense' AND date >= ?1 AND date < ?2 AND deleted_at IS NULL
         ORDER BY amount DESC LIMIT 5";
    let mut stmt = conn.prepare(top_tx_sql).map_err(map_sqlite_error)?;
    let top_transactions: Vec<TopTransaction> = stmt
        .query_map(params![start, end], |row| {
            Ok(TopTransaction {
                id: row.get(0)?,
                payee: row.get(1)?,
                amount: row.get(2)?,
                date: row.get(3)?,
            })
        })
        .map_err(map_sqlite_error)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(map_sqlite_error)?;

    Ok(OverviewReport {
        total_income: income,
        total_expense: expense,
        net_cash_flow: net,
        spending_by_bucket: buckets,
        top_categories,
        top_transactions,
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
        let change = month_b_val - month_a_val;
        let change_pct = if month_a_val > 0 {
            Some((change as f64 / month_a_val as f64) * 100.0)
        } else {
            None
        };
        rows.push(CompareRow {
            tag_id: key,
            name,
            month_a: month_a_val,
            month_b: month_b_val,
            change,
            change_pct,
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
            spent: total,
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
        "SELECT t.tag_id, COALESCE(ct.name, 'Uncategorised') AS name, t.kind, SUM(t.amount) AS total
         FROM transactions t
         LEFT JOIN category_tags ct ON t.tag_id = ct.id
         WHERE {kind} AND t.date >= ?1 AND t.date < ?2 AND t.deleted_at IS NULL
         GROUP BY t.tag_id, t.kind"
    );

    for _ in 0..months {
        let month_str = format!("{:04}-{:02}", cur_year, cur_month_i);
        let start = month_start(&month_str);
        let end = next_month_start(&month_str);

        let mut stmt = conn.prepare(&sql).map_err(map_sqlite_error)?;
        let rows: Vec<(Option<String>, String, String, i64)> = stmt
            .query_map(params![start, end], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .map_err(map_sqlite_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(map_sqlite_error)?;

        let mut tag_map: std::collections::HashMap<Option<String>, (String, i64)> =
            std::collections::HashMap::new();
        for (tag_id, name, kind, total) in &rows {
            let entry = tag_map
                .entry(tag_id.clone())
                .or_insert_with(|| (name.clone(), 0i64));
            match kind.as_str() {
                "expense" => entry.1 += total,
                "refund" => entry.1 -= total,
                "adjustment" if include_adjustments => entry.1 += total,
                _ => {}
            }
        }

        let mut tags: Vec<StackedTag> = tag_map
            .into_iter()
            .map(|(tag_id, (name, total))| StackedTag {
                tag_id,
                name,
                total,
            })
            .collect();
        tags.sort_by(|a, b| b.total.cmp(&a.total));

        points.push(StackedCategoryPoint {
            month: month_str,
            tags,
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

/// Year-over-year: 12-month income/expense for two years side by side.
pub fn get_year_over_year(
    conn: &Connection,
    year_a: i32,
    year_b: i32,
    include_adjustments: bool,
) -> DbResult<Vec<YearOverYearPoint>> {
    let kind = kind_filter(include_adjustments);
    let mut points = Vec::with_capacity(12);

    let sql = format!(
        "SELECT t.kind, SUM(t.amount) AS total FROM transactions t
         WHERE {kind} AND t.date >= ?1 AND t.date < ?2 AND t.deleted_at IS NULL
         GROUP BY t.kind"
    );
    let mut stmt = conn.prepare(&sql).map_err(map_sqlite_error)?;

    for m in 1..=12 {
        let month_num = format!("{:02}", m);
        let month_a_str = format!("{:04}-{}", year_a, month_num);
        let month_b_str = format!("{:04}-{}", year_b, month_num);

        let rows_a: Vec<(String, i64)> = stmt
            .query_map(params![month_start(&month_a_str), next_month_start(&month_a_str)], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(map_sqlite_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(map_sqlite_error)?;
        let rows_b: Vec<(String, i64)> = stmt
            .query_map(params![month_start(&month_b_str), next_month_start(&month_b_str)], |row| {
                Ok((row.get(0)?, row.get(1)?))
            })
            .map_err(map_sqlite_error)?
            .collect::<Result<Vec<_>, _>>()
            .map_err(map_sqlite_error)?;

        let (year_a_income, year_a_expense) = aggregate_kind_totals(&rows_a, include_adjustments);
        let (year_b_income, year_b_expense) = aggregate_kind_totals(&rows_b, include_adjustments);

        points.push(YearOverYearPoint {
            month: month_num,
            year_a_income,
            year_a_expense,
            year_b_income,
            year_b_expense,
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
