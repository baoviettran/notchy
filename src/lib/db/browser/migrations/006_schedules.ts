import type { Migration } from './runner';

/**
 * Scheduled transactions. Idempotent via `CREATE TABLE IF NOT EXISTS`, so a
 * half-applied migration (table created, version not bumped) cannot brick the
 * next boot — the same race `004` guards against with its PRAGMA check.
 *
 * `errored_at` is not in the original spec DDL: without it a schedule that
 * cannot post would retry on every boot. See the plan's note on the deviation.
 */
export const migration006: Migration = {
	version: 6,
	name: 'schedules',
	async up(db) {
		await db.execute(`
			CREATE TABLE IF NOT EXISTS schedules (
				id                  TEXT PRIMARY KEY,
				name                TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 64),
				kind                TEXT NOT NULL CHECK (kind IN ('expense', 'income', 'transfer')),
				amount              INTEGER NOT NULL CHECK (amount > 0 AND amount <= 999999999999),
				account_id          TEXT NOT NULL REFERENCES accounts(id),
				transfer_account_id TEXT REFERENCES accounts(id),
				tag_id              TEXT REFERENCES category_tags(id),
				payee               TEXT CHECK (payee IS NULL OR length(payee) <= 128),
				description         TEXT CHECK (description IS NULL OR length(description) <= 1024),
				frequency           TEXT NOT NULL CHECK (frequency IN ('weekly', 'biweekly', 'monthly', 'yearly')),
				start_date          TEXT NOT NULL CHECK (start_date BETWEEN '1970-01-01' AND '2100-12-31'),
				end_date            TEXT CHECK (end_date IS NULL OR end_date >= start_date),
				posts_transaction   INTEGER NOT NULL DEFAULT 1 CHECK (posts_transaction IN (0, 1)),
				next_due_date       TEXT,
				last_posted_date    TEXT,
				completed           INTEGER NOT NULL DEFAULT 0 CHECK (completed IN (0, 1)),
				enabled             INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
				errored_at          TEXT,
				created_at          TEXT NOT NULL,
				updated_at          TEXT NOT NULL,
				deleted_at          TEXT,
				CHECK (kind <> 'transfer' OR (transfer_account_id IS NOT NULL AND tag_id IS NULL)),
				CHECK (kind = 'transfer' OR transfer_account_id IS NULL)
			)
		`);
		await db.execute(`
			CREATE INDEX IF NOT EXISTS idx_schedules_due
			ON schedules(enabled, completed, errored_at, next_due_date, deleted_at)
		`);
	}
};
