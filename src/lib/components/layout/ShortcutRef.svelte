<script lang="ts">
	import Modal from '$lib/components/primitives/Modal.svelte';
	import * as m from '$lib/paraglide/messages';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	const shortcuts = [
		{ key: 'n', label: () => m.shortcuts_new_tx() },
		{ key: '/', label: () => m.shortcuts_search() },
		{ key: '?', label: () => m.shortcuts_help() },
		{ key: 'Esc', label: () => m.shortcuts_close() }
	];
</script>

<Modal bind:open title={m.shortcuts_title()}>
	<div class="space-y-3">
		{#each shortcuts as s}
			<div class="flex items-center justify-between">
				<span class="text-sm text-ledger">{s.label()}</span>
				<kbd class="px-2 py-1 text-xs font-mono text-phosphor bg-ink/40 border border-line rounded">{s.key}</kbd>
			</div>
		{/each}
	</div>
</Modal>
