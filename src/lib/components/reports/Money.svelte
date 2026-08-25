<script lang="ts">
	import { formatCurrency, formatCurrencyCompact, isLongCurrency } from '$lib/utils/currency';
	import { settings } from '$lib/stores/settings.svelte';

	let {
		amount,
		tone = 'ledger',
		glow = false,
		glyph,
		size = 'text-sm',
		class: klass = ''
	}: {
		amount: number;
		tone?: 'ledger' | 'dim' | 'phosphor' | 'debit';
		glow?: boolean;
		/** Literal glyph printed before the figure ('−', '+', 'Δ'…); defaults to − for negatives. */
		glyph?: string;
		size?: string;
		class?: string;
	} = $props();

	const tones = {
		ledger: 'text-ledger',
		dim: 'text-dim',
		phosphor: 'text-phosphor',
		debit: 'text-debit'
	};

	const long = $derived(isLongCurrency(amount, settings.currency, settings.locale));
	const resolvedGlyph = $derived(glyph !== undefined ? glyph : amount < 0 ? '−' : '');
</script>

<!-- The one way figures print: mono tabular numerals, compact when the
     exact form is too long to compose, glyph paired so color never carries
     meaning alone. When compacted, the visible text is hidden from
     assistive tech and the full-precision figure is announced instead —
     title is a mouse affordance, never the accessibility path. -->
<span
	class="figures {size} {tones[tone]} {glow ? 'figures-glow' : ''} {klass}"
	title={long ? formatCurrency(amount, settings.currency, settings.locale) : undefined}
>
	<span aria-hidden="true">{resolvedGlyph}{long
			? formatCurrencyCompact(Math.abs(amount), settings.currency, settings.locale)
			: formatCurrency(Math.abs(amount), settings.currency, settings.locale)}</span>
	{#if long}
		<span class="sr-only">{resolvedGlyph}{formatCurrency(amount, settings.currency, settings.locale)}</span>
	{/if}
</span>
