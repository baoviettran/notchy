<script lang="ts">
	import { page } from '$app/stores';
	import { primaryNav, secondaryNav, icons, isActive } from '$lib/nav-items';
	import * as m from '$lib/paraglide/messages';

	// Locale reactivity: the layout shell is {#key}ed on settings.locale, so
	// this component remounts on a language switch and these constants
	// re-evaluate under the new language tag.
</script>

<aside class="hidden md:flex flex-col w-60 border-r border-line bg-tape h-full">
	<a href="/" class="flex items-center gap-2.5 px-5 h-14 border-b border-line">
		<span class="figures-glow text-lg leading-none">▮</span>
		<span class="figures text-ledger tracking-wide">{m.app_name()}</span>
	</a>
	<nav aria-label={m.a11y_primary_nav()} class="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
		<p class="plate px-3 pb-2 pt-1">{m.layout_ledger()}</p>
		{#each primaryNav as item}
			<a
				href={item.href}
				data-tour={item.tourId || undefined}
				aria-current={isActive(item.href, $page.url.pathname) ? 'page' : undefined}
				class="group flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors
					{isActive(item.href, $page.url.pathname)
						? 'bg-phosphor/10 text-phosphor-bright'
						: 'text-dim hover:text-ledger hover:bg-line/40'}"
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-[18px] h-[18px] shrink-0 {isActive(item.href, $page.url.pathname) ? 'text-phosphor' : ''}">
					<path d={icons[item.key]} />
				</svg>
				<span>{item.label()}</span>
			</a>
		{/each}
		<div class="my-3 mx-3 border-t border-line"></div>
		<p class="plate px-3 pb-2">{m.layout_more()}</p>
		{#each secondaryNav as item}
			<a
				href={item.href}
				data-tour={item.tourId || undefined}
				aria-current={isActive(item.href, $page.url.pathname) ? 'page' : undefined}
				class="group flex items-center gap-3 px-3 py-2 rounded-md text-sm transition-colors
					{isActive(item.href, $page.url.pathname)
						? 'bg-phosphor/10 text-phosphor-bright'
						: 'text-dim hover:text-ledger hover:bg-line/40'}"
			>
				<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-[18px] h-[18px] shrink-0 {isActive(item.href, $page.url.pathname) ? 'text-phosphor' : ''}">
					<path d={icons[item.key]} />
				</svg>
				<span>{item.label()}</span>
			</a>
		{/each}
	</nav>
	<div class="px-5 py-3 border-t border-line">
		<p class="plate">{m.layout_local_offline()}</p>
	</div>
</aside>
