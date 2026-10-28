//! Automatic publication runs under one profile transition permit and one
//! executor job. No manager/state mutex survives await and no receipt nests.
use std::{fs, path::{Path, PathBuf}, sync::Arc};
use chrono::NaiveDate;
use rusqlite::{params, Connection};
use crate::database::{DbError, DbResult, ErrorCode, OperationId, BackupFailurePoint};
use crate::database::automatic_backup::{AutomaticBackupStatus, AutomaticCopy, read_automatic_status, automatic_backup_due, automatic_retention_ids, automatic_prune_clock_trusted, set_automatic_enabled};
use crate::database::backup::{backup_filename_with_id, publish_backup_with_id};
use crate::database::clock::{BackupClock, local_backup_clock, validated_clock};
use crate::database::connection::{create_dir_private, open_read_only_at};
use crate::database::domains::meta::{get_meta, set_meta};
use crate::database::error::map_sqlite_error;
use crate::database::manifest::validate_manifest;
use super::{coordinator::ProfileCoordinator, types::ProfileSession};

const PUBLICATION_WARNING: &str = "backup_automatic_failed";
const CLOCK_WARNING: &str = "backup_automatic_clock_warning";
const PRUNE_WARNING: &str = "backup_automatic_prune_failed";

/// Native test seam only; never exposed as a command argument.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AutomaticBackupFailurePoint { None, BeforePublication, AfterPublication, Prune }

#[derive(Clone)]
struct Job { id: String, filename: String, revision: i64, clock: BackupClock }
fn unavailable() -> DbError { DbError::new(ErrorCode::BackupUnavailable) }

fn pending(conn: &Connection) -> DbResult<Option<Job>> {
    conn.query_row("SELECT pending_job_id,pending_relative_filename,pending_revision,pending_local_date,pending_local_week,pending_started_at,pending_offset_minutes FROM automatic_backup_state WHERE id=1", [], |r| {
        let id: Option<String> = r.get(0)?;
        Ok(match id { None => None, Some(id) => Some(Job { id, filename:r.get(1)?,revision:r.get(2)?,clock:BackupClock { local_date:r.get(3)?,iso_week:r.get(4)?,now_iso:r.get(5)?,offset_minutes:r.get(6)? } }) })
    }).map_err(map_sqlite_error)
}
fn previous_clock(conn: &Connection) -> DbResult<Option<BackupClock>> {
    let status = read_automatic_status(conn)?;
    let offset: Option<i32> = conn.query_row("SELECT last_success_offset_minutes FROM automatic_backup_state WHERE id=1", [], |r| r.get(0)).map_err(map_sqlite_error)?;
    Ok(match (status.last_success_at,status.last_success_date,offset) {
        (Some(now_iso),Some(local_date),Some(offset_minutes)) => NaiveDate::parse_from_str(&local_date,"%Y-%m-%d").ok().map(|date| BackupClock { now_iso, local_date, iso_week:date.format("%G-W%V").to_string(), offset_minutes }),
        _ => None,
    })
}
fn status(conn: &Connection) -> DbResult<AutomaticBackupStatus> {
    let mut result=read_automatic_status(conn)?;
    if result.enabled {
        result.next_eligible_date = result.last_success_date.as_deref()
            .and_then(|d| NaiveDate::parse_from_str(d,"%Y-%m-%d").ok())
            .and_then(|d|d.succ_opt()).map(|d| d.to_string());
    }
    Ok(result)
}
fn warning(conn: &Connection, key: &str) -> DbResult<()> {
    conn.execute("UPDATE automatic_backup_state SET warning=?1 WHERE id=1", [key]).map_err(map_sqlite_error)?; Ok(())
}
fn clock_warning(conn: &Connection) -> DbResult<AutomaticBackupStatus> {
    let mut result=status(conn)?;
    // A clock observation cannot resolve an earlier publication failure. Keep
    // that durable cause while reporting the current clock warning to callers.
    if result.warning.as_deref()!=Some(PUBLICATION_WARNING) { warning(conn,CLOCK_WARNING)?; }
    result.warning=Some(CLOCK_WARNING.into());
    Ok(result)
}
fn prune_warning(conn: &Connection, key: Option<&str>) -> DbResult<()> {
    conn.execute("UPDATE automatic_backup_state SET prune_warning=?1 WHERE id=1", [key]).map_err(map_sqlite_error)?; Ok(())
}

