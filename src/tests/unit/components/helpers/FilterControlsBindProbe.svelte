<script lang="ts">
	import FilterControls from '$lib/components/primitives/FilterControls.svelte';
	// Test-only wrapper: two-way-binds FilterControls' four bindable filter props
	// and mirrors each into DOM nodes. Svelte 5 $bindable isn't reflected on the
	// component instance, so this probe is the oracle for each selection.
	let kind = $state('');
	let account = $state('');
	let tag = $state('');
	let month = $state('');
</script>

<FilterControls bind:filterKind={kind} bind:filterAccount={account} bind:filterTag={tag} bind:filterMonth={month} />
<span data-testid="kind">{kind}</span>
<span data-testid="account">{account}</span>
<span data-testid="tag">{tag}</span>
<span data-testid="month">{month}</span>