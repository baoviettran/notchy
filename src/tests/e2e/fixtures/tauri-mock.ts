import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve as resolvePath } from 'node:path';
import type { Page } from '@playwright/test';
import { test as base } from '@playwright/test';

export interface TauriMockOptions {
	/** Rows written into the live DB's app_meta immediately after load (before runAutoBackup reads them). */
	seedMeta?: Record<string, string>;
	/** If true, the live DB flushes to IndexedDB and rehydrates on load (reload-survival). */
	persist?: boolean;
	/** Seed the live DB before startup: 4 = the committed v004 fixture; any other value = a minimal app_meta claiming that schema_version. */
	initialSchemaVersion?: number;
	/** When set, the mock's VACUUM INTO interception throws → startup surfaces upgrade_backup_failed. */
	failUpgradeBackup?: boolean;
	/** When set, the migration runner's schema-version bump to this version throws → startup surfaces migration_failed. */
	failMigrationVersion?: number;
}

/**
 * Resolve the sql.js glue + wasm from disk at Playwright-test time (Node,
 * where the filesystem works), so the in-page init script only has to decode
 * base64 blobs. This avoids the Vite `?url` asset import (which Playwright's
 * raw test runner cannot resolve) and works against both `pnpm dev` and the
 * `pnpm preview` build target.
 *
 * The glue (`sql-wasm-browser.js`) isn't served by the SvelteKit build, so we
 * inject it as a blob script; the wasm bytes go in alongside it.
 */
const __filename = fileURLToPath(import.meta.url);
function readSqlJsAsset(name: string): string {
	// Try relative to this fixture first, then fall back to the workspace root.
	const candidates = [
		resolvePath(dirname(__filename), '../../../../../node_modules/sql.js/dist/' + name),
		resolvePath(process.cwd(), 'node_modules/sql.js/dist/' + name)
	];
	for (const p of candidates) {
		try {
			return readFileSync(p, name.endsWith('.js') ? 'utf8' : 'base64');
		} catch {}
	}
	throw new Error('tauri-mock: could not read sql.js asset ' + name + ' from node_modules');
}
const GLUE_SRC = readSqlJsAsset('sql-wasm-browser.js');
const WASM_B64 = readSqlJsAsset('sql-wasm.wasm');

// The committed released schema-4 fixture, base64 for in-page embedding. Only
// read on demand (initialSchemaVersion === 4) so the common case never touches
// disk for it.
let FIXTURE_V004_B64: string | null = null;
function readV004Fixture(): string {
	if (FIXTURE_V004_B64) return FIXTURE_V004_B64;
	const candidates = [
		resolvePath(dirname(__filename), '../../../../src/tests/fixtures/migrations/v004.sqlite'),
		resolvePath(process.cwd(), 'src/tests/fixtures/migrations/v004.sqlite')
	];
	for (const p of candidates) {
		try {
			FIXTURE_V004_B64 = readFileSync(p, 'base64');
			return FIXTURE_V004_B64;
		} catch {}
	}
	throw new Error('tauri-mock: could not read v004.sqlite fixture from src/tests/fixtures/migrations');
}

/**
 * Inject a __TAURI_INTERNALS__ mock into the page BEFORE the app loads.
 * Routes plugin:sql|* to real sql.js instances and plugin:fs|* / plugin:path|*
 * to an in-memory virtual filesystem. The real plugin code runs unchanged;
 * only the IPC transport is faked.
 *
 * Ordering guarantee: __TAURI_INTERNALS__.invoke is installed SYNCHRONOUSLY
 * (before any app script runs — addInitScript runs first). The function body
 * awaits an internal sqlReady promise, so the app's startup invoke() calls
 * queue safely and never hit undefined. sql.js itself loads by indirect-eval'ing
 * the browser glue (read from disk, base64-encoded into the init script) and
 * pointing locateFile at a blob URL of the wasm bytes — no CDN, no Vite module
 * graph, no served asset dependency in the page.
 */
