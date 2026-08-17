//! Category domain service — ported from `src/lib/db/repos/categories.ts`.
//!
//! Bucket (category_types) and Tag (category_tags) CRUD, move, delete, and merge.

use rusqlite::{Connection, OptionalExtension, params};

use crate::database::error::{DbError, DbResult, ErrorCode, map_sqlite_error};
use crate::database::migrations::now_iso_utc;
use crate::database::receipt::run_idempotent;
use crate::database::types::{Bucket, OperationId, Tag, TagDeleteInfo};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

fn row_to_bucket(row: &rusqlite::Row<'_>) -> rusqlite::Result<Bucket> {
    Ok(Bucket {
        id: row.get(0)?,
        name: row.get(1)?,
        is_system: row.get(2)?,
        budgetable: row.get(3)?,
        rollover_enabled: row.get(4)?,
        sort_order: row.get(5)?,
        created_at: row.get(6)?,
        updated_at: row.get(7)?,
    })
}

fn row_to_tag(row: &rusqlite::Row<'_>) -> rusqlite::Result<Tag> {
    Ok(Tag {
        id: row.get(0)?,
        type_id: row.get(1)?,
        name: row.get(2)?,
        is_system: row.get(3)?,
        sort_order: row.get(4)?,
        created_at: row.get(5)?,
        updated_at: row.get(6)?,
    })
}

// ---------------------------------------------------------------------------
// Bucket operations
// ---------------------------------------------------------------------------

/// List all non-deleted buckets ordered by sort_order.
pub fn list_buckets(conn: &Connection) -> DbResult<Vec<Bucket>> {
    let mut stmt = conn
        .prepare(
            "SELECT id, name, is_system, budgetable, rollover_enabled, sort_order, created_at, updated_at
             FROM category_types WHERE deleted_at IS NULL ORDER BY sort_order",
        )
        .map_err(map_sqlite_error)?;
    let rows = stmt.query_map([], row_to_bucket).map_err(map_sqlite_error)?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(map_sqlite_error)?);
    }
    Ok(out)
}

/// Create a new bucket. Returns the new ID.
pub fn create_bucket(
    conn: &mut Connection,
    op_id: OperationId,
    name: String,
    budgetable: i32,
) -> DbResult<String> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Created { id: String }

    run_idempotent(conn, op_id, "create_bucket", &name, |tx| {
        let now = now_iso_utc();
        let id = OperationId::generate().as_str().to_string();
        let max_sort: i32 = tx
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) FROM category_types WHERE deleted_at IS NULL",
                [],
                |r| r.get(0),
            )
            .map_err(map_sqlite_error)?;
        tx.execute(
            "INSERT INTO category_types (id, name, budgetable, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, name, budgetable, max_sort + 1, now, now],
        )
        .map_err(map_sqlite_error)?;
        Ok(Created { id })
    })
    .map(|r| r.id)
}

/// Rename a bucket.
pub fn rename_bucket(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
    name: String,
) -> DbResult<()> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    run_idempotent(conn, op_id, "rename_bucket", &name, |tx| {
        let now = now_iso_utc();
        let affected = tx
            .execute(
                "UPDATE category_types SET name = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
                params![name, now, id],
            )
            .map_err(map_sqlite_error)?;
        if affected == 0 {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }
        Ok(Void {})
    })
    .map(|_| ())
}

/// Set the rollover_enabled flag on a bucket.
pub fn set_rollover_enabled(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
    enabled: bool,
) -> DbResult<()> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    run_idempotent(conn, op_id, "set_rollover", &enabled, |tx| {
        let now = now_iso_utc();
        let val: i32 = if enabled { 1 } else { 0 };
        let affected = tx
            .execute(
                "UPDATE category_types SET rollover_enabled = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
                params![val, now, id],
            )
            .map_err(map_sqlite_error)?;
        if affected == 0 {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }
        Ok(Void {})
    })
    .map(|_| ())
}

