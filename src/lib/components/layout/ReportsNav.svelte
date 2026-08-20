<script lang="ts">
	import { page } from '$app/stores';
	import * as m from '$lib/paraglide/messages';

	const items = [
		{ href: '/reports', label: () => m.reports_overview() },
		{ href: '/reports/trend', label: () => m.reports_trend() },
		{ href: '/reports/compare', label: () => m.reports_compare() },
		{ href: '/reports/net-worth', label: () => m.reports_net_worth() },
		{ href: '/reports/category', label: () => m.reports_category_trend() },
		{ href: '/reports/composition', label: () => m.reports_composition() },
		{ href: '/reports/yoy', label: () => m.reports_year_over_year() }
	];

	function isActive(href: string, path: string): boolean {
		return path === href;
	}
</script>

<nav class="flex flex-wrap gap-2 text-sm">
	{#each items as item}
		<a
			href={item.href}
			aria-current={isActive(item.href, $page.url.pathname) ? 'page' : undefined}
			class="px-3 py-1.5 rounded-md transition-colors
				{isActive(item.href, $page.url.pathname)
					? 'bg-phosphor/15 text-phosphor font-medium'
					: 'text-dim hover:bg-line/40'}"
		>{item.label()}</a>
	{/each}
</nav>
