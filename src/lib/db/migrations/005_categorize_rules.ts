import type { Migration } from './runner';

export const migration005: Migration = {
	version: 5,
	name: 'categorize_rules',
	async up(db) {
		await db.execute(`
			CREATE TABLE IF NOT EXISTS categorize_rules (
				id          TEXT PRIMARY KEY,
				payee_term  TEXT NOT NULL CHECK (length(payee_term) BETWEEN 1 AND 128),
				match_mode  TEXT NOT NULL CHECK (match_mode IN ('is', 'starts_with', 'contains')),
				tag_id      TEXT NOT NULL REFERENCES category_tags(id),
				source      TEXT NOT NULL DEFAULT 'manual'
				               CHECK (source IN ('manual', 'learned')),
				enabled     INTEGER NOT NULL DEFAULT 1,
				created_at  TEXT NOT NULL,
				updated_at  TEXT NOT NULL,
				deleted_at  TEXT
			)
		`);

		await db.execute(`
			CREATE INDEX IF NOT EXISTS idx_categorize_rules_enabled
			ON categorize_rules(enabled, deleted_at)
		`);
	}
};
