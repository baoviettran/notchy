<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	import { save, open } from '@tauri-apps/plugin-dialog';
	import { writeTextFile } from '@tauri-apps/plugin-fs';
	import { getDb } from '$lib/db';
	import type { AppDatabase } from '$lib/db/client';
	import type { DatabaseService } from '$lib/db/browser/service';
	import { exportCsv } from '$lib/backup';
	import { createManualBackup, getBackupHealth, type BackupHealth } from '$lib/backup/health';

	/** Access the raw DatabaseService for legacy backup operations. */
	function getRawDb(db: AppDatabase): DatabaseService {
		return (db as unknown as { raw: DatabaseService }).raw;
	}
	import { restoreCompatibleDatabase } from '$lib/recovery';
	import { toast } from '$lib/stores/toast.svelte';
	import { AppError } from '$lib/errors';
	import { mapError } from '$lib/utils/errors';
	import { getDatabasePaths, getInstalledAppVersion, openBackupFolder } from '$lib/db/platform';
	import * as m from '$lib/paraglide/messages';

	let confirmImport = $state(false);
	let busy = $state(false);

	let health = $state<BackupHealth | null>(null);
	let healthError = $state<string | null>(null);
	let upgradeBackupDir = $state('');

	async function loadHealth() {
		try {
			const [appVersion, paths] = await Promise.all([getInstalledAppVersion(), getDatabasePaths()]);
			upgradeBackupDir = paths.upgradeBackupDir;
			const db = getDb();
			health = await getBackupHealth(getRawDb(db), {
				appVersion,
				databasePath: paths.databasePath,
				upgradeBackupDir: paths.upgradeBackupDir
			});
			healthError = null;
		} catch (e) {
			healthError = mapError(e);
		}
	}

	onMount(() => {
		void loadHealth();
	});

	async function createBackupNow() {
		try {
			busy = true;
			const db = getDb();
			await createManualBackup(getRawDb(db));
			await loadHealth();
			toast.show(m.settings_backup_toast_created());
		} catch (e) {
			toast.show(m.settings_backup_toast_export_failed({ error: mapError(e) }));
		} finally {
			busy = false;
		}
	}

	async function openUpgradeFolder() {
		try {
			await openBackupFolder(upgradeBackupDir);
		} catch (e) {
			toast.show(m.settings_backup_toast_export_failed({ error: mapError(e) }));
		}
	}

	async function exportSqlite() {
		try {
			busy = true;
			const path = await save({
				defaultPath: `notchy-${new Date().toISOString().split('T')[0]}.sqlite`,
				filters: [{ name: 'SQLite Database', extensions: ['sqlite', 'db'] }]
			});
			if (!path) return;
			const db = getDb();
			await getRawDb(db).execute(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
			toast.show(m.settings_backup_toast_exported());
		} catch (e) {
			toast.show(m.settings_backup_toast_export_failed({ error: String(e) }));
		} finally {
			busy = false;
		}
	}

	async function exportCsvFiles() {
		try {
			busy = true;
			const dir = await open({ directory: true });
			if (!dir) return;
			const db = getDb();
			const csvMap = await exportCsv(getRawDb(db));
			for (const [table, content] of csvMap) {
				if (content) await writeTextFile(`${dir}/${table}.csv`, content);
			}
			toast.show(m.settings_backup_toast_csv_exported());
		} catch (e) {
			toast.show(m.settings_backup_toast_export_failed({ error: String(e) }));
		} finally {
			busy = false;
		}
	}

	async function importDb() {
		try {
			const path = await open({
				filters: [{ name: 'SQLite Database', extensions: ['sqlite', 'db'] }]
			});
			if (!path) return;
			busy = true;
			// Throws on an invalid/newer backup; the catch below surfaces the
			// rejection toast. On success the live DB is closed and replaced.
			await restoreCompatibleDatabase(path);
			toast.show(m.settings_backup_toast_imported());
			// The live connection was closed and the file replaced; reload the app
			// so getDb() reopens the new database and migrations re-run.
			setTimeout(() => globalThis.location.reload(), 800);
		} catch (e) {
			// A backup_* AppError is a validation rejection; anything else (copy
			// failure, FS error) is a generic import failure. Both surface a
			// localized message, never a raw error code.
			const rejected = e instanceof AppError && e.code.startsWith('backup_');
			const error = mapError(e);
			toast.show(rejected
				? m.settings_backup_toast_import_rejected({ error })
				: m.settings_backup_toast_import_failed({ error }));
		} finally {
			busy = false;
		}
	}
</script>

<div class="space-y-6">
	<h1 class="figures text-xl text-ledger tracking-wide">{m.settings_backup()}</h1>

	<div class="space-y-4">
		<div class="bg-tape rounded-lg border border-line p-4 space-y-3">
			<div class="flex items-center justify-between gap-2">
				<h2 class="font-medium text-ledger">{m.settings_backup_health()}</h2>
				<div class="flex gap-2">
					<Button size="sm" variant="secondary" disabled={busy} onclick={createBackupNow}>{m.settings_backup_health_create_now()}</Button>
					<Button size="sm" variant="secondary" disabled={!upgradeBackupDir} onclick={openUpgradeFolder}>{m.settings_backup_health_open_folder()}</Button>
				</div>
			</div>

			{#if healthError}
				<p class="text-sm text-debit">{healthError}</p>
			{:else if health}
				<dl class="space-y-2 text-sm">
					<div>
						<dt class="text-dim">{m.settings_backup_health_version()}</dt>
						<dd class="text-ledger">{health.appVersion}</dd>
					</div>
					<div>
						<dt class="text-dim">{m.settings_backup_health_schema()}</dt>
						<dd class="text-ledger">{health.schemaVersion}</dd>
					</div>
					<div>
						<dt class="text-dim">{m.settings_backup_health_database_path()}</dt>
						<dd><code class="font-mono text-xs text-ledger break-all">{health.databasePath}</code></dd>
					</div>
					<div>
						<dt class="text-dim">{m.settings_backup_health_last_backup()}</dt>
						<dd class="text-ledger">{health.lastRoutineBackupAt ?? m.settings_backup_health_no_backup()}</dd>
					</div>
					<div>
						<dt class="text-dim">{m.settings_backup_health_last_upgrade_backup()}</dt>
						{#if health.lastUpgradeBackupPath}
							<dd><code class="font-mono text-xs text-ledger break-all">{health.lastUpgradeBackupPath}</code></dd>
							<dd class="text-xs text-dim">{m.settings_backup_health_upgrade_source_schema()}: {health.lastUpgradeFromSchema ?? '—'}</dd>
						{:else}
							<dd class="text-ledger">{m.common_none()}</dd>
						{/if}
					</div>
					{#if health.warning}
						<div>
							<dt class="text-dim">{m.settings_backup_health_warning()}</dt>
							<dd class="text-debit break-all">{health.warning}</dd>
						</div>
					{/if}
				</dl>
			{:else}
				<p class="text-sm text-dim">{m.layout_warming_up()}</p>
			{/if}
		</div>

		<div class="bg-tape rounded-lg border border-line p-4 space-y-2">
			<h2 class="font-medium text-ledger">{m.settings_backup_export()}</h2>
			<p class="text-sm text-dim">{m.settings_backup_export_desc()}</p>
			<div class="flex gap-2">
				<Button size="sm" variant="secondary" disabled={busy} onclick={exportSqlite}>{m.settings_backup_export_sqlite()}</Button>
				<Button size="sm" variant="secondary" disabled={busy} onclick={exportCsvFiles}>{m.settings_backup_export_csv()}</Button>
			</div>
		</div>

		<div class="bg-tape rounded-lg border border-line p-4 space-y-2">
			<h2 class="font-medium text-ledger">{m.settings_backup_import()}</h2>
			<p class="text-sm text-dim">{m.settings_backup_import_desc()}</p>
			<Button size="sm" variant="danger" onclick={() => confirmImport = true}>{m.settings_backup_import_button()}</Button>
		</div>

		<div class="bg-tape rounded-lg border border-line p-4 space-y-2">
			<h2 class="font-medium text-ledger">{m.settings_backup_auto()}</h2>
			<p class="text-sm text-dim">{m.settings_backup_auto_desc()}</p>
			<p class="text-xs text-dim">{m.settings_backup_auto_location()}</p>
		</div>
	</div>
</div>

<ConfirmDialog
	open={confirmImport}
	title={m.settings_backup_confirm_title()}
	message={m.settings_backup_confirm_message()}
	confirmLabel={m.settings_backup_confirm_label()}
	onconfirm={importDb}
/>