/// Soft-delete a bucket. Fails if it has active tags or transactions.
pub fn delete_bucket(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
) -> DbResult<()> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    run_idempotent(conn, op_id, "delete_bucket", &id.to_string(), |tx| {
        // Check for active tags.
        let tag_count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM category_tags WHERE type_id = ?1 AND deleted_at IS NULL",
                [id],
                |r| r.get(0),
            )
            .map_err(map_sqlite_error)?;
        if tag_count > 0 {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }

        // Check for active transactions referencing tags in this bucket.
        let txn_count: i64 = tx
            .query_row(
                "SELECT COUNT(*) FROM transactions t
                 JOIN category_tags ct ON t.tag_id = ct.id
                 WHERE ct.type_id = ?1 AND t.deleted_at IS NULL",
                [id],
                |r| r.get(0),
            )
            .map_err(map_sqlite_error)?;
        if txn_count > 0 {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }

        let now = now_iso_utc();
        tx.execute(
            "UPDATE category_types SET deleted_at = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
            params![now, now, id],
        )
        .map_err(map_sqlite_error)?;

        Ok(Void {})
    })
    .map(|_| ())
}

// ---------------------------------------------------------------------------
// Tag operations
// ---------------------------------------------------------------------------

/// List tags, optionally filtered by bucket.
pub fn list_tags(conn: &Connection, bucket_id: Option<&str>) -> DbResult<Vec<Tag>> {
    let (sql, param): (&str, Option<String>) = match bucket_id {
        Some(bid) => (
            "SELECT id, type_id, name, is_system, sort_order, created_at, updated_at
             FROM category_tags WHERE type_id = ?1 AND deleted_at IS NULL ORDER BY sort_order",
            Some(bid.to_string()),
        ),
        None => (
            "SELECT id, type_id, name, is_system, sort_order, created_at, updated_at
             FROM category_tags WHERE deleted_at IS NULL ORDER BY sort_order",
            None,
        ),
    };
    let mut stmt = conn.prepare(sql).map_err(map_sqlite_error)?;
    let rows = if let Some(ref p) = param {
        stmt.query_map(params![p], row_to_tag).map_err(map_sqlite_error)?
    } else {
        stmt.query_map([], row_to_tag).map_err(map_sqlite_error)?
    };
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(map_sqlite_error)?);
    }
    Ok(out)
}

/// Create a new tag within a bucket. Returns the new ID.
pub fn create_tag(
    conn: &mut Connection,
    op_id: OperationId,
    name: String,
    bucket_id: String,
) -> DbResult<String> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Created { id: String }

    run_idempotent(conn, op_id, "create_tag", &(&name, &bucket_id), |tx| {
        let now = now_iso_utc();
        let id = OperationId::generate().as_str().to_string();
        let max_sort: i32 = tx
            .query_row(
                "SELECT COALESCE(MAX(sort_order), -1) FROM category_tags WHERE type_id = ?1 AND deleted_at IS NULL",
                [&bucket_id],
                |r| r.get(0),
            )
            .map_err(map_sqlite_error)?;
        tx.execute(
            "INSERT INTO category_tags (id, type_id, name, sort_order, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![id, bucket_id, name, max_sort + 1, now, now],
        )
        .map_err(map_sqlite_error)?;
        Ok(Created { id })
    })
    .map(|r| r.id)
}

/// Rename a tag.
pub fn rename_tag(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
    name: String,
) -> DbResult<()> {
    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    run_idempotent(conn, op_id, "rename_tag", &name, |tx| {
        let now = now_iso_utc();
        let affected = tx
            .execute(
                "UPDATE category_tags SET name = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
                params![name, now, id],
            )
            .map_err(map_sqlite_error)?;
        if affected == 0 {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }
        Ok(Void {})
    })
    .map(|_| ())
}

