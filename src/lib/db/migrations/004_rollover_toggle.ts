import type { Migration } from './runner';

export const migration004: Migration = {
	version: 4,
	name: 'rollover_toggle',
	async up(db) {
		// SQLite ADD COLUMN with NOT NULL DEFAULT back-fills existing rows with 1.
		await db.execute(
			`ALTER TABLE category_types ADD COLUMN rollover_enabled INTEGER NOT NULL DEFAULT 1`
		);
	}
};
