import type { DatabaseService } from './service';

export async function applyPragmas(db: DatabaseService): Promise<void> {
	await db.execute('PRAGMA foreign_keys = ON');
	await db.execute('PRAGMA busy_timeout = 5000');
	await db.execute('PRAGMA journal_mode = WAL');
	await db.execute('PRAGMA synchronous = NORMAL');
}
