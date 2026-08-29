<script lang="ts">
	import DatePicker from '$lib/components/primitives/DatePicker.svelte';
	// Test-only wrapper: two-way-binds DatePicker's `value` and mirrors it into a
	// DOM node. Svelte 5 $bindable isn't reflected on the component instance, so
	// the probe is the oracle for date selection.
	let { label = '', initial = '', disabled = false }: { label?: string; initial?: string; disabled?: boolean } = $props();
	let value = $state(initial);
</script>

<DatePicker {label} {disabled} bind:value />
<div data-testid="value">{value}</div>