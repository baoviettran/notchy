<script lang="ts">
	import * as m from '$lib/paraglide/messages';
</script>

<!-- Utility bar: search + language toggle only. Navigation lives in Sidebar
     (desktop) and BottomNav (mobile); the brand mark lives in the Sidebar.
     The old hamburger menu button was a dead button — the handler was never
     passed from +layout.svelte, and the Sidebar it revealed is hidden
     md:flex. Removed entirely; BottomNav's "More" sheet now carries the
     secondary destinations on mobile. -->
<header class="h-14 flex items-center gap-3 px-4 border-b border-line bg-tape shrink-0">
	<label class="relative block flex-1 max-w-md mx-auto">
		<span class="sr-only">{m.layout_search()}</span>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-dim pointer-events-none"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" stroke-linecap="round" /></svg>
		<input
			type="search"
			placeholder={m.layout_search_placeholder()}
			class="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-line bg-ink text-ledger placeholder:text-dim/70"
		/>
	</label>
	<button class="plate px-2 py-1 rounded border border-line text-dim hover:text-ledger">{m.layout_lang_label_en()}</button>
</header>
