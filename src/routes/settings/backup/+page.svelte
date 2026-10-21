<script lang="ts">
	import { onMount } from 'svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import { save, open } from '@tauri-apps/plugin-dialog';
	import { getDb } from '$lib/db';
	import { getBackupHealth, type BackupHealth } from '$lib/backup/health';
	import { toast } from '$lib/stores/toast.svelte';
	import { mapError } from '$lib/utils/errors';
	import { getInstalledAppVersion, openBackupFolder } from '$lib/db';
	import { profiles } from '$lib/stores/profiles.svelte';
	import { profileDialog } from '$lib/components/profiles/controller.svelte';
	import * as m from '$lib/paraglide/messages';

	let busy = $state(false);

	let health = $state<BackupHealth | null>(null);
	let healthError = $state<string | null>(null);
	let upgradeBackupDir = $state('');

	async function loadHealth() {
		try {
			const active = profiles.snapshot?.active;
			if (!active) throw new Error('no active profile');
			const [appVersion, paths] = await Promise.all([getInstalledAppVersion(), profiles.paths(active.profileId)]);
			upgradeBackupDir = paths.upgradeBackupDir;
			health = await getBackupHealth(getDb().meta, {
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
			const active = profiles.snapshot?.active;
			if (!active) return;
			await profiles.backup(active.profileId);
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
			const active = profiles.snapshot?.active;
			if (!active) return;
			await profiles.exportBackup(active.profileId, path);
			toast.show(m.settings_backup_toast_exported());
		} catch (e) {
			toast.show(m.settings_backup_toast_export_failed({ error: mapError(e) }));
		} finally {
			busy = false;
		}
	}

	async function exportCsvFiles() {
		try {
			busy = true;
			const dir = await open({ directory: true });
			if (!dir) return;
			await getDb().backup.exportCsv(dir);
			toast.show(m.settings_backup_toast_csv_exported());
		} catch (e) {
			toast.show(m.settings_backup_toast_export_failed({ error: mapError(e) }));
		} finally {
			busy = false;
		}
	}

</script>

<div class="space-y-6">
	<h1 class="page-title">{m.settings_backup()}</h1>

	<!-- Backup status: health info + manual backup action. -->
	<div class="surface rounded-lg p-4 space-y-3">
		<div class="flex flex-wrap items-center justify-between gap-2 gap-y-2">
			<h2 class="plate">{m.settings_backup_health()}</h2>
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
			<Skeleton lines={4} />
		{/if}
	</div>

	<!-- Data management: export, import, and auto-backup. -->
	<div class="surface rounded-lg p-4 space-y-2">
		<h2 class="plate">{m.settings_backup_export()}</h2>
		<p class="text-sm text-dim">{m.settings_backup_export_desc()}</p>
		<div class="flex gap-2">
			<Button size="sm" variant="secondary" disabled={busy} onclick={exportSqlite}>{m.settings_backup_export_sqlite()}</Button>
			<Button size="sm" variant="secondary" disabled={busy} onclick={exportCsvFiles}>{m.settings_backup_export_csv()}</Button>
		</div>
	</div>

	<div class="surface rounded-lg p-4 space-y-2">
		<h2 class="plate">{m.settings_backup_import()}</h2>
		<p class="text-sm text-dim">{m.settings_backup_import_desc()}</p>
		<Button size="sm" variant="danger" onclick={() => profileDialog.open('restore')}>{m.settings_backup_import_button()}</Button>
	</div>

	<div class="surface rounded-lg p-4 space-y-2">
		<h2 class="plate">{m.settings_backup_auto()}</h2>
		<p class="text-sm text-dim">{m.settings_backup_auto_desc()}</p>
		<p class="text-xs text-dim">{m.settings_backup_auto_location()}</p>
	</div>
</div>
