<script lang="ts">
	import Autocomplete from '$lib/components/primitives/Autocomplete.svelte';
	// Test-only wrapper: two-way-binds the Autocomplete value and mirrors it
	// into a DOM node so jsdom tests can observe the bound state. Svelte 5
	// $bindable is not reflected on the component instance, and the controlled
	// input's .value is unreliable in jsdom, so this probe is the oracle.
	let {
		options,
		allowFreeText = false,
		initial = ''
	}: {
		options: { value: string; label: string }[];
		allowFreeText?: boolean;
		initial?: string;
	} = $props();

	let value = $state(initial);
</script>

<Autocomplete label="Probe" bind:value {options} {allowFreeText} />
<div data-testid="probe">{value}</div>