export async function injectTauriMock(page: Page, opts: TauriMockOptions = {}): Promise<void> {
	// Stash options on a global the in-page script reads.
	await page.addInitScript((o) => {
		(window as unknown as { __NOTCHY_TAURI_MOCK_OPTIONS__?: TauriMockOptions }).__NOTCHY_TAURI_MOCK_OPTIONS__ = o;
	}, opts);

	const glueB64 = Buffer.from(GLUE_SRC, 'utf8').toString('base64');
	// The v004 fixture bytes stay OUT of the options JSON: the init script is
	// in-page and cannot read disk, so the bytes are base64-embedded into the
	// template (read from disk here in Node, like the sql.js glue). Only embedded
	// when a released schema-4 live DB is requested.
	const fixtureV004B64 = opts.initialSchemaVersion === 4 ? readV004Fixture() : null;

	await page.addInitScript(`
const opts = window.__NOTCHY_TAURI_MOCK_OPTIONS__ || {};
const APP_DATA_DIR = '/notchy/appdata';
const LIVE_PATH = 'sqlite:notchy.db';
const LIVE_DB_PATH = '/notchy/appdata/notchy.db';
// Native boot loads LIVE_DB_PATH; the legacy plugin:sql connection string
// resolves to the same file via fsKeyFor. "Live" means either key.
function isLivePath(p) {
	return p === LIVE_PATH || p === LIVE_DB_PATH;
}
const GLUE_B64 = ${JSON.stringify(glueB64)};
const WASM_B64 = ${JSON.stringify(WASM_B64)};
const FIXTURE_V004_B64 = ${fixtureV004B64 === null ? 'null' : JSON.stringify(fixtureV004B64)};
if (opts.initialSchemaVersion === 4 && !FIXTURE_V004_B64) {
	throw new Error('tauri-mock: v004 fixture bytes not embedded');
}

// --- sql.js bootstrap -----------------------------------------------------
// addInitScript runs before the page is parsed — document.documentElement is
// null, so we can't append a script element. Instead, eval the glue source
// directly in the global scope (indirect eval). The glue declares var initSqlJs,
// which indirect-eval promotes to a real window.initSqlJs global. Its UMD
// footer falls through harmlessly in a plain browser (no module/exports/define).
const glueText = atob(GLUE_B64);
(0, eval)(glueText);

const sqlReady = (async () => {
	// The eval runs synchronously, so initSqlJs is defined immediately — but
	// guard with a short poll in case a future glue variant defers it.
	let init = window.initSqlJs;
	const deadline = Date.now() + 15000;
	while (!(init = window.initSqlJs)) {
		if (Date.now() > deadline) throw new Error('tauri-mock: initSqlJs never loaded');
		await new Promise((r) => setTimeout(r, 10));
	}
	// Decode the wasm bytes from base64 (read from disk at test time) and make
	// a blob URL — mirroring how the app's locateFile resolves through Vite,
	// but without depending on the preview server to serve the hashed asset.
	const wasmBytes = Uint8Array.from(atob(WASM_B64), (c) => c.charCodeAt(0));
	const wasmBlob = URL.createObjectURL(new Blob([wasmBytes], { type: 'application/wasm' }));
	return await init({ locateFile: () => wasmBlob });
})();

// --- virtual filesystem + DB registry -------------------------------------
const fs = new Map(); // path -> Uint8Array
const dbs = new Map(); // path -> sql.js Database
const idbKey = (path) => 'notchy-mock-db:' + path;

// Single shared IndexedDB connection. Opening the same DB repeatedly (once per
// idbGet/idbSet) races the initial version-change upgrade and deadlocks under
// rapid concurrent calls (migrations fire many executes). One connection,
// opened once, awaited by every operation.
let idbReady = null;
function getIdb() {
	if (idbReady) return idbReady;
	idbReady = new Promise((resolve, reject) => {
		const req = indexedDB.open('notchy-mock', 1);
		req.onupgradeneeded = () => {
			if (!req.result.objectStoreNames.contains('kv')) req.result.createObjectStore('kv');
		};
		req.onsuccess = () => resolve(req.result);
		req.onerror = () => reject(req.error);
		req.onblocked = () => reject(new Error('tauri-mock: idb open blocked'));
	});
	return idbReady;
}
async function idbGet(key) {
	const db = await getIdb();
	return new Promise((resolve) => {
		const tx = db.transaction('kv', 'readonly').objectStore('kv').get(key);
		tx.onsuccess = () => resolve(tx.result || null);
		tx.onerror = () => resolve(null);
	});
}
async function idbSet(key, val) {
	const db = await getIdb();
	return new Promise((resolve) => {
		const tx = db.transaction('kv', 'readwrite').objectStore('kv').put(val, key);
		tx.onsuccess = () => resolve();
		tx.onerror = () => resolve();
	});
}

// Injected failure controls (recovery journeys). Armed from the mock options; a
// persisted 'faults-cleared' marker (written by __notchyMock.clearFaults())
// disarms them so a restore can migrate forward after a reload re-runs this
// init script with the original options.
const faults = {
	failUpgradeBackup: !!opts.failUpgradeBackup,
	failMigrationVersion: opts.failMigrationVersion != null ? opts.failMigrationVersion : null
};
let lastOpenedPath = null;
const faultInit = (async () => {
	const cleared = await idbGet('notchy-mock:faults-cleared');
	if (cleared) {
		faults.failUpgradeBackup = false;
		faults.failMigrationVersion = null;
	}
})();

// Flush the live DB to IndexedDB on demand (persist mode). Called by the test
// via __notchyMock.flushLiveDb / flushDb() before a reload. Must NOT run inside
// an open SAVEPOINT — db.export() while a transaction is active corrupts sql.js's
// savepoint stack — so it is never invoked from the execute handler.
let flushInFlight = null;
function flushLiveDb() {
	if (flushInFlight) return flushInFlight;
	flushInFlight = (async () => {
		const db = dbs.get(LIVE_DB_PATH) || dbs.get(LIVE_PATH);
		if (db) {
			const bytes = db.export();
			try { await idbSet(idbKey(LIVE_DB_PATH), bytes); } catch {}
			try { await idbSet(idbKey(LIVE_PATH), bytes); } catch {}
		}
		flushInFlight = null;
	})();
	return flushInFlight;
}

// Normalize a connection string before keying the DB registry / FS. The Tauri
// SQL plugin passes '?readonly' (and other query params) through verbatim, so
// 'sqlite:foo?readonly' and 'sqlite:foo' would otherwise be distinct registry
// entries pointing at the same file. restoreCompatibleDatabase relies on this:
// it opens the candidate as 'sqlite:<path>?readonly', validates, then the live
// DB uses 'sqlite:notchy.db' (no suffix). Stripping the query string makes both refer
// to the same sql.js instance / FS bytes.
function normalizePath(p) {
	return String(p).split('?')[0];
}

// A 'sqlite:' connection string maps to a virtual-FS path without the prefix.
// The live DB ('sqlite:notchy.db') resolves to '<appDataDir>/notchy.db' on disk;
// createBackup/restoreCompatibleDatabase write backup files to bare FS paths.
// This returns the FS key a given connection string would read from, or null
// if it's not a file-backed path.
function fsKeyFor(connStr) {
	const p = normalizePath(connStr);
	if (p.startsWith('sqlite:')) {
		const rest = p.slice('sqlite:'.length);
		// The live DB connection string is bare ('sqlite:notchy.db'); resolve it
		// to its on-disk app-data path so restore-copied bytes are found.
		if (rest === 'notchy.db') return APP_DATA_DIR + '/notchy.db';
		return rest;
	}
	return p;
}

async function loadDb(path, SQL_JS) {
	path = normalizePath(path);
	if (dbs.has(path)) return dbs.get(path);
	// Rehydrate from IndexedDB if persist is on; else from the virtual FS
	// (restore path copied bytes there); else fresh.
	let bytes = null;
	if (opts.persist) bytes = await idbGet(idbKey(path));
	if (!bytes) {
		// Try the connection string directly, then its file-backed FS key
		// (strips 'sqlite:' prefix and resolves 'notchy.db' to the app-data dir).
		if (fs.has(path)) bytes = fs.get(path);
		else {
			const k = fsKeyFor(path);
			if (k && fs.has(k)) bytes = fs.get(k);
		}
	}
	// Seed the live DB as a released schema snapshot (recovery journeys). Only
	// applies on first load (no rehydrated bytes, not already open). Version 4
	// embeds the committed v004 fixture so the pre-upgrade backup is a genuine
	// released schema-4 database and migration 005 runs cleanly after restore.
	if (isLivePath(path) && !bytes && opts.initialSchemaVersion === 4 && FIXTURE_V004_B64) {
		bytes = Uint8Array.from(atob(FIXTURE_V004_B64), (c) => c.charCodeAt(0));
	}
	const db = bytes ? new SQL_JS.Database(bytes) : new SQL_JS.Database();
	dbs.set(path, db);

	// Newer-schema claim: a minimal app_meta claiming opts.initialSchemaVersion
	// is enough for inspectSchema to return 'newer' (tables non-empty).
	if (isLivePath(path) && !bytes && opts.initialSchemaVersion != null && opts.initialSchemaVersion !== 4) {
		db.run('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
		db.run("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?)", [
			String(opts.initialSchemaVersion)
		]);
	}

	// Pre-init seed hook: write seedMeta into the live DB before runAutoBackup.
	if (isLivePath(path) && opts.seedMeta) {
		for (const [k, v] of Object.entries(opts.seedMeta)) {
			try {
				db.run("INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)", [k, v]);
			} catch {}
		}
	}
	return db;
}

function select(db, query, values) {
	const stmt = db.prepare(query);
	try {
		stmt.bind(values || []);
		const rows = [];
		while (stmt.step()) rows.push(stmt.getAsObject());
		return rows;
	} finally {
		stmt.free();
	}
}

// Path helpers
const join = (...parts) => parts.join('/').replace(/\\\\/g, '/').replace(/\\/+/g, '/').replace(/\\/+/g, '/').replace(/\\/+/g, '/');

// --- install invoke SYNCHRONOUSLY -----------------------------------------
// The app calls getDb() -> Database.load() -> invoke() on startup. By
// installing invoke here (before any app script), every startup call resolves
// correctly; it just awaits sqlReady internally.
window.__TAURI_INTERNALS__ = {
	invoke: async (cmd, args) => {
		const SQL_JS = await sqlReady;
		await faultInit;
		args = args || {};
		// --- SQL plugin ---
		// Normalize the connection string (strip '?readonly' etc.) so the live
		// DB and a readonly candidate-open of the same file share one registry
		// entry. The plugin stores invoke's return as this.path; we echo the
		// normalized path so subsequent execute/select/close calls key correctly.
		const dbKey = normalizePath(args.db);
		if (cmd === 'plugin:sql|load') {
			await loadDb(dbKey, SQL_JS);
			return dbKey;
		}
		if (cmd === 'plugin:sql|select') {
			const db = await loadDb(dbKey, SQL_JS);
			return select(db, args.query, args.values);
		}
		if (cmd === 'plugin:sql|execute') {
			const db = await loadDb(dbKey, SQL_JS);
			// VACUUM INTO must be intercepted before sql.js sees it — sql.js's
			// in-memory VFS can't open an arbitrary path. createBackup issues this
			// as a top-level execute (no SAVEPOINT), so exporting here is safe.
			// NOTE: this init script is injected via addInitScript as a template
			// literal and eval'd in-page, so regex escapes must be doubled (\\s,
			// not \s) or they cook to a bare letter and the match silently fails.
			// Capture the full escaped single-quoted literal (handle '' as an
			// escaped quote per SQLite string-literal rules), then un-escape to
			// the real path before writing bytes into the virtual FS. Matches
			// real SQLite, which parses '' as a literal quote inside the string.
			const vac = args.query.match(/^\\s*VACUUM\\s+INTO\\s+'((?:[^']|'')*)'/i);
			if (vac) {
				if (faults.failUpgradeBackup) throw new Error('tauri-mock: injected upgrade-backup failure');
				fs.set(vac[1].replace(/''/g, "'"), db.export());
				return [0, 0];
			}
			// Injected migration failure: throw on the migration runner's
			// schema-version bump to the configured version. The runner wraps each
			// migration + bump in one SAVEPOINT, so the throw rolls the migration
			// back and surfaces as migration_failed.
			if (
				faults.failMigrationVersion != null &&
				Array.isArray(args.values) &&
				String(args.values[0]) === String(faults.failMigrationVersion)
			) {
				if (/^\\s*INSERT\\s+OR\\s+REPLACE\\s+INTO\\s+app_meta\\s*\\(\\s*key\\s*,\\s*value\\s*\\)\\s*VALUES\\s*\\(\\s*'schema_version'\\s*,\\s*\\?\\s*\\)/i.test(args.query)) {
					throw new Error('tauri-mock: injected migration failure');
				}
			}
			db.run(args.query, args.values || []);
			const rowsAffected = db.getRowsModified();
			// Persist mode does NOT auto-flush here: db.export() is O(DB size)
			// and running it mid-transaction (SAVEPOINT open) breaks sql.js's
			// savepoint stack. The test calls flushDb() at the points it needs
			// reload-survival; the next load rehydrates from IDB.
			return [rowsAffected, 0];
		}
		if (cmd === 'plugin:sql|close') {
			// Model the real Tauri SQL plugin: when close is invoked with no
			// db arg (TauriDatabase.close() passes nothing — the live pool is
			// referenced by handle, not by the connection string), the real
			// plugin closes ALL registered pools. So: a string db closes just
			// that one; undefined/null/absent closes every entry in the registry.
			// Guard double-close: sql.js throws if close() is called on an
			// already-closed Database instance.
			//
			// Before dropping a registry entry, persist its bytes back to the
			// virtual FS under the connection's file-backed key. The real
			// plugin's pool reopens the on-disk file on the next load, so a
			// close-then-reopen must see the same data — without this, closing
			// the live pool mid-restore (validation failure path) would
			// leave the next getDb() to rehydrate from an empty FS and silently
			// wipe the live DB. Skipping the persist for read-only candidate
			// connections (no file-backed key / not the live path) mirrors that
			// those files are never written through by the plugin.
			const closeOne = (k) => {
				const db = dbs.get(k);
				if (!db) return;
				const fsk = fsKeyFor(k);
				if (fsk) {
					try { fs.set(fsk, db.export()); } catch {}
				}
				try { db.close(); } catch {}
				dbs.delete(k);
			};
			if (typeof args.db === 'string') closeOne(dbKey);
			else for (const k of [...dbs.keys()]) closeOne(k);
			return {};
		}
		// --- App plugin ---
		// Main-window startup reads the installed app version for startup
		// metadata (prepareDatabase). Fixed value: E2E exercises behavior, not
		// the exact version string.
		if (cmd === 'plugin:app|version') return '0.1.3';
		// --- Path plugin ---
		if (cmd === 'plugin:path|resolve_directory') return APP_DATA_DIR;
		if (cmd === 'plugin:path|join') return join(...(args.paths || []));
		// --- FS plugin ---
		if (cmd === 'plugin:fs|copy_file') {
			const data = fs.get(args.fromPath);
			fs.set(args.toPath, data);
			// Restoring the live DB: copyFile(<backup>, <appData>/notchy.db) is
			// the restoreCompatibleDatabase success path. A real copy_file writes to disk
			// (persistent), so the reloaded page reopens the replaced file. The
			// virtual FS is per-page-load and does NOT survive reload, so mirror
			// the disk write into IndexedDB under the live connection key — the
			// only store that crosses page.reload(). This mirrors real FS
			// persistence (copy_file to disk is durable regardless of the
			// in-memory DB's persist flag, which only governs auto-flushing).
			if (data && args.toPath === LIVE_DB_PATH) {
				await idbSet(idbKey(LIVE_DB_PATH), data);
			}
			return {};
		}
		if (cmd === 'plugin:fs|mkdir') { return {}; }
		if (cmd === 'plugin:fs|read_dir') {
			const out = [];
			for (const p of fs.keys()) {
				if (p.startsWith(args.path + '/')) {
					out.push({ name: p.slice(args.path.length + 1), isDirectory: false });
				}
			}
			return out;
		}
		if (cmd === 'plugin:fs|remove') { fs.delete(args.path); return {}; }
		if (cmd === 'plugin:fs|stat') {
			const f = fs.get(args.path);
			return f ? { size: f.length, isFile: true, isDirectory: false } : { size: 0 };
		}
		if (cmd === 'plugin:fs|write_text_file') {
			fs.set(args.path, new TextEncoder().encode(args.contents));
			return {};
		}
		// --- Opener plugin ---
		// Mirrors the real opener permission (opener:allow-open-path) without a
		// production hook: record the opened path so the test can assert it.
		if (cmd === 'plugin:opener|open_path') {
			lastOpenedPath = args.path;
			return {};
		}
		// --- Native database commands (Task 14 cutover) ---
		// After the cutover, the app uses NativeDatabaseClient which calls
		// domain commands instead of plugin:sql|*. Translate them to SQL queries.
		if (cmd === 'database_initialize' || cmd === 'database_retry' || cmd === 'database_status') {
			// LATEST aligns to the JS registry (LATEST_SCHEMA_VERSION = 5 in
			// src/lib/db/migrations/index.ts): restoreCompatibleDatabase validates
			// max 5, and the E2E fixtures/assertions are schema-5-based. Rust runs
			// its own migration 006; the mock simulates the JS-visible contract.
			const LATEST = 5;
			const UPGRADE_DIR = APP_DATA_DIR + '/backups/upgrades';
			const BACKUP_DIR = APP_DATA_DIR + '/backups';
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const schemaRow = select(db, "SELECT value FROM app_meta WHERE key = 'schema_version'", []);
			const currentVersion = schemaRow.length > 0 ? parseInt(schemaRow[0].value) : 0;
			const stamp = new Date().toISOString().replace(/[:.]/g, '-');
			const upgradePath =
				UPGRADE_DIR +
				'/notchy-pre-upgrade-v' + currentVersion + '-to-v' + LATEST + '-0.2.0-' + stamp + '.sqlite';
			const toSummary = (p) => ({
				id: p,
				path: p,
				schema_version: currentVersion,
				source_app_version: '0.2.0',
				created_at: new Date().toISOString(),
				verified: true
			});
			// Verified backups available for restore, newest first.
			const upgrades = [...fs.keys()].filter((p) => p.startsWith(UPGRADE_DIR)).reverse().map(toSummary);

			if (currentVersion > LATEST) {
				return {
					lifecycle: 'recovery_required',
					stage: null,
					recovery: { code: 'database_schema_newer', retryable: false },
					backups: upgrades
				};
			}

			if (currentVersion < 5) {
				// Mirrors Rust: a verified pre-upgrade backup is written BEFORE any
				// migration, so a failed migration still leaves a restorable snapshot.
				if (!faults.failUpgradeBackup) {
					fs.set(upgradePath, db.export());
				}
				if (faults.failUpgradeBackup) {
					return {
						lifecycle: 'recovery_required',
						stage: null,
						recovery: { code: 'upgrade_backup_failed', retryable: false },
						backups: []
					};
				}
				if (faults.failMigrationVersion === 5) {
					return {
						lifecycle: 'recovery_required',
						stage: null,
						recovery: { code: 'migration_failed', retryable: true },
						backups: [toSummary(upgradePath)]
					};
				}
				// Migration 005 (mirrors src/lib/db/migrations/005-*.ts: goals table).
				db.run('CREATE TABLE IF NOT EXISTS goals (id TEXT PRIMARY KEY, name TEXT NOT NULL, goal_type TEXT NOT NULL, target_amount INTEGER NOT NULL, target_date TEXT NOT NULL, linked_account_id TEXT, starting_amount INTEGER DEFAULT 0, current_amount INTEGER DEFAULT 0, show_on_dashboard INTEGER DEFAULT 1, status TEXT DEFAULT active, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT)');
				db.run("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', '5')");
			}

			// Auto-backup simulation. runAutoBackup (src/lib/backup/index.ts) is no
			// longer called from dbStore.init() in native mode — Rust owns backups.
			// Mirror its contract: if last_backup_at is older than 1 hour, write a
			// notchy-backup-*.sqlite snapshot and refresh the marker.
			const lastBak = select(db, "SELECT value FROM app_meta WHERE key = 'last_backup_at'", []);
			if (lastBak.length > 0 && Date.now() - new Date(lastBak[0].value).getTime() > 3600_000) {
				fs.set(BACKUP_DIR + '/notchy-backup-' + stamp + '.sqlite', db.export());
				db.run("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('last_backup_at', ?)", [new Date().toISOString()]);
			}

			return { lifecycle: 'ready', stage: null, recovery: null, backups: upgrades };
		}
		if (cmd === 'account_list') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const today = new Date().toISOString().slice(0, 10);
			const rows = select(db, "SELECT a.id, a.name, a.type, a.counterparty, a.currency, a.archived, a.created_at, a.updated_at, COALESCE((SELECT SUM(CASE WHEN kind='income' THEN amount WHEN kind='adjustment' THEN amount WHEN kind='refund' THEN amount WHEN kind='expense' THEN -amount WHEN kind='transfer' AND account_id=a.id THEN -amount WHEN kind='transfer' AND transfer_account_id=a.id THEN amount ELSE 0 END) FROM transactions WHERE (account_id=a.id OR (kind='transfer' AND transfer_account_id=a.id)) AND deleted_at IS NULL AND date<=?), 0) AS balance FROM accounts a WHERE a.deleted_at IS NULL ORDER BY a.archived, a.created_at", [today]);
			return rows.map(r => ({ ...r, balance: r.balance || 0, counterparty: r.counterparty || null }));
		}
		if (cmd === 'account_get') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const rows = select(db, 'SELECT id, name, type, counterparty, currency, archived, created_at, updated_at FROM accounts WHERE id = ? AND deleted_at IS NULL', [args.id]);
			if (rows.length === 0) return null;
			const r = rows[0];
			const today = new Date().toISOString().slice(0, 10);
			const bal = select(db, 'SELECT COALESCE(SUM(CASE WHEN kind=\\'income\\' THEN amount WHEN kind=\\'adjustment\\' THEN amount WHEN kind=\\'refund\\' THEN amount WHEN kind=\\'expense\\' THEN -amount WHEN kind=\\'transfer\\' AND account_id=? THEN -amount WHEN kind=\\'transfer\\' AND transfer_account_id=? THEN amount ELSE 0 END), 0) AS balance FROM transactions WHERE (account_id=? OR (kind=\\'transfer\\' AND transfer_account_id=?)) AND deleted_at IS NULL AND date<=?', [args.id, args.id, args.id, args.id, today]);
			return { ...r, balance: bal[0]?.balance || 0, counterparty: r.counterparty || null };
		}
		if (cmd === 'account_get_balance') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const today = new Date().toISOString().slice(0, 10);
			const bal = select(db, 'SELECT COALESCE(SUM(CASE WHEN kind=\\'income\\' THEN amount WHEN kind=\\'adjustment\\' THEN amount WHEN kind=\\'refund\\' THEN amount WHEN kind=\\'expense\\' THEN -amount WHEN kind=\\'transfer\\' AND account_id=? THEN -amount WHEN kind=\\'transfer\\' AND transfer_account_id=? THEN amount ELSE 0 END), 0) AS balance FROM transactions WHERE (account_id=? OR (kind=\\'transfer\\' AND transfer_account_id=?)) AND deleted_at IS NULL AND date<=?', [args.accountId, args.accountId, args.accountId, args.accountId, today]);
			return bal[0]?.balance || 0;
		}
		if (cmd === 'account_get_balance_as_of') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const bal = select(db, 'SELECT COALESCE(SUM(CASE WHEN kind=\\'income\\' THEN amount WHEN kind=\\'adjustment\\' THEN amount WHEN kind=\\'refund\\' THEN amount WHEN kind=\\'expense\\' THEN -amount WHEN kind=\\'transfer\\' AND account_id=? THEN -amount WHEN kind=\\'transfer\\' AND transfer_account_id=? THEN amount ELSE 0 END), 0) AS balance FROM transactions WHERE (account_id=? OR (kind=\\'transfer\\' AND transfer_account_id=?)) AND deleted_at IS NULL AND date<=?', [args.accountId, args.accountId, args.accountId, args.accountId, args.date]);
			return bal[0]?.balance || 0;
		}
		if (cmd === 'account_create') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const input = args.input;
			const id = crypto.randomUUID().replace(/-/g, '').slice(0, 26);
			const now = new Date().toISOString();
			db.run('INSERT INTO accounts (id, name, type, counterparty, currency, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
				[id, input.name, input.type, input.counterparty || null, input.currency, now, now]);
			if (input.initial_balance && input.initial_balance !== 0) {
				const txId = crypto.randomUUID().replace(/-/g, '').slice(0, 26);
				const date = input.initial_balance_date || now.slice(0, 10);
				const kind = (input.type === 'credit_card' || input.type === 'loan_from_person') ? 'expense' : 'adjustment';
				db.run('INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, \\'tag_initial_balance\\', ?, ?)',
					[txId, kind, date, Math.abs(input.initial_balance), id, now, now]);
			}
			return id;
		}
		if (cmd === 'account_update') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const patch = args.patch;
			const sets = ['updated_at = ?'];
			const vals = [new Date().toISOString()];
			if (patch.name !== undefined) { sets.push('name = ?'); vals.push(patch.name); }
			if (patch.type !== undefined) { sets.push('type = ?'); vals.push(patch.type); }
			if (patch.counterparty !== undefined) { sets.push('counterparty = ?'); vals.push(patch.counterparty); }
			if (patch.archived !== undefined) { sets.push('archived = ?'); vals.push(patch.archived); }
			vals.push(args.id);
			db.run('UPDATE accounts SET ' + sets.join(', ') + ' WHERE id = ?', vals);
			return {};
		}
		if (cmd === 'account_delete') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const now = new Date().toISOString();
			db.run('UPDATE accounts SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, args.id]);
			return {};
		}
		if (cmd === 'transaction_list') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			let where = 'deleted_at IS NULL';
			const vals = [];
			const f = args.filter || {};
			if (f.account_id) { where += ' AND account_id = ?'; vals.push(f.account_id); }
			if (f.kind) { where += ' AND kind = ?'; vals.push(f.kind); }
			if (f.from_date) { where += ' AND date >= ?'; vals.push(f.from_date); }
			if (f.to_date) { where += ' AND date <= ?'; vals.push(f.to_date); }
			if (f.tag_id) { where += ' AND tag_id = ?'; vals.push(f.tag_id); }
			if (f.search) { where += ' AND (payee LIKE ? OR description LIKE ?)'; vals.push('%' + f.search + '%', '%' + f.search + '%'); }
			const limit = f.limit || 100;
			const offset = f.offset || 0;
			return select(db, 'SELECT * FROM transactions WHERE ' + where + ' ORDER BY date DESC, created_at DESC LIMIT ? OFFSET ?', [...vals, limit, offset]);
		}
		if (cmd === 'transaction_get') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const rows = select(db, 'SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL', [args.id]);
			return rows.length > 0 ? rows[0] : null;
		}
		if (cmd === 'transaction_create') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const input = args.input;
			const id = crypto.randomUUID().replace(/-/g, '').slice(0, 26);
			const now = new Date().toISOString();
			db.run('INSERT INTO transactions (id, kind, date, amount, account_id, transfer_account_id, transfer_pair_id, refund_of_id, tag_id, payee, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
				[id, input.kind, input.date, input.amount, input.account_id, input.transfer_account_id || null, input.transfer_pair_id || null, input.refund_of_id || null, input.tag_id || null, input.payee || null, input.description || null, now, now]);
			return id;
		}
		if (cmd === 'transaction_create_batch') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const ids = [];
			for (const input of args.inputs) {
				const id = crypto.randomUUID().replace(/-/g, '').slice(0, 26);
				const now = new Date().toISOString();
				db.run('INSERT INTO transactions (id, kind, date, amount, account_id, transfer_account_id, transfer_pair_id, refund_of_id, tag_id, payee, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
					[id, input.kind, input.date, input.amount, input.account_id, input.transfer_account_id || null, input.transfer_pair_id || null, input.refund_of_id || null, input.tag_id || null, input.payee || null, input.description || null, now, now]);
				ids.push(id);
			}
			return ids;
		}
		if (cmd === 'transaction_update') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const patch = args.patch;
			const sets = ['updated_at = ?'];
			const vals = [new Date().toISOString()];
			for (const key of ['kind', 'date', 'amount', 'account_id', 'transfer_account_id', 'tag_id', 'payee', 'description']) {
				if (patch[key] !== undefined) { sets.push(key + ' = ?'); vals.push(patch[key]); }
			}
			vals.push(args.id);
			db.run('UPDATE transactions SET ' + sets.join(', ') + ' WHERE id = ?', vals);
			return {};
		}
		if (cmd === 'transaction_delete') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const now = new Date().toISOString();
			db.run('UPDATE transactions SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, args.id]);
			return {};
		}
		if (cmd === 'transaction_restore') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			db.run('UPDATE transactions SET deleted_at = NULL, updated_at = ? WHERE id = ?', [new Date().toISOString(), args.id]);
			return {};
		}
		if (cmd === 'transaction_duplicate') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const rows = select(db, 'SELECT * FROM transactions WHERE id = ? AND deleted_at IS NULL', [args.id]);
			if (rows.length === 0) throw new Error('transaction not found');
			const orig = rows[0];
			const newId = crypto.randomUUID().replace(/-/g, '').slice(0, 26);
			const now = new Date().toISOString();
			db.run('INSERT INTO transactions (id, kind, date, amount, account_id, transfer_account_id, transfer_pair_id, refund_of_id, tag_id, payee, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
				[newId, orig.kind, orig.date, orig.amount, orig.account_id, orig.transfer_account_id, orig.transfer_pair_id, orig.refund_of_id, orig.tag_id, orig.payee, orig.description, now, now]);
			return newId;
		}
		if (cmd === 'category_list_buckets') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			return select(db, 'SELECT id, name, budgetable, rollover_enabled, created_at, updated_at FROM categories WHERE deleted_at IS NULL ORDER BY created_at', []);
		}
		if (cmd === 'category_create_bucket') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const id = crypto.randomUUID().replace(/-/g, '').slice(0, 26);
			const now = new Date().toISOString();
			db.run('INSERT INTO categories (id, name, budgetable, rollover_enabled, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)',
				[id, args.name, args.budgetable ?? 1, now, now]);
			return id;
		}
		if (cmd === 'category_rename_bucket') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			db.run('UPDATE categories SET name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [args.name, new Date().toISOString(), args.id]);
			return {};
		}
		if (cmd === 'category_set_rollover_enabled') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			db.run('UPDATE categories SET rollover_enabled = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [args.enabled ? 1 : 0, new Date().toISOString(), args.id]);
			return {};
		}
		if (cmd === 'category_delete_bucket') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const now = new Date().toISOString();
			db.run('UPDATE categories SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, args.id]);
			return {};
		}
		if (cmd === 'category_list_tags') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			let q = 'SELECT id, name, category_id, created_at, updated_at FROM tags WHERE deleted_at IS NULL';
			const vals = [];
			if (args.bucketId) { q += ' AND category_id = ?'; vals.push(args.bucketId); }
			q += ' ORDER BY created_at';
			return select(db, q, vals);
		}
		if (cmd === 'category_create_tag') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const id = crypto.randomUUID().replace(/-/g, '').slice(0, 26);
			const now = new Date().toISOString();
			db.run('INSERT INTO tags (id, name, category_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
				[id, args.name, args.bucketId, now, now]);
			return id;
		}
		if (cmd === 'category_rename_tag') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			db.run('UPDATE tags SET name = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [args.name, new Date().toISOString(), args.id]);
			return {};
		}
		if (cmd === 'category_move_tag') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			db.run('UPDATE tags SET category_id = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [args.newBucketId, new Date().toISOString(), args.tagId]);
			return { tag_id: args.tagId, old_category_id: null, new_category_id: args.newBucketId };
		}
		if (cmd === 'category_get_tag_transaction_info') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const cnt = select(db, 'SELECT COUNT(*) as count FROM transactions WHERE tag_id = ? AND deleted_at IS NULL', [args.tagId]);
			return { tag_id: args.tagId, transaction_count: cnt[0]?.count || 0 };
		}
		if (cmd === 'category_delete_tag') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const now = new Date().toISOString();
			const opt = args.option;
			if (opt === 'uncategorise') {
				db.run('UPDATE transactions SET tag_id = NULL, updated_at = ? WHERE tag_id = ? AND deleted_at IS NULL', [now, args.id]);
			} else {
				const parsed = typeof opt === 'string' ? JSON.parse(opt) : opt;
				if (parsed && parsed.merge_into) {
					db.run('UPDATE transactions SET tag_id = ?, updated_at = ? WHERE tag_id = ? AND deleted_at IS NULL', [parsed.merge_into, now, args.id]);
				}
			}
			db.run('UPDATE tags SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, args.id]);
			return {};
		}
		if (cmd === 'budget_get_for_month') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			return select(db, 'SELECT b.id, b.category_id, b.month, b.allocated, b.created_at, b.updated_at FROM budgets b WHERE b.month = ? AND b.deleted_at IS NULL', [args.month]);
		}
		if (cmd === 'budget_get_spent_for_bucket') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const start = args.month + '-01';
			const end = args.month + '-31';
			const r = select(db, 'SELECT COALESCE(SUM(amount), 0) as spent FROM transactions WHERE tag_id IN (SELECT id FROM tags WHERE category_id = ? AND deleted_at IS NULL) AND kind = \\'expense\\' AND date >= ? AND date <= ? AND deleted_at IS NULL', [args.typeId, start, end]);
			return r[0]?.spent || 0;
		}
		if (cmd === 'budget_get_rolled_over') {
			return 0;
		}
		if (cmd === 'budget_set_allocation') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const now = new Date().toISOString();
			db.run('INSERT OR REPLACE INTO budgets (id, category_id, month, allocated, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
				[crypto.randomUUID().replace(/-/g, '').slice(0, 26), args.typeId, args.month, args.allocated, now, now]);
			return {};
		}
		if (cmd === 'budget_copy_from_previous_month') {
			return {};
		}
		if (cmd === 'budget_has_allocations') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const r = select(db, 'SELECT COUNT(*) as count FROM budgets WHERE month = ? AND deleted_at IS NULL', [args.month]);
			return (r[0]?.count || 0) > 0;
		}
		if (cmd === 'goal_list') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			return select(db, 'SELECT * FROM goals WHERE deleted_at IS NULL ORDER BY created_at', []);
		}
		if (cmd === 'goal_get') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const r = select(db, 'SELECT * FROM goals WHERE id = ? AND deleted_at IS NULL', [args.id]);
			return r.length > 0 ? r[0] : null;
		}
		if (cmd === 'goal_create') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const id = crypto.randomUUID().replace(/-/g, '').slice(0, 26);
			const now = new Date().toISOString();
			db.run('INSERT INTO goals (id, name, goal_type, target_amount, target_date, linked_account_id, starting_amount, show_on_dashboard, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, \\'active\\', ?, ?)',
				[id, args.name, args.goalType, args.targetAmount, args.targetDate, args.linkedAccountId || null, args.startingAmount || 0, args.showOnDashboard || 1, now, now]);
			return id;
		}
		if (cmd === 'goal_update') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const sets = ['updated_at = ?'];
			const vals = [new Date().toISOString()];
			if (args.name !== null && args.name !== undefined) { sets.push('name = ?'); vals.push(args.name); }
			if (args.targetAmount !== null && args.targetAmount !== undefined) { sets.push('target_amount = ?'); vals.push(args.targetAmount); }
			if (args.targetDate !== null && args.targetDate !== undefined) { sets.push('target_date = ?'); vals.push(args.targetDate); }
			if (args.showOnDashboard !== null && args.showOnDashboard !== undefined) { sets.push('show_on_dashboard = ?'); vals.push(args.showOnDashboard); }
			if (args.status !== null && args.status !== undefined) { sets.push('status = ?'); vals.push(args.status); }
			vals.push(args.id);
			db.run('UPDATE goals SET ' + sets.join(', ') + ' WHERE id = ? AND deleted_at IS NULL', vals);
			return {};
		}
		if (cmd === 'goal_delete') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const now = new Date().toISOString();
			db.run('UPDATE goals SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, args.id]);
			return {};
		}
		if (cmd === 'rule_list' || cmd === 'rule_list_all') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			let q = 'SELECT id, payee_term, match_mode, tag_id, source, enabled, created_at, updated_at FROM rules WHERE deleted_at IS NULL';
			if (cmd === 'rule_list') q += ' AND enabled = 1';
			q += ' ORDER BY created_at';
			return select(db, q, []);
		}
		if (cmd === 'rule_create') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const id = crypto.randomUUID().replace(/-/g, '').slice(0, 26);
			const now = new Date().toISOString();
			db.run('INSERT INTO rules (id, payee_term, match_mode, tag_id, source, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)',
				[id, args.payeeTerm, args.matchMode, args.tagId, args.source || 'manual', now, now]);
			return { id, payee_term: args.payeeTerm, match_mode: args.matchMode, tag_id: args.tagId, source: args.source || 'manual', enabled: 1, created_at: now, updated_at: now };
		}
		if (cmd === 'rule_update') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const sets = ['updated_at = ?'];
			const vals = [new Date().toISOString()];
			if (args.payeeTerm !== null && args.payeeTerm !== undefined) { sets.push('payee_term = ?'); vals.push(args.payeeTerm); }
			if (args.matchMode !== null && args.matchMode !== undefined) { sets.push('match_mode = ?'); vals.push(args.matchMode); }
			if (args.tagId !== null && args.tagId !== undefined) { sets.push('tag_id = ?'); vals.push(args.tagId); }
			if (args.source !== null && args.source !== undefined) { sets.push('source = ?'); vals.push(args.source); }
			if (args.enabled !== null && args.enabled !== undefined) { sets.push('enabled = ?'); vals.push(args.enabled); }
			vals.push(args.id);
			db.run('UPDATE rules SET ' + sets.join(', ') + ' WHERE id = ? AND deleted_at IS NULL', vals);
			const r = select(db, 'SELECT id, payee_term, match_mode, tag_id, source, enabled, created_at, updated_at FROM rules WHERE id = ?', [args.id]);
			return r[0] || {};
		}
		if (cmd === 'rule_delete') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const now = new Date().toISOString();
			db.run('UPDATE rules SET deleted_at = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL', [now, now, args.id]);
			return {};
		}
		if (cmd === 'rule_upsert_learned') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const existing = select(db, 'SELECT id FROM rules WHERE payee_term = ? AND source = \\'learned\\' AND deleted_at IS NULL', [args.payeeTerm]);
			const now = new Date().toISOString();
			if (existing.length > 0) {
				db.run('UPDATE rules SET tag_id = ?, updated_at = ? WHERE id = ?', [args.tagId, now, existing[0].id]);
				return { id: existing[0].id, payee_term: args.payeeTerm, match_mode: 'contains', tag_id: args.tagId, source: 'learned', enabled: 1, created_at: now, updated_at: now };
			}
			const id = crypto.randomUUID().replace(/-/g, '').slice(0, 26);
			db.run('INSERT INTO rules (id, payee_term, match_mode, tag_id, source, enabled, created_at, updated_at) VALUES (?, ?, \\'contains\\', ?, \\'learned\\', 1, ?, ?)',
				[id, args.payeeTerm, args.tagId, now, now]);
			return { id, payee_term: args.payeeTerm, match_mode: 'contains', tag_id: args.tagId, source: 'learned', enabled: 1, created_at: now, updated_at: now };
		}
		if (cmd === 'meta_get') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const r = select(db, 'SELECT value FROM app_meta WHERE key = ?', [args.key]);
			return r.length > 0 ? r[0].value : null;
		}
		if (cmd === 'meta_set') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			db.run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (?, ?)', [args.key, args.value]);
			return {};
		}
		if (cmd === 'meta_delete') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			db.run('DELETE FROM app_meta WHERE key = ?', [args.key]);
			return {};
		}
		if (cmd === 'meta_is_first_run_complete') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const r = select(db, 'SELECT value FROM app_meta WHERE key = \\'first_run_complete\\'', []);
			return r.length > 0 && r[0].value === '1';
		}
		if (cmd === 'meta_get_locale') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const r = select(db, 'SELECT value FROM app_meta WHERE key = \\'locale\\'', []);
			return r.length > 0 ? r[0].value : 'en';
		}
		if (cmd === 'meta_get_currency') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const r = select(db, 'SELECT value FROM app_meta WHERE key = \\'currency\\'', []);
			return r.length > 0 ? r[0].value : 'VND';
		}
		if (cmd === 'meta_is_tour_complete') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const r = select(db, 'SELECT value FROM app_meta WHERE key = \\'tour_complete\\'', []);
			return r.length > 0 && r[0].value === '1';
		}
		if (cmd === 'meta_set_tour_complete') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			db.run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (\\'tour_complete\\', \\'1\\')', []);
			return {};
		}
		if (cmd === 'meta_set_first_run_complete') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			db.run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (\\'first_run_complete\\', \\'1\\')', []);
			return {};
		}
		if (cmd === 'meta_get_default_quick_account') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const r = select(db, 'SELECT value FROM app_meta WHERE key = \\'default_quick_account\\'', []);
			return r.length > 0 ? r[0].value : null;
		}
		if (cmd === 'meta_set_default_quick_account') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			db.run('INSERT OR REPLACE INTO app_meta (key, value) VALUES (\\'default_quick_account\\', ?)', [args.accountId]);
			return {};
		}
		if (cmd === 'meta_clear_default_quick_account') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			db.run('DELETE FROM app_meta WHERE key = \\'default_quick_account\\'', []);
			return {};
		}
		if (cmd === 'debt_list') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const iOwe = select(db, 'SELECT a.*, COALESCE(SUM(CASE WHEN t.kind=\\'expense\\' THEN t.amount WHEN t.kind=\\'transfer\\' AND t.transfer_account_id=a.id THEN t.amount ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN t.kind=\\'transfer\\' AND t.account_id=a.id THEN t.amount ELSE 0 END), 0) as balance FROM accounts a LEFT JOIN transactions t ON (t.account_id=a.id OR t.transfer_account_id=a.id) AND t.deleted_at IS NULL WHERE a.type=\\'loan_to_person\\' AND a.deleted_at IS NULL GROUP BY a.id', []);
			const owedToMe = select(db, 'SELECT a.*, COALESCE(SUM(CASE WHEN t.kind=\\'expense\\' THEN t.amount WHEN t.kind=\\'transfer\\' AND t.transfer_account_id=a.id THEN t.amount ELSE 0 END), 0) - COALESCE(SUM(CASE WHEN t.kind=\\'transfer\\' AND t.account_id=a.id THEN t.amount ELSE 0 END), 0) as balance FROM accounts a LEFT JOIN transactions t ON (t.account_id=a.id OR t.transfer_account_id=a.id) AND t.deleted_at IS NULL WHERE a.type=\\'loan_from_person\\' AND a.deleted_at IS NULL GROUP BY a.id', []);
			return { i_owe: iOwe, owed_to_me: owedToMe };
		}
		if (cmd === 'debt_write_off') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const id = crypto.randomUUID().replace(/-/g, '').slice(0, 26);
			const now = new Date().toISOString();
			db.run('INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, description, created_at, updated_at) VALUES (?, \\'adjustment\\', ?, ?, ?, ?, \\'Debt write-off\\', ?, ?)',
				[id, now.slice(0, 10), args.amount, args.accountId, args.tagId || null, now, now]);
			return id;
		}
		if (cmd === 'reconciliation_get_history') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			return select(db, 'SELECT * FROM reconciliations WHERE account_id = ? ORDER BY reconciled_at DESC', [args.accountId]);
		}
		if (cmd === 'reconciliation_reconcile') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const id = crypto.randomUUID().replace(/-/g, '').slice(0, 26);
			const now = new Date().toISOString();
			db.run('INSERT INTO reconciliations (id, account_id, actual_balance, book_balance, difference, notes, reconciled_at, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)',
				[id, args.accountId, args.actualBalance, args.actualBalance, args.notes || null, now, now, now]);
			if (args.createAdjustment) {
				const txId = crypto.randomUUID().replace(/-/g, '').slice(0, 26);
				db.run('INSERT INTO transactions (id, kind, date, amount, account_id, tag_id, description, created_at, updated_at) VALUES (?, \\'adjustment\\', ?, ?, ?, NULL, \\'Reconciliation adjustment\\', ?, ?)',
					[txId, now.slice(0, 10), args.actualBalance, args.accountId, now, now]);
			}
			return { reconciliation_id: id, difference: args.actualBalance };
		}
		if (cmd === 'report_get_overview') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			const start = args.month + '-01';
			const end = args.month + '-31';
			const income = select(db, 'SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE kind=\\'income\\' AND date >= ? AND date <= ? AND deleted_at IS NULL', [start, end]);
			const expense = select(db, 'SELECT COALESCE(SUM(amount), 0) as total FROM transactions WHERE kind=\\'expense\\' AND date >= ? AND date <= ? AND deleted_at IS NULL', [start, end]);
			return { month: args.month, income: income[0]?.total || 0, expense: expense[0]?.total || 0, net: (income[0]?.total || 0) - (expense[0]?.total || 0), by_category: [] };
		}
		if (cmd === 'report_get_trend') {
			return [];
		}
		if (cmd === 'report_get_comparison') {
			return [];
		}
		if (cmd === 'report_get_category_trend') {
			return [];
		}
		if (cmd === 'report_get_stacked_category_series') {
			return [];
		}
		if (cmd === 'report_get_year_over_year') {
			return [];
		}
		if (cmd === 'report_get_net_worth_series') {
			return [];
		}
		if (cmd === 'quit_app') {
			return {};
		}
		if (cmd === 'database_restore') {
			const src = args.summary && args.summary.path;
			const bytes = src && fs.get(src);
			if (!bytes) throw new Error('tauri-mock: database_restore source missing: ' + src);
			// Replace the live file bytes and persist to IndexedDB so the
			// post-restore reload rehydrates the restored database (mirrors a real
			// disk write that survives process restart).
			fs.set(LIVE_DB_PATH, bytes);
			await idbSet(idbKey(LIVE_DB_PATH), bytes);
			return {};
		}
		if (cmd === 'transaction_frequent') {
			const db = await loadDb(LIVE_DB_PATH, SQL_JS);
			return select(db, "SELECT payee, tag_id, account_id, amount, kind, COUNT(*) as count FROM transactions WHERE deleted_at IS NULL AND date >= ? AND payee IS NOT NULL AND kind IN ('expense', 'income') GROUP BY payee, tag_id, account_id ORDER BY count DESC, date DESC LIMIT 5", [args.sinceDate]);
		}
		throw new Error('tauri-mock: unhandled invoke ' + cmd);
	},
	transformCallback: () => 0,
	convertFileSrc: (p) => p,
};

// Expose a way for tests to read the virtual FS + flush the persist DB, plus a
// sql.js factory so tests can mint corrupt / mismatched candidate DBs through
// the same sql.js build the mock uses internally.
window.__notchyMock = {
	readFs: (path) => fs.get(path),
	listFs: (dir) => [...fs.keys()].filter((p) => p.startsWith(dir)),
	writeFs: (path, bytes) => fs.set(path, bytes),
	flushLiveDb: () => flushLiveDb(),
	// Resolves once sql.js is loaded; returns the SQL namespace (initSqlJs result).
	// Tests use this to build a throwaway Database, run DDL, and export() bytes.
	sqlReady: () => sqlReady,
	// Mock-only fault control: disarms injected failures in-page and persists a
	// marker so the disarm survives page.reload() (the reload re-runs this init
	// script with the original options).
	clearFaults: () => {
		faults.failUpgradeBackup = false;
		faults.failMigrationVersion = null;
		return idbSet('notchy-mock:faults-cleared', true);
	},
	lastOpenedPath: () => lastOpenedPath,
	rawQuery: (query, values) => {
		const db = dbs.get(LIVE_DB_PATH);
		if (!db) throw new Error('tauri-mock: live DB not open');
		return select(db, query, values || []);
	},
	rawExecute: (query, values) => {
		const db = dbs.get(LIVE_DB_PATH);
		if (!db) throw new Error('tauri-mock: live DB not open');
		db.run(query, values || []);
		return db.getRowsModified();
	},
	createBackup: (backupDir) => {
		const db = dbs.get(LIVE_DB_PATH);
		if (!db) throw new Error('tauri-mock: live DB not open');
		const stamp = new Date().toISOString().replace(/[:.]/g, '-');
		const path = backupDir + '/notchy-backup-' + stamp + '.sqlite';
		fs.set(path, db.export());
		return path;
	},
};
	`);
}

