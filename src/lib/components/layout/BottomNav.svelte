<script lang="ts">
	import { page } from '$app/stores';
	import { slideUp } from '$lib/transitions/motion';
	import * as m from '$lib/paraglide/messages';
	import { createFocusTrap } from '$lib/utils/focusTrap';

	const tabs = [
		{ href: '/', label: m.layout_home(), d: 'M3 12h7V3H3zM14 21h7v-9h-7zM14 3v6h7V3zM3 21h7v-3H3z' },
		{ href: '/transactions', label: m.layout_trans(), d: 'M4 6h16M4 12h16M4 18h10', tourId: 'transactions' },
		{ href: '/budgets', label: m.layout_budget(), d: 'M3 17l5-5 4 4 8-8M21 8v5h-5', tourId: 'budgets' },
		{ href: '/reports', label: m.nav_reports(), d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' }
	];

	const moreItems = [
		{ href: '/accounts', label: m.nav_accounts(), d: 'M3 7h18v12H3zM3 11h18M7 15h4' },
		{ href: '/goals', label: m.nav_goals(), d: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2' },
		{ href: '/debts', label: m.nav_debts(), d: 'M3 12h13M11 7l5 5-5 5M19 4v16' },
		{ href: '/settings', label: m.nav_settings(), d: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2' }
	];

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

	function isActive(href: string, path: string): boolean {
		return href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<nav class="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-tape/95 backdrop-blur border-t border-line flex z-30 pb-[env(safe-area-inset-bottom)]">
	{#each tabs as tab}
		{@const active = isActive(tab.href, $page.url.pathname)}
		<a
			href={tab.href}
			data-tour={tab.tourId}
			aria-current={active ? 'page' : undefined}
			class="flex-1 flex flex-col items-center justify-center gap-1 text-[11px] transition-colors
				{active ? 'text-phosphor-bright' : 'text-dim'}"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 {active ? 'text-phosphor' : ''}">
				<path d={tab.d} />
			</svg>
			<span class="tracking-wide">{tab.label}</span>
		</a>
	{/each}

	<button
		onclick={toggleMore}
		aria-expanded={moreOpen}
		aria-haspopup="dialog"
		class="flex-1 flex flex-col items-center justify-center gap-1 text-[11px] transition-colors {moreOpen ? 'text-phosphor-bright' : 'text-dim'}"
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
	<div class="md:hidden fixed inset-0 bg-[rgb(var(--scrim-rgb)/0.5)] z-40" onclick={closeMore}></div>

	<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
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
						<path d={item.d} />
					</svg>
					<span class="text-xs tracking-wide">{item.label}</span>
				</a>
			{/each}
		</div>
	</div>
{/if}
