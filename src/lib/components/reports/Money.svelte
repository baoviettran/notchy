<script lang="ts">
	import { formatCurrency, formatCurrencyCompact, isLongCurrency } from '$lib/utils/currency';
	import { settings } from '$lib/stores/settings.svelte';
	import * as m from '$lib/paraglide/messages';

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

	// A new figure invalidates the expansion — the exact value it displayed no
	// longer matches what a list row now carries, so collapse back to compact.
	let expanded = $state(false);
	$effect(() => {
		amount;
		expanded = false;
	});
</script>

<!-- The one way figures print: mono tabular numerals, compact when the
     exact form is too long to compose, glyph paired so color never carries
     meaning alone. When compacted, the compact form is a real button — the
     title tooltip is a mouse-only hint, never the accessibility path — that
     expands to the full-precision figure and back. Short figures stay a
     plain span. -->
<span
	class="figures {size} {tones[tone]} {glow ? 'figures-glow' : ''} {klass}"
	title={long ? formatCurrency(amount, settings.currency, settings.locale) : undefined}
>
	{#if long}
		<button
			type="button"
			class="figures-expand {size} {tones[tone]}"
			aria-label={expanded ? m.figures_show_compact() : m.figures_show_exact()}
			onclick={() => (expanded = !expanded)}
		>
			{#if expanded}
				{resolvedGlyph}{formatCurrency(amount, settings.currency, settings.locale)}
			{:else}
				<span aria-hidden="true">{resolvedGlyph}{formatCurrencyCompact(Math.abs(amount), settings.currency, settings.locale)}</span>
				<span class="sr-only">{resolvedGlyph}{formatCurrency(amount, settings.currency, settings.locale)}</span>
			{/if}
		</button>
	{:else}
		<span aria-hidden="true">{resolvedGlyph}{formatCurrency(Math.abs(amount), settings.currency, settings.locale)}</span>
	{/if}
</span>