/** The in-page mock surface exposed on window by the init script. */
interface NotchyMockWindow {
	readFs: (path: string) => Uint8Array | undefined;
	listFs: (dir: string) => string[];
	writeFs: (path: string, bytes: Uint8Array) => void;
	flushLiveDb: () => Promise<void>;
	sqlReady: () => Promise<SqlJsNamespace>;
	clearFaults: () => Promise<void>;
	lastOpenedPath: () => string | null;
	rawQuery: (query: string, values?: unknown[]) => unknown[];
	rawExecute: (query: string, values?: unknown[]) => number;
	createBackup: (backupDir: string) => string;
}

/** The sql.js namespace shape tests use to mint candidate DBs. */
interface SqlJsNamespace {
	Database: new () => {
		run: (sql: string) => void;
		export: () => Uint8Array;
	};
}

/** Inspect a virtual-FS file from the test. */
export async function readVirtualFs(page: Page, path: string): Promise<Uint8Array | undefined> {
	return page.evaluate(
		(p) => (window as unknown as { __notchyMock?: NotchyMockWindow }).__notchyMock?.readFs(p),
		path
	);
}

/** List virtual-FS files under a directory. */
export async function listVirtualFs(page: Page, dir: string): Promise<string[]> {
	return page.evaluate(
		(d) => (window as unknown as { __notchyMock?: NotchyMockWindow }).__notchyMock?.listFs(d) ?? [],
		dir
	);
}

