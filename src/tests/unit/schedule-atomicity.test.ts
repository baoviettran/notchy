import { it, expect } from 'vitest';
import { createTestDb } from './helpers/test-db';
import { runMigrations } from '$lib/db/migrations/runner';
import { migrations } from '$lib/db/migrations/index';
import { BrowserDatabaseClient } from '$lib/db/browser/client';
import { postDueSchedules } from '$lib/logic/post-due-schedules';
it('does not duplicate a posted occurrence after advancement fails and the schedule resumes', async () => {
	const raw = createTestDb();
	try {
		await runMigrations(raw, migrations);
		await raw.execute('PRAGMA foreign_keys = ON');
		await raw.execute("INSERT INTO accounts (id,name,type,currency,archived,created_at,updated_at) VALUES ('a','A','cash','VND',0,'x','x')");
		const db = new BrowserDatabaseClient(raw);
		const id = await db.schedules.create({ name: 'Rent', kind: 'expense', amount: 50000, account_id: 'a', frequency: 'monthly', start_date: '2026-01-01' });
		await raw.execute("CREATE TRIGGER fail_advance BEFORE UPDATE OF next_due_date ON schedules BEGIN SELECT RAISE(ABORT, 'injected advancement failure'); END");
		const first = await postDueSchedules(db, '2026-01-01');
		expect(first.errors).toHaveLength(1);
		expect(await raw.query('SELECT id FROM transactions')).toHaveLength(0);
		await raw.execute('DROP TRIGGER fail_advance');
		await raw.execute('UPDATE schedules SET errored_at=NULL, enabled=1 WHERE id=?', [id]);
		await postDueSchedules(db, '2026-01-01');
		const rows = await raw.query('SELECT date,amount FROM transactions');
		console.log('Persisted occurrences after resume:', rows);
		expect(rows).toHaveLength(1);
	} finally { await raw.close(); }
});
