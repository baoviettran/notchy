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
		const db = dbs.get(LIVE_PATH);
		if (db) {
			try { await idbSet(idbKey(LIVE_PATH), db.export()); } catch {}
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
	if (path === LIVE_PATH && !bytes && opts.initialSchemaVersion === 4 && FIXTURE_V004_B64) {
		bytes = Uint8Array.from(atob(FIXTURE_V004_B64), (c) => c.charCodeAt(0));
	}
	const db = bytes ? new SQL_JS.Database(bytes) : new SQL_JS.Database();
	dbs.set(path, db);

	// Newer-schema claim: a minimal app_meta claiming opts.initialSchemaVersion
	// is enough for inspectSchema to return 'newer' (tables non-empty).
	if (path === LIVE_PATH && !bytes && opts.initialSchemaVersion != null && opts.initialSchemaVersion !== 4) {
		db.run('CREATE TABLE IF NOT EXISTS app_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL)');
		db.run("INSERT OR REPLACE INTO app_meta (key, value) VALUES ('schema_version', ?)", [
			String(opts.initialSchemaVersion)
		]);
	}

	// Pre-init seed hook: write seedMeta into the live DB before runAutoBackup.
	if (path === LIVE_PATH && opts.seedMeta) {
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
			if (data && args.toPath === APP_DATA_DIR + '/notchy.db') {
				await idbSet(idbKey(LIVE_PATH), data);
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
	tauriMockOptions: [{}, { option: true }],
	tauriMockPage: async ({ page, tauriMockOptions }, use) => {
		await injectTauriMock(page, tauriMockOptions);
		await use(page);
	},
});

export { expect } from '@playwright/test';
