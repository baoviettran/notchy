<script lang="ts">
	import { page } from '$app/stores';
	import * as m from '$lib/paraglide/messages';

	const tabs = [
		{ href: '/', label: m.layout_home(), d: 'M3 12h7V3H3zM14 21h7v-9h-7zM14 3v6h7V3zM3 21h7v-3H3z' },
		{ href: '/transactions', label: m.layout_trans(), d: 'M4 6h16M4 12h16M4 18h10' },
		{ href: '/budgets', label: m.layout_budget(), d: 'M3 17l5-5 4 4 8-8M21 8v5h-5' },
		{ href: '/reports', label: m.nav_reports(), d: 'M4 20V10M10 20V4M16 20v-7M22 20H2' }
	];

	function isActive(href: string, path: string): boolean {
		return href === '/' ? path === '/' : path === href || path.startsWith(href + '/');
	}
</script>

<nav class="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-tape/95 backdrop-blur border-t border-line flex z-30 pb-[env(safe-area-inset-bottom)]">
	{#each tabs as tab}
		{@const active = isActive(tab.href, $page.url.pathname)}
		<a
			href={tab.href}
			aria-current={active ? 'page' : undefined}
			class="flex-1 flex flex-col items-center justify-center gap-1 text-[10px] transition-colors
				{active ? 'text-phosphor-bright' : 'text-dim'}"
		>
			<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" class="w-5 h-5 {active ? 'text-phosphor' : ''}">
				<path d={tab.d} />
			</svg>
			<span class="tracking-wide">{tab.label}</span>
		</a>
	{/each}
</nav>
