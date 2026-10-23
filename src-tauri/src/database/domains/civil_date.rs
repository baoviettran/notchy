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

/// Recurrence keeps the current JS clamping/drift semantics.
pub fn next_due_date(date: &crate::database::types::IsoDate, frequency: &crate::database::types::ScheduleFrequency) -> crate::database::error::DbResult<crate::database::types::IsoDate> {
 use crate::database::{types::{IsoDate, ScheduleFrequency}, error::{DbError, ErrorCode}};
 let parts: Vec<u32> = date.as_str().split('-').map(|v| v.parse().unwrap_or(0)).collect();
 let (mut y, mut m, mut d) = (parts[0], parts[1], parts[2]);
 fn dim(y:u32,m:u32)->u32 { match m {2=>if y % 400 == 0 || (y % 4 == 0 && y % 100 != 0) {29}else{28},4|6|9|11=>30,_=>31} }
 match frequency {
  ScheduleFrequency::Monthly => { m+=1; if m==13 {m=1;y+=1;} d=d.min(dim(y,m)); },
  ScheduleFrequency::Yearly => { y+=1; d=d.min(dim(y,m)); },
  ScheduleFrequency::Weekly | ScheduleFrequency::Biweekly => {
   let days=if matches!(frequency,ScheduleFrequency::Weekly) {7}else{14};
   for _ in 0..days {d+=1;if d>dim(y,m) {d=1;m+=1;if m>12 {m=1;y+=1;}}}
  }
 }
 IsoDate::parse(format!("{y:04}-{m:02}-{d:02}")).map_err(|_|DbError::new(ErrorCode::InvalidDate))
}

#[cfg(test)]
mod tests {
    use super::civil_from_days;

    // Expected values come from an independent source (Python
    // `datetime.date`), not from reading this function back. Month-granularity
    // assertions are not enough: a one-day shift in the era constant
    // (`719_468` -> `719_469`) left the whole suite green while `today_iso()`
    // -- which feeds the `date <=` boundary filters in `list_accounts` and
    // `get_account` -- was a day out.

    #[test]
    fn epoch_is_1970_01_01() {
        assert_eq!(civil_from_days(0), (1970, 1, 1));
    }

    #[test]
    fn day_before_the_epoch_takes_the_negative_era_branch() {
        assert_eq!(civil_from_days(-1), (1969, 12, 31));
    }

    #[test]
    fn day_after_the_epoch() {
        assert_eq!(civil_from_days(1), (1970, 1, 2));
    }

    #[test]
    fn leap_day_and_the_day_after() {
        assert_eq!(civil_from_days(19_782), (2024, 2, 29));
        assert_eq!(civil_from_days(19_783), (2024, 3, 1));
    }

    #[test]
    fn leap_century_2000() {
        assert_eq!(civil_from_days(11_016), (2000, 2, 29));
        assert_eq!(civil_from_days(11_017), (2000, 3, 1));
    }

    #[test]
    fn non_leap_century_2100_has_no_february_29() {
        assert_eq!(civil_from_days(47_540), (2100, 2, 28));
        assert_eq!(civil_from_days(47_541), (2100, 3, 1));
    }

    #[test]
    fn ordinary_month_rollover() {
        assert_eq!(civil_from_days(20_713), (2026, 9, 17));
        assert_eq!(civil_from_days(20_714), (2026, 9, 18));
    }

    #[test]
    fn far_future() {
        assert_eq!(civil_from_days(2_932_896), (9999, 12, 31));
    }
}
