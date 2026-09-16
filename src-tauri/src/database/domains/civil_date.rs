//! Civil date arithmetic, in one place.
//!
//! The Howard Hinnant days-from-civil block was copy-pasted four times inside
//! `reports.rs` alone (`:204`, `:362`, `:440`, `:591`) and once more inline in
//! `transactions.rs:585`. Five copies of a date derivation is five places to be
//! wrong about February.

/// `(year, month, day)` for a count of days since the Unix epoch, UTC.
///
/// Howard Hinnant's `civil_from_days`, the standard constant-719468 form.
fn civil_from_days(days: i64) -> (i32, u32, u32) {
    let z = days + 719_468;
    let era = if z >= 0 { z } else { z - 146_096 } / 146_097;
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let year = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = if month <= 2 { year + 1 } else { year };

    (year as i32, month as u32, day as u32)
}

/// Days since the Unix epoch, UTC, from the system clock.
fn days_since_epoch() -> i64 {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default();
    (now.as_secs() / 86_400) as i64
}

/// Today as `(year, month)`, UTC.
pub fn current_year_month() -> (i32, u32) {
    let (year, month, _) = civil_from_days(days_since_epoch());
    (year, month)
}

/// Today as `YYYY-MM-DD`, UTC.
pub fn today_iso() -> String {
    let (year, month, day) = civil_from_days(days_since_epoch());
    format!("{year:04}-{month:02}-{day:02}")
}