// Refuse redirected owned directories. Names from SQLite never become arbitrary
// paths, even if an imported/edited row bypassed its CHECK constraint.
fn owned_directory(profile: &Path) -> DbResult<PathBuf> {
    for path in [profile.parent().and_then(Path::parent).ok_or_else(unavailable)?, profile.parent().ok_or_else(unavailable)?, profile] {
        if !fs::symlink_metadata(path).map_err(|_|unavailable())?.is_dir() { return Err(unavailable()); }
    }
    let directory=profile.join("backups");
    match fs::symlink_metadata(&directory) {
        Ok(meta) if meta.is_dir() => {},
        Ok(_) => return Err(unavailable()),
        Err(e) if e.kind()==std::io::ErrorKind::NotFound => create_dir_private(&directory).map_err(|_|unavailable())?,
        Err(_) => return Err(unavailable()),
    }
    Ok(directory)
}
fn owned_path(directory: &Path, name: &str) -> DbResult<PathBuf> {
    if name.is_empty() || name.contains(['/', '\\']) || matches!(name,"."|"..") { return Err(unavailable()); }
    Ok(directory.join(name))
}
fn verify_job(directory: &Path, owner: &str, job: &Job) -> DbResult<i64> {
    OperationId::parse(&job.id).map_err(|_|unavailable())?;
    if validated_clock(&job.clock).is_none() { return Err(unavailable()); }
    let path=owned_path(directory,&job.filename)?;
    if !fs::symlink_metadata(&path).map_err(|_|unavailable())?.is_file() { return Err(unavailable()); }
    let conn=open_read_only_at(&path)?;
    let schema=get_meta(&conn,"schema_version")?.and_then(|s|s.parse::<i64>().ok()).ok_or_else(unavailable)?;
    validate_manifest(&conn,schema)?;
    if get_meta(&conn,"automatic_backup_owner")?.as_deref()!=Some(owner)
        || backup_filename_with_id(&path,&job.id)? != job.filename
        || read_automatic_status(&conn)?.content_revision != job.revision {
        return Err(unavailable());
    }
    let embedded=pending(&conn)?.ok_or_else(unavailable)?;
    if embedded.id!=job.id || embedded.filename!=job.filename || embedded.revision!=job.revision || embedded.clock!=job.clock { return Err(unavailable()); }
    Ok(schema)
}
fn sync_publication(directory: &Path, filename: &str) -> DbResult<()> {
    fs::File::open(owned_path(directory,filename)?).and_then(|f|f.sync_all()).map_err(|_|unavailable())?;
    fs::File::open(directory).and_then(|f|f.sync_all()).map_err(|_|unavailable())
}
fn register(conn: &mut Connection, job: &Job, schema: i64) -> DbResult<()> {
    let tx=conn.transaction().map_err(map_sqlite_error)?;
    tx.execute("INSERT INTO automatic_backup_copies (id,relative_filename,schema_version,captured_revision,local_date,local_week,created_at,publication_job_id,offset_minutes) VALUES (?1,?2,?3,?4,?5,?6,?7,?1,?8)", params![job.id,job.filename,schema,job.revision,job.clock.local_date,job.clock.iso_week,job.clock.now_iso,job.clock.offset_minutes]).map_err(map_sqlite_error)?;
    tx.execute("UPDATE automatic_backup_state SET backed_up_revision=?1,last_success_at=?2,last_success_date=?3,last_success_offset_minutes=?4,warning=NULL,pending_job_id=NULL,pending_relative_filename=NULL,pending_revision=NULL,pending_local_date=NULL,pending_local_week=NULL,pending_started_at=NULL,pending_offset_minutes=NULL WHERE id=1",params![job.revision,job.clock.now_iso,job.clock.local_date,job.clock.offset_minutes]).map_err(map_sqlite_error)?;
    tx.commit().map_err(map_sqlite_error)
}
fn prune(conn: &Connection, directory: &Path, owner: &str, protected: &str, failpoint: AutomaticBackupFailurePoint) -> DbResult<()> {
    let mut stmt=conn.prepare("SELECT id,relative_filename,schema_version,captured_revision,local_date,local_week,created_at,publication_job_id,offset_minutes FROM automatic_backup_copies").map_err(map_sqlite_error)?;
    let copies: Vec<AutomaticCopy> = stmt.query_map([], |r| Ok(AutomaticCopy { id:r.get(0)?,relative_filename:r.get(1)?,schema_version:r.get(2)?,captured_revision:r.get(3)?,local_date:r.get(4)?,local_week:r.get(5)?,created_at:r.get(6)?,publication_job_id:r.get(7)?,offset_minutes:r.get(8)?,kind:"automatic".into(),verified:true,owned:true })).map_err(map_sqlite_error)?.collect::<rusqlite::Result<_>>().map_err(map_sqlite_error)?;
    drop(stmt);
    let as_job=|c: &AutomaticCopy| Job {id:c.id.clone(),filename:c.relative_filename.clone(),revision:c.captured_revision,clock:BackupClock {now_iso:c.created_at.clone(),local_date:c.local_date.clone(),iso_week:c.local_week.clone(),offset_minutes:c.offset_minutes}};
    let protected_copy=copies.iter().find(|c|c.id==protected).ok_or_else(unavailable)?;
    verify_job(directory,owner,&as_job(protected_copy))?;
    let mut verified=Vec::new();
    for copy in copies {
        if copy.id!=copy.publication_job_id { return Err(unavailable()); }
        let path=owned_path(directory,&copy.relative_filename)?;
        if matches!(fs::symlink_metadata(&path),Err(e) if e.kind()==std::io::ErrorKind::NotFound) {
            // An interrupted unlink is harmless. Forget only the missing row.
            conn.execute("DELETE FROM automatic_backup_copies WHERE id=?1",[&copy.id]).map_err(map_sqlite_error)?;
            continue;
        }
        if verify_job(directory,owner,&as_job(&copy))? != copy.schema_version { return Err(unavailable()); }
        verified.push(copy);
    }
    for id in automatic_retention_ids(&verified,protected) {
        if failpoint==AutomaticBackupFailurePoint::Prune { return Err(unavailable()); }
        let copy=verified.iter().find(|c|c.id==id).ok_or_else(unavailable)?;
        // Revalidate immediately before unlink; never treat a filename as proof.
        verify_job(directory,owner,&as_job(copy))?;
        fs::remove_file(owned_path(directory,&copy.relative_filename)?).map_err(|_|unavailable())?;
        fs::File::open(directory).and_then(|f|f.sync_all()).map_err(|_|unavailable())?;
        conn.execute("DELETE FROM automatic_backup_copies WHERE id=?1",[id]).map_err(map_sqlite_error)?;
    }
    Ok(())
}
fn run(conn: &mut Connection, profile: &Path, owner: &str, clock: &BackupClock, failpoint: AutomaticBackupFailurePoint) -> DbResult<AutomaticBackupStatus> {
    let before=read_automatic_status(conn)?;
    let job=pending(conn)?;
    let previous=previous_clock(conn)?;
    let Some(now)=validated_clock(clock) else { return clock_warning(conn); };
    let backwards=before.last_success_at.as_deref().is_some_and(|at| chrono::DateTime::parse_from_rfc3339(at).map_or(true,|last|now<last))
        || before.last_success_date.as_deref().is_some_and(|date|NaiveDate::parse_from_str(date,"%Y-%m-%d").is_err() || clock.local_date.as_str()<date);
    let pending_backwards=job.as_ref().is_some_and(|job| validated_clock(&job.clock)
        .is_none_or(|started| now<started || clock.local_date<job.clock.local_date));
    if backwards || pending_backwards { return clock_warning(conn); }
    if before.warning.as_deref()==Some(CLOCK_WARNING) { conn.execute("UPDATE automatic_backup_state SET warning=NULL WHERE id=1",[]).map_err(map_sqlite_error)?; }
    if !before.enabled { return status(conn); }
    if job.is_none() && !automatic_backup_due(&before,clock) {
        // Retry a failed prune only after a previously verified publication.
        // Clock-deferral warnings are cleared by a later stable publication.
        if before.prune_warning.as_deref()==Some(PRUNE_WARNING) && previous.as_ref().is_some_and(|p|automatic_prune_clock_trusted(p,clock)) {
            let result=(|| {
                let dir=owned_directory(profile)?;
                let protected:String=conn.query_row("SELECT id FROM automatic_backup_copies ORDER BY created_at DESC,id DESC LIMIT 1",[],|r|r.get(0)).map_err(map_sqlite_error)?;
                prune(conn,&dir,owner,&protected,failpoint)
            })();
            prune_warning(conn,if result.is_ok(){None}else{Some(PRUNE_WARNING)})?;
        }
        return status(conn);
    }
    let result=(|| -> DbResult<(Job,i64,PathBuf)> {
        let directory=owned_directory(profile)?;
        let source=profile.join("notchy.db");
        let id=job.as_ref().map(|j|j.id.clone()).unwrap_or_else(||OperationId::generate().as_str().into());
        OperationId::parse(&id).map_err(|_|unavailable())?;
        if let Some(existing)=job.as_ref() {
            let path=owned_path(&directory,&existing.filename)?;
            match fs::symlink_metadata(&path) {
                Ok(_) => {
                    let schema=verify_job(&directory,owner,existing)?;
                    sync_publication(&directory,&existing.filename)?;
                    return Ok((existing.clone(),schema,directory));
                },
                Err(e) if e.kind()==std::io::ErrorKind::NotFound => {},
                Err(_) => return Err(unavailable()),
            }
        }
        // No durable copy exists: keep the job identity but capture the current
        // revision and clock together. A prior failed attempt backed up nothing.
        let fresh=Job { filename:backup_filename_with_id(&source,&id)?, id, revision:before.content_revision, clock:clock.clone() };
        conn.execute("UPDATE automatic_backup_state SET pending_job_id=?1,pending_relative_filename=?2,pending_revision=?3,pending_local_date=?4,pending_local_week=?5,pending_started_at=?6,pending_offset_minutes=?7 WHERE id=1",params![fresh.id,fresh.filename,fresh.revision,clock.local_date,clock.iso_week,clock.now_iso,clock.offset_minutes]).map_err(map_sqlite_error)?;
        let publication_failpoint=if failpoint==AutomaticBackupFailurePoint::BeforePublication { BackupFailurePoint::AfterFileSync } else { BackupFailurePoint::None };
        publish_backup_with_id(&source,&directory,&fresh.id,publication_failpoint)?;
        let schema=verify_job(&directory,owner,&fresh)?;
        if failpoint==AutomaticBackupFailurePoint::AfterPublication { return Err(unavailable()); }
        Ok((fresh,schema,directory))
    })();
    let (job,schema,directory)=match result { Ok(result)=>result,Err(_)=>{warning(conn,PUBLICATION_WARNING)?;return status(conn);} };
    if register(conn,&job,schema).is_err() { warning(conn,PUBLICATION_WARNING)?; return status(conn); }
    // Both persisted job time and current observation must move forward before
    // authorizing deletion. Never substitute the just-written success for prior.
    let trusted=previous.as_ref().is_some_and(|p| automatic_prune_clock_trusted(p,&job.clock))
        && automatic_prune_clock_trusted(&job.clock,clock);
    if trusted {
        let result=prune(conn,&directory,owner,&job.id,failpoint);
        prune_warning(conn,if result.is_ok(){None}else{Some(PRUNE_WARNING)})?;
    } else if previous.is_some() {
        prune_warning(conn,Some(CLOCK_WARNING))?;
    }
    status(conn)
}

