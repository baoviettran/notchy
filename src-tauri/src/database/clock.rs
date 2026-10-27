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
    let instant = DateTime::parse_from_rfc3339(&clock.now_iso).ok()?;
    let offset = FixedOffset::east_opt(clock.offset_minutes.checked_mul(60)?)?;
    let local = instant.with_timezone(&offset);
    if local.format("%Y-%m-%d").to_string() != clock.local_date
        || format!("{:04}-W{:02}", local.iso_week().year(), local.iso_week().week()) != clock.iso_week {
        return None;
    }
    Some(local)
}
