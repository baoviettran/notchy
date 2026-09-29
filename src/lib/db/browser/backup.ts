/**
 * Browser `BackupOps` — sql.js in Vitest and Playwright.
 *
 * Wraps the existing backup helpers so the web build keeps its current
 * behaviour: `VACUUM INTO` for database copies and the JS table dump for CSV.
 * Discovery is Rust-only (`discoverRestorePoints` returns `[]` in the browser),
 * so a browser-side filename has no cross-adapter contract to honour — the
 * timestamp filenames stay on this side on purpose.
 *
 * The seams exist because the Tauri plugins are absent in the browser: without
 * them a test cannot aim a backup at a real directory or capture the CSV writes.
 * `..` is imported lazily because `src/lib/db/index.ts` constructs this client,
 * so a static import would close a module cycle.
 *
 * One difference from the pre-port page: this writes a file for every table,
 * including an empty one, because the port promises one file per table. The JS
 * dump returns an empty string for a table with no rows, so such a file is
 * empty rather than header-only — only the native path can cheaply emit
 * headers, so the content of an empty table's file is not part of the contract.
 */
import type { DatabaseService } from './service';
import type { BackupOps } from '../client';
import { createBackup, exportCsv } from '$lib/backup';
import { setMeta } from './repos/meta';

export interface BrowserBackupOptions {
	/** Routine backup directory. Defaults to `getDatabasePaths().routineBackupDir`. */
	backupDir?: string;
	/** Directory-creation seam. Defaults to the platform `ensureDirectory`. */
	ensureDirectory?: (path: string) => Promise<void>;
	/** File-write seam. Defaults to the Tauri FS plugin's `writeTextFile`. */
	writeFile?: (path: string, content: string) => Promise<void>;
}

export class BrowserBackupOps implements BackupOps {
	constructor(
		private readonly db: DatabaseService,
		private readonly options: BrowserBackupOptions = {}
	) {}

	async create(): Promise<string> {
		const dir =
			this.options.backupDir ??
			(await (await import('..')).getDatabasePaths()).routineBackupDir;
		await this.ensure(dir);
		const path = await createBackup(this.db, dir);
		// Recorded only after the file exists, so a failure leaves the last
		// known-good timestamp intact.
		await setMeta(this.db, 'last_backup_at', new Date().toISOString());
		return path;
	}

	async exportSqlite(targetPath: string): Promise<void> {
		await this.db.execute(`VACUUM INTO '${targetPath.replace(/'/g, "''")}'`);
	}

	async exportCsv(dir: string): Promise<string[]> {
		await this.ensure(dir);
		const csvMap = await exportCsv(this.db);
		const written: string[] = [];
		for (const [table, content] of csvMap) {
			const path = `${dir}/${table}.csv`;
			await this.write(path, content);
			written.push(path);
		}
		return written;
	}

	private async ensure(dir: string): Promise<void> {
		if (this.options.ensureDirectory) return this.options.ensureDirectory(dir);
		const { ensureDirectory } = await import('..');
		return ensureDirectory(dir);
	}

	private async write(path: string, content: string): Promise<void> {
		if (this.options.writeFile) return this.options.writeFile(path, content);
		const { writeTextFile } = await import('@tauri-apps/plugin-fs');
		await writeTextFile(path, content);
	}
}
