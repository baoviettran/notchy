<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	import { save, open } from '@tauri-apps/plugin-dialog';
	import { writeTextFile } from '@tauri-apps/plugin-fs';
	import { getDb } from '$lib/db';
	import { exportCsv, importDatabase } from '$lib/backup';
	import { toast } from '$lib/stores/toast.svelte';
	import * as m from '$lib/paraglide/messages';

	let confirmImport = $state(false);
	let busy = $state(false);

	async function exportSqlite() {
		try {
			busy = true;
			const path = await save({
				defaultPath: `notchy-${new Date().toISOString().split('T')[0]}.sqlite`,
				filters: [{ name: 'SQLite Database', extensions: ['sqlite', 'db'] }]
			});
			if (!path) return;
			const db = await getDb();
			await db.execute(`VACUUM INTO '${path.replace(/'/g, "''")}'`);
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
			const db = await getDb();
			const csvMap = await exportCsv(db);
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
			const result = await importDatabase(path, 3);
			if (!result.valid) {
				toast.show(m.settings_backup_toast_import_rejected({ error: result.error ?? '' }));
				return;
			}
			toast.show(m.settings_backup_toast_imported());
			// The live connection was closed and the file replaced; reload the app
			// so getDb() reopens the new database and migrations re-run.
			setTimeout(() => globalThis.location.reload(), 800);
		} catch (e) {
			toast.show(m.settings_backup_toast_import_failed({ error: String(e) }));
		} finally {
			busy = false;
		}
	}
</script>

<div class="space-y-6">
	<h1 class="figures text-xl text-ledger tracking-wide">{m.settings_backup()}</h1>

	<div class="space-y-4">
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