/** Write a file into the virtual FS (used to mint corrupt/mismatch test files). */
export async function writeVirtualFs(page: Page, path: string, bytes: Uint8Array): Promise<void> {
	await page.evaluate(
		({ p, b }) =>
			(window as unknown as { __notchyMock?: NotchyMockWindow }).__notchyMock?.writeFs(p, new Uint8Array(b)),
		{ p: path, b: Array.from(bytes) }
	);
}

/**
 * Force the live DB to flush to IndexedDB (persist mode). Call before a
 * page.reload() so the reloaded page rehydrates the latest state. The mock's
 * execute handler does not auto-flush (export mid-transaction breaks sql.js's
 * savepoint stack), so an explicit flush is required before reload.
 */
export async function flushDb(page: Page): Promise<void> {
	await page.evaluate(
		() => (window as unknown as { __notchyMock?: NotchyMockWindow }).__notchyMock?.flushLiveDb()
	);
}

export async function rawQuery<T>(page: Page, sql: string, values?: unknown[]): Promise<T[]> {
	return page.evaluate(
		({ sql, values }) =>
			(window as unknown as { __notchyMock?: { rawQuery: (q: string, v: unknown[]) => unknown[] } }).__notchyMock?.rawQuery(sql, values ?? []),
		{ sql, values }
	) as Promise<T[]>;
}

