import type { DatabaseService } from './service';

export class IntegrityError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'IntegrityError';
	}
}

export async function runIntegrityCheck(db: DatabaseService): Promise<void> {
	const rows = await db.query<{ integrity_check: string }>('PRAGMA integrity_check');
	if (rows[0]?.integrity_check !== 'ok') {
		throw new IntegrityError(
			'The database file appears corrupt. Please restore from backup.'
		);
	}
}

export async function checkOrphanedTransfers(db: DatabaseService): Promise<void> {
	// Single-row transfer model: each transfer row has a unique transfer_pair_id used for sync/export correlation.
	// An orphan is a pair_id shared by more than one row (duplicate), indicating data corruption.
	const orphans = await db.query<{ pair: string; n: number }>(`
		SELECT transfer_pair_id AS pair, COUNT(*) AS n
		FROM transactions
		WHERE kind = 'transfer' AND deleted_at IS NULL
		GROUP BY transfer_pair_id
		HAVING n != 1
	`);

	if (orphans.length > 0) {
		await db.execute(
			`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('integrity_warnings', ?)`,
			[JSON.stringify(orphans)]
		);
	} else {
		// Clear stale warnings
		await db.execute(`DELETE FROM app_meta WHERE key = 'integrity_warnings'`);
	}
}
