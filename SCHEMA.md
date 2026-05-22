# Notchy — Schema Reference

This document describes every table in the Notchy SQLite database in plain language. It is intended for anyone who needs to understand or query the data directly using the `sqlite3` CLI.

## app_meta

Key-value store for application settings and state.

| Column | Type | Description |
|--------|------|-------------|
| key | TEXT (PK) | Setting name |
| value | TEXT | Setting value |

Known keys: `schema_version`, `device_id`, `locale`, `currency`, `first_run_complete`, `onboarding_step`, `integrity_warnings`.

## accounts

Financial accounts (bank accounts, wallets, credit cards, loans).

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (PK) | ULID identifier |
| name | TEXT | Display name (max 64 chars) |
| type | TEXT | One of: `checking`, `savings`, `cash`, `credit_card`, `loan_to_person`, `loan_from_person` |
| counterparty | TEXT | Required for loan types — the person involved |
| currency | TEXT | ISO 4217 code (e.g. `VND`, `USD`) |
| archived | INTEGER | 1 = hidden from active lists, still in reports |
| created_at | TEXT | ISO 8601 timestamp |
| updated_at | TEXT | ISO 8601 timestamp |
| deleted_at | TEXT | Soft-delete timestamp (NULL = active) |

## category_types (Buckets)

Top-level spending categories.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (PK) | ULID or stable ID (e.g. `bucket_essentials`) |
| name | TEXT | Display name (max 64 chars) |
| is_system | INTEGER | 1 = cannot be deleted |
| budgetable | INTEGER | 1 = included in budget calculations |
| sort_order | INTEGER | Display order |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | Soft-delete |

Seeded buckets: Essentials, Learning & Entertainment, Saving & Investment, Adjustments (system, not budgetable).

## category_tags (Tags)

Sub-categories within buckets.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (PK) | ULID or stable ID (e.g. `tag_initial_balance`) |
| type_id | TEXT (FK) | References `category_types.id` |
| name | TEXT | Display name (max 64 chars, unique within bucket) |
| is_system | INTEGER | 1 = cannot be deleted (can be renamed) |
| sort_order | INTEGER | Display order |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | Soft-delete. Transactions referencing a deleted tag display as "Uncategorised" |

System tags: Initial Balance, Loss, Gift, Reconciliation (all under Adjustments).

## transactions

All financial movements.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (PK) | ULID |
| kind | TEXT | One of: `expense`, `income`, `transfer`, `refund`, `adjustment` |
| date | TEXT | Transaction date (YYYY-MM-DD, between 1970-01-01 and 2100-12-31) |
| amount | INTEGER | **Always positive.** In the smallest currency unit (e.g. VND has no decimals; USD stores cents) |
| account_id | TEXT (FK) | The account this transaction belongs to |
| transfer_account_id | TEXT (FK) | For transfers: the other account |
| transfer_pair_id | TEXT | Shared ID linking both sides of a transfer |
| refund_of_id | TEXT (FK) | For refunds: the original expense being refunded |
| tag_id | TEXT (FK) | Category tag (NULL for transfers) |
| payee | TEXT | Who was paid (max 128 chars) |
| description | TEXT | Notes (max 1024 chars) |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | Soft-delete |

**Balance calculation:** For a given account, balance = SUM of: +income, +adjustment, +refund, -expense. Transfers: -amount on the source side, +amount on the destination side. Future-dated transactions are excluded from current balance.

## budgets

Monthly envelope allocations per bucket.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (PK) | ULID |
| type_id | TEXT (FK) | References `category_types.id` |
| month | TEXT | Format: `YYYY-MM` |
| allocated | INTEGER | Budget amount in smallest currency unit |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | Soft-delete |

Spent = SUM(expense) - SUM(refund) for transactions tagged within the bucket during that month.

## goals

Financial goals with progress tracking.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (PK) | ULID |
| name | TEXT | Goal name (max 64 chars) |
| type | TEXT | One of: `savings`, `debt_payoff`, `net_worth` |
| target_amount | INTEGER | Target in smallest currency unit |
| target_date | TEXT | Deadline (YYYY-MM-DD) |
| linked_account_id | TEXT (FK) | Account to track (NULL for net_worth) |
| starting_amount | INTEGER | Balance when goal was created |
| show_on_dashboard | INTEGER | 1 = visible on dashboard widget |
| status | TEXT | One of: `active`, `completed`, `abandoned`, `overdue` |
| closed_at | TEXT | When the goal was completed/abandoned |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | Soft-delete |

## reconciliations

Records of balance verification against external sources.

| Column | Type | Description |
|--------|------|-------------|
| id | TEXT (PK) | ULID |
| account_id | TEXT (FK) | Account reconciled |
| date | TEXT | Reconciliation date |
| expected_balance | INTEGER | Computed balance at time of reconciliation |
| actual_balance | INTEGER | User-entered actual balance |
| adjustment_transaction_id | TEXT (FK) | Transaction created to fix discrepancy (if any) |
| notes | TEXT | User notes |
| created_at | TEXT | ISO 8601 |
| updated_at | TEXT | ISO 8601 |
| deleted_at | TEXT | Soft-delete |

## change_log

Audit trail of all data changes. Written automatically by triggers.

| Column | Type | Description |
|--------|------|-------------|
| id | INTEGER (PK) | Auto-increment |
| table_name | TEXT | Which table was modified |
| row_id | TEXT | ID of the modified row |
| operation | TEXT | One of: `insert`, `update`, `delete` |
| timestamp | TEXT | When the change occurred |
| device_id | TEXT | Which device made the change |
| payload | TEXT | JSON snapshot of the row at time of change |

This table is used for auditing in v0.1 and will power the synchronisation engine in v0.4.