export async function rawExecute(page: Page, sql: string, values?: unknown[]): Promise<number> {
	return page.evaluate(
		({ sql, values }) =>
			(window as unknown as { __notchyMock?: { rawExecute: (q: string, v: unknown[]) => number } }).__notchyMock?.rawExecute(sql, values ?? []),
		{ sql, values }
	) as Promise<number>;
}

export async function createMockBackup(page: Page, dir: string): Promise<string> {
	return page.evaluate(
		(dir) => (window as unknown as { __notchyMock?: { createBackup: (d: string) => string } }).__notchyMock?.createBackup(dir),
		dir
	) as Promise<string>;
}

/**
 * Clear an injected mock fault (failUpgradeBackup / failMigrationVersion), both
 * in-page and persisted to IndexedDB so the clear survives page.reload() — the
 * reload re-runs the init script with the original options.
 */
export async function clearFaults(page: Page): Promise<void> {
	await page.evaluate(
		() => (window as unknown as { __notchyMock?: NotchyMockWindow }).__notchyMock?.clearFaults()
	);
}

/** Return the path the mock opener handler recorded (null until opened). */
export async function lastOpenedPath(page: Page): Promise<string | null> {
	return page.evaluate(
		() => (window as unknown as { __notchyMock?: NotchyMockWindow }).__notchyMock?.lastOpenedPath() ?? null
	);
}

/**
 * Fixture: injects the mock before navigation. Configure via test.use:
 *   test.use({ tauriMockOptions: { seedMeta: {...} } })
 */
export const test = base.extend<{ tauriMockPage: Page; tauriMockOptions: TauriMockOptions }>({
	// Undefined by default: the mock is only injected when a test explicitly
	// opts in via test.use({ tauriMockOptions }). UI-flow specs run the browser
	// fallback (real repos, documented E2E path); DB-lifecycle specs opt in.
	tauriMockOptions: [undefined, { option: true }],
	tauriMockPage: async ({ page, tauriMockOptions }, use) => {
		if (tauriMockOptions !== undefined) await injectTauriMock(page, tauriMockOptions);
		await use(page);
	},
});

export { expect } from '@playwright/test';
