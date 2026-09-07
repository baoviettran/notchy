<script lang="ts">
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	let { open = $bindable(false) }: { open?: boolean } = $props();
</script>

<ConfirmDialog bind:open title="T" message="M" confirmLabel="OK">
	<select data-testid="merge-target">
		<option>x</option>
	</select>
</ConfirmDialog>
