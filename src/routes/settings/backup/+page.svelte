<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import Button from '$lib/components/primitives/Button.svelte';
	import Skeleton from '$lib/components/primitives/Skeleton.svelte';
	import { save, open } from '@tauri-apps/plugin-dialog';
	import { getDb, isTauri } from '$lib/db';
	import { automaticBackupState, sameBackupSession } from '$lib/backup/status.svelte';
	import { label } from '$lib/utils/i18n.svelte';
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
	let routineBackupDir = $state('');
	let automaticBusy = $state(false);
	let mounted = true;
	const automatic = $derived(sameBackupSession(automaticBackupState.session, profiles.snapshot?.active ?? null) ? automaticBackupState.status : null);
	const automaticError = $derived(sameBackupSession(automaticBackupState.session, profiles.snapshot?.active ?? null) && automaticBackupState.error);
	function warningLabel(key: string): string {
		if (key === 'backup_automatic_clock_warning') return m.backup_automatic_clock_warning();
		if (key === 'backup_automatic_prune_failed') return m.backup_automatic_prune_failed();
		return m.backup_automatic_failed();
	}
	async function updateAutomatic(enabled?: boolean) {
		const active = profiles.snapshot?.active;
		if (!active || automaticBusy) return;
		const bound = { ...active };
		if (!sameBackupSession(bound, automaticBackupState.session)) automaticBackupState.reset(bound);
		automaticBusy = true;
		try {
			const db = getDb();
			if (enabled !== undefined) await db.backup.setAutomaticEnabled(enabled);
			const status = enabled === undefined ? await db.backup.checkAutomatic() : await db.backup.automaticStatus();
			if (mounted && sameBackupSession(bound, profiles.snapshot?.active ?? null)) automaticBackupState.publish(bound, status);
		} catch {
			if (mounted && sameBackupSession(bound, profiles.snapshot?.active ?? null)) automaticBackupState.fail(bound);
		} finally { if (mounted) automaticBusy = false; }
	}
	async function changeAutomatic(input: HTMLInputElement) {
		await updateAutomatic(input.checked);
		// A failed write must restore the persisted value in the native control.
		input.checked = automatic?.enabled ?? false;
	}
	async function loadAutomatic() {
		const active = profiles.snapshot?.active;
		if (!active) return;
		const bound = { ...active };
		if (!sameBackupSession(bound, automaticBackupState.session)) automaticBackupState.reset(bound);
		try {
			const db = getDb();
			const status = await db.backup.automaticStatus();
			if (mounted && sameBackupSession(bound, profiles.snapshot?.active ?? null)) automaticBackupState.publish(bound, status);
		} catch { if (mounted && sameBackupSession(bound, profiles.snapshot?.active ?? null)) automaticBackupState.fail(bound); }
	}
	onDestroy(() => { mounted = false; });

	async function loadHealth() {
		try {
			const active = profiles.snapshot?.active;
			if (!active) throw new Error('no active profile');
			const [appVersion, paths] = await Promise.all([getInstalledAppVersion(), profiles.paths(active.profileId)]);
			if (!mounted || !sameBackupSession(active, profiles.snapshot?.active ?? null)) return;
			upgradeBackupDir = paths.upgradeBackupDir;
			routineBackupDir = paths.routineBackupDir;
			const nextHealth = await getBackupHealth(getDb().meta, {
				appVersion,
				databasePath: paths.databasePath,
				upgradeBackupDir: paths.upgradeBackupDir
			});
			if (!mounted || !sameBackupSession(active, profiles.snapshot?.active ?? null)) return;
			health = nextHealth;
			healthError = null;
		} catch (e) {
			if (mounted) healthError = mapError(e);
		}
	}

	onMount(() => {
		void loadHealth();
		void loadAutomatic();
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
		<p class="text-sm text-dim">{label(() => m.settings_backup_auto_desc())}</p>
		{#if !isTauri()}<p class="text-sm text-dim">{label(() => m.settings_backup_auto_browser())}</p>{/if}
		{#if automatic}
			<label class="flex items-center gap-3 py-2 text-sm text-ledger">
				<input type="checkbox" class="accent-phosphor h-4 w-4 focus-visible:ring-2 focus-visible:ring-phosphor" checked={automatic.enabled} disabled={automaticBusy} onchange={(event) => void changeAutomatic(event.currentTarget)} />
				{label(() => m.settings_backup_auto_enabled())}
			</label>
			<dl class="space-y-2 text-sm" aria-live="polite">
				<div><dt class="text-dim">{label(() => m.settings_backup_auto_last_success())}</dt><dd class="text-ledger">{automatic.lastSuccessAt ?? label(() => m.settings_backup_health_no_backup())}</dd></div>
				<div><dt class="text-dim">{label(() => m.settings_backup_auto_eligibility())}</dt><dd class="text-ledger">{!automatic.enabled ? label(() => m.settings_backup_auto_paused()) : automatic.nextEligibleDate ?? label(() => m.settings_backup_auto_first_check())}</dd></div>
				{#if isTauri()}<div><dt class="text-dim">{label(() => m.settings_backup_auto_location())}</dt><dd><code class="font-mono text-xs text-ledger break-all">{routineBackupDir}</code></dd></div>{/if}
			</dl>
		{:else if !automaticError}
			<Skeleton lines={3} />
		{/if}
		{#if automaticError || automatic?.warning || automatic?.pruneWarning}
			<div class="space-y-2" role="status">
				{#if automaticError}<p class="text-sm text-debit">{label(() => m.backup_automatic_failed())}</p>{/if}
				{#if automatic?.warning}<p class="text-sm text-debit">{label(() => warningLabel(automatic!.warning!))}</p>{/if}
				{#if automatic?.pruneWarning}<p class="text-sm text-debit">{label(() => warningLabel(automatic!.pruneWarning!))}</p>{/if}
				<Button size="sm" variant="secondary" disabled={automaticBusy} onclick={() => void updateAutomatic()}>{label(() => automaticBusy ? m.settings_backup_auto_checking() : m.settings_backup_auto_retry())}</Button>
			</div>
		{/if}
		{#if isTauri()}<p class="text-xs text-dim">{label(() => m.settings_backup_auto_same_disk())}</p>{/if}
	</div>
</div>
