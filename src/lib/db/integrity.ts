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
	const orphans = await db.query<{ pair: string; n: number }>(`
		SELECT transfer_pair_id AS pair, COUNT(*) AS n
		FROM transactions
		WHERE kind = 'transfer' AND deleted_at IS NULL
		GROUP BY transfer_pair_id
		HAVING n != 2
	`);

	if (orphans.length > 0) {
		await db.execute(
			`INSERT OR REPLACE INTO app_meta (key, value) VALUES ('integrity_warnings', ?)`,
			[JSON.stringify(orphans)]
		);
	}
}
