<script lang="ts">
	let {
		label,
		amount,
		tone = 'ledger',
		variant = 'line',
		note,
		title
	}: {
		label: string;
		amount: string;
		tone?: 'ledger' | 'dim' | 'phosphor' | 'debit';
		variant?: 'line' | 'subtotal' | 'total';
		/** Ruled secondary figure printed before the amount ("42%"). */
		note?: string;
		title?: string;
	} = $props();

	const tones = {
		ledger: 'text-ledger',
		dim: 'text-dim',
		phosphor: 'text-phosphor',
		debit: 'text-debit'
	};
</script>

<!-- One printed line of the tape: label, dotted leader, figure. Subtotal
     rows rule themselves off with a dashed seam; the total row closes the
     statement with a double rule and the resting VFD glow. -->
<div
	class="flex items-baseline gap-2 min-w-0 {variant === 'subtotal'
		? 'mt-2 pt-1.5 border-t border-dashed border-line/60'
		: ''} {variant === 'total' ? 'mt-3 pt-2 border-t-4 border-double border-line' : ''}"
>
	{#if variant === 'line'}
		<span class="text-sm truncate {tones[tone]}">{label}</span>
	{:else}
		<span class="plate {variant === 'total' ? '!text-ledger' : ''}">{label}</span>
	{/if}
	<span class="flex-1 border-b border-dotted border-line/70 -translate-y-1" aria-hidden="true"></span>
	{#if note}
		<span class="figures text-xs text-dim shrink-0">{note}</span>
	{/if}
	<span
		class="figures shrink-0 {variant === 'line' ? 'text-sm' : variant === 'subtotal' ? 'text-base' : 'text-lg'} {tones[tone]} {variant === 'total' ? 'figures-glow' : ''}"
		{title}
	>{amount}</span>
</div>
