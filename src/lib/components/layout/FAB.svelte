<script lang="ts">
	import * as m from '$lib/paraglide/messages';

	let { onclick = () => {} }: { onclick?: () => void } = $props();
</script>

<!-- The keypad "+" — the adding machine's only physical key. -->
<button
	{onclick}
	data-tour="add"
		class="group fixed bottom-20 right-5 md:bottom-8 md:right-8 w-14 h-14 rounded-full flex items-center justify-center z-40
		bg-phosphor text-ink hover:brightness-110 transition-[filter,colors]
		shadow-[0_0_0_1px_rgb(var(--phosphor-rgb)/0.3),0_8px_24px_-4px_rgb(var(--phosphor-rgb)/0.5)]"
	aria-label={m.layout_add_transaction()}
>
	<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" class="w-6 h-6 pointer-fine:group-hover:scale-105 transition-transform">
		<path d="M12 5v14M5 12h14" />
	</svg>
</button>
