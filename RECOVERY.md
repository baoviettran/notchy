# Notchy — Data Recovery Guide

If the Notchy application becomes unusable, your data is safe. The database is a standard SQLite file that can be read with any SQLite tool.

## Locating the Database

The database file is named `notchy.db` and is stored in the Tauri application configuration directory:

| OS | Path |
|----|------|
| Linux | `~/.config/com.notchy.app/notchy.db` |
| macOS | `~/Library/Application Support/com.notchy.app/notchy.db` |
| Windows | `%APPDATA%\com.notchy.app\notchy.db` |

## Opening with sqlite3

```bash
sqlite3 ~/.config/com.notchy.app/notchy.db
```

## Essential Queries

### List all accounts with balances

```sql
WITH deltas AS (
  SELECT account_id AS account_id,
    CASE WHEN kind IN ('income', 'adjustment', 'refund') THEN amount
         WHEN kind IN ('expense', 'transfer') THEN -amount ELSE 0 END AS delta
  FROM transactions
  WHERE deleted_at IS NULL AND date <= date('now', 'localtime')
  UNION ALL
  SELECT transfer_account_id AS account_id, amount AS delta
  FROM transactions
  WHERE kind = 'transfer' AND deleted_at IS NULL
    AND date <= date('now', 'localtime')
)
SELECT a.name, a.type, a.currency, COALESCE(SUM(d.delta), 0) AS balance
FROM accounts a
LEFT JOIN deltas d ON d.account_id = a.id
WHERE a.deleted_at IS NULL
GROUP BY a.id
ORDER BY a.type, a.name;
```

### Monthly spending by tag

```sql
SELECT
  ct.name AS tag,
  cty.name AS bucket,
  SUM(t.amount) AS total
FROM transactions t
JOIN category_tags ct ON t.tag_id = ct.id
JOIN category_types cty ON ct.type_id = cty.id
WHERE t.kind = 'expense'
  AND t.date >= '2026-05-01'
  AND t.date < '2026-06-01'
  AND t.deleted_at IS NULL
GROUP BY t.tag_id
ORDER BY total DESC;
```

### All transactions for a payee

```sql
SELECT date, kind, amount, payee, description
FROM transactions
WHERE payee LIKE '%Coffee%'
  AND deleted_at IS NULL
ORDER BY date DESC;
```

### Complete data dump (CSV-friendly)

```sql
.mode csv
.headers on
.output accounts.csv
SELECT * FROM accounts WHERE deleted_at IS NULL;
.output transactions.csv
SELECT * FROM transactions WHERE deleted_at IS NULL;
.output categories.csv
SELECT ct.id, ct.name AS tag, cty.name AS bucket
FROM category_tags ct
JOIN category_types cty ON ct.type_id = cty.id
WHERE ct.deleted_at IS NULL;
.output stdout
```

### Check database integrity

```sql
PRAGMA integrity_check;
```

### View schema version

```sql
SELECT value FROM app_meta WHERE key = 'schema_version';
```

## Restoring from Backup

Desktop backups are stored in the application **data** directory, separately from the live database in the configuration directory. On Linux, routine snapshots are under `~/.local/share/com.notchy.app/backups/`, with pre-upgrade snapshots under `backups/upgrades/`. Current names look like `notchy-backup-v7-0.2.1-<ULID>.sqlite`; older timestamp-based names remain discoverable.

Prefer Settings → Backup & Data → Import database, or the recovery screen's verified-backup restore. The native restore protocol validates the candidate, publishes a rollback snapshot, retires the old SQLite journals, replaces the database, migrates if necessary, and verifies the result.

For offline recovery, first quit **all** Notchy processes. Keep the original database and its `-wal`/`-shm` companions together in a separate recovery folder before replacing anything; never leave journals from the old database beside a restored file. Work from a copy of a verified backup, and check it before reopening the app:

```bash
sqlite3 /path/to/backup.sqlite 'PRAGMA integrity_check;'
```

Ordinary launches do not publish routine backups and there is no automatic retention cleanup. Create manual backups regularly. Use SQLite exports for a complete restore; per-table CSV dumps are readable archives, not a lossless database import format.

## Schema Diagram

```
app_meta (key, value)

accounts ──┐
            ├── transactions (account_id → accounts.id)
            │       ├── tag_id → category_tags.id
            │       ├── transfer_account_id → accounts.id (destination)
            │       └── refund_of_id → transactions.id
            │
category_types ──── category_tags (type_id → category_types.id)
            │
            ├── budgets (type_id → category_types.id)
            │
accounts ──── goals (linked_account_id → accounts.id)
            │
accounts ──── reconciliations (account_id → accounts.id)

categorize_rules (payee → tag rules)
schedules (recurring templates)
operation_receipts (desktop mutation retry records)
change_log (audit trail, written by triggers)
```

## Notes

- All monetary amounts are integers in the smallest currency unit (VND has no decimals; USD stores cents)
- Soft-deleted rows have `deleted_at IS NOT NULL` — filter them out in queries
- Each transfer is one row: `account_id` is the source and `transfer_account_id` is the destination. Count both sides when calculating account balances.
- The `change_log` table contains a full history of all changes as JSON payloads
