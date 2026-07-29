import BetterSqlite3 from 'better-sqlite3';
import type { DatabaseService, QueryResult, Row } from '$lib/db/service';

// Mirror TauriDatabase's savepoint naming: unique per call so two contexts
// sharing a pooled connection can't collide on SQLite's LIFO savepoint stack.
function uniqueSavepointName(): string {
	const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
	return `sp_${rand}`;
}

export class TestDatabase implements DatabaseService {
	private db: BetterSqlite3.Database;

	constructor(path = ':memory:') {
		this.db = new BetterSqlite3(path);
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
		const name = uniqueSavepointName();
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

export function createTestDbFromPath(path: string): DatabaseService {
	return new TestDatabase(path);
}
