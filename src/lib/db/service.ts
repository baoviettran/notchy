import Database from '@tauri-apps/plugin-sql';

export interface QueryResult {
	rowsAffected: number;
	lastInsertId?: number;
}

export type Row = Record<string, string | number | null>;

export interface DatabaseService {
	execute(sql: string, params?: unknown[]): Promise<QueryResult>;
	query<T = Row>(sql: string, params?: unknown[]): Promise<T[]>;
	transaction<T>(fn: (tx: DatabaseService) => Promise<T>): Promise<T>;
	close(): Promise<void>;
}

let savepointCounter = 0;

export class TauriDatabase implements DatabaseService {
	constructor(private db: Database) {}

	async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
		const r = await this.db.execute(sql, params);
		return { rowsAffected: r.rowsAffected, lastInsertId: r.lastInsertId };
	}

	async query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
		return this.db.select<T[]>(sql, params);
	}

	async transaction<T>(fn: (tx: DatabaseService) => Promise<T>): Promise<T> {
		const name = `sp_${++savepointCounter}`;
		await this.execute(`SAVEPOINT ${name}`);
		try {
			const result = await fn(this);
			await this.execute(`RELEASE SAVEPOINT ${name}`);
			return result;
		} catch (e) {
			await this.execute(`ROLLBACK TO SAVEPOINT ${name}`);
			// ROLLBACK TO rewinds but leaves the savepoint on SQLite's stack.
			// RELEASE removes it, preventing a stack leak across errored
			// top-level transactions (which no outer RELEASE would otherwise mop up).
			await this.execute(`RELEASE SAVEPOINT ${name}`);
			throw e;
		}
	}

	async close(): Promise<void> {
		await this.db.close();
	}
}

export async function createTauriDb(path: string): Promise<DatabaseService> {
	const db = await Database.load(path);
	return new TauriDatabase(db);
}
