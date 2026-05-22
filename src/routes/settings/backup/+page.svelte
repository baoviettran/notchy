<script lang="ts">
	import Button from '$lib/components/primitives/Button.svelte';
</script>

<div class="space-y-6">
	<h1 class="text-xl font-semibold text-zinc-900 dark:text-zinc-50">Backup & Data</h1>

	<div class="space-y-4">
		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2">
			<h2 class="font-medium text-zinc-900 dark:text-zinc-50">Export</h2>
			<p class="text-sm text-zinc-500">Download your data as a SQLite file or CSV.</p>
			<div class="flex gap-2">
				<Button size="sm" variant="secondary">Export SQLite</Button>
				<Button size="sm" variant="secondary">Export CSV</Button>
			</div>
		</div>

		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2">
			<h2 class="font-medium text-zinc-900 dark:text-zinc-50">Import</h2>
			<p class="text-sm text-zinc-500">Replace your database with an imported file. This cannot be undone.</p>
			<Button size="sm" variant="danger">Import database</Button>
		</div>

		<div class="bg-white dark:bg-zinc-800 rounded-lg border border-zinc-200 dark:border-zinc-700 p-4 space-y-2">
			<h2 class="font-medium text-zinc-900 dark:text-zinc-50">Auto-backup</h2>
			<p class="text-sm text-zinc-500">Backups are created automatically on every launch. The 10 most recent are retained.</p>
		</div>
	</div>
</div>
