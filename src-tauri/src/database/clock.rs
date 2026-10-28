//! Native local calendar labels; callers can inject the same DTO in tests.
use chrono::{DateTime, Datelike, FixedOffset, Local};
use serde::{Deserialize, Serialize};
use ts_rs::TS;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct BackupClock {
    pub now_iso: String,
    pub local_date: String,
    pub iso_week: String,
    pub offset_minutes: i32,
}

pub fn local_backup_clock() -> BackupClock {
    let now = Local::now();
    BackupClock {
        now_iso: now.to_rfc3339(),
        local_date: now.format("%Y-%m-%d").to_string(),
        iso_week: now.format("%G-W%V").to_string(),
        offset_minutes: now.offset().local_minus_utc() / 60,
    }
}

pub(crate) fn validated_clock(clock: &BackupClock) -> Option<DateTime<FixedOffset>> {
    // chrono accepts leap seconds and truncates excessive fractional precision;
    // keep the same canonical subset as the browser policy before parsing.
    let value = &clock.now_iso;
    if !value.is_ascii() || value.len() < 20 { return None; }
    if value.get(10..11)? != "T" || value.get(13..14)? != ":" || value.get(16..17)? != ":"
        || value.get(11..13)?.parse::<u8>().ok()? > 23
        || value.get(14..16)?.parse::<u8>().ok()? > 59
        || value.get(17..19)?.parse::<u8>().ok()? > 59 {
        return None;
    }
    let suffix = &value[19..];
    let suffix = if let Some(fraction) = suffix.strip_prefix('.') {
        let digits = fraction.bytes().take_while(u8::is_ascii_digit).count();
        if !(1..=9).contains(&digits) { return None; }
        &fraction[digits..]
    } else { suffix };
    if suffix != "Z" && !(suffix.len() == 6
        && matches!(suffix.as_bytes()[0], b'+' | b'-')
        && suffix.as_bytes()[3] == b':'
        && suffix[1..3].bytes().all(|b| b.is_ascii_digit())
        && suffix[4..6].bytes().all(|b| b.is_ascii_digit())) {
        return None;
    }
    let instant = DateTime::parse_from_rfc3339(value).ok()?;
    let offset = FixedOffset::east_opt(clock.offset_minutes.checked_mul(60)?)?;
    let local = instant.with_timezone(&offset);
    if local.format("%Y-%m-%d").to_string() != clock.local_date
        || format!("{:04}-W{:02}", local.iso_week().year(), local.iso_week().week()) != clock.iso_week {
        return None;
    }
    Some(local)
}