impl ProfileCoordinator {
    pub async fn automatic_backup_status(&self, session: &ProfileSession) -> DbResult<AutomaticBackupStatus> {
        self.with_session(session,|state|status(state.connection()?)).await
    }
    pub async fn set_automatic_backup_enabled(&self, session: &ProfileSession, enabled: bool, operation_id: OperationId) -> DbResult<()> {
        self.with_session(session,move |state|set_automatic_enabled(state.connection_mut()?,enabled,operation_id)).await
    }
    pub async fn check_automatic_backup(&self, session: &ProfileSession) -> DbResult<AutomaticBackupStatus> {
        self.check_automatic_backup_at(session,&local_backup_clock(),AutomaticBackupFailurePoint::None).await
    }
    pub async fn check_automatic_backup_at(&self, session: &ProfileSession, clock: &BackupClock, failpoint: AutomaticBackupFailurePoint) -> DbResult<AutomaticBackupStatus> {
        let _permit=self.transition.write().await;
        let (manager,name)={
            let state=self.state.lock().unwrap_or_else(|p|p.into_inner());
            let active=state.active.as_ref().filter(|a|a.session==*session).ok_or_else(||DbError::new(ErrorCode::ProfileSessionExpired))?;
            let name=state.registry.profiles.iter().find(|p|p.id==session.profile_id).ok_or_else(unavailable)?.name.clone();
            (Arc::clone(&active.manager),name)
        };
        let profile=self.paths.profile_dir(&session.profile_id)?;
        let owner=session.profile_id.clone(); let clock=clock.clone();
        manager.data_job(move |state| {
            let conn=state.connection_mut()?;
            set_meta(conn,"profile_display_name",&name)?;
            run(conn,&profile,&owner,&clock,failpoint)
        }).await
    }
}
