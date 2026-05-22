import type { Migration } from './runner';

export const migration001: Migration = {
	version: 1,
	name: 'initial_schema',
	async up(db) {
		await db.execute(`
			CREATE TABLE accounts (
				id           TEXT PRIMARY KEY,
				name         TEXT NOT NULL CHECK (length(name) <= 64),
				type         TEXT NOT NULL CHECK (type IN (
				               'checking', 'savings', 'cash', 'credit_card',
				               'loan_to_person', 'loan_from_person'
				             )),
				counterparty TEXT CHECK (counterparty IS NULL OR length(counterparty) <= 64),
				currency     TEXT NOT NULL DEFAULT 'VND',
				archived     INTEGER NOT NULL DEFAULT 0,
				created_at   TEXT NOT NULL,
				updated_at   TEXT NOT NULL,
				deleted_at   TEXT
			)
		`);

		await db.execute(`
			CREATE TABLE category_types (
				id         TEXT PRIMARY KEY,
				name       TEXT NOT NULL CHECK (length(name) <= 64),
				is_system  INTEGER NOT NULL DEFAULT 0,
				budgetable INTEGER NOT NULL DEFAULT 1,
				sort_order INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				deleted_at TEXT
			)
		`);

		await db.execute(`
			CREATE TABLE category_tags (
				id         TEXT PRIMARY KEY,
				type_id    TEXT NOT NULL REFERENCES category_types(id),
				name       TEXT NOT NULL CHECK (length(name) <= 64),
				is_system  INTEGER NOT NULL DEFAULT 0,
				sort_order INTEGER NOT NULL DEFAULT 0,
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				deleted_at TEXT,
				UNIQUE(type_id, name) ON CONFLICT ABORT
			)
		`);

		await db.execute(`
			CREATE TABLE transactions (
				id                  TEXT PRIMARY KEY,
				kind                TEXT NOT NULL CHECK (kind IN (
				                      'expense', 'income', 'transfer', 'refund', 'adjustment'
				                    )),
				date                TEXT NOT NULL CHECK (date BETWEEN '1970-01-01' AND '2100-12-31'),
				amount              INTEGER NOT NULL CHECK (amount > 0 AND amount <= 999999999999),
				account_id          TEXT NOT NULL REFERENCES accounts(id),
				transfer_account_id TEXT REFERENCES accounts(id),
				transfer_pair_id    TEXT,
				refund_of_id        TEXT REFERENCES transactions(id),
				tag_id              TEXT REFERENCES category_tags(id),
				payee               TEXT CHECK (payee IS NULL OR length(payee) <= 128),
				description         TEXT CHECK (description IS NULL OR length(description) <= 1024),
				created_at          TEXT NOT NULL,
				updated_at          TEXT NOT NULL,
				deleted_at          TEXT,
				CHECK (
					(kind = 'transfer' AND transfer_account_id IS NOT NULL AND transfer_pair_id IS NOT NULL AND tag_id IS NULL AND refund_of_id IS NULL)
					OR (kind = 'refund' AND transfer_account_id IS NULL AND transfer_pair_id IS NULL)
					OR (kind IN ('expense', 'income', 'adjustment') AND transfer_account_id IS NULL AND transfer_pair_id IS NULL AND refund_of_id IS NULL)
				)
			)
		`);

		await db.execute(`
			CREATE TABLE budgets (
				id         TEXT PRIMARY KEY,
				type_id    TEXT NOT NULL REFERENCES category_types(id),
				month      TEXT NOT NULL CHECK (month GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]'),
				allocated  INTEGER NOT NULL CHECK (allocated >= 0),
				created_at TEXT NOT NULL,
				updated_at TEXT NOT NULL,
				deleted_at TEXT,
				UNIQUE(type_id, month)
			)
		`);

		await db.execute(`
			CREATE TABLE goals (
				id                TEXT PRIMARY KEY,
				name              TEXT NOT NULL CHECK (length(name) <= 64),
				type              TEXT NOT NULL CHECK (type IN ('savings', 'debt_payoff', 'net_worth')),
				target_amount     INTEGER NOT NULL CHECK (target_amount > 0),
				target_date       TEXT NOT NULL,
				linked_account_id TEXT REFERENCES accounts(id),
				starting_amount   INTEGER NOT NULL,
				show_on_dashboard INTEGER NOT NULL DEFAULT 1,
				status            TEXT NOT NULL DEFAULT 'active'
				                    CHECK (status IN ('active', 'completed', 'abandoned', 'overdue')),
				closed_at         TEXT,
				created_at        TEXT NOT NULL,
				updated_at        TEXT NOT NULL,
				deleted_at        TEXT
			)
		`);

		await db.execute(`
			CREATE TABLE reconciliations (
				id                        TEXT PRIMARY KEY,
				account_id                TEXT NOT NULL REFERENCES accounts(id),
				date                      TEXT NOT NULL,
				expected_balance          INTEGER NOT NULL,
				actual_balance            INTEGER NOT NULL,
				adjustment_transaction_id TEXT REFERENCES transactions(id),
				notes                     TEXT,
				created_at                TEXT NOT NULL,
				updated_at                TEXT NOT NULL,
				deleted_at                TEXT
			)
		`);

		await db.execute(`
			CREATE TABLE change_log (
				id         INTEGER PRIMARY KEY AUTOINCREMENT,
				table_name TEXT NOT NULL,
				row_id     TEXT NOT NULL,
				operation  TEXT NOT NULL CHECK (operation IN ('insert', 'update', 'delete')),
				timestamp  TEXT NOT NULL,
				device_id  TEXT NOT NULL,
				payload    TEXT
			)
		`);

		// Indexes
		await db.execute(`CREATE INDEX idx_accounts_type ON accounts(type) WHERE deleted_at IS NULL`);
		await db.execute(`CREATE INDEX idx_accounts_archived ON accounts(archived) WHERE deleted_at IS NULL`);
		await db.execute(`CREATE INDEX idx_transactions_date ON transactions(date)`);
		await db.execute(`CREATE INDEX idx_transactions_account ON transactions(account_id)`);
		await db.execute(`CREATE INDEX idx_transactions_tag ON transactions(tag_id)`);
		await db.execute(`CREATE INDEX idx_transactions_payee ON transactions(payee)`);
		await db.execute(`CREATE INDEX idx_transactions_kind_date ON transactions(kind, date)`);
		await db.execute(`CREATE INDEX idx_transactions_pair ON transactions(transfer_pair_id)`);
		await db.execute(`CREATE INDEX idx_transactions_refund ON transactions(refund_of_id)`);
		await db.execute(`CREATE INDEX idx_transactions_deleted ON transactions(deleted_at) WHERE deleted_at IS NOT NULL`);
		await db.execute(`CREATE INDEX idx_goals_status ON goals(status) WHERE deleted_at IS NULL`);
		await db.execute(`CREATE INDEX idx_reconciliations_account ON reconciliations(account_id, date)`);
		await db.execute(`CREATE INDEX idx_change_log_timestamp ON change_log(timestamp)`);
	}
};
