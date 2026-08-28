<script lang="ts">
	import { page } from '$app/stores';
	import * as m from '$lib/paraglide/messages';

	interface NavItem {
		href: string;
		label: () => string;
	}

	interface NavGroup {
		label: () => string;
		items: NavItem[];
	}

	const groups: NavGroup[] = [
		{
			label: () => m.reports_group_flow(),
			items: [
				{ href: '/reports', label: () => m.reports_overview() },
				{ href: '/reports/trend', label: () => m.reports_trend() },
				{ href: '/reports/yoy', label: () => m.reports_year_over_year() }
			]
		},
		{
			label: () => m.reports_group_breakdown(),
			items: [
				{ href: '/reports/category', label: () => m.reports_category_trend() },
				{ href: '/reports/composition', label: () => m.reports_composition() }
			]
		},
		{
			label: () => m.reports_group_compare(),
			items: [
				{ href: '/reports/compare', label: () => m.reports_compare() },
				{ href: '/reports/net-worth', label: () => m.reports_net_worth() }
			]
		}
	];

	function isActive(href: string, path: string): boolean {
		return path === href;
	}

	// The active group is whichever contains the current route.
	let activeGroup = $derived(groups.findIndex((g) => g.items.some((i) => isActive(i.href, $page.url.pathname))));
</script>

<div class="space-y-2">
	<!-- Category tabs: 3 grouped buttons replacing 7 flat tabs. -->
	<nav aria-label={m.reports_nav()}>
		<div class="flex gap-1.5" role="tablist">
			{#each groups as group, i}
				<a
					href={group.items[0].href}
					role="tab"
					aria-selected={activeGroup === i}
					class="inline-flex items-center min-h-9 pointer-coarse:min-h-11 px-3 rounded-md text-sm transition-colors
						{activeGroup === i
							? 'bg-phosphor/15 text-phosphor font-medium'
							: 'text-dim hover:bg-line/40'}"
				>{group.label()}</a>
			{/each}
		</div>
	</nav>

	<!-- Sub-items for the active group: compact pills below the category. -->
	{#if activeGroup >= 0}
		{@const current = groups[activeGroup]}
		<nav class="flex gap-1 text-xs overflow-x-auto scrollbar-none" aria-label={current.label()}>
			{#each current.items as item}
				<a
					href={item.href}
					aria-current={isActive(item.href, $page.url.pathname) ? 'page' : undefined}
					class="inline-flex items-center min-h-8 pointer-coarse:min-h-10 px-2.5 rounded transition-colors
						{isActive(item.href, $page.url.pathname)
							? 'bg-line/40 text-ledger font-medium'
							: 'text-dim hover:bg-line/30'}"
				>{item.label()}</a>
			{/each}
		</nav>
	{/if}
</div>
