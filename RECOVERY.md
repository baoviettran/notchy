# Notchy — Data Recovery Guide

If the Notchy application becomes unusable, your data is safe. The database is a standard SQLite file that can be read with any SQLite tool.

## Locating the Database

The database file is named `notchy.db` and is stored in the Tauri application data directory:

| OS | Path |
|----|------|
| Linux | `~/.local/share/com.notchy.app/notchy.db` |
| macOS | `~/Library/Application Support/com.notchy.app/notchy.db` |
| Windows | `%APPDATA%\com.notchy.app\notchy.db` |

## Opening with sqlite3

```bash
sqlite3 ~/.local/share/com.notchy.app/notchy.db
```

## Essential Queries

### List all accounts with balances

```sql
SELECT
  a.name,
  a.type,
  a.currency,
  COALESCE(SUM(
    CASE
      WHEN t.kind IN ('income', 'adjustment', 'refund') THEN t.amount
      WHEN t.kind = 'expense' THEN -t.amount
      WHEN t.kind = 'transfer' AND t.transfer_account_id IS NOT NULL THEN -t.amount
      WHEN t.kind = 'transfer' AND t.transfer_account_id IS NULL THEN t.amount
      ELSE 0
    END
  ), 0) AS balance
FROM accounts a
LEFT JOIN transactions t ON t.account_id = a.id AND t.deleted_at IS NULL AND t.date <= date('now')
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

Backups are stored in the same directory as the database, named `notchy-backup-YYYY-MM-DDTHH-MM-SS.sqlite`. To restore:

```bash
# 1. Close Notchy
# 2. Replace the database with a backup
cp notchy-backup-2026-05-22T10-00-00.sqlite notchy.db
# 3. Reopen Notchy
```

## Schema Diagram

```
app_meta (key, value)

accounts ──┐
            ├── transactions (account_id → accounts.id)
            │       ├── tag_id → category_tags.id
            │       ├── transfer_pair_id (links two transfer rows)
            │       └── refund_of_id → transactions.id
            │
category_types ──── category_tags (type_id → category_types.id)
            │
            ├── budgets (type_id → category_types.id)
            │
accounts ──── goals (linked_account_id → accounts.id)
            │
accounts ──── reconciliations (account_id → accounts.id)

change_log (audit trail, written by triggers)
```

## Notes

- All monetary amounts are integers in the smallest currency unit (VND has no decimals; USD stores cents)
- Soft-deleted rows have `deleted_at IS NOT NULL` — filter them out in queries
- Transfers always exist as pairs sharing a `transfer_pair_id`
- The `change_log` table contains a full history of all changes as JSON payloads
