import type { DatabaseService } from './service';
import { createTauriDb } from './service';
import { applyPragmas } from './pragmas';
import { runIntegrityCheck } from './integrity';
import { runMigrations } from './migrations/runner';
import { migrations } from './migrations/index';

let _db: DatabaseService | null = null;

export async function getDb(): Promise<DatabaseService> {
	if (_db) return _db;
	_db = await createTauriDb('sqlite:notchy.db');
	await applyPragmas(_db);
	await runIntegrityCheck(_db);
	await runMigrations(_db, migrations);
	return _db;
}

export async function closeDb(): Promise<void> {
	if (_db) {
		await _db.close();
		_db = null;
	}
}
