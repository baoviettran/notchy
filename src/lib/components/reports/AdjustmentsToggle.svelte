<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let {
		checked = $bindable(false)
	}: {
		checked?: boolean;
	} = $props();
</script>

<!-- Same switch vocabulary as the rest of the app — a raw native
     checkbox would break the control language of the ledger. -->
<button
	type="button"
	role="switch"
	aria-checked={checked}
	onclick={() => (checked = !checked)}
	class="flex items-center gap-2 text-sm text-dim hover:text-ledger transition-colors min-h-9 pointer-coarse:min-h-11"
>
	<span
		aria-hidden="true"
		class="w-8 h-4.5 rounded-full border border-line relative transition-colors {checked
			? 'bg-phosphor/20'
			: 'bg-ink'}"
	>
		<span
			class="absolute top-1/2 -translate-y-1/2 w-3 h-3 rounded-full transition-all {checked
				? 'left-4 bg-phosphor'
				: 'left-0.5 bg-dim'}"
		></span>
	</span>
	{m.reports_include_adjustments()}
</button>
