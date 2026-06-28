/**
 * In-memory DatabaseService backed by sql.js (SQLite compiled to WASM).
 *
 * TEST-ONLY / WEB-PREVIEW FALLBACK. This is never used by the shipped Tauri
 * app: `getDb()` in `./index.ts` only constructs this when
 * `window.__TAURI_INTERNALS__` is absent (i.e. a plain browser such as
 * Playwright's chromium or `pnpm dev`/`pnpm preview`). The data is volatile —
 * lost on reload — which is fine for end-to-end tests. It is the seed of the
 * v0.2 web-DB work; do NOT wire it into the production Tauri path.
 *
 * Why sql.js: it executes the exact same SQLite dialect the Tauri plugin does,
 * so every migration (CHECK constraints, partial indexes, triggers, json_object,
 * GLOB, AUTOINCREMENT, SAVEPOINTs) runs unmodified.
 */
import initSqlJs, { type Database as SqlJsDatabase, type SqlJsStatic } from 'sql.js';
import wasmUrl from 'sql.js/dist/sql-wasm.wasm?url';
import type { DatabaseService, QueryResult, Row } from './service';

let sqlPromise: Promise<SqlJsStatic> | null = null;

function getSqlJs(): Promise<SqlJsStatic> {
	if (!sqlPromise) {
		// `locateFile` resolves the wasm asset through Vite (`?url`) so the bundler
		// serves/copies it in both dev and the static build — no CDN dependency.
		sqlPromise = initSqlJs({ locateFile: () => wasmUrl });
	}
	return sqlPromise;
}

export class InMemoryDatabase implements DatabaseService {
	constructor(private db: SqlJsDatabase) {}

	/**
	 * sql.js binds positional `?` placeholders against an array, the same shape
	 * the Tauri plugin and every repo already use.
	 */
	private bind(params: unknown[]): (string | number | Uint8Array | null)[] {
		return params.map((p) => {
			if (p === undefined) return null;
			if (p instanceof Date) return p.toISOString();
			if (typeof p === 'boolean') return p ? 1 : 0;
			return p as string | number | Uint8Array | null;
		});
	}

	async execute(sql: string, params: unknown[] = []): Promise<QueryResult> {
		this.db.run(sql, this.bind(params));
		const r = this.db.getRowsModified();
		// lastInsertId isn't surfaced by sql.js for TEXT-PK tables; repos generate
		// their own ULIDs, and the only AUTOINCREMENT table (change_log) isn't
		// read back by id, so undefined is safe here.
		return { rowsAffected: r, lastInsertId: undefined };
	}

	async query<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
		const stmt = this.db.prepare(sql);
		try {
			stmt.bind(this.bind(params));
			const rows: T[] = [];
			while (stmt.step()) {
				// stmt.getAsObject() returns { [column]: value } for the current row.
				rows.push(stmt.getAsObject() as T);
			}
			return rows;
		} finally {
			stmt.free();
		}
	}

	async transaction<T>(fn: (tx: DatabaseService) => Promise<T>): Promise<T> {
		// Same SAVEPOINT pattern as TauriDatabase (./service.ts). sql.js honors
		// SAVEPOINT / RELEASE / ROLLBACK TO against the in-memory database.
		const name = `sp_${++savepointCounter}`;
		await this.execute(`SAVEPOINT ${name}`);
		try {
			const result = await fn(this);
			await this.execute(`RELEASE SAVEPOINT ${name}`);
			return result;
		} catch (e) {
			await this.execute(`ROLLBACK TO SAVEPOINT ${name}`);
			// ROLLBACK TO rewinds but leaves the savepoint on the stack; RELEASE
			// removes it. See service.ts for the full rationale.
			await this.execute(`RELEASE SAVEPOINT ${name}`);
			throw e;
		}
	}

	async close(): Promise<void> {
		this.db.close();
	}
}

let savepointCounter = 0;

export async function createInMemoryDb(): Promise<DatabaseService> {
	const SQL = await getSqlJs();
	return new InMemoryDatabase(new SQL.Database());
}
