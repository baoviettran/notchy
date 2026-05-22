<script lang="ts">
	import { page } from '$app/stores';

	const tabs = [
		{ href: '/', label: 'Home', icon: '🏠' },
		{ href: '/transactions', label: 'Trans', icon: '📋' },
		{ href: '/budgets', label: 'Budget', icon: '💰' },
		{ href: '/reports', label: 'Reports', icon: '📊' }
	];
</script>

<nav class="md:hidden fixed bottom-0 left-0 right-0 h-14 bg-white dark:bg-zinc-800 border-t border-zinc-200 dark:border-zinc-800 flex z-30">
	{#each tabs as tab}
		<a
			href={tab.href}
			class="flex-1 flex flex-col items-center justify-center text-xs transition-colors
				{$page.url.pathname === tab.href ? 'text-emerald-600' : 'text-zinc-500 dark:text-zinc-400'}"
		>
			<span class="text-lg">{tab.icon}</span>
			<span>{tab.label}</span>
		</a>
	{/each}
</nav>
