<script lang="ts">
	import { page } from '$app/stores';
	import { slideUp } from '$lib/transitions/motion';
	import { primaryNav, secondaryNav, icons, isActive } from '$lib/nav-items';
	import * as m from '$lib/paraglide/messages';
	import { createFocusTrap } from '$lib/utils/focusTrap';

	// BottomNav shows primary tabs + a "More" button that opens a sheet
	// with secondary items.
	const moreItems = secondaryNav;

	let moreOpen = $state(false);
	let sheetEl = $state<HTMLElement | null>(null);
	const focusTrap = createFocusTrap();

	function toggleMore() {
		moreOpen = !moreOpen;
	}

	function closeMore() {
		moreOpen = false;
	}

	function handleKeydown(event: KeyboardEvent) {
		if (event.key === 'Escape') {
			closeMore();
		}
	}

	// Focus lifecycle: capture the trigger, move focus to the first sheet link
	// when it opens, trap Tab within the sheet, restore focus on close.
	$effect(() => {
		if (moreOpen) return focusTrap.enter(() => sheetEl ?? undefined);
	});
</script>

<svelte:window onkeydown={handleKeydown} />

<nav class="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-tape/95 backdrop-blur border-t border-line flex z-30 pb-[env(safe-area-inset-bottom)]">
	{#each primaryNav as tab}
		{@const active = isActive(tab.href, $page.url.pathname)}
		<a
			href={tab.href}
			data-tour={tab.tourId}
			aria-current={active ? 'page' : undefined}
			class="flex-1 flex flex-col items-center justify-center gap-1 text-xs transition-colors
				{active ? 'text-phosphor-bright' : 'text-dim'}"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 {active ? 'text-phosphor' : ''}">
				<path d={icons[tab.key]} />
			</svg>
			<span class="tracking-wide">{tab.label()}</span>
		</a>
	{/each}

	<button
		onclick={toggleMore}
		aria-expanded={moreOpen}
		aria-haspopup="dialog"
		class="flex-1 flex flex-col items-center justify-center gap-1 text-xs transition-colors {moreOpen ? 'text-phosphor-bright' : 'text-dim'}"
	>
		<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 {moreOpen ? 'text-phosphor' : ''}">
			<path d="M4 8h16M4 12h16M4 16h16" />
		</svg>
		<span class="tracking-wide">{m.layout_more()}</span>
	</button>
</nav>

{#if moreOpen}
	<!-- svelte-ignore a11y_click_events_have_key_events -->
	<!-- svelte-ignore a11y_no_static_element_interactions -->
	<div class="md:hidden fixed inset-0 bg-[rgb(var(--scrim-rgb)/var(--scrim-nav))] z-40" onclick={closeMore}></div>

	<div
		bind:this={sheetEl}
		tabindex="-1"
		onkeydown={(e) => focusTrap.trap(e, sheetEl ?? undefined)}
		role="dialog"
		aria-label={m.layout_more()}
		class="md:hidden fixed bottom-16 left-0 right-0 bg-tape border-t border-line rounded-t-lg p-4 z-50"
		transition:slideUp
	>
		<div class="grid grid-cols-4 gap-4">
			{#each moreItems as item}
				{@const active = isActive(item.href, $page.url.pathname)}
				<a
					href={item.href}
					onclick={closeMore}
					class="flex flex-col items-center gap-2 p-3 rounded-lg transition-colors {active ? 'text-phosphor-bright' : 'text-dim'}"
				>
					<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-6 h-6 {active ? 'text-phosphor' : ''}">
						<path d={icons[item.key]} />
					</svg>
					<span class="text-xs tracking-wide">{item.label()}</span>
				</a>
			{/each}
		</div>
	</div>
{/if}
