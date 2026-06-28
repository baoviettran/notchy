<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	import { save, open } from '@tauri-apps/plugin-dialog';
	import { writeTextFile } from '@tauri-apps/plugin-fs';
	import { getDb } from '$lib/db';
	import { exportCsv, importDatabase } from '$lib/backup';
	import { toast } from '$lib/stores/toast.svelte';

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
			await db.execute(`VACUUM INTO ?`, [path]);
			toast.show('Database exported.');
		} catch (e) {
			toast.show(`Export failed: ${e}`);
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
			toast.show('CSV files exported.');
		} catch (e) {
			toast.show(`Export failed: ${e}`);
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
				toast.show(`Import rejected: ${result.error}`);
				return;
			}
			toast.show('Database imported. Reloading…');
			// The live connection was closed and the file replaced; reload the app
			// so getDb() reopens the new database and migrations re-run.
			setTimeout(() => globalThis.location.reload(), 800);
		} catch (e) {
			toast.show(`Import failed: ${e}`);
		} finally {
			busy = false;
		}
	}
</script>

<div class="space-y-6">
	<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Backup & Data</h1>

	<div class="space-y-4">
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2">
			<h2 class="font-medium text-zinc-900 dark:text-zinc-50">Export</h2>
			<p class="text-sm text-zinc-500">Download your data as a SQLite file (most durable) or CSV per table.</p>
			<div class="flex gap-2">
				<Button size="sm" variant="secondary" disabled={busy} onclick={exportSqlite}>Export SQLite</Button>
				<Button size="sm" variant="secondary" disabled={busy} onclick={exportCsvFiles}>Export CSV</Button>
			</div>
		</div>

		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2">
			<h2 class="font-medium text-zinc-900 dark:text-zinc-50">Import</h2>
			<p class="text-sm text-zinc-500">Replace your database with an imported file. This cannot be undone.</p>
			<Button size="sm" variant="danger" onclick={() => confirmImport = true}>Import database</Button>
		</div>

		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2">
			<h2 class="font-medium text-zinc-900 dark:text-zinc-50">Auto-backup</h2>
			<p class="text-sm text-zinc-500">Backups are created automatically on every launch. The 10 most recent are retained.</p>
			<p class="text-xs text-zinc-400">Location: same folder as the database file.</p>
		</div>
	</div>
</div>

<ConfirmDialog
	open={confirmImport}
	title="Replace database?"
	message="Importing will REPLACE all current data. Make sure you've exported a backup first. Continue?"
	confirmLabel="Continue"
	onconfirm={importDb}
/>
