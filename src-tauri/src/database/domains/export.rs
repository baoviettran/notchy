//! Export domain service — ported from the CSV export logic.
//!
//! Pure read-only functions. CSV export neutralizes formula injection by
//! prefixing cells starting with `=`, `+`, `-`, `@`, `\t`, `\r` with a
//! single quote.

use rusqlite::Connection;

use crate::database::error::{DbResult, map_sqlite_error};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/// Neutralize CSV formula injection by prefixing dangerous leading characters.
///
/// Cells starting with `=`, `+`, `-`, `@`, `\t`, or `\r` get a single-quote
/// prefix so spreadsheet applications treat them as text, not formulas.
pub fn sanitize_csv_cell(value: &str) -> String {
    if value.starts_with('=')
        || value.starts_with('+')
        || value.starts_with('-')
        || value.starts_with('@')
        || value.starts_with('\t')
        || value.starts_with('\r')
    {
        format!("'{value}")
    } else {
        value.to_string()
    }
}

/// Escape a value for CSV output (RFC 4180).
fn csv_escape(value: &str) -> String {
    let sanitized = sanitize_csv_cell(value);
    if sanitized.contains(',') || sanitized.contains('"') || sanitized.contains('\n') {
        let escaped = sanitized.replace('"', "\"\"");
        format!("\"{escaped}\"")
    } else {
        sanitized
    }
}

/// Format an i64 amount as a decimal string (divide by 100).
fn format_amount(amount: i64) -> String {
    let sign = if amount < 0 { "-" } else { "" };
    let abs = amount.unsigned_abs();
    format!("{}{}.{:02}", sign, abs / 100, abs % 100)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/// Export transactions as CSV with formula-injection protection.
///
/// Returns the complete CSV content as a string.
pub fn export_transactions_csv(
    conn: &Connection,
    date_from: Option<&str>,
    date_to: Option<&str>,
) -> DbResult<String> {
    let mut conditions = vec!["t.deleted_at IS NULL".to_string()];
    let mut param_values: Vec<String> = Vec::new();

    if let Some(from) = date_from {
        conditions.push("t.date >= ?".to_string());
        param_values.push(from.to_string());
    }
    if let Some(to) = date_to {
        conditions.push("t.date <= ?".to_string());
        param_values.push(to.to_string());
    }

    let where_clause = conditions.join(" AND ");
    let sql = format!(
        "SELECT t.date, t.kind, t.amount, t.payee, t.description,
                a.name AS account_name,
                COALESCE(ct.name, '') AS category_name
         FROM transactions t
         JOIN accounts a ON t.account_id = a.id
         LEFT JOIN category_tags ct ON t.tag_id = ct.id
         WHERE {where_clause}
         ORDER BY t.date ASC"
    );

    let mut stmt = conn.prepare(&sql).map_err(map_sqlite_error)?;

    let param_refs: Vec<&dyn rusqlite::types::ToSql> = param_values
        .iter()
        .map(|v| v as &dyn rusqlite::types::ToSql)
        .collect();

    let rows = stmt
        .query_map(param_refs.as_slice(), |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, Option<String>>(3)?,
                row.get::<_, Option<String>>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
            ))
        })
        .map_err(map_sqlite_error)?;

    let mut out = String::new();
    out.push_str("Date,Kind,Amount,Payee,Description,Account,Category\n");

    for row in rows {
        let (date, kind, amount, payee, description, account, category) =
            row.map_err(map_sqlite_error)?;

        let line = format!(
            "{},{},{},{},{},{},{}",
            csv_escape(&date),
            csv_escape(&kind),
            csv_escape(&format_amount(amount)),
            csv_escape(payee.as_deref().unwrap_or("")),
            csv_escape(description.as_deref().unwrap_or("")),
            csv_escape(&account),
            csv_escape(&category),
        );
        out.push_str(&line);
        out.push('\n');
    }

    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_formula_equals() {
        assert_eq!(sanitize_csv_cell("=SUM(A1)"), "'=SUM(A1)");
    }

    #[test]
    fn sanitize_formula_plus() {
        assert_eq!(sanitize_csv_cell("+123"), "'+123");
    }

    #[test]
    fn sanitize_formula_minus() {
        assert_eq!(sanitize_csv_cell("-123"), "'-123");
    }

    #[test]
    fn sanitize_formula_at() {
        assert_eq!(sanitize_csv_cell("@SUM(A1)"), "'@SUM(A1)");
    }

    #[test]
    fn sanitize_formula_tab() {
        assert_eq!(sanitize_csv_cell("\t123"), "'\t123");
    }

    #[test]
    fn sanitize_formula_cr() {
        assert_eq!(sanitize_csv_cell("\r123"), "'\r123");
    }

    #[test]
    fn sanitize_safe_text() {
        assert_eq!(sanitize_csv_cell("hello"), "hello");
    }
}