/// Get info about transactions affected by a tag.
pub fn get_tag_transaction_info(conn: &Connection, tag_id: &str) -> DbResult<TagDeleteInfo> {
    let row = conn
        .query_row(
            "SELECT COUNT(*), COALESCE(SUM(amount), 0) FROM transactions WHERE tag_id = ?1 AND deleted_at IS NULL",
            [tag_id],
            |r| Ok(TagDeleteInfo {
                affected_count: r.get(0)?,
                affected_total: r.get(1)?,
            }),
        )
        .map_err(map_sqlite_error)?;
    Ok(row)
}

/// Move a tag to a different bucket. Returns info about affected transactions.
pub fn move_tag(
    conn: &mut Connection,
    op_id: OperationId,
    tag_id: &str,
    new_bucket_id: String,
) -> DbResult<TagDeleteInfo> {
    let info = get_tag_transaction_info(conn, tag_id)?;

    #[derive(serde::Serialize, serde::Deserialize)]
    struct Void {}

    run_idempotent(conn, op_id, "move_tag", &(&tag_id, &new_bucket_id), |tx| {
        let now = now_iso_utc();
        let affected = tx
            .execute(
                "UPDATE category_tags SET type_id = ?1, updated_at = ?2 WHERE id = ?3 AND deleted_at IS NULL",
                params![new_bucket_id, now, tag_id],
            )
            .map_err(map_sqlite_error)?;
        if affected == 0 {
            return Err(DbError::new(ErrorCode::InvalidInput));
        }
        Ok(Void {})
    })?;

    Ok(info)
}

/// Delete a tag. System tags cannot be deleted.
///
/// - `Some("uncategorise")`: soft-delete only; transactions keep their tag_id.
/// - `Some(merge_into)`: re-point all transactions to `merge_into`, then soft-delete source.
pub fn delete_tag(
    conn: &mut Connection,
    op_id: OperationId,
    id: &str,
    option: &str,
) -> DbResult<()> {
    // Validate tag exists and is not a system tag.
    let tag_row: Option<(i32,)> = conn
        .query_row(
            "SELECT is_system FROM category_tags WHERE id = ?1 AND deleted_at IS NULL",
            [id],
            |r| Ok((r.get(0)?,)),
        )
        .optional()
        .map_err(map_sqlite_error)?;
    let (is_system,) = tag_row.ok_or_else(|| DbError::new(ErrorCode::InvalidInput))?;
    if is_system == 1 {
        return Err(DbError::new(ErrorCode::InvalidInput));
    }

    if option == "uncategorise" {
        // Soft-delete only, inside idempotent wrapper.
        #[derive(serde::Serialize, serde::Deserialize)]
        struct Void {}
        run_idempotent(conn, op_id, "delete_tag_uncategorise", &id.to_string(), |tx| {
            let now = now_iso_utc();
            tx.execute(
                "UPDATE category_tags SET deleted_at = ?1, updated_at = ?2 WHERE id = ?3",
                params![now, now, id],
            )
            .map_err(map_sqlite_error)?;
            Ok(Void {})
        })?;
    } else {
        // Merge: re-point transactions then soft-delete source.
        let merge_target = option;
        #[derive(serde::Serialize, serde::Deserialize)]
        struct Void {}
        run_idempotent(conn, op_id, "delete_tag_merge", &(&id.to_string(), merge_target), |tx| {
            let now = now_iso_utc();
            tx.execute(
                "UPDATE transactions SET tag_id = ?1, updated_at = ?2 WHERE tag_id = ?3 AND deleted_at IS NULL",
                params![merge_target, now, id],
            )
            .map_err(map_sqlite_error)?;
            tx.execute(
                "UPDATE category_tags SET deleted_at = ?1, updated_at = ?2 WHERE id = ?3",
                params![now, now, id],
            )
            .map_err(map_sqlite_error)?;
            Ok(Void {})
        })?;
    }
    Ok(())
}
