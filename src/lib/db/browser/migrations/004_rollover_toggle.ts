import type { Migration } from './runner';

export const migration004: Migration = {
	version: 4,
	name: 'rollover_toggle',
	async up(db) {
		// SQLite ADD COLUMN with NOT NULL DEFAULT back-fills existing rows with 1.
		// Guard against a half-applied state (column exists but schema_version
		// wasn't bumped): SQLite has no ADD COLUMN IF NOT EXISTS, so check
		// PRAGMA table_info. Without this, a crashed/interrupted migration bricks
		// every subsequent boot with "duplicate column name".
		const cols = await db.query<{ name: string }>(
			`PRAGMA table_info(category_types)`
		);
		if (cols.some((c) => c.name === 'rollover_enabled')) {
			return;
		}
		await db.execute(
			`ALTER TABLE category_types ADD COLUMN rollover_enabled INTEGER NOT NULL DEFAULT 1`
		);
	}
};
