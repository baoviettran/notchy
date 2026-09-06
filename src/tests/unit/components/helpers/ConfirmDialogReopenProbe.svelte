<script lang="ts">
	import ConfirmDialog from '$lib/components/primitives/ConfirmDialog.svelte';
	let { onclose }: { onclose?: () => void } = $props();

	// Mirrors the categories delete page: a one-way `open={target !== null}`
	// prop with the parent holding the target. An internal close (Cancel, Esc,
	// backdrop) must surface through onclose, otherwise the parent's state
	// stays non-null and the dialog can never be reopened.
	let target = $state<string | null>(null);
</script>

<button data-testid="open-a" onclick={() => (target = 'Tag A')}>Delete A</button>
<button data-testid="open-b" onclick={() => (target = 'Tag B')}>Delete B</button>

<ConfirmDialog
	open={target !== null}
	title={target ?? ''}
	message="M"
	confirmLabel="OK"
	onclose={() => { target = null; onclose?.(); }}
/>
