<script lang="ts">
	import { page } from '$app/stores';
	import * as m from '$lib/paraglide/messages';

	const primaryNav = [
		{ href: '/', key: 'dashboard', label: () => m.nav_dashboard() },
		{ href: '/transactions', key: 'transactions', label: () => m.nav_transactions() },
		{ href: '/budgets', key: 'budgets', label: () => m.nav_budgets() },
		{ href: '/reports', key: 'reports', label: () => m.nav_reports() }
	];
	const secondaryNav = [
		{ href: '/accounts', key: 'accounts', label: () => m.nav_accounts() },
		{ href: '/goals', key: 'goals', label: () => m.nav_goals() },
		{ href: '/debts', key: 'debts', label: () => m.nav_debts() },
		{ href: '/settings', key: 'settings', label: () => m.nav_settings() }
	];

	function isActive(href: string, path: string): boolean {
		return href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
	}

	// Single-stroke glyph set — one visual language across nav.
	const icons: Record<string, string> = {
		dashboard: 'M3 12h7V3H3zM14 21h7v-9h-7zM14 3v6h7V3zM3 21h7v-3H3z',
		transactions: 'M4 6h16M4 12h16M4 18h10',
		budgets: 'M3 17l5-5 4 4 8-8M21 8v5h-5',
		reports: 'M4 20V10M10 20V4M16 20v-7M22 20H2',
		accounts: 'M3 7h18v12H3zM3 11h18M7 15h4',
		goals: 'M12 3a9 9 0 100 18 9 9 0 000-18zM12 7v5l3 2',
		debts: 'M3 12h13M11 7l5 5-5 5M19 4v16',
		settings: 'M12 9a3 3 0 100 6 3 3 0 000-6zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2'
	};
</script>

<aside class="hidden md:flex flex-col w-60 border-r border-line bg-tape h-full">
	<a href="/" class="flex items-center gap-2.5 px-5 h-14 border-b border-line">
		<span class="figures-glow text-lg leading-none">▮</span>
		<span class="figures text-ledger tracking-wide">{m.app_name()}</span>
	</a>
	<nav class="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
		<p class="plate px-3 pb-2 pt-1">{m.layout_ledger()}</p>
		{#each primaryNav as item}
			<a
				href={item.href}
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
