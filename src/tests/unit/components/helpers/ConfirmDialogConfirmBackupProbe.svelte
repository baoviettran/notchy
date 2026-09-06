<script lang="ts">
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';

	// Mirrors src/routes/settings/backup/+page.svelte's import confirm shape:
	// one-way `open={confirmImport}`; importDb may early-return (native
	// picker cancelled → no path) and must clear confirmImport on every
	// path. Keep importDb in lockstep with the page's importDb.
	let confirmImport = $state(false);
	let pickedPath = $state<string | null>(null);

	async function importDb() {
		// Clear the trigger up front — this function also runs when the
		// picker is cancelled (early return), and a stale confirmImport
		// bricks the Import button (one-way open expression stuck at true).
		confirmImport = false;
		if (!pickedPath) return;
		pickedPath = null;
	}
</script>

<button data-testid="import-btn" onclick={() => (confirmImport = true)}>Import backup</button>
<button data-testid="pick" onclick={() => (pickedPath = '/backup.sqlite')}>Pick</button>

<ConfirmDialog open={confirmImport} title="Import?" message="M" confirmLabel="Confirm" onconfirm={importDb} />
