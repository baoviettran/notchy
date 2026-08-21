<script lang="ts">
	import Modal from '$lib/components/primitives/Modal.svelte';
	let { open = $bindable(false) }: { open?: boolean } = $props();
</script>

<button onclick={() => (open = true)}>Open</button>
<Modal bind:open>
	<button>First</button>
	<button>Second</button>
</Modal>
