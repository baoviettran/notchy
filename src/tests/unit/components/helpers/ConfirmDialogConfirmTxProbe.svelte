<script lang="ts">
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';

	// Mirrors src/routes/transactions/+page.svelte's delete confirm shape:
	// one-way `open={showDeleteConfirm}` with a boolean + pendingDeleteTx.
	// Keep the doDelete body in lockstep with the page's doDelete — the
	// confirm handler must reset BOTH states, or the open expression can
	// never flip again after a confirmed delete (true-over-true → no
	// re-propagation → dialog stays shut).
	let showDeleteConfirm = $state(false);
	let pendingDeleteTx = $state<string | null>(null);

	function confirmDelete(tx: string) {
		pendingDeleteTx = tx;
		showDeleteConfirm = true;
	}
	function doDelete() {
		if (!pendingDeleteTx) return;
		showDeleteConfirm = false;
		pendingDeleteTx = null;
	}
</script>

<button data-testid="del-1" onclick={() => confirmDelete('Tx 1')}>Delete 1</button>
<button data-testid="del-2" onclick={() => confirmDelete('Tx 2')}>Delete 2</button>

<ConfirmDialog open={showDeleteConfirm} title={pendingDeleteTx ?? ''} message="M" confirmLabel="OK" onconfirm={doDelete} />
