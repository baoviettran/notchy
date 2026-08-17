/**
 * Local interface matching the tauri-plugin-sql Database API. The npm package
 * was removed as part of the native database cutover (Task 14/15); this stub
 * keeps the TauriDatabase wrapper compiling without the external dependency.
 */
interface PluginDatabase {
	execute(sql: string, params?: unknown[]): Promise<{ rowsAffected: number; lastInsertId?: number }>;
	select<T>(sql: string, params?: unknown[]): Promise<T>;
	close(): Promise<void>;
}

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

// Each Tauri webview window is a separate JS context, but tauri-plugin-sql
// routes them to ONE pooled connection per DB path. A module-level counter
// resets to 0 in every context, so two windows would both emit sp_1, sp_2, …
// on the shared connection — colliding on SQLite's LIFO savepoint stack and
// corrupting transactions ("no such savepoint"). A per-call random name makes
// collisions effectively impossible regardless of how many contexts share it.
export function uniqueSavepointName(): string {
	const rand = crypto.randomUUID().replace(/-/g, '').slice(0, 12);
	return `sp_${rand}`;
}

export class TauriDatabase implements DatabaseService {
	constructor(private db: PluginDatabase) {}

	async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
		const r = await this.db.execute(sql, params);
		return { rowsAffected: r.rowsAffected, lastInsertId: r.lastInsertId };
	}

	async query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
		return this.db.select<T[]>(sql, params);
	}

	async transaction<T>(fn: (tx: DatabaseService) => Promise<T>): Promise<T> {
		const name = uniqueSavepointName();
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
	// After the native database cutover (Task 14/15), this path is dead code in
	// production.  It remains reachable in E2E (Playwright sql.js mock) and unit
	// tests that exercise backup-validation through the in-memory adapter.
	// The npm package was removed from package.json; the dynamic import bypasses
	// Rollup's static analysis via string concatenation so the build doesn't fail.
	const specifier = ['@tauri-apps', 'plugin-sql'].join('/');
	const mod: { default: { load: (p: string) => Promise<PluginDatabase> } } =
		await import(/* @vite-ignore */ specifier);
	const db = await mod.default.load(path);
	return new TauriDatabase(db);
}
