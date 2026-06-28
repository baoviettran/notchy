import BetterSqlite3 from 'better-sqlite3';
import type { DatabaseService, QueryResult, Row } from '$lib/db/service';

let savepointCounter = 0;

export class TestDatabase implements DatabaseService {
	private db: BetterSqlite3.Database;

	constructor() {
		this.db = new BetterSqlite3(':memory:');
	}

	async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
		const stmt = this.db.prepare(sql);
		const result = stmt.run(...params);
		return { rowsAffected: result.changes, lastInsertId: Number(result.lastInsertRowid) };
	}

	async query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
		const stmt = this.db.prepare(sql);
		return stmt.all(...params) as T[];
	}

	async transaction<T>(fn: (tx: DatabaseService) => Promise<T>): Promise<T> {
		const name = `sp_test_${++savepointCounter}`;
		this.db.exec(`SAVEPOINT ${name}`);
		try {
			const result = await fn(this);
			this.db.exec(`RELEASE SAVEPOINT ${name}`);
			return result;
		} catch (e) {
			this.db.exec(`ROLLBACK TO SAVEPOINT ${name}`);
			// ROLLBACK TO leaves the savepoint on the stack; RELEASE removes it.
			// Mirrors the production TauriDatabase / InMemoryDatabase contract.
			this.db.exec(`RELEASE SAVEPOINT ${name}`);
			throw e;
		}
	}

	async close(): Promise<void> {
		this.db.close();
	}
}

export function createTestDb(): DatabaseService {
	return new TestDatabase();
}
