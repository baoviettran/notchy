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

	await page.addInitScript(`
const opts = window.__NOTCHY_TAURI_MOCK_OPTIONS__ || {};
const APP_DATA_DIR = '/notchy/appdata';
const LIVE_PATH = 'sqlite:notchy.db';
const GLUE_B64 = ${JSON.stringify(glueB64)};
const WASM_B64 = ${JSON.stringify(WASM_B64)};

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

async function loadDb(path, SQL_JS) {
	if (dbs.has(path)) return dbs.get(path);
	// Rehydrate from IndexedDB if persist is on; else from the virtual FS
	// (restore path copied bytes there); else fresh.
	let bytes = null;
	if (opts.persist) bytes = await idbGet(idbKey(path));
	if (!bytes && fs.has(path)) bytes = fs.get(path);
	const db = bytes ? new SQL_JS.Database(bytes) : new SQL_JS.Database();
	dbs.set(path, db);

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
		args = args || {};
		// --- SQL plugin ---
		if (cmd === 'plugin:sql|load') {
			await loadDb(args.db, SQL_JS);
			// Echo the path: the plugin stores invoke's return as this.path.
			return args.db;
		}
		if (cmd === 'plugin:sql|select') {
			const db = await loadDb(args.db, SQL_JS);
			return select(db, args.query, args.values);
		}
		if (cmd === 'plugin:sql|execute') {
			const db = await loadDb(args.db, SQL_JS);
			db.run(args.query, args.values || []);
			const rowsAffected = db.getRowsModified();
			// Persist mode does NOT auto-flush here: db.export() is O(DB size)
			// and running it mid-transaction (SAVEPOINT open) breaks sql.js's
			// savepoint stack. The test calls flushDb() at the points it needs
			// reload-survival; the next load rehydrates from IDB.
			return [rowsAffected, 0];
		}
		if (cmd === 'plugin:sql|close') {
			const db = dbs.get(args.db);
			if (db) { db.close(); dbs.delete(args.db); }
			return {};
		}
		// --- Path plugin ---
		if (cmd === 'plugin:path|resolve_directory') return APP_DATA_DIR;
		if (cmd === 'plugin:path|join') return join(...(args.paths || []));
		// --- FS plugin ---
		if (cmd === 'plugin:fs|copy_file') {
			fs.set(args.toPath, fs.get(args.fromPath));
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
		throw new Error('tauri-mock: unhandled invoke ' + cmd);
	},
	transformCallback: () => 0,
	convertFileSrc: (p) => p,
};

// Expose a way for tests to read the virtual FS + flush the persist DB.
window.__notchyMock = {
	readFs: (path) => fs.get(path),
	listFs: (dir) => [...fs.keys()].filter((p) => p.startsWith(dir)),
	writeFs: (path, bytes) => fs.set(path, bytes),
	flushLiveDb: () => flushLiveDb(),
};
	`);
}

/** The in-page mock surface exposed on window by the init script. */
interface NotchyMockWindow {
	readFs: (path: string) => Uint8Array | undefined;
	listFs: (dir: string) => string[];
	writeFs: (path: string, bytes: Uint8Array) => void;
	flushLiveDb: () => Promise<void>;
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
