<script lang="ts">
	import { goto } from '$app/navigation';
	import { transactionsSearchUrl } from '$lib/utils/search';
	import { settings } from '$lib/stores/settings.svelte';
	import * as m from '$lib/paraglide/messages';

	let search = $state('');

	// Bridge: track settings.locale in a local $state so Svelte re-renders
	// the template (and re-evaluates m.*() calls) when the language changes.
	let _locale = $state(settings.locale);
	$effect(() => { _locale = settings.locale; });

	function onSearchKeydown(event: KeyboardEvent) {
		if (event.key === 'Enter') {
			goto(transactionsSearchUrl(search));
		}
	}
</script>

<header class="h-14 flex items-center gap-3 px-4 border-b border-line bg-tape shrink-0">
	<label class="relative block flex-1 max-w-md mx-auto">
		<span class="sr-only">{m.layout_search()}</span>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-dim pointer-events-none"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" stroke-linecap="round" /></svg>
		<input
			type="search"
			placeholder={m.layout_search_placeholder()}
			bind:value={search}
			onkeydown={onSearchKeydown}
			class="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-line bg-ink text-ledger placeholder:text-dim"
		/>
	</label>
	<button
		onclick={() => settings.setLocale(_locale === 'en' ? 'vi' : 'en')}
		aria-label={_locale === 'en' ? m.layout_lang_toggle_en() : m.layout_lang_toggle_vi()}
		class="plate px-2 py-2 rounded border border-line text-dim hover:text-ledger"
	>
		{_locale === 'en' ? m.layout_lang_label_vi() : m.layout_lang_label_en()}
	</button>
</header>
