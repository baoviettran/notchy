/**
 * Native `BackupOps` — the production Tauri adapter.
 *
 * Thin `invoke()` bridges: Rust owns the publication protocol, the manifest
 * validation, and the CSV escaping. No raw SQL crosses this seam.
 *
 * No `isTauri()` guard, deliberately: every other op on `NativeDatabaseClient`
 * is a bare `invoke()`, and this client is only ever constructed when the app
 * is already running under Tauri (`src/lib/db/index.ts` picks the adapter by
 * `isTauri()`). A guard here would also put `index -> native/client ->
 * native/backup -> index` on the runtime graph, and would make the boundary
 * sweep throw in the node test environment, where `isTauri()` is false by
 * construction.
 */
import { invoke } from '@tauri-apps/api/core';
import type { BackupOps } from '../client';

export class NativeBackupOps implements BackupOps {
	async create(): Promise<string> {
		return invoke<string>('backup_create');
	}

	async exportSqlite(targetPath: string): Promise<void> {
		return invoke<void>('backup_export_sqlite', { targetPath });
	}

	async exportCsv(dir: string): Promise<string[]> {
		return invoke<string[]>('backup_export_csv', { dir });
	}
}
