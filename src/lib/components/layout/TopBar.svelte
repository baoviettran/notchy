<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let { onMenuToggle = () => {} }: { onMenuToggle?: () => void } = $props();
</script>

<header class="h-14 flex items-center gap-3 px-4 border-b border-line bg-tape shrink-0">
	<button class="md:hidden p-1.5 -ml-1 text-dim hover:text-ledger" onclick={onMenuToggle} aria-label={m.layout_menu()}>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" class="w-5 h-5"><path d="M4 6h16M4 12h16M4 18h16" /></svg>
	</button>
	<a href="/" class="md:hidden flex items-center gap-2">
		<span class="figures-glow text-base leading-none">▮</span>
		<span class="figures text-ledger tracking-wide">Notchy</span>
	</a>
	<div class="hidden md:block flex-1 max-w-md mx-auto">
		<label class="relative block">
			<span class="sr-only">{m.layout_search()}</span>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-dim pointer-events-none"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" stroke-linecap="round" /></svg>
			<input
				type="search"
				placeholder={m.layout_search_placeholder()}
				class="w-full pl-8 pr-3 py-1.5 text-sm rounded-md border border-line bg-ink text-ledger placeholder:text-dim/70"
			/>
		</label>
	</div>
	<div class="flex-1 md:hidden"></div>
	<div class="flex items-center gap-2">
		<button class="md:hidden p-1.5 text-dim hover:text-ledger" aria-label={m.layout_search()}>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" class="w-5 h-5"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" stroke-linecap="round" /></svg>
		</button>
		<button class="plate px-2 py-1 rounded border border-line text-dim hover:text-ledger">EN</button>
	</div>
</header>
